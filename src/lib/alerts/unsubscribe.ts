import { createHmac, timingSafeEqual } from "node:crypto";
import { emailBaseOrigin } from "../auth/tokens.ts";
import { getClient } from "../store.ts";

export const MIN_APP_SECRET_LENGTH = 32;

export class AppSecretError extends Error {
  constructor(message = "APP_SECRET must be at least 32 characters") {
    super(message);
    this.name = "AppSecretError";
  }
}

/** True iff `APP_SECRET` is a string with at least 32 characters. */
export function appSecretConfigured(secret: string | undefined = process.env.APP_SECRET): boolean {
  return typeof secret === "string" && secret.length >= MIN_APP_SECRET_LENGTH;
}

/**
 * Signs an unsubscribe token `${planId}.${base64url(HMAC-SHA256(planId, APP_SECRET))}`.
 * Throws `AppSecretError` if `APP_SECRET` is missing or shorter than 32 characters.
 */
export function signUnsubscribeToken(planId: string, secret: string | undefined = process.env.APP_SECRET): string {
  if (!appSecretConfigured(secret)) {
    throw new AppSecretError();
  }
  if (typeof planId !== "string" || planId.length === 0 || planId.includes(".")) {
    throw new Error("Invalid planId");
  }
  const sig = createHmac("sha256", secret!).update(planId, "utf8").digest("base64url");
  return `${planId}.${sig}`;
}

/**
 * Verifies an unsubscribe token using constant-time comparison (`timingSafeEqual`).
 * Throws `AppSecretError` if `APP_SECRET` is missing or shorter than 32 characters.
 * Returns `planId` if valid, or `null` if malformed or tampered.
 */
export function verifyUnsubscribeToken(
  token: unknown,
  secret: string | undefined = process.env.APP_SECRET,
): string | null {
  if (!appSecretConfigured(secret)) {
    throw new AppSecretError();
  }
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  if (trimmed.length === 0 || trimmed.length > 256) return null;

  const parts = trimmed.split(".");
  if (parts.length !== 2) return null;
  const [planId, providedSig] = parts;
  if (!planId || !providedSig || !/^[A-Za-z0-9_-]+$/.test(providedSig)) {
    return null;
  }

  const expectedSig = createHmac("sha256", secret!).update(planId, "utf8").digest("base64url");
  const providedBuf = Buffer.from(providedSig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (providedBuf.byteLength !== expectedBuf.byteLength) {
    return null;
  }
  if (!timingSafeEqual(providedBuf, expectedBuf)) {
    return null;
  }
  return planId;
}

/** Builds `${APP_ORIGIN}/unsubscribe?token=<token>`. */
export function buildUnsubscribeLink(
  planId: string,
  appOrigin: string | undefined = process.env.APP_ORIGIN,
  secret: string | undefined = process.env.APP_SECRET,
): string {
  const token = signUnsubscribeToken(planId, secret);
  return `${emailBaseOrigin(appOrigin)}/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * Verifies `token` and disables alerts (`alert_enabled = 0`) for the referenced plan.
 * Throws `AppSecretError` if `APP_SECRET` is not configured (caller returns 503).
 * Returns `true` if the token is valid and the plan exists, or `false` otherwise.
 */
export async function unsubscribePlanWithToken(
  token: unknown,
  secret: string | undefined = process.env.APP_SECRET,
): Promise<boolean> {
  const planId = verifyUnsubscribeToken(token, secret);
  if (!planId) return false;

  const client = await getClient();
  const rs = await client.execute({
    sql: "UPDATE plans SET alert_enabled = 0 WHERE id = ? RETURNING id",
    args: [planId],
  });
  return rs.rows.length > 0;
}
