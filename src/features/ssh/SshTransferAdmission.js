import { fail } from '../../core/errors.js';
const accounts = new Map();
let total = 0;
export function acquireSshTransfer(ownerId) {
  const count = accounts.get(ownerId) || 0;
  if (count >= 10 || total >= 20) fail(429, 'SSH 전송은 계정별 최대 10개, 서버 전체 최대 20개까지 가능합니다.');
  accounts.set(ownerId, count + 1); total++;
  let released = false;
  return () => {
    if (released) return; released = true; total--;
    const next = (accounts.get(ownerId) || 1) - 1;
    if (next) accounts.set(ownerId, next); else accounts.delete(ownerId);
  };
}
