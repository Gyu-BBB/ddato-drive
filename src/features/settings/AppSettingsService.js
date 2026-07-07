import { config } from "../../core/config.js";
import { fail } from "../../core/errors.js";
import { settingsRepository } from "./SettingsRepository.js";

const DEFAULT_QUOTA_KEY = "default_quota_bytes";

export class AppSettingsService {
  getSettings() {
    const defaultQuotaBytes = this.getDefaultQuotaBytes();
    return {
      defaultQuotaBytes,
      defaultQuotaMb: Math.round((defaultQuotaBytes / (1024 * 1024)) * 10) / 10
    };
  }

  getDefaultQuotaBytes() {
    const row = settingsRepository.get(DEFAULT_QUOTA_KEY);
    const bytes = Number(row?.value);
    if (Number.isFinite(bytes) && bytes >= 1) return Math.round(bytes);
    return config.defaultQuotaBytes;
  }

  updateDefaultQuota(payload = {}) {
    const quotaBytes = normalizeQuotaBytes(payload);
    if (quotaBytes > config.projectDiskQuotaBytes) {
      fail(400, "기본 저장소 크기는 프로젝트 최대 용량을 넘을 수 없습니다.", {
        code: "default_quota_too_large",
        quotaBytes,
        maxBytes: config.projectDiskQuotaBytes
      });
    }
    settingsRepository.set(DEFAULT_QUOTA_KEY, quotaBytes);
    return this.getSettings();
  }
}

export const appSettingsService = new AppSettingsService();

function normalizeQuotaBytes(payload = {}) {
  if (payload.quotaBytes !== undefined) {
    const bytes = Math.round(Number(payload.quotaBytes));
    if (Number.isFinite(bytes) && bytes >= 1) return bytes;
  }

  const mb = Number(payload.quotaMb);
  if (!Number.isFinite(mb) || mb <= 0) {
    fail(400, "기본 저장소 크기를 1MB 이상으로 입력하세요.", {
      code: "invalid_default_quota"
    });
  }
  return Math.round(mb * 1024 * 1024);
}
