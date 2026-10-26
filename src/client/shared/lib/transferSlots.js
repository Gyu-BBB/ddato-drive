export function createTransferSlots(limit) {
  let active = 0;
  const waiting = [];
  function release() {
    active -= 1;
    const next = waiting.shift();
    if (next) next();
  }
  return signal => new Promise((resolve, reject) => {
    const abort = () => {
      const index = waiting.indexOf(start);
      if (index !== -1) waiting.splice(index, 1);
      reject(new DOMException('전송이 취소되었습니다.', 'AbortError'));
    };
    const start = () => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) { abort(); return; }
      active += 1;
      let released = false;
      resolve(() => { if (!released) { released = true; release(); } });
    };
    if (signal.aborted) { abort(); return; }
    if (active < limit) start();
    else { waiting.push(start); signal.addEventListener('abort', abort, { once: true }); }
  });
}
