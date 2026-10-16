import { createHash, randomBytes } from "node:crypto";
import { getClient } from "../store.ts";

export type TokenPurpose = "verify" | "reset";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Computes the SHA-256 hex digest of a raw email token. */
export function hashEmailToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/**
 * Creates a new 32-byte random token for `userId` and `purpose` ('verify' = 24h, 'reset' = 1h).
 * Invalidates any existing unused tokens of the same purpose for that user in the same transaction.
 */
export async function createEmailToken(
  userId: number,
  purpose: TokenPurpose,
  nowMs = Date.now(),
): Promise<string> {
  const rawToken = randomBytes(32).toString("base64url");
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
        sql: "INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)",
        args: [tokenHash, userId, purpose, expiresAtIso],
      },
    ],
    "write",
  );

  return rawToken;
}

/**
 * Atomically marks a token as used with a single UPDATE ... RETURNING user_id statement.
 * Returns the `user_id` if valid, unused, and unexpired; otherwise returns null.
 */
export async function consumeToken(
  rawToken: unknown,
  purpose: TokenPurpose,
  nowMs = Date.now(),
): Promise<number | null> {
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
  return Number(row.user_id);
}
