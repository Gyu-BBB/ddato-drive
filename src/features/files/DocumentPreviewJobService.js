import { documentPdfPreviewService } from "./DocumentPdfPreviewService.js";

export class DocumentPreviewJobService {
  constructor({ converter = documentPdfPreviewService, maxQueue = 32, maxHistory = 200 } = {}) {
    this.converter = converter;
    this.maxQueue = maxQueue;
    this.maxHistory = maxHistory;
    this.jobs = new Map();
    this.queue = [];
    this.running = false;
  }

  getStatus(file, absolutePath, { enqueue = true } = {}) {
    if (!this.converter.canTryConvert(file)) {
      return { status: "fallback", message: "PDF 변환을 지원하지 않아 텍스트 미리보기를 사용합니다." };
    }
    if (!this.converter.canConvert(file)) {
      return { status: "fallback", message: "문서 변환 프로그램을 찾지 못해 텍스트 미리보기를 사용합니다." };
    }
    if (this.converter.cachedPdfPath(file)) {
      return { status: "ready", message: "미리보기가 준비되었습니다." };
    }

    const key = this.key(file);
    const job = this.jobs.get(key);
    if (job?.status === "error") {
      return { status: "fallback", message: "PDF 미리보기를 만들지 못해 텍스트 미리보기를 사용합니다." };
    }
    const queued = enqueue ? this.enqueue(file, absolutePath) : job;
    return {
      status: queued?.status || "pending",
      message: enqueue && !queued ? "다른 문서의 미리보기가 준비되면 자동으로 처리합니다." : "문서 미리보기를 생성하는 중입니다.",
      retryAfterMs: queued?.status === "running" ? 1200 : 3000,
      queuedAt: queued?.queuedAt || Date.now()
    };
  }

  enqueue(file, absolutePath) {
    const key = this.key(file);
    const existing = this.jobs.get(key);
    if (existing && ["queued", "running"].includes(existing.status)) return existing;
    if (this.queue.length >= this.maxQueue) return null;

    const job = {
      key,
      file: { ...file },
      absolutePath,
      status: "queued",
      queuedAt: Date.now(),
      updatedAt: Date.now(),
      error: ""
    };
    this.jobs.set(key, job);
    this.queue.push(job);
    this.trim();
    this.runNext();
    return job;
  }

  runNext() {
    if (this.running) return;
    const job = this.queue.shift();
    if (!job) return;

    this.running = true;
    job.status = "running";
    job.updatedAt = Date.now();

    setImmediate(async () => {
      try {
        const pdfPath = await this.converter.convertToPdf(job.file, job.absolutePath);
        if (!pdfPath) throw new Error("Document conversion did not produce a PDF.");
        job.status = "ready";
        job.updatedAt = Date.now();
      } catch (error) {
        job.status = "error";
        job.error = error.message || "Document conversion failed.";
        job.updatedAt = Date.now();
      } finally {
        this.running = false;
        this.trim();
        this.runNext();
      }
    });
  }

  key(file) {
    return [file.id, file.updated_at || 0, file.size_bytes || 0].join("-");
  }

  trim() {
    const entries = [...this.jobs.values()].filter(job => !["queued", "running"].includes(job.status))
      .sort((a, b) => a.updatedAt - b.updatedAt);
    for (const job of entries.slice(0, Math.max(0, entries.length - this.maxHistory))) {
      this.jobs.delete(job.key);
    }
  }
}

export const documentPreviewJobService = new DocumentPreviewJobService();
