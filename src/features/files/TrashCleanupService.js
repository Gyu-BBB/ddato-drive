import fs from 'node:fs';
import { withTransaction } from '../../database/database.js';
import { TRASH_RETENTION_MS } from '../../shared/trashRetention.js';
import { auditLogger } from '../audit/AuditLogger.js';
import { fileRepository } from './FileRepository.js';
import { fileStorage } from './FileStorage.js';

export class TrashCleanupService {
  constructor() {
    this.timer = null;
    this.running = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.run().catch(error => console.error('Trash cleanup failed:', error)); }, 60000);
    this.timer.unref();
    void this.run().catch(error => console.error('Trash cleanup failed:', error));
  }

  async stop() {
    clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => {});
  }

  run(now = Date.now()) {
    if (this.running) return this.running;
    this.running = this.cleanup(now).finally(() => { this.running = null; });
    return this.running;
  }

  async cleanup(now) {
    const cutoff = now - TRASH_RETENTION_MS;
    let purged = 0;
    const failed = new Set();
    while (true) {
      const rows = fileRepository.listExpiredTrashLeaves(cutoff, 25 + failed.size)
        .filter(row => !failed.has(row.id)).slice(0, 25);
      if (!rows.length) break;
      for (const row of rows) {
        try {
          // The database transaction also blocks restore/delete races during disk cleanup.
          withTransaction(() => {
            const current = fileRepository.findById(row.id);
            if (current?.deleted_at == null || current.deleted_at > cutoff) return;
            if (current.storage_path) fs.rmSync(fileStorage.resolveDataPath(current.storage_path), { force: true });
            fileStorage.deletePreviewFiles(current, { strict: true });
            fileRepository.purgeTree([current]);
            auditLogger.record('trash.auto_purge', { headers: {}, socket: { remoteAddress: 'system' } }, current.id,
              { name: current.original_name, ownerId: current.owner_id, bytes: current.size_bytes, deletedAt: current.deleted_at });
            purged++;
          });
        } catch (error) {
          failed.add(row.id);
          console.error('Trash item cleanup failed:', row.id, error.message);
        }
        await new Promise(resolve => setImmediate(resolve));
      }
      await new Promise(resolve => setImmediate(resolve));
    }
    return { purged, failed: failed.size };
  }
}

export const trashCleanupService = new TrashCleanupService();
