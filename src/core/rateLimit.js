import crypto from "node:crypto";
import { fail } from "./errors.js";
import { getRequestIp } from "./http.js";

const buckets = new Map();

export function enforceRateLimit(req, options) {
  const key = `${options.name}:${options.key(req)}`;
  const now = Date.now();
  const windowMs = Math.max(1000, Number(options.windowMs || 60_000));
  const limit = Math.max(1, Number(options.limit || 1));
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    pruneBuckets(now);
    return;
  }

  bucket.count += 1;
  if (bucket.count <= limit) return;

  const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
  fail(429, options.message || "Too many requests. Try again later.", {
    retryAfterSeconds
  });
}

export function ipKey(req) {
  return getRequestIp(req);
}

export function ipAndValueKey(req, value) {
  return `${ipKey(req)}:${hashKey(value)}`;
}

function hashKey(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("base64url").slice(0, 24);
}

function pruneBuckets(now) {
  if (buckets.size < 2000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}
