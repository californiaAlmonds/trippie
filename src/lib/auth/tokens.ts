import { createHash, randomBytes } from "node:crypto";
import { getClient } from "../store.ts";

export type TokenPurpose = "verify" | "reset";

export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Generates a 32-byte random email token encoded as base64url. */
export function generateEmailToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Computes the SHA-256 hex digest of a raw email token. */
export function hashEmailToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** Resolves the base origin for email links: APP_ORIGIN if set, otherwise `http://localhost:3111`. */
export function emailBaseOrigin(appOrigin = process.env.APP_ORIGIN): string {
  const trimmed = appOrigin?.trim();
  if (trimmed) {
    return trimmed.replace(/\/+$/, "");
  }
  return "http://localhost:3111";
}

/** Builds an email verification link `${origin}/verify?token=...`. */
export function buildVerifyLink(token: string, appOrigin = process.env.APP_ORIGIN): string {
  return `${emailBaseOrigin(appOrigin)}/verify?token=${encodeURIComponent(token)}`;
}

/** Builds a password reset link `${origin}/reset?token=...`. */
export function buildResetLink(token: string, appOrigin = process.env.APP_ORIGIN): string {
  return `${emailBaseOrigin(appOrigin)}/reset?token=${encodeURIComponent(token)}`;
}

/**
 * Creates a new 32-byte random token for `userId` and `purpose` ('verify' = 24h, 'reset' = 1h).
 * Invalidates any existing unused tokens of the same purpose for that user in the same batch.
 */
export async function createEmailToken(
  userId: string,
  purpose: TokenPurpose,
  nowMs = Date.now(),
): Promise<string> {
  const rawToken = generateEmailToken();
  const tokenHash = hashEmailToken(rawToken);
  const ttlMs = purpose === "verify" ? VERIFY_TTL_MS : RESET_TTL_MS;
  const nowIso = new Date(nowMs).toISOString();
  const expiresAtIso = new Date(nowMs + ttlMs).toISOString();

  const client = await getClient();
  await client.batch(
    [
      {
        sql: "UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL",
        args: [nowIso, userId, purpose],
      },
      {
        sql: `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, used_at, created_at)
              VALUES (?, ?, ?, ?, NULL, ?)`,
        args: [tokenHash, userId, purpose, expiresAtIso, nowIso],
      },
    ],
    "write",
  );

  return rawToken;
}

/**
 * Atomically consumes a single-use token:
 * `UPDATE email_tokens SET used_at=? WHERE token_hash=? AND purpose=? AND used_at IS NULL AND expires_at > ? RETURNING user_id`
 * Returns `user_id` if valid, unused, and unexpired; otherwise `null`.
 */
export async function consumeEmailToken(
  rawToken: unknown,
  purpose: TokenPurpose,
  nowMs = Date.now(),
): Promise<string | null> {
  if (typeof rawToken !== "string" || rawToken.length < 16 || rawToken.length > 256) {
    return null;
  }
  const tokenHash = hashEmailToken(rawToken);
  const nowIso = new Date(nowMs).toISOString();

  const client = await getClient();
  const rs = await client.execute({
    sql: `UPDATE email_tokens
          SET used_at = ?
          WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?
          RETURNING user_id`,
    args: [nowIso, tokenHash, purpose, nowIso],
  });

  const row = rs.rows[0];
  if (!row) return null;
  return String(row.user_id);
}
