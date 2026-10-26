# Transfer Reliability Audit

Date: 2026-10-26 (Asia/Seoul).

## Confirmed and Fixed

- Folder ZIP downloads could include independently password-locked descendants. Private/public ZIP paths now check tree access. New protection revokes pre-existing shares for affected descendants and ancestors, including links with a separate share password. Legacy links also compare share/protection timestamps so previously issued links cannot bypass a newer lock.
- Completed resumable sessions disappeared immediately. A lost completion response or reload could then create another file. Completion receipts are now committed in the same SQLite transaction as the file record; retries return the original result, including after server restart. Deleted completed files return 410 rather than silently starting over.
- Lost session-creation responses could reserve quota multiple times. Stable client operation IDs reuse the original session. Cancellation tombstones stop delayed creation requests from reviving canceled uploads.
- Chunk writes, completion and cancellation used different synchronization paths. They now share one per-session queue. Identical retransmissions are byte-checked; conflicting content is rejected. Metadata publication is atomic, active operations are protected from TTL cleanup, and database rollback restores the partial upload.
- Upload bodies were parsed before transfer admission, allowing queued chunks to consume memory. Admission now precedes parsing, preserves the account limit of 10, and retains a slot until an active disk write finishes after disconnection. Multipart uploads reserve account/project capacity and stop at available quota rather than receiving an arbitrarily large file first. SQLite WAL/SHM disk usage is included.
- Byte suffix ranges were incorrect, valid oversized end offsets were rejected, and malformed ranges could behave incorrectly. Single ranges, suffix ranges, HEAD and empty files are covered. File pipelines and ZIP error handling close resources on errors/disconnects; truncated ZIP source reads cannot be reported as success.
- Browser download buffering had no bound. Supported browsers keep direct-to-disk streaming; other browsers hand files/ZIPs above 128 MiB to their own downloader. This state is not reported as completed and application progress/cancel controls are not falsely offered. Truncated downloads fail before committing a local file. Encoded Content-Length is not compared with decoded bytes.
- Queue restoration could replace newly enqueued items, account changes could receive late transfer callbacks, and a failed file-list refresh could turn a successfully committed upload into a failure. These paths are now guarded.
- New uploads now reserve server capacity before writing the original file into IndexedDB. Oversized requests fail before local file persistence or binary transfer; local persistence failures release the reservation. Files waiting for one of the ten transfer slots are persisted after admission so pause/reload/resume still works.
- Upload network errors previously failed immediately, while XHR/control requests could wait indefinitely. Transient errors now retry at most three times with abortable backoff; retries query confirmed server offsets and reduce chunk size. Control requests have a 30-second deadline and binary requests a 10-minute deadline. Quota/authentication errors remain non-retryable.
- Express, Multer and vulnerable runtime transitive dependencies were updated. Relevant upstream advisories include [multipart field parsing](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm) and [compressed request parsing](https://github.com/advisories/GHSA-27r3-jxmh-p828). The runtime-only dependency audit reports zero known vulnerabilities at this verification date. Development-tool audit findings are separate and are not claimed to be fixed here.

## Verification

All mutation tests use isolated temporary data, never live user files.

```sh
npm run build
npm run smoke
npm run test:transfers
npm run test:transfer-reliability
npm run test:transfer-ui
npm run test:folder-upload
npm run test:resources
node scripts/navigation-browser-test.js
npm audit --omit=dev
```

Coverage includes runtime parser failures, quota boundaries, byte ranges, zero-byte files, idempotent create/complete, server restart, delayed cancellation, partial-write and database failure injection, ZIP truncation, disconnects, ten simultaneous uploads plus one waiting, pause/reload/resume, real browser multi-file ZIP downloads and SHA-256 equality of an uploaded/downloaded multi-chunk file.

## Boundaries

- Passing these tests is not proof against every possible failure. This is not a 1-TB load test, a physical disk failure/power-loss test, or a real-device Safari/Android test. Browser workflows were exercised in Chrome with both normal and direct-save-disabled paths; existing mobile layout checks remain separate.
- Reload recovery requires successful browser IndexedDB persistence and the original file to remain stored there. Browser storage quotas/eviction still apply. Closing the browser or suspending a mobile browser does not guarantee continued web uploads.
- Before server admission and local persistence finish, a newly selected file exists only in the current page; a reload during that preparation requires selecting it again. The 10-GiB/20-GiB preflight browser test simulates the file size metadata rather than allocating a 20-GiB fixture.
- Incomplete sessions retain the configured TTL (24 hours by default). Completion/cancellation records retain 30 days for retry safety; these records are not a file backup.
- HTTP/native browser download handoff does not expose true progress or cancellation back to JavaScript; use the browser's download manager in that case.
- No server credentials, user quotas or project capacity were changed by the audit.
