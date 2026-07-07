import { config } from "../../core/config.js";
import { jsonError } from "../../core/http.js";
import { parseCookies } from "./auth.cookies.js";
import { sessionService } from "./SessionService.js";

export function attachSession(req, _res, next) {
  const token = parseCookies(req.headers.cookie).get(config.sessionCookieName);
  req.sessionToken = token || "";
  req.user = sessionService.findUserByToken(req.sessionToken);
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) {
    jsonError(res, 401, "Authentication required.");
    return;
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    jsonError(res, 403, "Admin access required.");
    return;
  }
  next();
}
