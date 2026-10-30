import express from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { config } from "./core/config.js";
import { jsonError } from "./core/http.js";
import { requireSameOriginForUnsafeMethods } from "./core/requestGuards.js";
import { closeDatabase, initializeDatabase } from "./database/database.js";
import { adminRouter } from "./features/admin/admin.routes.js";
import { attachSession } from "./features/auth/auth.middleware.js";
import { authRouter } from "./features/auth/auth.routes.js";
import { filesRouter } from "./features/files/file.routes.js";
import { trashCleanupService } from "./features/files/TrashCleanupService.js";
import { healthRouter } from "./features/health/health.routes.js";
import { notesRouter } from "./features/notes/note.routes.js";
import { shareRouter } from "./features/shares/share.routes.js";
import { sshRouter } from './features/ssh/ssh.routes.js';
import { driveSshServer } from './features/ssh/DriveSshServer.js';
import { remoteTransferService } from './features/ssh/RemoteTransferService.js';

initializeDatabase();
await driveSshServer.initialize();

const clientDistDir = path.join(config.projectRoot, "dist");
const clientIndexFile = path.join(clientDistDir, "index.html");
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", config.trustProxy);

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "frame-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "connect-src 'self'",
  "worker-src 'self' blob:"
].join("; ");

app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", contentSecurityPolicy);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  next();
});

app.use(requireSameOriginForUnsafeMethods);
app.use(express.json({ limit: "1mb" }));
app.use(attachSession);

app.use("/api", healthRouter);
app.use("/api", authRouter);
app.use("/api", filesRouter);
app.use("/api", notesRouter);
app.use("/api", shareRouter);
app.use("/api", adminRouter);
app.use('/api', sshRouter);

app.get("/service-worker.js", (_req, res) => {
  res
    .type("application/javascript; charset=utf-8")
    .setHeader("Cache-Control", "no-store");
  res.send(`
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: "window" });
    await Promise.all(clients.map((client) => client.navigate(client.url)));
  })());
});
`);
});

app.use(express.static(clientDistDir, {
  setHeaders: (res, filePath) => {
    const fileName = path.basename(filePath);
    if (fileName === "index.html") {
      res.setHeader("Cache-Control", "no-cache");
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
}));

app.use((req, res) => {
  if (req.path.startsWith("/api")) {
    jsonError(res, 404, `Route not found: ${req.method} ${req.path}`);
    return;
  }

  if (req.method === "GET" && fs.existsSync(clientIndexFile)) {
    res.sendFile(clientIndexFile);
    return;
  }

  res
    .status(503)
    .type("text/plain; charset=utf-8")
    .send("DDATO Drive frontend build is missing. Run `npm run build` first.");
});

app.use((error, _req, res, _next) => {
  if (res.headersSent || res.destroyed) {
    if (!res.destroyed) res.destroy();
    return;
  }
  if (error.code === 'ENOSPC' || error.code === 'EDQUOT') {
    jsonError(res, 507, '서버 디스크 공간이 부족합니다. 관리자에게 문의한 뒤 다시 시도해 주세요.', { details: { code: 'disk_full' } });
    return;
  }
  if (error instanceof multer.MulterError) {
    if (error.details) { jsonError(res, error.statusCode || 400, error.message, { details: error.details }); return; }
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    if (error.code === "LIMIT_FILE_SIZE") {
      jsonError(res, status, "파일이 너무 큽니다.", {
        details: {
          code: "upload_file_too_large",
          maxBytes: config.maxUploadBytes
        }
      });
      return;
    }
    jsonError(res, status, error.message);
    return;
  }

  const status = Number(error.statusCode || error.status || 500);
  if (status >= 500) {
    console.error(error);
  }
  const extra = error.details ? { details: error.details } : {};
  jsonError(res, status, status >= 500 ? '서버에서 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' : error.message || 'Request failed.', extra);
});

const server = app.listen(config.port, config.host, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  console.log("DDATO Drive API is running:");
  console.log(`  http://localhost:${port}`);
  console.log(`  data: ${config.dataDir}`);
  console.log(`  admin: ${config.adminId}`);
});

trashCleanupService.start();

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  await Promise.all([driveSshServer.stop(), remoteTransferService.stop()]);
  server.close(async () => {
    await trashCleanupService.stop();
    closeDatabase();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
