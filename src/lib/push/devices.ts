import { hashSessionToken } from "../auth/session-core.ts";
import { getClient } from "../store.ts";

export const DEVICE_TOKEN_RE = /^[A-Za-z0-9:_\-.]{20,4096}$/;
export const MAX_DEVICES_PER_USER = 10;
export const DEVICE_RATE_LIMIT = 30;
export const DEVICE_RATE_WINDOW_SECONDS = 60 * 60; // 1 hour

export type DevicePlatform = "android";

export interface DeviceRow {
  token: string;
  userId: string;
  platform: DevicePlatform;
  createdAt: string;
  lastSeenAt: string;
}

let lastMonotonicMs = 0;

function monotonicIso(now?: Date): string {
  const baseMs = now ? now.getTime() : Date.now();
  const nextMs = baseMs > lastMonotonicMs ? baseMs : lastMonotonicMs + 1;
  lastMonotonicMs = nextMs;
  return new Date(nextMs).toISOString();
}

export function isValidDeviceToken(token: unknown): token is string {
  return typeof token === "string" && DEVICE_TOKEN_RE.test(token);
}

export function isValidDevicePlatform(platform: unknown): platform is DevicePlatform {
  return platform === "android";
}

/**
 * Upserts a device token for `userId` (reassigning ownership if the token was previously
 * registered to another account) and prunes `userId`'s devices beyond the newest 10 in one write transaction.
 */
export async function registerDevice(
  userId: string,
  token: string,
  platform: DevicePlatform = "android",
  now?: Date,
): Promise<void> {
  if (!isValidDeviceToken(token)) {
    throw new Error("Invalid device token");
  }
  if (!isValidDevicePlatform(platform)) {
    throw new Error("Invalid device platform");
  }

  const timestamp = monotonicIso(now);
  const client = await getClient();

  await client.batch(
    [
      {
        sql: `INSERT INTO devices (token, user_id, platform, created_at, last_seen_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(token) DO UPDATE SET
                user_id = excluded.user_id,
                last_seen_at = excluded.last_seen_at`,
        args: [token, userId, platform, timestamp, timestamp],
      },
      {
        sql: `DELETE FROM devices
              WHERE user_id = ?
                AND token NOT IN (
                  SELECT token FROM devices
                  WHERE user_id = ?
                  ORDER BY last_seen_at DESC, created_at DESC, rowid DESC
                  LIMIT ?
                )`,
        args: [userId, userId, MAX_DEVICES_PER_USER],
      },
    ],
    "write",
  );
}

/**
 * Deletes a device token only if it belongs to `userId`.
 * Returns void regardless of whether a row was deleted (no oracle).
 */
export async function unregisterDevice(userId: string, token: string): Promise<void> {
  const client = await getClient();
  await client.execute({
    sql: "DELETE FROM devices WHERE token = ? AND user_id = ?",
    args: [token, userId],
  });
}

/**
 * Removes `deviceToken` during logout only if `userId` (or an active `sessionToken`) is present
 * and `deviceToken` is valid and belongs to that user. When `sessionToken` is provided, also
 * deletes the session row in the same write operation. Invalid or omitted `deviceToken` is ignored.
 */
export async function unregisterDeviceOnLogout(
  userId: string | null | undefined,
  deviceToken?: unknown,
  sessionToken?: string | null,
): Promise<void> {
  const validDeviceToken = isValidDeviceToken(deviceToken) ? deviceToken : null;
  const validSessionToken =
    typeof sessionToken === "string" && sessionToken.length > 0 && sessionToken.length <= 256
      ? sessionToken
      : null;

  if (validSessionToken) {
    const tokenHash = hashSessionToken(validSessionToken);
    const nowIso = new Date().toISOString();
    const client = await getClient();
    if (validDeviceToken) {
      await client.batch(
        [
          userId
            ? {
                sql: "DELETE FROM devices WHERE token = ? AND user_id = ?",
                args: [validDeviceToken, userId],
              }
            : {
                sql: `DELETE FROM devices
                      WHERE token = ?
                        AND user_id = (
                          SELECT user_id FROM sessions
                          WHERE token_hash = ? AND expires_at > ?
                        )`,
                args: [validDeviceToken, tokenHash, nowIso],
              },
          {
            sql: "DELETE FROM sessions WHERE token_hash = ?",
            args: [tokenHash],
          },
        ],
        "write",
      );
    } else {
      await client.execute({
        sql: "DELETE FROM sessions WHERE token_hash = ?",
        args: [tokenHash],
      });
    }
    return;
  }

  if (userId && validDeviceToken) {
    await unregisterDevice(userId, validDeviceToken);
  }
}

/**
 * Deletes a device token unconditionally (used when FCM reports the token is unregistered/invalid).
 */
export async function deleteDeviceToken(token: string): Promise<void> {
  const client = await getClient();
  await client.execute({
    sql: "DELETE FROM devices WHERE token = ?",
    args: [token],
  });
}

/**
 * Lists all device tokens belonging to `userId`, ordered newest `last_seen_at` first.
 */
export async function listUserDeviceTokens(userId: string): Promise<string[]> {
  const client = await getClient();
  const rs = await client.execute({
    sql: `SELECT token FROM devices
          WHERE user_id = ?
          ORDER BY last_seen_at DESC, created_at DESC, rowid DESC`,
    args: [userId],
  });
  return rs.rows.map((r) => String(r.token));
}
