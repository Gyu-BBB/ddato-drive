import { Worker } from "node:worker_threads";
import { BoundedTaskQueue } from "../../core/BoundedTaskQueue.js";

export class DocumentPreviewWorkerService {
  constructor() {
    this.workQueue = new BoundedTaskQueue({ concurrency: 1, maxQueue: 32 });
    this.pending = new Map();
  }

  extractText(file, absolutePath) {
    return this.extract("text", file, absolutePath);
  }

  extractSpreadsheetPreview(file, absolutePath) {
    return this.extract("spreadsheet", file, absolutePath);
  }

  extract(mode, file, absolutePath) {
    const key = JSON.stringify([mode, absolutePath, file.original_name, file.updated_at, file.size_bytes]);
    if (this.pending.has(key)) return this.pending.get(key);
    const task = this.workQueue.run(() => runWorker({ mode, file: { original_name: file.original_name }, absolutePath }))
      .finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
}

function runWorker(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./document-preview.worker.js", import.meta.url), {
      workerData, resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 }
    });
    let result;
    let failure;
    const timer = setTimeout(() => {
      failure = Object.assign(new Error("문서 미리보기 처리 시간이 초과됐습니다."), { statusCode: 422 });
      void worker.terminate();
    }, 30000);
    worker.on("message", message => {
      if (message.error) failure = Object.assign(new Error(message.error.message), { statusCode: message.error.statusCode });
      else result = message;
    });
    worker.on("error", () => {
      failure ||= Object.assign(new Error("문서가 너무 복잡하거나 미리보기를 처리하지 못했습니다."), { statusCode: 422 });
    });
    worker.on("exit", code => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0 || !result) reject(new Error("문서 미리보기를 처리하지 못했습니다."));
      else resolve(result.value);
    });
  });
}

export const documentPreviewWorkerService = new DocumentPreviewWorkerService();
