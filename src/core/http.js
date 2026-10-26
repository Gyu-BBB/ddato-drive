import path from "node:path";
import { config } from "./config.js";
import { normalizeCrossPlatformFileName } from "./fileNames.js";
import { pipeline } from 'node:stream/promises';
import { parseByteRange } from './httpRange.js';

export function jsonError(res, status, message, extra = {}) {
  res.status(status).json({
    ok: false,
    error: message,
    ...extra
  });
}

export function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function getRequestIp(req) {
  const forwarded = config.trustProxy ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
  return forwarded || req.socket?.remoteAddress || "unknown";
}

export function isSecureRequest(req) {
  return Boolean(req.secure || String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https");
}

export function contentDisposition(disposition, fileName) {
  const safeName = normalizeCrossPlatformFileName(fileName, "download");
  const fallback = safeName
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/[\\"]/g, "_")
    .slice(0, 160) || "download";
  const encoded = encodeURIComponent(safeName).replace(/[!'()*]/g, (char) => {
    return `%${char.charCodeAt(0).toString(16).toUpperCase()}`;
  });
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function sendFileStream(req, res, absolutePath, options = {}) {
  const fs = options.fs;
  const stat = fs.statSync(absolutePath);
  const total = stat.size;
  const range = req.method === 'HEAD' || req.headers['if-range'] ? null : parseByteRange(String(req.headers.range || ''), total);
  const contentType = options.contentType || "application/octet-stream";
  const disposition = contentDisposition(options.disposition || "attachment", options.fileName || path.basename(absolutePath));

  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", disposition);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", `${options.cacheControl || 'private, no-store'}, no-transform`);

  if (range) {
    if (range.invalid) {
      res.status(416).setHeader("Content-Range", `bytes */${total}`);
      res.end();
      return;
    }
    const { start, end } = range;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.setHeader("Content-Length", end - start + 1);
    if (req.method === 'HEAD') { res.end(); return; }
    await pipeline(fs.createReadStream(absolutePath, { start, end }), res);
    return;
  }

  res.setHeader("Content-Length", total);
  if (req.method === 'HEAD') { res.end(); return; }
  await pipeline(fs.createReadStream(absolutePath), res);
}
