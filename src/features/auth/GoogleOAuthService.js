import crypto from "node:crypto";
import { config } from "../../core/config.js";
import { fail } from "../../core/errors.js";
import { isSecureRequest } from "../../core/http.js";

const AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const SCOPES = ["openid", "email", "profile"];

export class GoogleOAuthService {
  isEnabled() {
    return Boolean(config.googleClientId && config.googleClientSecret);
  }

  createState() {
    return crypto.randomBytes(24).toString("base64url");
  }

  getAuthorizationUrl(req, state) {
    this.assertEnabled();
    const params = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: this.getRedirectUri(req),
      response_type: "code",
      scope: SCOPES.join(" "),
      state,
      access_type: "online",
      prompt: "select_account"
    });
    return `${AUTHORIZATION_URL}?${params}`;
  }

  async exchangeCallback(req, { code, state, expectedState }) {
    this.assertEnabled();
    const cleanCode = String(code || "").trim();
    if (!cleanCode) fail(400, "Google authorization code was not provided.");
    if (!this.isValidState(state, expectedState)) fail(400, "Google login state is invalid.");

    const token = await this.exchangeCode(req, cleanCode);
    return this.fetchUserInfo(token.access_token);
  }

  async exchangeCode(req, code) {
    const body = new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.getRedirectUri(req)
    });

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    const json = await safeJson(response);
    if (!response.ok || !json?.access_token) {
      fail(502, "Google 로그인 토큰을 발급받지 못했습니다.", {
        status: response.status,
        error: json?.error || "token_exchange_failed"
      });
    }
    return json;
  }

  async fetchUserInfo(accessToken) {
    const response = await fetch(USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    const json = await safeJson(response);
    if (!response.ok || !json?.sub) {
      fail(502, "Google 사용자 정보를 가져오지 못했습니다.", {
        status: response.status,
        error: json?.error || "userinfo_failed"
      });
    }
    return json;
  }

  getRedirectUri(req) {
    return `${this.getBaseUrl(req)}/api/auth/google/callback`;
  }

  getBaseUrl(req) {
    if (config.publicUrl) return config.publicUrl;
    const protocol = isSecureRequest(req) ? "https" : "http";
    const host = String(req.headers.host || "").trim();
    return host ? `${protocol}://${host}` : `http://localhost:${config.port}`;
  }

  assertEnabled() {
    if (!this.isEnabled()) {
      fail(503, "Google 로그인이 아직 설정되지 않았습니다.");
    }
  }

  isValidState(state, expectedState) {
    const actual = Buffer.from(String(state || ""));
    const expected = Buffer.from(String(expectedState || ""));
    return actual.length > 0 && actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export const googleOAuthService = new GoogleOAuthService();
