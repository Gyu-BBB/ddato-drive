import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import ssh2 from 'ssh2';
import { config } from '../../core/config.js';
import { fail } from '../../core/errors.js';
import { fileRepository } from '../files/FileRepository.js';
import { fileService } from '../files/FileService.js';
import { fileStorage } from '../files/FileStorage.js';
import { fileNamePolicy } from '../files/FileNamePolicy.js';
import { resolveUploadConflict } from '../files/UploadConflictPolicy.js';
import { multipartReservationStore } from '../files/MultipartReservationStore.js';
import { uploadSessionStore } from '../files/UploadSessionStore.js';
import { accessPasswordService } from '../protection/AccessPasswordService.js';
import { auditLogger } from '../audit/AuditLogger.js';
import { sshCredentials } from './SshCredentials.js';
import { withTransaction, getDb } from '../../database/database.js';
import { acquireSshTransfer } from './SshTransferAdmission.js';

const { STATUS_CODE: S, OPEN_MODE: O } = ssh2.utils.sftp;
const activeTempPaths = new Set();
export async function cleanupSshTemps() {
  for (const name of await fs.readdir(config.tempDir)) {
    if (!/^ssh-[a-f0-9-]{36}$/.test(name)) continue;
    const target = path.join(config.tempDir, name); if (activeTempPaths.has(target)) continue;
    const stat = await fs.lstat(target).catch(() => null);
    if (stat && stat.mtimeMs < Date.now() - 86400000) await fs.rm(target, { force: true });
  }
}
export class DriveSftpSession {
  constructor(stream, identity, ip, onActivity = () => {}) {
    this.stream = stream; this.identity = identity; this.handles = new Map(); this.chain = Promise.resolve(); this.closed = false;
    this.req = { user: identity.user, sessionToken: `ssh:${crypto.randomUUID()}`, headers: {}, socket: { remoteAddress: ip } };
    this.onActivity = onActivity;
    this.install();
  }
  check() { if (this.closed) fail(403, 'Connection closed'); this.req.user = sshCredentials.assertActive(this.identity.user.id, this.identity.hash); }
  resolve(raw, { parent = false, allowLocked = false } = {}) {
    if (typeof raw !== 'string' || raw.includes('\0') || raw.length > 4096) fail(400, 'Invalid path');
    const normalized = path.posix.resolve('/', raw).normalize('NFC');
    const parts = normalized.split('/').filter(Boolean); const name = parent ? parts.pop() : null;
    let row = null;
    for (const part of parts) {
      if (row && row.type !== 'folder') fail(404, 'Folder not found');
      row = fileRepository.findByName(this.req.user.id, row?.id || null, part);
      if (!row) fail(404, 'File not found');
    }
    if (row && !allowLocked) accessPasswordService.assertFileAccess(this.req, row);
    return parent ? { folder: row, name, normalized } : row;
  }
  attrs(row) {
    return { mode: row?.type === 'file' ? 0o100600 : 0o40700, size: Number(row?.size_bytes || 0), uid: 0, gid: 0,
      atime: Math.floor((row?.updated_at || Date.now()) / 1000), mtime: Math.floor((row?.source_modified_at || row?.updated_at || Date.now()) / 1000) };
  }
  handle(token) { const entry = this.handles.get(token.toString('hex')); if (!entry) fail(400, 'Invalid handle'); return entry; }
  add(entry) {
    if (this.handles.size >= 32) fail(429, 'Too many open handles');
    const token = crypto.randomBytes(16); this.handles.set(token.toString('hex'), entry); return token;
  }
  on(event, action) {
    this.stream.on(event, (id, ...args) => {
      this.onActivity();
      this.pending = (this.pending || 0) + 1;
      if (this.pending > 256) { this.stream.end(); return; }
      this.chain = this.chain.then(async () => {
        try { this.check(); await action(id, ...args); }
        catch (error) {
          if (!this.closed) this.stream.status(id, error.statusCode === 404 ? S.NO_SUCH_FILE : [401, 403, 423].includes(error.statusCode) ? S.PERMISSION_DENIED : S.FAILURE,
            error.statusCode && error.statusCode < 500 ? error.message : 'File operation failed');
        } finally { this.pending--; }
      }).catch(() => {});
    });
  }
  install() {
    const s = this.stream;
    s.on('error', () => { void this.shutdown(); });
    this.on('REALPATH', (id, raw) => {
      const normalized = path.posix.resolve('/', raw); let row;
      try { row = this.resolve(normalized); }
      catch (error) {
        if (error.statusCode !== 404) throw error;
        const { folder } = this.resolve(normalized, { parent: true });
        if (folder && folder.type !== 'folder') throw error;
      }
      s.name(id, [{ filename: normalized, longname: normalized, attrs: this.attrs(row) }]);
    });
    for (const event of ['STAT', 'LSTAT']) this.on(event, (id, raw) => s.attrs(id, this.attrs(this.resolve(raw))));
    this.on('FSTAT', (id, token) => { const h = this.handle(token); if (h.row) { h.row = fileService.getAccessibleFile(this.req.user, h.row.id); accessPasswordService.assertFileAccess(this.req, h.row); } s.attrs(id, h.upload ? { ...this.attrs(null), mode: 0o100600, size: h.size } : this.attrs(h.row)); });
    this.on('OPENDIR', (id, raw) => {
      const row = this.resolve(raw); if (row && row.type !== 'folder') fail(400, 'Not a folder');
      s.handle(id, this.add({ directory: true, cursor: '', parent: row }));
    });
    this.on('READDIR', (id, token) => {
      const h = this.handle(token); if (!h.directory) fail(400, 'Not a directory handle');
      if (h.parent) accessPasswordService.assertFileAccess(this.req, fileService.getAccessibleFile(this.req.user, h.parent.id));
      const rows = getDb().prepare("SELECT * FROM files WHERE owner_id = ? AND parent_id IS ? AND id > ? AND deleted_at IS NULL ORDER BY id LIMIT 100").all(this.req.user.id, h.parent?.id || null, h.cursor);
      if (rows.length) h.cursor = rows.at(-1).id;
      if (!rows.length) s.status(id, S.EOF);
      else s.name(id, rows.map(row => ({ filename: row.original_name, longname: row.original_name, attrs: this.attrs(row) })));
    });
    this.on('OPEN', async (id, raw, flags, attrs = {}) => {
      if (flags & O.WRITE) {
        if (!(flags & O.CREAT) || flags & O.APPEND) fail(400, 'Append/resume is not supported; upload a complete file');
        const { folder, name } = this.resolve(raw, { parent: true });
        if (!name || (folder && folder.type !== 'folder')) fail(400, 'Invalid target');
        const existing = fileRepository.findByName(this.req.user.id, folder?.id || null, fileNamePolicy.sanitize(name));
        if (existing && flags & O.EXCL) fail(409, 'File exists');
        const conflict = resolveUploadConflict(this.req, { ownerId: this.req.user.id, parentId: folder?.id || null, name, conflictPolicy: existing ? 'replace' : 'keep' });
        if (attrs.size !== undefined && (!Number.isSafeInteger(attrs.size) || attrs.size < 0 || attrs.size > config.maxUploadBytes)) fail(400, 'Invalid declared file size');
        const uploadReq = { ...this.req }; const tempPath = path.join(config.tempDir, `ssh-${crypto.randomUUID()}`);
        const release = acquireSshTransfer(this.req.user.id); let file;
        try {
          file = await fs.open(tempPath, 'wx', 0o600);
          this.check();
          const h = { upload: true, uploadReq, file, tempPath, release, size: 0, reserved: 0, expectedSize: attrs.size, parentId: folder?.id || null, name, conflict, failed: false };
          const token = this.add(h); activeTempPaths.add(tempPath);
          multipartReservationStore.reserve(uploadReq, 0); multipartReservationStore.setPath(uploadReq, tempPath); s.handle(id, token);
        } catch (error) { await file?.close().catch(() => {}); await fs.rm(tempPath, { force: true }).catch(() => {}); multipartReservationStore.release(uploadReq); activeTempPaths.delete(tempPath); release(); throw error; }
      } else {
        if (flags !== O.READ) fail(400, 'Unsupported open flags');
        const row = this.resolve(raw); if (row?.type !== 'file') fail(400, 'Not a file');
        const release = acquireSshTransfer(this.req.user.id);
        try { s.handle(id, this.add({ row, release })); } catch (error) { release(); throw error; }
        auditLogger.record('ssh.file.download', this.req, row.id);
      }
    });
    this.on('READ', async (id, token, offset, length) => {
      const h = this.handle(token); if (!h.row || h.row.type !== 'file') fail(400, 'Not readable');
      const row = fileService.getAccessibleFile(this.req.user, h.row.id); accessPasswordService.assertFileAccess(this.req, row);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(length) || length <= 0 || length > 1024 * 1024) fail(400, 'Invalid range');
      if (offset >= row.size_bytes) { s.status(id, S.EOF); return; }
      const file = await fs.open(fileStorage.getAbsoluteFilePath(row), 'r');
      try { const buffer = Buffer.alloc(Math.min(length, row.size_bytes - offset)); const result = await file.read(buffer, 0, buffer.length, offset); s.data(id, buffer.subarray(0, result.bytesRead)); }
      finally { await file.close(); }
    });
    this.on('WRITE', async (id, token, offset, data) => {
      const h = this.handle(token); if (!h.upload || h.failed) fail(400, 'Upload is not writable');
      try {
        if (offset !== h.size || !Buffer.isBuffer(data) || data.length > 1024 * 1024) fail(409, 'Upload chunks must be sequential');
        const nextSize = h.size + data.length;
        fileService.assertUserQuota(this.req.user, nextSize, { excludeRequest: h.uploadReq });
        if (nextSize > h.reserved) {
          const reserve = amount => {
            fileService.assertUserQuota(this.req.user, amount, { excludeRequest: h.uploadReq });
            fileService.assertProjectQuota(amount - h.reserved + uploadSessionStore.getPendingRemainingBytes());
            multipartReservationStore.reserve(h.uploadReq, amount); multipartReservationStore.setPath(h.uploadReq, h.tempPath); h.reserved = amount;
          };
          // Reserve a window so small SFTP packets do not trigger repeated disk scans.
          try { reserve(Math.ceil(nextSize / (8 * 1024 * 1024)) * 8 * 1024 * 1024); }
          catch (error) { if (error.statusCode !== 413) throw error; reserve(nextSize); }
        }
        let written = 0;
        while (written < data.length) { const result = await h.file.write(data, written, data.length - written, h.size + written); if (!result.bytesWritten) throw new Error('Write failed'); written += result.bytesWritten; }
        h.size = nextSize; s.status(id, S.OK);
      } catch (error) { h.failed = true; throw error; }
    });
    this.on('CLOSE', async (id, token) => {
      const h = this.handle(token);
      try {
        if (h.upload) {
          await h.file.close(); h.file = null;
          if (h.failed) fail(409, 'Upload failed; no file was committed');
          if (h.expectedSize !== undefined && h.expectedSize !== h.size) fail(409, 'Upload size does not match the declared file size');
          const row = fileService.createFileFromUpload(h.uploadReq, { ownerId: this.req.user.id, parentId: h.parentId, originalName: h.name,
            tempPath: h.tempPath, mimeType: 'application/octet-stream', sizeBytes: h.size, ...h.conflict });
          auditLogger.record('ssh.file.upload', this.req, row.id, { sizeBytes: h.size });
        }
        s.status(id, S.OK);
      } finally { this.handles.delete(token.toString('hex')); if (h.upload) await this.discard(h); else h.release?.(); }
    });
    this.on('MKDIR', (id, raw) => {
      const { folder, name } = this.resolve(raw, { parent: true });
      if (fileRepository.findByName(this.req.user.id, folder?.id || null, name)) fail(409, 'Already exists');
      const row = fileService.createFolder(this.req, { parentId: folder?.id || null, name }); auditLogger.record('ssh.folder.create', this.req, row.id); s.status(id, S.OK);
    });
    // chmod/utimes requests must never change physical storage permissions.
    const setstat = (id, row, attrs) => {
      if (attrs.size !== undefined && attrs.size !== row?.size_bytes) fail(400, 'Truncation is not supported');
      if (row) { row = fileService.getAccessibleFile(this.req.user, row.id); accessPasswordService.assertFileAccess(this.req, row); if (attrs.mtime) fileRepository.setSourceMetadata(row.id, { sourceModifiedAt: attrs.mtime * 1000, capturedAt: row.captured_at, contentSha256: row.content_sha256 }); }
      s.status(id, S.OK);
    };
    this.on('SETSTAT', (id, raw, attrs) => setstat(id, this.resolve(raw), attrs));
    this.on('FSETSTAT', (id, token, attrs) => {
      const h = this.handle(token);
      if (h.upload) {
        if (attrs.size !== undefined) {
          if (!Number.isSafeInteger(attrs.size) || attrs.size < h.size || attrs.size > config.maxUploadBytes) { h.failed = true; fail(400, 'Invalid declared file size'); }
          h.expectedSize = attrs.size;
        }
        s.status(id, S.OK);
      } else setstat(id, h.row, attrs);
    });
    for (const event of ['REMOVE', 'RMDIR']) this.on(event, (id, raw) => {
      const row = this.resolve(raw, { allowLocked: true }); if (!row) fail(403, 'Cannot delete home');
      if (event === 'RMDIR' && fileRepository.list(this.req.user.id, row.id).length) fail(409, 'Folder is not empty');
      fileService.deleteFileTree(this.req, row.id); auditLogger.record('ssh.file.delete', this.req, row.id); s.status(id, S.OK);
    });
    this.on('RENAME', (id, from, to) => {
      const row = this.resolve(from); const { folder, name } = this.resolve(to, { parent: true });
      if (!row || fileRepository.findByName(this.req.user.id, folder?.id || null, name)) fail(409, 'Destination exists');
      withTransaction(() => {
        if (row.parent_id !== (folder?.id || null)) fileService.moveFile(this.req, row.id, { parentId: folder?.id || null });
        if (row.original_name !== name) fileService.renameFile(this.req, row.id, name);
      });
      auditLogger.record('ssh.file.move', this.req, row.id); s.status(id, S.OK);
    });
    s.on('close', () => { void this.shutdown(); });
  }
  async discard(h) {
    if (h.discarded) return; h.discarded = true;
    await h.file?.close().catch(() => {}); await fs.rm(h.tempPath, { force: true }).catch(() => {});
    multipartReservationStore.release(h.uploadReq);
    activeTempPaths.delete(h.tempPath);
    h.release();
  }
  shutdown() {
    if (!this.shutdownTask) this.shutdownTask = this.finishShutdown();
    return this.shutdownTask;
  }
  async finishShutdown() {
    this.closed = true;
    await this.chain;
    await Promise.all([...this.handles.values()].map(h => h.upload ? this.discard(h) : h.release?.()));
    this.handles.clear();
  }
}
