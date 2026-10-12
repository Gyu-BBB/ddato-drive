import { parentPort, workerData } from "node:worker_threads";
import { documentTextPreviewService } from "./DocumentTextPreviewService.js";

try {
  const { mode, file, absolutePath } = workerData;
  const value = mode === "spreadsheet"
    ? documentTextPreviewService.extractSpreadsheetPreview(file, absolutePath)
    : documentTextPreviewService.extractText(file, absolutePath);
  parentPort.postMessage({ value });
} catch (error) {
  parentPort.postMessage({ error: { message: error.message, statusCode: error.statusCode || 422 } });
}
