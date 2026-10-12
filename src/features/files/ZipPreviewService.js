import yauzl from 'yauzl';
import { fail } from '../../core/errors.js';

const MAX_ENTRIES = 10000;
const MAX_PATH_LENGTH = 4096;

export class ZipPreviewService {
  async inspect(absolutePath) {
    try {
      return await new Promise((resolve, reject) => {
        yauzl.open(absolutePath, { lazyEntries: true, validateEntrySizes: false }, (error, zip) => {
          if (error) { reject(error); return; }
          const entries = [];
          let settled = false;
          const timer = setTimeout(() => finish(new Error('ZIP 목록 읽기 시간 초과')), 10000);
          const finish = (error = null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            zip.close();
            if (error) { reject(error); return; }
            resolve({ kind: 'zip', totalEntries: zip.entryCount, truncated: zip.entryCount > entries.length, entries });
          };
          zip.on('error', finish);
          zip.on('end', () => finish());
          zip.on('entry', entry => {
            if (entry.fileName.length > MAX_PATH_LENGTH || !Number.isSafeInteger(entry.uncompressedSize) || !Number.isSafeInteger(entry.compressedSize)) {
              finish(new Error('유효하지 않은 ZIP 목록')); return;
            }
            entries.push({ path: entry.fileName.normalize('NFC'), directory: entry.fileName.endsWith('/'),
              sizeBytes: entry.uncompressedSize, compressedBytes: entry.compressedSize, encrypted: entry.isEncrypted() });
            if (entries.length >= MAX_ENTRIES) finish();
            else zip.readEntry();
          });
          zip.readEntry();
        });
      });
    } catch {
      fail(422, 'ZIP 내부 목록을 읽을 수 없습니다. 손상되었거나 목록 자체가 암호화된 압축 파일일 수 있습니다.');
    }
  }
}

export const zipPreviewService = new ZipPreviewService();
