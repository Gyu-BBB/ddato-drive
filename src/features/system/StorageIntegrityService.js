import fs from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as yieldToServer } from 'node:timers/promises';
import { config } from '../../core/config.js';
import { getDb } from '../../database/database.js';

export class StorageIntegrityService {
  status = { state: 'idle' };

  start() {
    if (this.status.state === 'running') return this.getStatus();
    this.status = { state: 'running', startedAt: Date.now(), checked: 0, diskFiles: 0, expectedBytes: 0, actualBytes: 0,
      issueCount: 0, issues: [], truncated: false };
    this.task = this.scan().then(() => {
      this.status.state = 'done';
    }).catch(() => {
      this.status.state = 'failed';
      this.status.error = '저장소 점검을 완료하지 못했습니다. 다시 시도해 주세요.';
    }).finally(() => { this.status.finishedAt = Date.now(); });
    return this.getStatus();
  }

  getStatus() { return { ...this.status, issues: [...(this.status.issues || [])] }; }

  issue(kind, row, details = {}) {
    this.status.issueCount++;
    if (this.status.issues.length < 200) this.status.issues.push({ kind, fileId: row?.id, name: row?.original_name, ownerId: row?.owner_id, ...details });
    else this.status.truncated = true;
  }

  async scan() {
    const referenced = new Set();
    let cursor = '';
    while (true) {
      const rows = getDb().prepare("SELECT * FROM files WHERE type = 'file' AND id > ? ORDER BY id LIMIT 200").all(cursor);
      if (!rows.length) break;
      for (const row of rows) {
        cursor = row.id;
        this.status.checked++;
        this.status.expectedBytes += row.size_bytes;
        const absolute = path.resolve(config.dataDir, row.storage_path || '');
        if (!absolute.startsWith(`${path.resolve(config.storageDir)}${path.sep}`)) { this.issue('invalid_path', row); continue; }
        referenced.add(absolute);
        try {
          const stat = await fs.lstat(absolute);
          if (!stat.isFile()) { this.issue('not_regular_file', row); continue; }
          this.status.actualBytes += stat.size;
          if (stat.size !== row.size_bytes) this.issue('size_mismatch', row, { expectedBytes: row.size_bytes, actualBytes: stat.size });
        } catch (error) {
          // A concurrent permanent deletion is not a missing stored file.
          if (getDb().prepare('SELECT id FROM files WHERE id = ? AND storage_path = ?').get(row.id, row.storage_path)) {
            this.issue(error.code === 'ENOENT' ? 'missing' : 'unreadable', row);
          }
        }
      }
      await yieldToServer();
    }
    const walk = async directory => {
      const entries = await fs.opendir(directory);
      for await (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(absolute);
        else if (entry.isFile()) {
          this.status.diskFiles++;
          if (!referenced.has(absolute)) {
            const relative = path.relative(config.dataDir, absolute);
            const current = getDb().prepare('SELECT id FROM files WHERE storage_path = ?').get(relative);
            const stat = await fs.lstat(absolute).catch(() => null);
            // Ignore files being committed while this non-transactional scan runs.
            if (!current && stat && stat.mtimeMs < this.status.startedAt - 60_000) this.issue('orphan', null, { name: relative, actualBytes: stat.size });
          }
        } else this.issue('not_regular_file', null, { name: path.relative(config.dataDir, absolute) });
      }
    };
    await walk(config.storageDir);
  }
}

export const storageIntegrityService = new StorageIntegrityService();
