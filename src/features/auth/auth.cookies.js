import { config } from "../../core/config.js";
import { isSecureRequest } from "../../core/http.js";

export function parseCookies(header) {
  const cookies = new Map();
  for (const part of String(header || "").split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (key) cookies.set(key, decodeURIComponent(value));
  }
  return cookies;
}

export function makeSessionCookie(req, sessionToken) {
  const maxAgeSeconds = Math.floor(config.sessionTtlMs / 1000);
  return [
    `${config.sessionCookieName}=${encodeURIComponent(sessionToken)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    isSecureRequest(req) ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

export function clearSessionCookie(req) {
  return [
    `${config.sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    isSecureRequest(req) ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

export function makeGoogleStateCookie(req, state) {
  return [
    `${config.googleStateCookieName}=${encodeURIComponent(state)}`,
    "Path=/api/auth/google",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=600",
    isSecureRequest(req) ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

export function clearGoogleStateCookie(req) {
  return [
    `${config.googleStateCookieName}=`,
    "Path=/api/auth/google",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    isSecureRequest(req) ? "Secure" : ""
  ].filter(Boolean).join("; ");
}
