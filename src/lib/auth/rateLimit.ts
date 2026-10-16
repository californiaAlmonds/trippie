import { createHash } from "node:crypto";
import { getClient } from "../store.ts";

export const LOGIN_EMAIL_LIMIT = 5;
export const LOGIN_IP_LIMIT = 20;
export const LOGIN_WINDOW_SECONDS = 15 * 60; // 15 minutes

export const SIGNUP_IP_LIMIT = 5;
export const SIGNUP_WINDOW_SECONDS = 60 * 60; // 1 hour

export const FORGOT_EMAIL_LIMIT = 3;
export const FORGOT_IP_LIMIT = 10;
export const FORGOT_WINDOW_SECONDS = 60 * 60; // 1 hour

export const RESEND_USER_LIMIT = 3;
export const RESEND_WINDOW_SECONDS = 60 * 60; // 1 hour

const ONE_DAY_SECONDS = 86400;

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  windowStart: number;
}

/** Hashes a normalized email with SHA-256 so raw email addresses are never stored in `rate_limits`. */
export function emailRateLimitKey(scope: string, normalizedEmail: string): string {
  const digest = createHash("sha256").update(normalizedEmail.trim().toLowerCase(), "utf8").digest("hex");
  return `${scope}:email:${digest}`;
}

/** Builds an IP rate-limit key for the given scope. */
export function ipRateLimitKey(scope: string, ip: string): string {
  return `${scope}:ip:${ip}`;
}

/** Builds a user ID rate-limit key for the given scope. */
export function userRateLimitKey(scope: string, userId: string): string {
  return `${scope}:user:${userId}`;
}

/**
 * Enforces a fixed-window rate limit using an atomic UPSERT on `rate_limits`:
 * `INSERT ... ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1 RETURNING count`
 * Opportunistically prunes rows older than 1 day.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  nowMs = Date.now(),
): Promise<RateLimitResult> {
  const nowSeconds = Math.floor(nowMs / 1000);
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  const staleBefore = nowSeconds - ONE_DAY_SECONDS;

  const client = await getClient();
  await client.execute({
    sql: "DELETE FROM rate_limits WHERE window_start < ?",
    args: [staleBefore],
  });

  const rs = await client.execute({
    sql: `INSERT INTO rate_limits (key, window_start, count)
          VALUES (?, ?, 1)
          ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
          RETURNING count`,
    args: [key, windowStart],
  });

  const count = Number(rs.rows[0]?.count ?? 1);
  return {
    allowed: count <= limit,
    count,
    windowStart,
  };
}

/** Clears a rate limit key after a successful authentication so only failed attempts accumulate. */
export async function clearRateLimit(key: string): Promise<void> {
  const client = await getClient();
  await client.execute({
    sql: "DELETE FROM rate_limits WHERE key = ?",
    args: [key],
  });
}
