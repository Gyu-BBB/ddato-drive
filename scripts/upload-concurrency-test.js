import assert from 'node:assert/strict';
import { UploadTransferLimiter } from '../src/features/files/UploadTransferLimiter.js';

const limiter = new UploadTransferLimiter(10);
const active = { alice: 0, bob: 0 };
const peak = { alice: 0, bob: 0 };
const run = account => limiter.run(account, async () => {
  active[account]++;
  peak[account] = Math.max(peak[account], active[account]);
  await new Promise(resolve => setTimeout(resolve, 2));
  active[account]--;
});
await Promise.all(Array.from({ length: 30 }, () => run('alice')).concat(Array.from({ length: 20 }, () => run('bob'))));
assert.deepEqual(peak, { alice: 10, bob: 10 });
assert.equal(limiter.accounts.size, 0);
await assert.rejects(limiter.run('alice', () => { throw new Error('write failed'); }));
assert.equal(limiter.accounts.size, 0);
console.log('Upload concurrency passed: each account independently reaches and stays within 10.');
