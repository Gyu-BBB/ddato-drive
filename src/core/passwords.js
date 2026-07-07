import crypto from "node:crypto";

const KEY_LENGTH = 64;
const DEFAULT_PARAMS = Object.freeze({
  N: 16384,
  r: 8,
  p: 1
});

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, KEY_LENGTH, DEFAULT_PARAMS);
  return [
    "scrypt",
    DEFAULT_PARAMS.N,
    DEFAULT_PARAMS.r,
    DEFAULT_PARAMS.p,
    salt.toString("base64url"),
    derived.toString("base64url")
  ].join("$");
}

export function verifyPassword(password, encoded) {
  const parts = String(encoded || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  const params = {
    N: Number(rawN),
    r: Number(rawR),
    p: Number(rawP)
  };

  if (!Number.isFinite(params.N) || !Number.isFinite(params.r) || !Number.isFinite(params.p)) {
    return false;
  }

  try {
    const salt = Buffer.from(rawSalt, "base64url");
    const expected = Buffer.from(rawHash, "base64url");
    const actual = crypto.scryptSync(String(password), salt, expected.length, params);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
