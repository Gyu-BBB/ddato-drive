import fs from 'node:fs';
import crypto from 'node:crypto';
import exifr from 'exifr';
import { UploadTransferLimiter } from './UploadTransferLimiter.js';

export const MAX_PHOTO_INSPECTION_BYTES = 64 * 1024 * 1024;
const limiter = new UploadTransferLimiter(2);

export function normalizeSourceDate(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number < 8_640_000_000_000_000 ? number : null;
}

export class PhotoMetadataService {
  async inspect(filePath, { name = '', mimeType = '', sizeBytes = 0 } = {}) {
    if (!(mimeType.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp|tiff?)$/i.test(name)) || sizeBytes > MAX_PHOTO_INSPECTION_BYTES) return {};
    return limiter.run('photo-metadata', async () => {
      const hash = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 256 * 1024 })) hash.update(chunk);
      let capturedAt = null;
      try {
        const tags = await exifr.parse(filePath, { pick: ['DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal'], gps: false, chunked: true, chunkSize: 65536, chunkLimit: 5 });
        capturedAt = normalizeSourceDate((tags?.DateTimeOriginal || tags?.CreateDate)?.getTime?.());
      } catch { /* Missing or malformed EXIF must not prevent original file storage. */ }
      return { contentSha256: hash.digest('hex'), capturedAt };
    });
  }
}
export const photoMetadataService = new PhotoMetadataService();
