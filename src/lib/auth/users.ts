import { randomUUID } from "node:crypto";
import { getClient } from "../store.ts";
import { computeSessionExpiry, generateSessionToken, hashSessionToken } from "./session-core.ts";
import { peekEmailToken, resetPasswordWithToken, verifyEmailWithToken } from "./tokens.ts";

export { peekEmailToken, resetPasswordWithToken, verifyEmailWithToken };

export interface PublicUser {
  id: string;
  email: string;
  verified: boolean;
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
  verified_at: string | null;
}

function isUniqueConstraintError(err: unknown): boolean {
  const msg = String(err);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(msg);
}

/** Inserts a new user with a random UUID primary key. Returns `{ ok: false, duplicate: true }` if email exists. */
export async function createUser(
  email: string,
  passwordHash: string,
  options?: { verified?: boolean },
): Promise<{ ok: true; user: PublicUser } | { ok: false; duplicate: true }> {
  const id = randomUUID();
  const normalized = email.trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const verifiedAt = options?.verified ? nowIso : null;

  const client = await getClient();
  try {
    await client.execute({
      sql: `INSERT INTO users (id, email, password_hash, created_at, verified_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [id, normalized, passwordHash, nowIso, verifiedAt],
    });
    return {
      ok: true,
      user: {
        id,
        email: normalized,
        verified: Boolean(verifiedAt),
      },
    };
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return { ok: false, duplicate: true };
    }
    throw err;
  }
}

/** Looks up a user row by normalized email address. */
export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const normalized = email.trim().toLowerCase();
  const client = await getClient();
  const rs = await client.execute({
    sql: "SELECT id, email, password_hash, created_at, verified_at FROM users WHERE email = ?",
    args: [normalized],
  });
  const row = rs.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    password_hash: String(row.password_hash),
    created_at: String(row.created_at),
    verified_at: row.verified_at == null ? null : String(row.verified_at),
  };
}

/** Looks up a user row by UUID. */
export async function getUserById(userId: string): Promise<UserRow | null> {
  const client = await getClient();
  const rs = await client.execute({
    sql: "SELECT id, email, password_hash, created_at, verified_at FROM users WHERE id = ?",
    args: [userId],
  });
  const row = rs.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    password_hash: String(row.password_hash),
    created_at: String(row.created_at),
    verified_at: row.verified_at == null ? null : String(row.verified_at),
  };
}

/**
 * Conditionally inserts a session row with a single statement only when `users.password_hash`
 * for `userId` still equals `expectedPasswordHash` (prevents a concurrent password reset from
 * allowing an in-flight login with the old password to create a session).
 * Returns `{ token, expiresAt }` when inserted (`rowsAffected > 0`), or `null` when `rowsAffected === 0`.
 */
export async function insertSessionIfPasswordMatches(
  userId: string,
  expectedPasswordHash: string,
  options?: { existingToken?: string; nowMs?: number },
): Promise<{ token: string; expiresAt: Date } | null> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const nowMs = options?.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const expiresAt = computeSessionExpiry(nowMs);
  const expiresAtIso = expiresAt.toISOString();

  const client = await getClient();
  const rs = await client.execute({
    sql: `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
          SELECT ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM users WHERE id = ? AND password_hash = ?
          )`,
    args: [tokenHash, userId, nowIso, expiresAtIso, userId, expectedPasswordHash],
  });

  if (rs.rowsAffected === 0) {
    return null;
  }

  await client.execute({
    sql: "DELETE FROM sessions WHERE expires_at <= ?",
    args: [nowIso],
  });
  if (options?.existingToken && options.existingToken.length <= 256) {
    const existingHash = hashSessionToken(options.existingToken);
    if (existingHash !== tokenHash) {
      await client.execute({
        sql: "DELETE FROM sessions WHERE token_hash = ?",
        args: [existingHash],
      });
    }
  }

  return { token, expiresAt };
}

/** Sets `users.verified_at` if not already set. */
export async function markUserVerified(userId: string): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const client = await getClient();
  const rs = await client.execute({
    sql: `UPDATE users
          SET verified_at = COALESCE(verified_at, ?)
          WHERE id = ?
          RETURNING id`,
    args: [nowIso, userId],
  });
  return rs.rows.length > 0;
}

/**
 * Updates `password_hash`, marks `verified_at` if null (reset proves mailbox control),
 * and destroys all sessions for the user in one transaction.
 */
export async function resetUserPassword(userId: string, newPasswordHash: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const client = await getClient();
  await client.batch(
    [
      {
        sql: "UPDATE users SET password_hash = ?, verified_at = COALESCE(verified_at, ?) WHERE id = ?",
        args: [newPasswordHash, nowIso, userId],
      },
      {
        sql: "DELETE FROM sessions WHERE user_id = ?",
        args: [userId],
      },
    ],
    "write",
  );
}

/**
 * Deletes the user's child rows and user record in ONE write transaction in explicit dependency order:
 * email_tokens -> sessions -> users.
 */
export async function deleteUserAccount(userId: string): Promise<void> {
  const client = await getClient();
  await client.batch(
    [
      // TODO(plans/recents): Delete user's saved plans, price alerts, and recent searches here before deleting users row.
      {
        sql: "DELETE FROM email_tokens WHERE user_id = ?",
        args: [userId],
      },
      {
        sql: "DELETE FROM sessions WHERE user_id = ?",
        args: [userId],
      },
      {
        sql: "DELETE FROM users WHERE id = ?",
        args: [userId],
      },
    ],
    "write",
  );
}
