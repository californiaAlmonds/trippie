import { cookies } from "next/headers";
import { getClient } from "../store.ts";
import {
  buildClearSessionCookieOptions,
  buildSessionCookieOptions,
  computeSessionExpiry,
  generateSessionToken,
  hashSessionToken,
  isSessionExpired,
  sessionCookieName,
} from "./session-core.ts";

export interface SessionUser {
  id: string;
  email: string;
  verified: boolean;
}

/**
 * Issues a fresh 30-day session for `userId` (rotating any existing session cookie),
 * stores sha256(token) in DB, and sets the session cookie.
 */
export async function createSession(userId: string): Promise<string> {
  const cookieStore = await cookies();
  const cookieName = sessionCookieName();
  const existingToken = cookieStore.get(cookieName)?.value;

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = computeSessionExpiry(now.getTime());
  const expiresAtIso = expiresAt.toISOString();

  const statements: Array<{ sql: string; args: Array<string> }> = [
    {
      sql: "DELETE FROM sessions WHERE expires_at <= ?",
      args: [nowIso],
    },
  ];
  if (existingToken && existingToken.length <= 256) {
    statements.push({
      sql: "DELETE FROM sessions WHERE token_hash = ?",
      args: [hashSessionToken(existingToken)],
    });
  }
  statements.push({
    sql: "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    args: [tokenHash, userId, nowIso, expiresAtIso],
  });

  const client = await getClient();
  await client.batch(statements, "write");

  cookieStore.set(cookieName, token, buildSessionCookieOptions(expiresAt));
  return token;
}

/**
 * Looks up the current session user (`{ id, email, verified }` or `null`).
 * Enforces 30-day expiry on every lookup and deletes expired sessions.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(sessionCookieName())?.value;
  if (!rawToken || rawToken.length > 256) return null;

  const tokenHash = hashSessionToken(rawToken);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const client = await getClient();
  await client.execute({
    sql: "DELETE FROM sessions WHERE expires_at <= ?",
    args: [nowIso],
  });

  const rs = await client.execute({
    sql: `SELECT u.id, u.email, u.verified_at, s.expires_at
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.expires_at > ?`,
    args: [tokenHash, nowIso],
  });

  const row = rs.rows[0];
  if (!row) return null;
  if (isSessionExpired(String(row.expires_at), nowMs)) {
    await client.execute({
      sql: "DELETE FROM sessions WHERE token_hash = ?",
      args: [tokenHash],
    });
    return null;
  }

  return {
    id: String(row.id),
    email: String(row.email),
    verified: Boolean(row.verified_at),
  };
}

/** Destroys the current session in the DB and clears the session cookie. */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const name = sessionCookieName();
  const rawToken = cookieStore.get(name)?.value;

  if (rawToken && rawToken.length <= 256) {
    const tokenHash = hashSessionToken(rawToken);
    const client = await getClient();
    await client.execute({
      sql: "DELETE FROM sessions WHERE token_hash = ?",
      args: [tokenHash],
    });
  }

  cookieStore.set(name, "", buildClearSessionCookieOptions());
}

/** Deletes all sessions belonging to `userId`. */
export async function destroyAllSessions(userId: string): Promise<void> {
  const client = await getClient();
  await client.execute({
    sql: "DELETE FROM sessions WHERE user_id = ?",
    args: [userId],
  });
}
