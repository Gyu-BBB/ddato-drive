import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fail } from '../../core/errors.js';
import { connectRemote } from './RemoteSshConnection.js';
import { fileService } from '../files/FileService.js';
import { resumableUploadService } from '../files/ResumableUploadService.js';
import { fileStorage } from '../files/FileStorage.js';
import { accessPasswordService } from '../protection/AccessPasswordService.js';
import { userRepository } from '../users/UserRepository.js';
import { auditLogger } from '../audit/AuditLogger.js';
import { acquireSshTransfer } from './SshTransferAdmission.js';

const call = (sftp, method, ...args) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { sftp.destroy(); reject(Object.assign(new Error('원격 파일 작업 시간이 초과되었습니다.'), { statusCode: 408 })); }, 20000); timer.unref();
  try { sftp[method](...args, (error, result) => { clearTimeout(timer); error ? reject(error) : resolve(result); }); }
  catch (error) { clearTimeout(timer); reject(error); }
});
function remotePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.length > 4096) fail(400, '원격 경로를 확인해 주세요.');
  return path.posix.normalize(value);
}
function currentUser(req) {
  const user = userRepository.findById(req.user.id);
  if (!user || user.disabled_at) fail(403, '계정의 전송 권한이 해제되었습니다.');
  req.user = user; return user;
}

export class RemoteTransferService {
  connections = new Map(); jobs = new Map(); connecting = new Map();
  constructor() {
    this.timer = setInterval(() => {
      for (const [id, connection] of this.connections) if (Date.now() - connection.lastActivity > 5 * 60_000 && !this.activeFor(id).length) this.closeConnection(connection);
      for (const [id, job] of this.jobs) if (job.status !== 'running' && Date.now() - job.updatedAt > 86400000) this.jobs.delete(id);
    }, 60000); this.timer.unref();
  }
  activeFor(connectionId) { return [...this.jobs.values()].filter(job => job.connectionId === connectionId && job.status === 'running'); }
  async connect(req, payload, probe = false) {
    currentUser(req);
    const pending = this.connecting.get(req.user.id) || 0;
    if (this.connections.size + [...this.connecting.values()].reduce((a, b) => a + b, 0) >= 50 || pending + [...this.connections.values()].filter(c => c.ownerId === req.user.id).length >= 3) fail(429, '동시에 최대 3개의 SSH 연결을 사용할 수 있습니다.');
    this.connecting.set(req.user.id, pending + 1);
    try {
      const result = await connectRemote(req.user, payload, { probe });
      try { currentUser(req); } catch (error) { result.client?.end(); throw error; }
      if (result.privateTarget && req.user.role !== 'admin') { result.client?.end(); fail(403, '내부 네트워크 연결 권한이 변경되었습니다.'); }
      if (probe) return result;
      const connection = { ...result, id: crypto.randomUUID(), ownerId: req.user.id, lastActivity: Date.now(), allowPrivate: result.privateTarget };
      this.connections.set(connection.id, connection);
      result.client.on('close', () => { this.connections.delete(connection.id); });
      result.sftp.on('close', () => { this.closeConnection(connection); });
      auditLogger.record('ssh.remote.connect', req, connection.id, { host: result.host, port: result.port, fingerprint: result.fingerprint });
      return this.serializeConnection(connection);
    } finally { const remaining = (this.connecting.get(req.user.id) || 1) - 1; if (remaining) this.connecting.set(req.user.id, remaining); else this.connecting.delete(req.user.id); }
  }
  serializeConnection(c) { return { id: c.id, host: c.host, port: c.port, fingerprint: c.fingerprint }; }
  list(req) {
    currentUser(req);
    return { connections: [...this.connections.values()].filter(c => c.ownerId === req.user.id).map(c => this.serializeConnection(c)),
      jobs: [...this.jobs.values()].filter(job => job.ownerId === req.user.id).map(job => this.serializeJob(job)) };
  }
  connection(req, id) {
    currentUser(req); const c = this.connections.get(id);
    if (!c || c.ownerId !== req.user.id) fail(404, 'SSH 연결이 만료되었습니다. 다시 연결해 주세요.');
    if (c.allowPrivate && req.user.role !== 'admin') { this.closeConnection(c); fail(403, '내부 네트워크 연결 권한이 변경되었습니다.'); }
    c.lastActivity = Date.now(); return c;
  }
  async listDirectory(req, id, rawPath = '.') {
    const c = this.connection(req, id); const directory = remotePath(rawPath);
    const handle = await call(c.sftp, 'opendir', directory); const rows = [];
    try {
      while (rows.length <= 1000) {
        const batch = await call(c.sftp, 'readdir', handle).catch(error => { if (error.code === 1) return false; throw error; });
        if (batch === false) break; rows.push(...batch);
      }
    } finally { await call(c.sftp, 'close', handle).catch(() => {}); }
    return { path: directory, entries: rows.slice(0, 1000).filter(row => !['.', '..'].includes(row.filename)).map(row => ({ name: row.filename, sizeBytes: row.attrs.size,
      type: row.attrs.isDirectory() ? 'folder' : row.attrs.isFile() ? 'file' : 'other', modifiedAt: row.attrs.mtime * 1000 })), truncated: rows.length > 1000 };
  }
  disconnect(req, id) { const c = this.connection(req, id); this.closeConnection(c); }
  closeConnection(c) {
    for (const job of this.activeFor(c.id)) job.controller.abort();
    c.client.end(); this.connections.delete(c.id);
  }
  serializeJob(job) { const { controller, req, task, ...publicJob } = job; return publicJob; }
  start(req, payload) {
    const c = this.connection(req, payload.connectionId);
    const active = [...this.jobs.values()].filter(job => job.status === 'running');
    if (active.length >= 20 || active.filter(job => job.ownerId === req.user.id).length >= 10) fail(429, 'SSH 전송 작업이 많습니다. 완료 후 다시 시도해 주세요.');
    if (!['import', 'export'].includes(payload.direction)) fail(400, '전송 방향을 선택해 주세요.');
    const targetPath = remotePath(payload.path);
    if (this.jobs.size >= 1000) { const done = [...this.jobs.values()].find(job => job.status !== 'running'); if (done) this.jobs.delete(done.id); else fail(429, '작업 목록이 가득 찼습니다.'); }
    const release = acquireSshTransfer(req.user.id);
    const job = { id: crypto.randomUUID(), ownerId: req.user.id, connectionId: c.id, direction: payload.direction, path: targetPath,
      status: 'running', bytes: 0, sizeBytes: null, createdAt: Date.now(), updatedAt: Date.now(), error: '', controller: new AbortController() };
    this.jobs.set(job.id, job);
    job.task = this.run(req, c, job, payload).catch(error => {
      job.status = job.controller.signal.aborted ? 'canceled' : 'failed';
      job.error = job.controller.signal.aborted ? '전송이 취소되었습니다.' : error.statusCode && error.statusCode < 500 ? error.message : 'SSH 파일 전송에 실패했습니다. 원격 권한·연결 상태를 확인해 주세요.';
    }).finally(() => { release(); job.updatedAt = Date.now(); c.lastActivity = Date.now(); });
    return this.serializeJob(job);
  }
  async run(req, c, job, payload) {
    const fresh = () => { currentUser(req); this.connection(req, c.id); job.controller.signal.throwIfAborted(); };
    const touch = length => { fresh(); job.bytes += length; job.updatedAt = Date.now(); };
    let lastBytes = 0;
    const timeout = setInterval(() => { if (job.bytes === lastBytes) job.controller.abort(); lastBytes = job.bytes; }, 120000); timeout.unref();
    try {
      if (job.direction === 'import') {
        const stat = await call(c.sftp, 'stat', job.path); if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 0) fail(400, '일반 파일만 가져올 수 있습니다.');
        fresh();
        job.sizeBytes = stat.size;
        const session = resumableUploadService.createSession(req, { parentId: payload.parentId || null, name: path.posix.basename(job.path),
          sizeBytes: stat.size, sourceModifiedAt: stat.mtime * 1000, clientUploadId: `ssh-import-${job.id}` });
        const stream = c.sftp.createReadStream(job.path);
        const abort = () => stream.destroy(new Error('Canceled')); job.controller.signal.addEventListener('abort', abort, { once: true });
        try {
          for await (const chunk of stream) { fresh(); await resumableUploadService.appendChunk(req.user, session.id, { offset: job.bytes, buffer: chunk }); touch(chunk.length); }
          fresh();
          const after = await call(c.sftp, 'stat', job.path);
          if (job.bytes !== stat.size || after.size !== stat.size || after.mtime !== stat.mtime) fail(409, '전송 중 원격 파일이 변경되었습니다. 다시 시도해 주세요.');
          const file = await resumableUploadService.completeSession(req, session.id); job.fileId = file.id;
        } catch (error) { await resumableUploadService.cancelSession(req.user, session.id).catch(() => {}); throw error; }
        finally { job.controller.signal.removeEventListener('abort', abort); stream.destroy(); }
      } else {
        fresh(); const row = fileService.getAccessibleFile(req.user, payload.fileId);
        if (row.owner_id !== req.user.id || row.type !== 'file') fail(403, '자신의 일반 파일만 보낼 수 있습니다.');
        accessPasswordService.assertFileAccess(req, row); job.sizeBytes = row.size_bytes;
        const existing = await call(c.sftp, 'lstat', job.path).then(() => true, error => { if (error.code === 2) return false; throw error; });
        if (existing) fail(409, '원격에 같은 이름이 있습니다. 다른 대상 경로를 입력해 주세요.');
        const temp = path.posix.join(path.posix.dirname(job.path), `.ddato-${job.id}.part`);
        let created = false;
        try {
          const output = c.sftp.createWriteStream(temp, { flags: 'wx', mode: 0o600 });
          output.on('open', () => { created = true; });
          const meter = new Transform({ transform(chunk, _encoding, done) {
            try { touch(chunk.length); accessPasswordService.assertFileAccess(req, fileService.getAccessibleFile(req.user, row.id)); done(null, chunk); } catch (error) { done(error); }
          } });
          await pipeline(fs.createReadStream(fileStorage.getAbsoluteFilePath(row)), meter, output, { signal: job.controller.signal });
          fresh(); const remote = await call(c.sftp, 'stat', temp);
          if (remote.size !== row.size_bytes || job.bytes !== row.size_bytes) fail(409, '원격 저장 크기가 일치하지 않습니다.');
          await call(c.sftp, 'rename', temp, job.path);
        } catch (error) { if (created) await call(c.sftp, 'unlink', temp).catch(() => {}); throw error; }
      }
      job.status = 'done';
      auditLogger.record(`ssh.remote.${job.direction}`, req, job.fileId || payload.fileId, { host: c.host, path: job.path, bytes: job.bytes });
    } finally { clearInterval(timeout); }
  }
  cancel(req, id) { const job = this.jobs.get(id); if (!job || job.ownerId !== req.user.id) fail(404, '전송 작업을 찾을 수 없습니다.'); if (job.status === 'running') job.controller.abort(); return this.serializeJob(job); }
  async stop() { clearInterval(this.timer); for (const c of this.connections.values()) this.closeConnection(c); await Promise.all([...this.jobs.values()].map(job => job.task)); }
}
export const remoteTransferService = new RemoteTransferService();
