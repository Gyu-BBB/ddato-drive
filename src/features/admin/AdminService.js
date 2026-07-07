import { config } from "../../core/config.js";
import { fail } from "../../core/errors.js";
import { hashPassword } from "../../core/passwords.js";
import { withTransaction } from "../../database/database.js";
import { auditLogger } from "../audit/AuditLogger.js";
import { fileRepository } from "../files/FileRepository.js";
import { fileService } from "../files/FileService.js";
import { fileStorage } from "../files/FileStorage.js";
import { uploadSessionStore } from "../files/UploadSessionStore.js";
import { noteService } from "../notes/NoteService.js";
import { appSettingsService } from "../settings/AppSettingsService.js";
import { systemStatusService } from "../system/SystemStatusService.js";
import { serializeUser } from "../users/user.serializer.js";
import { userRepository } from "../users/UserRepository.js";

export class AdminService {
  listUsers() {
    return userRepository.listAll().map((user) => ({
      ...serializeUser(user),
      usageBytes: fileRepository.getUsageBytes(user.id)
    }));
  }

  createUser(body = {}) {
    const id = this.normalizeUserId(body.id);
    const password = this.normalizePassword(body.password);
    if (!id || !password) fail(400, "ID and password are required.");

    const quotaBytes = body.quotaMb === undefined && body.quotaBytes === undefined && body.unlimited !== true
      ? appSettingsService.getDefaultQuotaBytes()
      : this.normalizeQuota(body);

    let user;
    try {
      user = userRepository.create({
        id,
        passwordHash: hashPassword(password),
        role: "user",
        quotaBytes
      });
    } catch (error) {
      if (String(error.message || "").includes("UNIQUE")) {
        fail(409, "This ID is already registered.");
      }
      throw error;
    }

    return {
      ...serializeUser(user),
      usageBytes: 0
    };
  }

  updateQuota(userId, body = {}) {
    const user = userRepository.findById(userId);
    if (!user) fail(404, "User was not found.");

    const quotaBytes = this.normalizeQuota(body);
    const updated = userRepository.setQuota(user.id, quotaBytes);
    return {
      ...serializeUser(updated),
      usageBytes: fileRepository.getUsageBytes(updated.id)
    };
  }

  updateRole(adminUser, userId, body = {}) {
    if (userId === config.adminId) {
      fail(400, "The bootstrap admin role cannot be changed.");
    }
    if (adminUser.id === userId) {
      fail(400, "You cannot change your own role.");
    }

    const user = userRepository.findById(userId);
    if (!user) fail(404, "User was not found.");

    const role = this.normalizeRole(body.role);
    const updated = userRepository.setRole(user.id, role);
    return {
      ...serializeUser(updated),
      usageBytes: fileRepository.getUsageBytes(updated.id)
    };
  }

  listUserFiles(req, userId, parentId) {
    return fileService.listFiles(req, {
      ownerId: userId,
      parentId
    });
  }

  disableUser(userId) {
    if (userId === config.adminId) {
      fail(400, "The bootstrap admin user cannot be disabled.");
    }

    const user = userRepository.findById(userId);
    if (!user) fail(404, "User was not found.");

    const disabled = userRepository.disable(user.id);
    return {
      ...serializeUser(disabled),
      usageBytes: fileRepository.getUsageBytes(disabled.id)
    };
  }

  enableUser(userId) {
    const user = userRepository.findById(userId);
    if (!user) fail(404, "User was not found.");

    const enabled = userRepository.enable(user.id);
    return {
      ...serializeUser(enabled),
      usageBytes: fileRepository.getUsageBytes(enabled.id)
    };
  }

  deleteUser(userId) {
    if (userId === config.adminId) {
      fail(400, "The bootstrap admin user cannot be deleted.");
    }

    const user = userRepository.findById(userId);
    if (!user) fail(404, "User was not found.");

    const files = fileRepository.listByOwner(user.id);
    const storedFiles = files.filter((file) => file.type === "file" && file.storage_path);
    const usageBytes = fileRepository.getUsageBytes(user.id);
    const deletedUploadSessions = uploadSessionStore.deleteSessionsForUser(user.id);

    withTransaction(() => {
      userRepository.delete(user.id);
    });

    for (const file of storedFiles) {
      fileStorage.deleteStoredAssets(file);
    }

    return {
      user: {
        ...serializeUser(user),
        usageBytes
      },
      deletedFiles: files.length,
      deletedBytes: usageBytes,
      deletedUploadSessions
    };
  }

  unlockUserLogin(userId) {
    const user = userRepository.findById(userId);
    if (!user) fail(404, "User was not found.");

    const unlocked = userRepository.clearLoginFailureState(user.id);
    return {
      ...serializeUser(unlocked),
      usageBytes: fileRepository.getUsageBytes(unlocked.id)
    };
  }

  resetFileAccessPassword(req, fileId) {
    return fileService.resetAccessPasswordAsAdmin(req, fileId);
  }

  resetNoteAccessPassword(req, noteId) {
    return noteService.resetAccessPasswordAsAdmin(req, noteId);
  }

  getStorageSummary() {
    return fileRepository.getStorageSummary();
  }

  getSystemStatus() {
    return systemStatusService.getStatus(fileRepository.getStorageSummary(), appSettingsService.getSettings());
  }

  updateDefaultQuota(body = {}) {
    return appSettingsService.updateDefaultQuota(body);
  }

  listAuditLogs(query = {}) {
    return auditLogger.list({
      limit: query.limit,
      action: query.action
    });
  }

  normalizeQuota(body = {}) {
    if (body.unlimited === true || body.quotaBytes === null || body.quotaMb === null) return null;

    if (body.quotaBytes !== undefined) {
      const bytes = Math.round(Number(body.quotaBytes));
      if (!Number.isFinite(bytes) || bytes < 0) {
        fail(400, "quotaBytes must be a positive number or null.");
      }
      return bytes;
    }

    if (body.quotaMb !== undefined) {
      const mb = Number(body.quotaMb);
      if (!Number.isFinite(mb) || mb < 0) {
        fail(400, "quotaMb must be a positive number or null.");
      }
      return Math.round(mb * 1024 * 1024);
    }

    fail(400, "quotaMb, quotaBytes, or unlimited is required.");
  }

  normalizeUserId(value) {
    return String(value || "").normalize("NFKC").trim().slice(0, 80);
  }

  normalizePassword(value) {
    return String(value || "").slice(0, 1024);
  }

  normalizeRole(value) {
    const role = String(value || "").trim();
    if (role === "admin" || role === "user") return role;
    fail(400, "Role must be admin or user.");
  }
}

export const adminService = new AdminService();
