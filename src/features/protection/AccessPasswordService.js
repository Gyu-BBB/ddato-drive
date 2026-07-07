import { fail } from "../../core/errors.js";
import { getRequestIp } from "../../core/http.js";
import { hashPassword, sha256, verifyPassword } from "../../core/passwords.js";
import { fileRepository } from "../files/FileRepository.js";

const UNLOCK_TTL_MS = 4 * 60 * 60 * 1000;
const unlocks = new Map();

export class AccessPasswordService {
  hash(password) {
    return hashPassword(normalizePassword(password));
  }

  verify(password, encoded) {
    return verifyPassword(normalizePassword(password), encoded);
  }

  findFileProtection(file) {
    if (!file) return null;
    if (file.access_password_hash) return file;

    const rows = fileRepository.listActiveByOwner(file.owner_id);
    const byId = new Map(rows.map((row) => [row.id, row]));
    let cursor = file.parent_id ? byId.get(file.parent_id) : null;
    while (cursor) {
      if (cursor.access_password_hash) return cursor;
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : null;
    }
    return null;
  }

  serializeFileProtection(req, file) {
    const protection = this.findFileProtection(file);
    return {
      passwordProtected: Boolean(protection),
      ownPasswordProtected: Boolean(file?.access_password_hash),
      passwordUnlocked: !protection || this.isAuthenticatedUnlocked(req, "file", protection.id)
    };
  }

  assertFileAccess(req, file) {
    const protection = this.findFileProtection(file);
    if (!protection || this.isAuthenticatedUnlocked(req, "file", protection.id)) return;
    failPasswordRequired("file", file.id);
  }

  assertFileTreeAccess(req, root, rows = []) {
    const rootProtection = this.findFileProtection(root);
    if (rootProtection && !this.isAuthenticatedUnlocked(req, "file", rootProtection.id)) {
      failPasswordRequired("file", root.id);
    }

    for (const row of rows) {
      if (row.access_password_hash && !this.isAuthenticatedUnlocked(req, "file", row.id)) {
        failPasswordRequired("file", row.id);
      }
    }
  }

  unlockFile(req, file, password) {
    const protection = this.findFileProtection(file);
    if (!protection) return { unlocked: true, protected: false };
    if (!this.verify(password, protection.access_password_hash)) {
      fail(401, "암호가 올바르지 않습니다.", { code: "password_invalid", resourceType: "file" });
    }
    this.grantAuthenticatedUnlock(req, "file", protection.id);
    return { unlocked: true, protected: true };
  }

  assertPublicFileAccess(req, token, file) {
    const protection = this.findFileProtection(file);
    if (!protection || this.isPublicUnlocked(req, token, protection.id)) return;
    failPasswordRequired("share", file.id);
  }

  unlockPublicFile(req, token, file, password) {
    const protection = this.findFileProtection(file);
    if (!protection) return { unlocked: true, protected: false };
    if (!this.verify(password, protection.access_password_hash)) {
      fail(401, "암호가 올바르지 않습니다.", { code: "password_invalid", resourceType: "share" });
    }
    this.grantPublicUnlock(req, token, protection.id);
    return { unlocked: true, protected: true };
  }

  assertPublicSharePasswordAccess(req, share) {
    if (!share?.access_password_hash || this.isPublicUnlocked(req, share.token, share.id)) return;
    failPasswordRequired("share", share.id);
  }

  unlockPublicSharePassword(req, share, password) {
    if (!share?.access_password_hash) return { unlocked: true, protected: false };
    if (!this.verify(password, share.access_password_hash)) {
      fail(401, "암호가 올바르지 않습니다.", { code: "password_invalid", resourceType: "share" });
    }
    this.grantPublicUnlock(req, share.token, share.id);
    return { unlocked: true, protected: true };
  }

  serializeNoteProtection(req, note) {
    const protectedId = note?.access_password_hash ? note.id : "";
    return {
      passwordProtected: Boolean(protectedId),
      passwordUnlocked: !protectedId || this.isAuthenticatedUnlocked(req, "note", protectedId)
    };
  }

  assertNoteAccess(req, note) {
    if (!note?.access_password_hash || this.isAuthenticatedUnlocked(req, "note", note.id)) return;
    failPasswordRequired("note", note.id);
  }

  unlockNote(req, note, password) {
    if (!note?.access_password_hash) return { unlocked: true, protected: false };
    if (!this.verify(password, note.access_password_hash)) {
      fail(401, "암호가 올바르지 않습니다.", { code: "password_invalid", resourceType: "note" });
    }
    this.grantAuthenticatedUnlock(req, "note", note.id);
    return { unlocked: true, protected: true };
  }

  grantAuthenticatedUnlock(req, resourceType, resourceId) {
    setUnlock(authenticatedKey(req, resourceType, resourceId));
  }

  isAuthenticatedUnlocked(req, resourceType, resourceId) {
    return hasUnlock(authenticatedKey(req, resourceType, resourceId));
  }

  revokeUnlocksForResource(resourceId) {
    const suffix = `:${resourceId}`;
    for (const key of unlocks.keys()) {
      if (key.endsWith(suffix)) unlocks.delete(key);
    }
  }

  grantPublicUnlock(req, token, resourceId) {
    setUnlock(publicKey(req, token, resourceId));
  }

  isPublicUnlocked(req, token, resourceId) {
    return hasUnlock(publicKey(req, token, resourceId));
  }
}

export const accessPasswordService = new AccessPasswordService();

function normalizePassword(password) {
  const value = String(password || "");
  if (!value) fail(400, "암호를 입력하세요.", { code: "password_required_input" });
  return value;
}

function failPasswordRequired(resourceType, resourceId) {
  fail(423, "암호가 필요합니다.", {
    code: "password_required",
    resourceType,
    resourceId
  });
}

function authenticatedKey(req, resourceType, resourceId) {
  return `auth:${sha256(req.sessionToken || "")}:${resourceType}:${resourceId}`;
}

function publicKey(req, token, resourceId) {
  const fingerprint = sha256(`${getRequestIp(req)}|${req.headers["user-agent"] || ""}`);
  return `public:${sha256(token)}:${fingerprint}:${resourceId}`;
}

function setUnlock(key) {
  cleanupUnlocks();
  unlocks.set(key, Date.now() + UNLOCK_TTL_MS);
}

function hasUnlock(key) {
  const expiresAt = unlocks.get(key) || 0;
  if (expiresAt > Date.now()) return true;
  unlocks.delete(key);
  return false;
}

function cleanupUnlocks() {
  const now = Date.now();
  for (const [key, expiresAt] of unlocks.entries()) {
    if (expiresAt <= now) unlocks.delete(key);
  }
}
