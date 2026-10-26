import express from "express";
import fs from "node:fs";
import { asyncRoute, contentDisposition, isSecureRequest, sendFileStream } from "../../core/http.js";
import { enforceRateLimit, ipAndValueKey } from "../../core/rateLimit.js";
import { auditLogger } from "../audit/AuditLogger.js";
import { requireUser } from "../auth/auth.middleware.js";
import { zipArchiveService } from "../files/ZipArchiveService.js";
import { shareService } from "./ShareService.js";

export const shareRouter = express.Router();

shareRouter.get("/files/:id/share", requireUser, asyncRoute((req, res) => {
  res.json({
    ok: true,
    ...shareService.getActiveShare(req.user, req.params.id, (token) => buildShareUrl(req, token))
  });
}));

shareRouter.post("/files/:id/share", requireUser, asyncRoute((req, res) => {
  const result = shareService.createShare(req, req.params.id, req.body?.mode, req.body?.password, (token) => buildShareUrl(req, token));
  auditLogger.record("file.share.create", req, req.params.id, result.share);
  res.status(201).json({ ok: true, ...result });
}));

shareRouter.delete("/files/:id/share", requireUser, asyncRoute((req, res) => {
  const result = shareService.revokeShares(req.user, req.params.id);
  auditLogger.record("file.share.revoke", req, req.params.id, result);
  res.json({ ok: true, ...result });
}));

shareRouter.get("/shares/:token", asyncRoute((req, res) => {
  enforcePublicShareLimit(req);
  const result = shareService.getPublicShare(req, req.params.token, (token) => buildShareUrl(req, token), req.query.parentId);
  auditLogger.record("share.public.view", req, result.file.id, {
    token: maskToken(req.params.token),
    fileName: result.file.name,
    mode: result.share.mode
  });
  res.json({
    ok: true,
    ...result
  });
}));

shareRouter.post("/shares/:token/unlock", asyncRoute((req, res) => {
  enforcePublicShareLimit(req);
  const result = shareService.unlockPublicShare(req, req.params.token, req.body?.password);
  auditLogger.record("share.public.unlock", req, result.file.id, {
    token: maskToken(req.params.token),
    fileName: result.file.name
  });
  res.json({ ok: true, ...result });
}));

shareRouter.get("/shares/:token/download", asyncRoute(async (req, res) => {
  enforcePublicShareLimit(req);
  const target = shareService.getPublicDownloadTarget(req, req.params.token);
  auditLogger.record("share.public.download", req, target.file.id, {
    token: maskToken(req.params.token),
    fileName: target.fileName || target.file.original_name
  });
  if (target.zipRows) {
    await sendZipStream(res, target);
    return;
  }

  return sendFileStream(req, res, target.absolutePath, {
    fs,
    fileName: target.fileName || target.file.original_name,
    contentType: target.contentType,
    disposition: target.disposition,
    cacheControl: "private, no-store"
  });
}));

shareRouter.get("/shares/:token/items/:id/download", asyncRoute(async (req, res) => {
  enforcePublicShareLimit(req);
  const target = shareService.getPublicSharedItemDownloadTarget(req, req.params.token, req.params.id);
  auditLogger.record("share.public.item.download", req, target.file.id, {
    token: maskToken(req.params.token),
    itemId: req.params.id,
    fileName: target.fileName || target.file.original_name
  });
  if (target.zipRows) {
    await sendZipStream(res, target);
    return;
  }

  return sendFileStream(req, res, target.absolutePath, {
    fs,
    fileName: target.fileName || target.file.original_name,
    contentType: target.contentType,
    disposition: target.disposition,
    cacheControl: "private, no-store"
  });
}));

shareRouter.get("/shares/:token/preview", asyncRoute(async (req, res) => {
  enforcePublicShareLimit(req);
  const target = await shareService.getPublicPreviewTarget(req, req.params.token);
  auditLogger.record("share.public.preview", req, target.file.id, {
    token: maskToken(req.params.token),
    fileName: target.file.original_name
  });
  if (target.pending) {
    res.status(202).json({ ok: true, preview: target.preview });
    return;
  }
  if (target.text != null) {
    sendTextPreview(res, target);
    return;
  }
  if (target.json != null) {
    sendJsonPreview(res, target);
    return;
  }
  return sendFileStream(req, res, target.absolutePath, {
    fs,
    fileName: target.fileName || target.file.original_name,
    contentType: target.contentType,
    disposition: target.disposition,
    cacheControl: "private, no-store"
  });
}));

shareRouter.get("/shares/:token/preview-status", asyncRoute((req, res) => {
  enforcePublicShareLimit(req);
  res.json({ ok: true, ...shareService.getPublicPreviewStatus(req, req.params.token) });
}));

function buildShareUrl(req, token) {
  const protocol = isSecureRequest(req) ? "https" : "http";
  return `${protocol}://${req.headers.host}/share/${encodeURIComponent(token)}`;
}

function enforcePublicShareLimit(req) {
  enforceRateLimit(req, {
    name: "public-share-token",
    key: (request) => ipAndValueKey(request, request.params.token),
    limit: 120,
    windowMs: 10 * 60 * 1000,
    message: "공유 링크 접근이 너무 많습니다. 잠시 후 다시 시도하세요."
  });
}

function maskToken(token) {
  const value = String(token || "");
  return value.length <= 12 ? "short-token" : `${value.slice(0, 6)}...${value.slice(-4)}`;
}

async function sendZipStream(res, target) {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", contentDisposition(target.disposition || "attachment", target.fileName || `${target.file.original_name}.zip`));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  await zipArchiveService.streamFolderZip(target.file, target.zipRows, res);
}

function sendTextPreview(res, target) {
  const body = String(target.text || "");
  res.setHeader("Content-Type", target.contentType || "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", contentDisposition(target.disposition || "inline", target.fileName || target.file.original_name));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Length", Buffer.byteLength(body, "utf8"));
  res.end(body);
}

function sendJsonPreview(res, target) {
  const body = JSON.stringify(target.json || {});
  res.setHeader("Content-Type", target.contentType || "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", contentDisposition(target.disposition || "inline", target.fileName || target.file.original_name));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Length", Buffer.byteLength(body, "utf8"));
  res.end(body);
}
