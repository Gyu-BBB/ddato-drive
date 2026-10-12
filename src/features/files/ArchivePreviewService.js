import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fail } from '../../core/errors.js';
import { zipPreviewService } from './ZipPreviewService.js';

const execute = promisify(execFile);
const helper = fileURLToPath(new URL('../../../scripts/archive-preview.py', import.meta.url));
const python = process.env.DDATO_DRIVE_PYTHON || ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'].find(file => fs.existsSync(file)) || 'python3';

export class ArchivePreviewService {
  async inspect(absolutePath, originalName) {
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
