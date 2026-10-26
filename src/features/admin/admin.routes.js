import express from "express";
import { asyncRoute } from "../../core/http.js";
import { auditLogger } from "../audit/AuditLogger.js";
import { requireAdmin } from "../auth/auth.middleware.js";
import { adminService } from "./AdminService.js";
import { storageIntegrityService } from '../system/StorageIntegrityService.js';

export const adminRouter = express.Router();

adminRouter.use("/admin", requireAdmin);

adminRouter.get('/admin/integrity', asyncRoute((_req, res) => {
  res.json({ ok: true, report: storageIntegrityService.getStatus() });
}));
adminRouter.post('/admin/integrity', asyncRoute((req, res) => {
  const report = storageIntegrityService.start();
  auditLogger.record('admin.integrity.start', req, null);
  res.status(202).json({ ok: true, report });
}));

adminRouter.get("/admin/users", asyncRoute((_req, res) => {
  res.json({ ok: true, users: adminService.listUsers() });
}));

adminRouter.post("/admin/users", asyncRoute((req, res) => {
  const user = adminService.createUser(req.body || {});
  auditLogger.record("admin.user.create", req, user.id, { quotaBytes: user.quotaBytes });
  res.status(201).json({ ok: true, user });
}));

adminRouter.patch("/admin/users/:id/quota", asyncRoute((req, res) => {
  const user = adminService.updateQuota(req.params.id, req.body || {});
  auditLogger.record("admin.quota.update", req, user.id, { quotaBytes: user.quotaBytes });
  res.json({ ok: true, user });
}));

adminRouter.patch("/admin/users/:id/role", asyncRoute((req, res) => {
  const user = adminService.updateRole(req.user, req.params.id, req.body || {});
  auditLogger.record("admin.role.update", req, user.id, { role: user.role });
  res.json({ ok: true, user });
}));

adminRouter.get("/admin/users/:id/files", asyncRoute((req, res) => {
  res.json({
    ok: true,
    ...adminService.listUserFiles(req, req.params.id, req.query.parentId)
  });
}));

adminRouter.delete("/admin/users/:id", asyncRoute((req, res) => {
  const user = adminService.disableUser(req.params.id);
  auditLogger.record("admin.user.disable", req, user.id);
  res.json({ ok: true, user });
}));

adminRouter.post("/admin/users/:id/enable", asyncRoute((req, res) => {
  const user = adminService.enableUser(req.params.id);
  auditLogger.record("admin.user.enable", req, user.id);
  res.json({ ok: true, user });
}));

adminRouter.delete("/admin/users/:id/permanent", asyncRoute((req, res) => {
  const result = adminService.deleteUser(req.params.id);
  auditLogger.record("admin.user.delete", req, result.user.id, {
    deletedFiles: result.deletedFiles,
    deletedBytes: result.deletedBytes,
    deletedUploadSessions: result.deletedUploadSessions
  });
  res.json({ ok: true, ...result });
}));

adminRouter.post("/admin/users/:id/unlock", asyncRoute((req, res) => {
  const user = adminService.unlockUserLogin(req.params.id);
  auditLogger.record("admin.user.unlock", req, user.id);
  res.json({ ok: true, user });
}));

adminRouter.delete("/admin/files/:id/password", asyncRoute((req, res) => {
  const file = adminService.resetFileAccessPassword(req, req.params.id);
  auditLogger.record("admin.file.password.reset", req, file.id, {
    ownerId: file.ownerId,
    name: file.name
  });
  res.json({ ok: true, file });
}));

adminRouter.delete("/admin/notes/:id/password", asyncRoute((req, res) => {
  const note = adminService.resetNoteAccessPassword(req, req.params.id);
  auditLogger.record("admin.note.password.reset", req, note.id, {
    ownerId: note.userId,
    title: note.title
  });
  res.json({ ok: true, note });
}));

adminRouter.get("/admin/storage", asyncRoute((_req, res) => {
  res.json({ ok: true, storage: adminService.getStorageSummary() });
}));

adminRouter.get("/admin/system", asyncRoute((_req, res) => {
  res.json({ ok: true, system: adminService.getSystemStatus() });
}));

adminRouter.patch("/admin/settings/default-quota", asyncRoute((req, res) => {
  const settings = adminService.updateDefaultQuota(req.body || {});
  auditLogger.record("admin.settings.default_quota.update", req, "default_quota", {
    defaultQuotaBytes: settings.defaultQuotaBytes
  });
  res.json({ ok: true, settings });
}));

adminRouter.get("/admin/audit", asyncRoute((req, res) => {
  res.json({ ok: true, logs: adminService.listAuditLogs(req.query) });
}));
