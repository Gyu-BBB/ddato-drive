import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../../core/config.js";

export class UploadSessionStore {
  constructor() {
    this.lastCleanupAt = 0;
  }

  getPendingBytes(filters = {}) {
    return this.listSessions({ cleanup: true })
      .filter((session) => this.matches(session.metadata, filters))
      .reduce((total, session) => total + Number(session.metadata.sizeBytes || 0), 0);
  }

  getPendingRemainingBytes(filters = {}) {
    return this.listSessions({ cleanup: true })
      .filter((session) => this.matches(session.metadata, filters))
      .reduce((total, session) => {
        const sizeBytes = Number(session.metadata.sizeBytes || 0);
        const uploadedBytes = this.uploadedBytes(session);
        return total + Math.max(0, sizeBytes - uploadedBytes);
      }, 0);
  }

  deleteSessionsForUser(userId) {
    let deleted = 0;
    for (const session of this.listSessions({ cleanup: false })) {
      if (session.metadata.ownerId !== userId && session.metadata.requestUserId !== userId) continue;
      fs.rmSync(session.dir, { recursive: true, force: true });
      deleted += 1;
    }
    return deleted;
  }

  cleanupStaleSessions(now = Date.now()) {
    const root = this.rootDir();
    if (!fs.existsSync(root)) return 0;

    let deleted = 0;
    for (const session of this.listSessions({ cleanup: false })) {
      const updatedAt = Number(session.metadata.updatedAt || session.metadata.createdAt || 0);
      if (updatedAt && now - updatedAt <= config.uploadSessionTtlMs) continue;
      fs.rmSync(session.dir, { recursive: true, force: true });
      deleted += 1;
    }
    this.lastCleanupAt = now;
    return deleted;
  }

  listSessions({ cleanup = false } = {}) {
    const now = Date.now();
    if (cleanup && now - this.lastCleanupAt > 60_000) {
      this.cleanupStaleSessions(now);
    }

    const root = this.rootDir();
    if (!fs.existsSync(root)) return [];

    const sessions = [];
    for (const userEntry of safeReadDir(root)) {
      if (!userEntry.isDirectory()) continue;
      const userDir = path.join(root, userEntry.name);
      for (const sessionEntry of safeReadDir(userDir)) {
        if (!sessionEntry.isDirectory()) continue;
        const dir = path.join(userDir, sessionEntry.name);
        const metadataPath = path.join(dir, "metadata.json");
        const metadata = readMetadata(metadataPath);
        if (!metadata) continue;
        sessions.push({
          dir,
          partialPath: path.join(dir, "upload.bin"),
          metadata
        });
      }
    }
    return sessions;
  }

  matches(metadata, filters = {}) {
    if (filters.ownerId && metadata.ownerId !== filters.ownerId) return false;
    if (filters.requestUserId && metadata.requestUserId !== filters.requestUserId) return false;
    if (filters.excludeSessionId && metadata.id === filters.excludeSessionId) return false;
    return true;
  }

  uploadedBytes(session) {
    try {
      return fs.statSync(session.partialPath).size;
    } catch {
      return 0;
    }
  }

  rootDir() {
    return path.join(config.tempDir, "upload-sessions");
  }

  userKey(userId) {
    return crypto.createHash("sha256").update(String(userId)).digest("hex").slice(0, 24);
  }
}

function readMetadata(metadataPath) {
  try {
    return JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  } catch {
    return null;
  }
}

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

export const uploadSessionStore = new UploadSessionStore();
