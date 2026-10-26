import { fail } from '../../core/errors.js';
import { fileRepository } from './FileRepository.js';
import { fileNamePolicy } from './FileNamePolicy.js';
import { accessPasswordService } from '../protection/AccessPasswordService.js';

export function resolveUploadConflict(req, { ownerId, parentId, name, conflictPolicy = 'keep' }) {
  if (!['keep', 'skip', 'replace'].includes(conflictPolicy)) fail(400, '올바른 중복 파일 처리 방식을 선택해 주세요.');
  const safeName = fileNamePolicy.sanitizeUploadName(name, 'upload');
  const existing = fileRepository.findByName(ownerId, parentId, safeName);
  if (!existing || conflictPolicy === 'keep') return { conflictPolicy };
  if (conflictPolicy === 'skip') return { conflictPolicy, skipped: true };
  if (existing.type !== 'file') fail(409, '같은 이름의 폴더는 파일로 교체할 수 없습니다.');
  accessPasswordService.assertFileAccess(req, existing);
  return { conflictPolicy, replaceTargetId: existing.id, replaceTargetVersion: existing.updated_at };
}
