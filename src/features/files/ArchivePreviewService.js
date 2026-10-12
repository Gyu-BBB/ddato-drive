import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fail } from '../../core/errors.js';
import { BoundedTaskQueue } from '../../core/BoundedTaskQueue.js';
import { zipPreviewService } from './ZipPreviewService.js';

const execute = promisify(execFile);
const helper = fileURLToPath(new URL('../../../scripts/archive-preview.py', import.meta.url));
const python = process.env.DDATO_DRIVE_PYTHON || ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'].find(file => fs.existsSync(file)) || 'python3';

export class ArchivePreviewService {
  constructor({ concurrency = 2, maxQueue = 32, maxCacheBytes = 16 * 1024 * 1024,
    maxCacheEntries = 32, cacheTtlMs = 60000, inspectFile = null } = {}) {
    this.workQueue = new BoundedTaskQueue({ concurrency, maxQueue });
    this.maxCacheBytes = maxCacheBytes;
    this.maxCacheEntries = maxCacheEntries;
    this.cacheTtlMs = cacheTtlMs;
    this.inspectFile = inspectFile || ((file, name) => this.inspectUncached(file, name));
    this.pending = new Map();
    this.cache = new Map();
    this.cacheBytes = 0;
  }

  async inspect(absolutePath, originalName) {
    const stat = await fs.promises.stat(absolutePath, { bigint: true });
    const key = JSON.stringify([absolutePath, originalName, String(stat.ino), String(stat.size), String(stat.mtimeNs)]);
    this.pruneCache();
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.value;
    }
    if (this.pending.has(key)) return this.pending.get(key);
    const task = this.workQueue.run(() => this.inspectFile(absolutePath, originalName))
      .then(value => {
        const bytes = Buffer.byteLength(JSON.stringify(value));
        if (bytes <= this.maxCacheBytes) {
          this.cache.set(key, { value, bytes, expiresAt: Date.now() + this.cacheTtlMs });
          this.cacheBytes += bytes;
          this.pruneCache();
        }
        return value;
      }).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  pruneCache() {
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= Date.now()) {
        this.cache.delete(key);
        this.cacheBytes -= entry.bytes;
      }
    }
    while (this.cache.size > this.maxCacheEntries || this.cacheBytes > this.maxCacheBytes) {
      const key = this.cache.keys().next().value;
      this.cacheBytes -= this.cache.get(key).bytes;
      this.cache.delete(key);
    }
  }

  async inspectUncached(absolutePath, originalName) {
    if (path.extname(originalName).toLowerCase() === '.zip') return zipPreviewService.inspect(absolutePath);
    try {
      const { stdout } = await execute(python, [helper, absolutePath, originalName], { timeout: 10000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
      return JSON.parse(stdout);
    } catch (error) {
      if (error.code === 'ENOENT') fail(503, '압축 파일 미리보기에 필요한 서버 도구를 사용할 수 없습니다.');
      fail(422, '압축 파일 목록을 읽을 수 없습니다. 손상·암호화·지원되지 않는 형식이거나 목록 확인 시간이 초과됐을 수 있습니다.');
    }
  }
}

export const archivePreviewService = new ArchivePreviewService();
