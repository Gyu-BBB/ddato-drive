import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

loadEnvFile(path.join(projectRoot, ".env"));

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function numberEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
}

function absolutePath(value, fallback) {
  const raw = String(value || "").trim();
  return path.resolve(raw || fallback);
}

const dataDir = absolutePath(process.env.DDATO_DRIVE_DATA_DIR, path.join(os.homedir(), "NASDrive"));
const projectDiskQuotaBytes = Math.max(1, Math.round(numberEnv("DDATO_DRIVE_PROJECT_QUOTA_GB", 1024) * 1024 * 1024 * 1024));
const publicUrl = String(process.env.DDATO_DRIVE_PUBLIC_URL || "").trim().replace(/\/+$/, "");

export const config = Object.freeze({
  projectRoot,
  host: process.env.DDATO_DRIVE_HOST || "0.0.0.0",
  port: numberEnv("DDATO_DRIVE_PORT", Number(process.env.PORT || 4000)),
  publicUrl,
  trustProxy: process.env.DDATO_DRIVE_TRUST_PROXY === "1",
  dataDir,
  appDataDir: path.join(dataDir, "app-data"),
  dbFile: absolutePath(process.env.DDATO_DRIVE_DB_FILE, path.join(dataDir, "app-data", "drive.sqlite")),
  previewCacheDir: path.join(dataDir, "app-data", "previews"),
  storageDir: path.join(dataDir, "storage"),
  tempDir: path.join(dataDir, "temp"),
  trashDir: path.join(dataDir, "trash"),
  adminId: process.env.DDATO_DRIVE_ADMIN_ID || "admin",
  adminPassword: process.env.DDATO_DRIVE_ADMIN_PASSWORD || "518520",
  defaultQuotaBytes: Math.max(1, Math.round(numberEnv("DDATO_DRIVE_DEFAULT_QUOTA_MB", 1024) * 1024 * 1024)),
  projectDiskQuotaBytes,
  sessionCookieName: process.env.DDATO_DRIVE_SESSION_COOKIE || "ddato_drive_sid",
  googleStateCookieName: process.env.DDATO_DRIVE_GOOGLE_STATE_COOKIE || "ddato_drive_google_state",
  googleClientId: String(process.env.DDATO_DRIVE_GOOGLE_CLIENT_ID || "").trim(),
  googleClientSecret: String(process.env.DDATO_DRIVE_GOOGLE_CLIENT_SECRET || "").trim(),
  sessionTtlMs: Math.max(60_000, numberEnv("DDATO_DRIVE_SESSION_DAYS", 14) * 24 * 60 * 60 * 1000),
  uploadSessionTtlMs: Math.max(60_000, numberEnv("DDATO_DRIVE_UPLOAD_SESSION_TTL_HOURS", 24) * 60 * 60 * 1000),
  maxUploadBytes: projectDiskQuotaBytes,
  maxUploadChunkBytes: Math.max(1, numberEnv("DDATO_DRIVE_MAX_UPLOAD_CHUNK_BYTES", 8 * 1024 * 1024))
});

export function ensureDataDirectories() {
  fs.mkdirSync(config.appDataDir, { recursive: true });
  fs.mkdirSync(config.previewCacheDir, { recursive: true });
  fs.mkdirSync(config.storageDir, { recursive: true });
  fs.mkdirSync(config.tempDir, { recursive: true });
  fs.mkdirSync(config.trashDir, { recursive: true });
}
