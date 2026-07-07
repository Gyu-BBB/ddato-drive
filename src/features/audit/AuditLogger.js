import crypto from "node:crypto";
import { getRequestIp } from "../../core/http.js";
import { getDb } from "../../database/database.js";

export class AuditLogger {
  record(action, req, targetId = null, detail = null) {
    getDb().prepare(`
      INSERT INTO audit_logs (id, user_id, action, target_id, ip, detail_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      req.user?.id || null,
      action,
      targetId,
      getRequestIp(req),
      detail ? JSON.stringify(detail) : null,
      Date.now()
    );
  }

  list({ limit = 80, action = "" } = {}) {
    const safeLimit = Math.max(1, Math.min(300, Number(limit) || 80));
    const actionFilter = String(action || "").trim();
    const rows = actionFilter
      ? getDb().prepare(`
        SELECT *
        FROM audit_logs
        WHERE action = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(actionFilter, safeLimit)
      : getDb().prepare(`
        SELECT *
        FROM audit_logs
        ORDER BY created_at DESC
        LIMIT ?
      `).all(safeLimit);

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      action: row.action,
      targetId: row.target_id,
      ip: row.ip,
      detail: parseDetail(row.detail_json),
      createdAt: row.created_at
    }));
  }
}

export const auditLogger = new AuditLogger();

function parseDetail(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
