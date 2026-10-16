import { consumeToken, createEmailToken, type TokenPurpose } from "./auth/tokens.ts";
import { getClient } from "./store.ts";

export { consumeToken, createEmailToken, type TokenPurpose };

/**
 * Child tables keyed by `user_id` that are explicitly removed in a single write transaction
 * before deleting the row in `users`. Extended by subsequent features (plans, recent_searches, alerts).
 */
export const ACCOUNT_CHILD_TABLES: readonly string[] = ["sessions", "email_tokens"];

export interface PublicUser {
  id: number;
  email: string;
}

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  created_at: string;
  verified_at: string | null;
}

const EMAIL_REGEX =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export type EmailValidationResult = { ok: true; email: string } | { ok: false; error: string };

/** Lowercases, trims, and validates an email address (simple strict regex, <=254 chars). */
export function validateEmail(raw: unknown): EmailValidationResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Valid email is required" };
  }
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || email.includes("\0") || email.includes("..")) {
    return { ok: false, error: "Valid email is required" };
  }
  const atIndex = email.indexOf("@");
  if (atIndex < 1 || atIndex > 64) {
    return { ok: false, error: "Valid email is required" };
  }
  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, error: "Valid email is required" };
  }
  return { ok: true, email };
}

function isUniqueConstraintError(err: unknown): boolean {
  const msg = String(err);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(msg);
}

/** Inserts a new user. Returns `{ duplicate: true }` if the email already exists. */
export async function createUser(
  email: string,
  passwordHash: string,
  options?: { verified?: boolean },
): Promise<{ ok: true; user: PublicUser } | { ok: false; duplicate: true }> {
  const normalized = email.trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const verifiedAt = options?.verified ? nowIso : null;

  const client = await getClient();
  try {
    const rs = await client.execute({
      sql: `INSERT INTO users (email, password_hash, created_at, verified_at)
            VALUES (?, ?, ?, ?)
            RETURNING id, email`,
      args: [normalized, passwordHash, nowIso, verifiedAt],
    });
    const row = rs.rows[0];
    return {
      ok: true,
      user: {
        id: Number(row.id),
        email: String(row.email),
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
    id: Number(row.id),
    email: String(row.email),
    password_hash: String(row.password_hash),
    created_at: String(row.created_at),
    verified_at: row.verified_at == null ? null : String(row.verified_at),
  };
}

/** Looks up a user row by ID. */
export async function getUserById(userId: number): Promise<UserRow | null> {
  const client = await getClient();
  const rs = await client.execute({
    sql: "SELECT id, email, password_hash, created_at, verified_at FROM users WHERE id = ?",
    args: [userId],
  });
  const row = rs.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    email: String(row.email),
    password_hash: String(row.password_hash),
    created_at: String(row.created_at),
    verified_at: row.verified_at == null ? null : String(row.verified_at),
  };
}

/** Marks a user's `verified_at` timestamp (preserving existing if already set) and returns `{id, email}`. */
export async function markUserVerified(userId: number): Promise<PublicUser | null> {
  const nowIso = new Date().toISOString();
  const client = await getClient();
  const rs = await client.execute({
    sql: `UPDATE users
          SET verified_at = COALESCE(verified_at, ?)
          WHERE id = ?
          RETURNING id, email`,
    args: [nowIso, userId],
  });
  const row = rs.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    email: String(row.email),
  };
}

/** Updates a user's password hash, sets `verified_at` if null, and deletes all sessions for that user in one transaction. */
export async function resetUserPassword(userId: number, newPasswordHash: string): Promise<void> {
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

const SAFE_TABLE_NAME = /^[a-z_][a-z0-9_]*$/;

/** Deletes all child records across `ACCOUNT_CHILD_TABLES` and the user row inside a single write transaction. */
export async function deleteUserAccount(userId: number): Promise<void> {
  const statements = ACCOUNT_CHILD_TABLES.map((table) => {
    if (!SAFE_TABLE_NAME.test(table)) {
      throw new Error(`Invalid table name in ACCOUNT_CHILD_TABLES: ${table}`);
    }
    return {
      sql: `DELETE FROM ${table} WHERE user_id = ?`,
      args: [userId],
    };
  });
  statements.push({
    sql: "DELETE FROM users WHERE id = ?",
    args: [userId],
  });

  const client = await getClient();
  await client.batch(statements, "write");
}
