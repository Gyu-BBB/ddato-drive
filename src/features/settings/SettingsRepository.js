import { getDb } from "../../database/database.js";

export class SettingsRepository {
  get(key) {
    return getDb().prepare("SELECT key, value, updated_at FROM app_settings WHERE key = ?").get(key);
  }

  set(key, value) {
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, String(value), now);
    return this.get(key);
  }
}

export const settingsRepository = new SettingsRepository();
