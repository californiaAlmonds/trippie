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
  id: number;
  email: string;
  verified: boolean;
}

/** Issues a new 30-day session for `userId`, stores sha256(token) in DB, and sets the session cookie. */
export async function createSession(userId: number): Promise<string> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = computeSessionExpiry(now.getTime());
  const expiresAtIso = expiresAt.toISOString();

  const client = await getClient();
  await client.batch(
    [
      {
        sql: "DELETE FROM sessions WHERE expires_at <= ?",
        args: [nowIso],
      },
      {
        sql: "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        args: [tokenHash, userId, nowIso, expiresAtIso],
      },
    ],
    "write",
  );

  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName(), token, buildSessionCookieOptions(expiresAt));
  return token;
}

/** Looks up the current session user. Enforces 30-day expiry and verified account; opportunistically deletes expired rows. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(sessionCookieName())?.value;
  if (!rawToken || rawToken.length > 256) return null;

  const tokenHash = hashSessionToken(rawToken);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const client = await getClient();
  // Opportunistically clean up expired sessions
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
  if (!row.verified_at) return null;

  return {
    id: Number(row.id),
    email: String(row.email),
    verified: true,
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
export async function destroyAllSessions(userId: number): Promise<void> {
  const client = await getClient();
  await client.execute({
    sql: "DELETE FROM sessions WHERE user_id = ?",
    args: [userId],
  });
}
