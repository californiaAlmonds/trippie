import { createHash, randomBytes } from "node:crypto";
import { buildResetEmail, buildVerifyEmail, mailConfigured, type SendMailInput, sendMail } from "../mailer.ts";
import { getClient } from "../store.ts";
import { validateEmail } from "./password.ts";
import { getUserByEmail } from "./users.ts";

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
 * Non-mutating check whether a single-use token is currently valid, unused, and unexpired.
 * Returns `user_id` if valid; otherwise `null`.
 */
export async function peekEmailToken(
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
    sql: `SELECT user_id
          FROM email_tokens
          WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?`,
    args: [tokenHash, purpose, nowIso],
  });

  const row = rs.rows[0];
  if (!row) return null;
  return String(row.user_id);
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

export interface TokenTransactionOptions {
  nowMs?: number;
  beforeUserUpdate?: (userId: string) => void | Promise<void>;
}

/**
 * Atomically consumes a `'reset'` token, updates `users.password_hash` (+ `verified_at` if null),
 * and deletes all sessions for that user in ONE write transaction (`client.transaction('write')`).
 * Returns `false` (after rolling back) if the token is invalid, used, or expired.
 * If the user update or session deletion fails, rolls back so the token remains unused and sessions remain intact.
 */
export async function resetPasswordWithToken(
  rawToken: unknown,
  newPasswordHash: string,
  options?: number | TokenTransactionOptions,
): Promise<boolean> {
  if (typeof rawToken !== "string" || rawToken.length < 16 || rawToken.length > 256) {
    return false;
  }
  const opts: TokenTransactionOptions =
    typeof options === "number" ? { nowMs: options } : (options ?? {});
  const nowMs = opts.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const tokenHash = hashEmailToken(rawToken);

  const client = await getClient();
  const tx = await client.transaction("write");
  try {
    const consumed = await tx.execute({
      sql: `UPDATE email_tokens
            SET used_at = ?
            WHERE token_hash = ? AND purpose = 'reset' AND used_at IS NULL AND expires_at > ?
            RETURNING user_id`,
      args: [nowIso, tokenHash, nowIso],
    });
    const row = consumed.rows[0];
    if (!row) {
      await tx.rollback();
      return false;
    }
    const userId = String(row.user_id);

    if (opts.beforeUserUpdate) {
      await opts.beforeUserUpdate(userId);
    }
    if (typeof newPasswordHash !== "string" || newPasswordHash.length === 0) {
      throw new Error("Invalid password hash");
    }

    const updated = await tx.execute({
      sql: `UPDATE users
            SET password_hash = ?, verified_at = COALESCE(verified_at, ?)
            WHERE id = ?
            RETURNING id`,
      args: [newPasswordHash, nowIso, userId],
    });
    if (updated.rows.length === 0) {
      throw new Error("User not found");
    }

    await tx.execute({
      sql: "DELETE FROM sessions WHERE user_id = ?",
      args: [userId],
    });

    await tx.commit();
    return true;
  } catch (err) {
    if (!tx.closed) {
      await tx.rollback().catch(() => undefined);
    }
    throw err;
  } finally {
    tx.close();
  }
}

/**
 * Atomically consumes a `'verify'` token and sets `users.verified_at` (if null)
 * in ONE write transaction (`client.transaction('write')`).
 * Returns `false` (after rolling back) if the token is invalid, used, or expired.
 * If the user update fails, rolls back so the token remains unused.
 */
export async function verifyEmailWithToken(
  rawToken: unknown,
  options?: number | TokenTransactionOptions,
): Promise<boolean> {
  if (typeof rawToken !== "string" || rawToken.length < 16 || rawToken.length > 256) {
    return false;
  }
  const opts: TokenTransactionOptions =
    typeof options === "number" ? { nowMs: options } : (options ?? {});
  const nowMs = opts.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const tokenHash = hashEmailToken(rawToken);

  const client = await getClient();
  const tx = await client.transaction("write");
  try {
    const consumed = await tx.execute({
      sql: `UPDATE email_tokens
            SET used_at = ?
            WHERE token_hash = ? AND purpose = 'verify' AND used_at IS NULL AND expires_at > ?
            RETURNING user_id`,
      args: [nowIso, tokenHash, nowIso],
    });
    const row = consumed.rows[0];
    if (!row) {
      await tx.rollback();
      return false;
    }
    const userId = String(row.user_id);

    if (opts.beforeUserUpdate) {
      await opts.beforeUserUpdate(userId);
    }

    const updated = await tx.execute({
      sql: `UPDATE users
            SET verified_at = COALESCE(verified_at, ?)
            WHERE id = ?
            RETURNING id`,
      args: [nowIso, userId],
    });
    if (updated.rows.length === 0) {
      throw new Error("User not found");
    }

    await tx.commit();
    return true;
  } catch (err) {
    if (!tx.closed) {
      await tx.rollback().catch(() => undefined);
    }
    throw err;
  } finally {
    tx.close();
  }
}

/**
 * Background task scheduled via `after()` in `/api/auth/forgot`:
 * validates the email, looks up the user, creates a reset token, and sends the reset email.
 * Catches and swallows all errors, logging only a fixed generic string with no PII.
 */
export async function runForgotPasswordTask(
  rawEmail: string,
  sendMailFn: (input: SendMailInput) => Promise<void> = sendMail,
): Promise<void> {
  try {
    const emailRes = validateEmail(rawEmail);
    if (!emailRes.ok) return;
    const user = await getUserByEmail(emailRes.email);
    if (user && (mailConfigured() || process.env.NODE_ENV !== "production")) {
      const token = await createEmailToken(user.id, "reset");
      const resetUrl = buildResetLink(token);
      await sendMailFn(buildResetEmail(user.email, resetUrl));
    }
  } catch {
    console.error("forgot-password failed");
  }
}

/**
 * Background task scheduled via `after()` in `/api/auth/signup` and `/api/auth/resend`:
 * creates a verification token and sends the verification email.
 * Catches and swallows all errors, logging only a fixed generic string with no PII.
 */
export async function runVerificationEmailTask(
  userId: string,
  email: string,
  sendMailFn: (input: SendMailInput) => Promise<void> = sendMail,
): Promise<void> {
  try {
    const token = await createEmailToken(userId, "verify");
    const verifyUrl = buildVerifyLink(token);
    await sendMailFn(buildVerifyEmail(email, verifyUrl));
  } catch {
    console.error("verification email failed");
  }
}
