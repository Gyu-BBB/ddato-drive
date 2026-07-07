import express from "express";
import { config } from "../../core/config.js";
import { asyncRoute, jsonError } from "../../core/http.js";
import { enforceRateLimit, ipKey } from "../../core/rateLimit.js";
import { auditLogger } from "../audit/AuditLogger.js";
import { fileRepository } from "../files/FileRepository.js";
import { userRepository } from "../users/UserRepository.js";
import { serializeUser } from "../users/user.serializer.js";
import { authService } from "./AuthService.js";
import { clearGoogleStateCookie, clearSessionCookie, makeGoogleStateCookie, makeSessionCookie, parseCookies } from "./auth.cookies.js";
import { requireUser } from "./auth.middleware.js";
import { googleOAuthService } from "./GoogleOAuthService.js";

export const authRouter = express.Router();

authRouter.post("/auth/register", asyncRoute((_req, res) => {
  jsonError(res, 410, "일반 회원가입은 Google 로그인으로 대체되었습니다.");
}));

authRouter.post("/auth/login", asyncRoute((req, res) => {
  const rawId = req.body?.id || "";
  enforceRateLimit(req, {
    name: "auth-login-ip",
    key: ipKey,
    limit: 40,
    windowMs: 15 * 60 * 1000,
    message: "로그인 요청이 너무 많습니다. 잠시 후 다시 시도하세요."
  });

  let result;
  try {
    result = authService.login(req.body || {});
  } catch (error) {
    auditLogger.record("auth.login.failed", req, String(rawId || "").slice(0, 80));
    throw error;
  }
  req.user = { id: result.user.id, role: result.user.role };
  auditLogger.record("auth.login", req, result.user.id);
  res.setHeader("Set-Cookie", makeSessionCookie(req, result.token));
  res.json({ ok: true, user: result.user });
}));

authRouter.get("/auth/google/status", (_req, res) => {
  res.json({ ok: true, enabled: googleOAuthService.isEnabled() });
});

authRouter.get("/auth/google", asyncRoute((req, res) => {
  if (!googleOAuthService.isEnabled()) {
    jsonError(res, 503, "Google 로그인이 아직 설정되지 않았습니다.");
    return;
  }

  enforceRateLimit(req, {
    name: "auth-google-start-ip",
    key: ipKey,
    limit: 40,
    windowMs: 15 * 60 * 1000,
    message: "Google 로그인 요청이 너무 많습니다. 잠시 후 다시 시도하세요."
  });

  const state = googleOAuthService.createState();
  res.setHeader("Set-Cookie", makeGoogleStateCookie(req, state));
  res.redirect(googleOAuthService.getAuthorizationUrl(req, state));
}));

authRouter.get("/auth/google/callback", asyncRoute(async (req, res) => {
  if (req.query.error) {
    res.setHeader("Set-Cookie", clearGoogleStateCookie(req));
    res.redirect(`/?authError=${encodeURIComponent(String(req.query.error))}`);
    return;
  }

  const expectedState = parseCookies(req.headers.cookie).get(config.googleStateCookieName);
  const profile = await googleOAuthService.exchangeCallback(req, {
    code: req.query.code,
    state: req.query.state,
    expectedState
  });
  const result = authService.loginWithGoogleProfile(profile);
  req.user = { id: result.user.id, role: result.user.role };
  auditLogger.record("auth.google.login", req, result.user.id, {
    email: result.user.googleEmail
  });
  res.setHeader("Set-Cookie", [
    clearGoogleStateCookie(req),
    makeSessionCookie(req, result.token)
  ]);
  res.redirect("/");
}));

authRouter.post("/auth/logout", (req, res) => {
  authService.logout(req.sessionToken);
  res.setHeader("Set-Cookie", clearSessionCookie(req));
  res.json({ ok: true });
});

authRouter.patch("/auth/profile", requireUser, asyncRoute((req, res) => {
  const result = authService.updateProfile(req.user.id, req.body || {});
  req.user = { id: result.user.id, role: result.user.role };
  auditLogger.record("auth.profile.update", req, result.user.id, { displayName: result.user.displayName });
  res.json({ ok: true, user: result.user });
}));

authRouter.get("/auth/me", requireUser, (req, res) => {
  const user = userRepository.findById(req.user.id);
  res.json({
    ok: true,
    user: {
      ...serializeUser(user),
      usageBytes: fileRepository.getUsageBytes(user.id)
    }
  });
});
