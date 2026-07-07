import crypto from "node:crypto";
import { config } from "../../core/config.js";
import { fail } from "../../core/errors.js";
import { hashPassword, sha256, verifyPassword } from "../../core/passwords.js";
import { fileRepository } from "../files/FileRepository.js";
import { appSettingsService } from "../settings/AppSettingsService.js";
import { userRepository } from "../users/UserRepository.js";
import { serializeUser } from "../users/user.serializer.js";
import { sessionService } from "./SessionService.js";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

export class AuthService {
  register({ id, password }) {
    const loginId = this.normalizeLoginId(id);
    const cleanPassword = this.normalizePassword(password);
    if (!loginId || !cleanPassword) fail(400, "ID and password are required.");

    let user;
    try {
      user = userRepository.create({
        id: loginId,
        passwordHash: hashPassword(cleanPassword),
        role: "user",
        quotaBytes: appSettingsService.getDefaultQuotaBytes(),
        lastLoginAt: Date.now()
      });
    } catch (error) {
      if (String(error.message || "").includes("UNIQUE")) {
        fail(409, "This ID is already registered.");
      }
      throw error;
    }

    return this.makeLoginResult(user);
  }

  login({ id, password }) {
    const loginId = this.normalizeLoginId(id);
    const cleanPassword = this.normalizePassword(password);
    if (!loginId || !cleanPassword) fail(400, "ID and password are required.");

    const user = userRepository.findById(loginId);
    if (!user) {
      fail(401, "Invalid ID or password.");
    }

    this.assertCanAttemptLogin(user);

    if (user.auth_provider === "google") {
      fail(401, "Google 계정으로 가입한 사용자입니다. Google로 로그인하세요.");
    }

    if (!verifyPassword(cleanPassword, user.password_hash)) {
      this.recordFailedLogin(user);
    }

    return this.makeLoginResult(userRepository.touchLogin(user.id));
  }

  loginWithGoogleProfile(profile) {
    const googleSub = this.normalizeGoogleSubject(profile?.sub);
    const googleEmail = this.normalizeGoogleEmail(profile?.email);
    const emailVerified = profile?.email_verified !== false;
    if (!googleSub) fail(400, "Google account id was not provided.");
    if (!emailVerified) fail(403, "Google 이메일 인증이 완료된 계정만 사용할 수 있습니다.");

    let user = userRepository.findByGoogleSub(googleSub);
    if (!user) {
      user = userRepository.create({
        id: this.makeGoogleUserId(googleSub),
        displayName: this.normalizeDisplayName(profile?.name || googleEmail || "Google User", "Google User"),
        passwordHash: hashPassword(crypto.randomBytes(32).toString("base64url")),
        authProvider: "google",
        googleSub,
        googleEmail,
        role: "user",
        quotaBytes: appSettingsService.getDefaultQuotaBytes(),
        lastLoginAt: Date.now()
      });
      return this.makeLoginResult(user);
    }

    this.assertCanAttemptLogin(user);
    userRepository.updateGoogleProfile(user.id, { googleEmail });
    return this.makeLoginResult(userRepository.touchLogin(user.id));
  }

  logout(token) {
    sessionService.delete(token);
  }

  updateProfile(userId, { displayName, password }) {
    const user = userRepository.findById(userId);
    if (!user || user.disabled_at) fail(404, "User was not found.");

    const cleanName = this.normalizeDisplayName(displayName ?? user.display_name ?? user.id, user.id);
    const cleanPassword = this.normalizePassword(password);
    const passwordHash = cleanPassword ? hashPassword(cleanPassword) : null;
    const updated = userRepository.updateProfile(user.id, {
      displayName: cleanName,
      passwordHash
    });

    return {
      user: {
        ...serializeUser(updated),
        usageBytes: fileRepository.getUsageBytes(updated.id)
      }
    };
  }

  makeLoginResult(user) {
    const token = sessionService.create(user.id);
    return {
      token,
      user: {
        ...serializeUser(user),
        usageBytes: fileRepository.getUsageBytes(user.id)
      }
    };
  }

  assertCanAttemptLogin(user) {
    if (user.disabled_at) {
      fail(403, "이 계정은 비활성화되었습니다.");
    }

    if (user.id === config.adminId) {
      return;
    }

    if (user.login_suspended_at) {
      fail(423, "비밀번호 오류가 20회 누적되어 계정이 일시정지되었습니다. 관리자에게 해제를 요청하세요.", {
        suspendedAt: user.login_suspended_at,
        failedCount: user.login_failed_count || 20
      });
    }

    const lockedUntil = Number(user.login_locked_until || 0);
    if (lockedUntil > Date.now()) {
      fail(423, "비밀번호를 여러 번 틀렸습니다. 잠시 후 다시 시도하세요.", {
        lockedUntil,
        retryAfterSeconds: Math.ceil((lockedUntil - Date.now()) / 1000),
        failedCount: user.login_failed_count || 0
      });
    }
  }

  recordFailedLogin(user) {
    const failedCount = Math.max(0, Number(user.login_failed_count || 0)) + 1;
    const now = Date.now();
    let lockedUntil = null;
    let suspendedAt = null;

    if (user.id === config.adminId) {
      userRepository.recordLoginFailure(user.id, {
        failedCount,
        lockedUntil: null,
        suspendedAt: null
      });
      fail(401, "Invalid ID or password.", { failedCount });
    }

    if (failedCount >= 20) {
      suspendedAt = now;
    } else if (failedCount === 10) {
      lockedUntil = now + ONE_HOUR_MS;
    } else if (failedCount === 5) {
      lockedUntil = now + FIVE_MINUTES_MS;
    }

    userRepository.recordLoginFailure(user.id, {
      failedCount,
      lockedUntil,
      suspendedAt
    });

    if (suspendedAt) {
      fail(423, "비밀번호 오류가 20회 누적되어 계정이 일시정지되었습니다. 관리자에게 해제를 요청하세요.", {
        suspendedAt,
        failedCount
      });
    }

    if (lockedUntil) {
      fail(423, failedCount === 10 ? "비밀번호를 10번 틀려 1시간 동안 로그인할 수 없습니다." : "비밀번호를 5번 틀려 5분 동안 로그인할 수 없습니다.", {
        lockedUntil,
        retryAfterSeconds: Math.ceil((lockedUntil - now) / 1000),
        failedCount
      });
    }

    fail(401, "Invalid ID or password.", { failedCount });
  }

  normalizeLoginId(value) {
    return String(value || "").normalize("NFKC").trim().slice(0, 80);
  }

  normalizePassword(value) {
    return String(value || "").slice(0, 1024);
  }

  normalizeGoogleSubject(value) {
    return String(value || "").trim().slice(0, 256);
  }

  normalizeGoogleEmail(value) {
    return String(value || "").normalize("NFKC").trim().toLowerCase().slice(0, 254) || null;
  }

  normalizeDisplayName(value, fallback) {
    return String(value || "").normalize("NFKC").trim().slice(0, 80) || fallback;
  }

  makeGoogleUserId(googleSub) {
    const base = `google_${sha256(googleSub).slice(0, 20)}`;
    let candidate = base;
    for (let index = 1; userRepository.findById(candidate); index += 1) {
      candidate = `${base}_${index}`;
    }
    return candidate;
  }
}

export const authService = new AuthService();
