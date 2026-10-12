import { fail } from "./errors.js";

export class BoundedTaskQueue {
  constructor({ concurrency = 1, maxQueue = 32 } = {}) {
    this.concurrency = concurrency;
    this.maxQueue = maxQueue;
    this.active = 0;
    this.queue = [];
  }

  run(work) {
    if (this.active >= this.concurrency && this.queue.length >= this.maxQueue) {
      fail(503, "미리보기 요청이 많습니다. 잠시 후 다시 시도하세요.");
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ work, resolve, reject });
      this.drain();
    });
  }

  drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      this.active++;
      Promise.resolve().then(job.work).then(job.resolve, job.reject).finally(() => {
        this.active--;
        this.drain();
      });
    }
  }
}
