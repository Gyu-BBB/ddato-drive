import { jsonError, isSecureRequest } from "./http.js";
import { config } from "./config.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireSameOriginForUnsafeMethods(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "cross-site") {
    jsonError(res, 403, "Cross-site requests are not allowed.");
    return;
  }

  const expectedOrigin = getRequestOrigin(req);
  const origin = getSingleHeader(req.headers.origin);
  if (origin) {
    if (sameOrigin(origin, expectedOrigin)) {
      next();
      return;
    }
    jsonError(res, 403, "Request origin is not allowed.");
    return;
  }

  const referer = getSingleHeader(req.headers.referer);
  if (referer && !sameOrigin(referer, expectedOrigin)) {
    jsonError(res, 403, "Request referer is not allowed.");
    return;
  }

  next();
}

function getRequestOrigin(req) {
  const host = String((config.trustProxy && req.headers["x-forwarded-host"]) || req.headers.host || "").trim();
  const protocol = isSecureRequest(req) ? "https" : "http";
  return host ? `${protocol}://${host}` : "";
}

function sameOrigin(candidate, expectedOrigin) {
  if (!expectedOrigin) return false;

  try {
    return new URL(candidate).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function getSingleHeader(value) {
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}
