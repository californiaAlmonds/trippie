import { createHash, randomBytes } from "node:crypto";

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  expires: Date;
  maxAge: number;
}

/** Generates a 32-byte random session token encoded as base64url. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Computes the SHA-256 hex digest of a raw session token. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Computes the 30-day expiration Date from the given timestamp (ms). */
export function computeSessionExpiry(nowMs = Date.now()): Date {
  return new Date(nowMs + SESSION_TTL_MS);
}

/** Returns true if the ISO expiry timestamp is invalid or at/before `nowMs`. */
export function isSessionExpired(expiresAtIso: string, nowMs = Date.now()): boolean {
  const ts = Date.parse(expiresAtIso);
  if (!Number.isFinite(ts)) return true;
  return ts <= nowMs;
}

/**
 * Determines whether session cookies must have the `Secure` attribute:
 * true iff `APP_ORIGIN` starts with `https` (case-insensitive).
 */
export function isSessionCookieSecure(appOrigin = process.env.APP_ORIGIN): boolean {
  const trimmed = appOrigin?.trim().toLowerCase() ?? "";
  return trimmed.startsWith("https://") || trimmed === "https:";
}

/** Returns `__Host-trippie_session` when `APP_ORIGIN` starts with https, else `trippie_session`. */
export function sessionCookieName(appOrigin = process.env.APP_ORIGIN): string {
  return isSessionCookieSecure(appOrigin) ? "__Host-trippie_session" : "trippie_session";
}

/** Builds cookie options for setting a session cookie. */
export function buildSessionCookieOptions(
  expiresAt: Date,
  appOrigin = process.env.APP_ORIGIN,
): SessionCookieOptions {
  const secure = isSessionCookieSecure(appOrigin);
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    expires: expiresAt,
    maxAge: SESSION_TTL_SECONDS,
  };
}

/** Builds cookie options for clearing a session cookie. */
export function buildClearSessionCookieOptions(appOrigin = process.env.APP_ORIGIN): SessionCookieOptions {
  const secure = isSessionCookieSecure(appOrigin);
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    expires: new Date(0),
    maxAge: 0,
  };
}
