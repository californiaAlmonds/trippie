import { createSign } from "node:crypto";

export const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
export const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
export const REQUEST_TIMEOUT_MS = 10_000; // 10 seconds

export interface ServiceAccountConfig {
  type: "service_account";
  project_id: string;
  client_email: string;
  private_key: string;
}

export interface PushMessageInput {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

export type SendPushResult = "ok" | "invalid_token" | "error";

export interface SendPushOptions {
  fetch?: typeof globalThis.fetch;
  clock?: () => number;
  now?: () => number;
  serviceAccountJson?: string;
}

interface CachedAccessToken {
  cacheKey: string;
  accessToken: string;
  expiresAtMs: number;
}

let cachedToken: CachedAccessToken | null = null;

/** Clears the cached OAuth access token (useful for deterministic unit tests). */
export function clearAccessTokenCache(): void {
  cachedToken = null;
}

/** Parses and validates the service account JSON string. Returns `null` if invalid. */
export function parseServiceAccount(rawJson: string | undefined): ServiceAccountConfig | null {
  if (!rawJson || !rawJson.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    if (
      obj.type !== "service_account" ||
      typeof obj.project_id !== "string" ||
      !obj.project_id.trim() ||
      typeof obj.client_email !== "string" ||
      !obj.client_email.trim() ||
      typeof obj.private_key !== "string" ||
      !obj.private_key.trim()
    ) {
      return null;
    }
    return {
      type: "service_account",
      project_id: obj.project_id.trim(),
      client_email: obj.client_email.trim(),
      private_key: obj.private_key.replace(/\\n/g, "\n"),
    };
  } catch {
    return null;
  }
}

/** True iff `FCM_SERVICE_ACCOUNT` parses as a valid service_account JSON with project_id, client_email, and private_key. */
export function pushConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseServiceAccount(env.FCM_SERVICE_ACCOUNT) !== null;
}

/** Builds an RS256-signed JWT assertion for Google OAuth2 service account token exchange. */
export function buildServiceAccountJwt(
  account: ServiceAccountConfig,
  nowMs: number,
): string {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + 3600;

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: account.client_email,
    scope: FCM_SCOPE,
    aud: OAUTH_TOKEN_URL,
    iat,
    exp,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
  const encodedClaims = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signingInput = `${encodedHeader}.${encodedClaims}`;

  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(account.private_key, "base64url");

  return `${signingInput}.${signature}`;
}

async function fetchWithTimeout(
  fetchFn: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getAccessToken(
  account: ServiceAccountConfig,
  fetchFn: typeof globalThis.fetch,
  nowMs: number,
): Promise<string> {
  const cacheKey = `${account.project_id}:${account.client_email}`;
  if (
    cachedToken &&
    cachedToken.cacheKey === cacheKey &&
    nowMs < cachedToken.expiresAtMs - TOKEN_REFRESH_BUFFER_MS
  ) {
    return cachedToken.accessToken;
  }

  const assertion = buildServiceAccountJwt(account, nowMs);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  }).toString();

  const res = await fetchWithTimeout(fetchFn, OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`OAuth token exchange failed with status ${res.status}`);
  }

  const data = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof data?.access_token !== "string" || !data.access_token) {
    throw new Error("OAuth response missing access_token");
  }

  const expiresInSec =
    typeof data.expires_in === "number" && Number.isFinite(data.expires_in) && data.expires_in > 0
      ? data.expires_in
      : 3600;

  cachedToken = {
    cacheKey,
    accessToken: data.access_token,
    expiresAtMs: nowMs + expiresInSec * 1000,
  };

  return data.access_token;
}

function classifyFcmError(status: number, body: unknown): SendPushResult {
  if (status === 404) {
    return "invalid_token";
  }

  if (typeof body === "object" && body !== null && "error" in body) {
    const errObj = (body as { error?: unknown }).error;
    if (typeof errObj === "object" && errObj !== null) {
      const errRecord = errObj as Record<string, unknown>;
      const fcmStatus = typeof errRecord.status === "string" ? errRecord.status : "";
      const message = typeof errRecord.message === "string" ? errRecord.message : "";
      const details = Array.isArray(errRecord.details) ? errRecord.details : [];
      const errorCodes = details
        .map((d) =>
          typeof d === "object" && d !== null && "errorCode" in d
            ? String((d as { errorCode?: unknown }).errorCode)
            : "",
        )
        .filter(Boolean);

      if (fcmStatus === "UNREGISTERED" || errorCodes.includes("UNREGISTERED")) {
        return "invalid_token";
      }

      if (fcmStatus === "INVALID_ARGUMENT" || errorCodes.includes("INVALID_ARGUMENT")) {
        if (!message || /token|registration/i.test(message)) {
          return "invalid_token";
        }
      }
    }
  }

  return "error";
}

/**
 * Sends an Android push notification via FCM HTTP v1 API.
 * Returns `'ok'`, `'invalid_token'` (HTTP 404 or UNREGISTERED / INVALID_ARGUMENT about the token), or `'error'`.
 * Never logs device tokens, access tokens, or FCM error bodies.
 */
export async function sendPush(
  token: string,
  payload: PushMessageInput,
  options?: SendPushOptions,
): Promise<SendPushResult> {
  const account = parseServiceAccount(
    options?.serviceAccountJson ?? process.env.FCM_SERVICE_ACCOUNT,
  );
  if (!account) {
    return "error";
  }

  const fetchFn = options?.fetch ?? globalThis.fetch;
  const nowFn = options?.clock ?? options?.now ?? Date.now;

  let accessToken: string;
  try {
    accessToken = await getAccessToken(account, fetchFn, nowFn());
  } catch {
    return "error";
  }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`;
  const requestBody = {
    message: {
      token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: {
        url: payload.url,
      },
      android: {
        priority: "HIGH",
        notification: {
          channel_id: "price_alerts",
          tag: payload.tag ?? "",
        },
      },
    },
  };

  try {
    const res = await fetchWithTimeout(fetchFn, endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (res.ok) {
      return "ok";
    }

    let parsedBody: unknown = null;
    try {
      parsedBody = await res.json();
    } catch {
      parsedBody = null;
    }

    return classifyFcmError(res.status, parsedBody);
  } catch {
    return "error";
  }
}
