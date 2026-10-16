import { createHash } from "node:crypto";
import { getClient } from "../store.ts";

export const AUTH_HEADERS = {
  "Cache-Control": "no-store",
} as const;

/** Builds a JSON Response with `Cache-Control: no-store`. */
export function authJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: AUTH_HEADERS });
}

/** Resolves the expected origin: env APP_ORIGIN if set, otherwise `new URL(request.url).origin`. */
export function expectedOrigin(request: Request, appOrigin = process.env.APP_ORIGIN): string {
  const configured = appOrigin?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      return configured.replace(/\/+$/, "");
    }
  }
  return new URL(request.url).origin;
}

/**
 * Verifies the `Origin` header on mutating requests.
 * Returns null if valid, or a 403 Response (`Cache-Control: no-store`) if missing or mismatched.
 */
export function checkOrigin(request: Request, appOrigin = process.env.APP_ORIGIN): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) {
    return authJson({ error: "Forbidden: missing Origin header" }, 403);
  }
  const expected = expectedOrigin(request, appOrigin);
  if (origin !== expected) {
    return authJson({ error: "Forbidden: invalid Origin header" }, 403);
  }
  return null;
}

export type ReadJsonResult<T> = { ok: true; data: T } | { ok: false; response: Response };

/**
 * Requires `Content-Type: application/json`, reads the body up to `maxBytes` (rejecting larger with 413),
 * and safely parses a JSON object.
 */
export async function readJson<T = Record<string, unknown>>(
  request: Request,
  maxBytes = 16384,
  options?: { allowEmpty?: boolean },
): Promise<ReadJsonResult<T>> {
  const rawCt = request.headers.get("content-type") ?? "";
  const mediaType = rawCt.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "application/json") {
    return {
      ok: false,
      response: authJson({ error: "Content-Type must be application/json" }, 415),
    };
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const cl = Number(contentLengthHeader);
    if (Number.isFinite(cl) && cl > maxBytes) {
      return {
        ok: false,
        response: authJson({ error: "Request body too large" }, 413),
      };
    }
  }

  let text = "";
  if (request.body) {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel().catch(() => undefined);
            return {
              ok: false,
              response: authJson({ error: "Request body too large" }, 413),
            };
          }
          chunks.push(value);
        }
      }
    } catch {
      return {
        ok: false,
        response: authJson({ error: "Failed to read request body" }, 400),
      };
    }
    text = Buffer.concat(chunks).toString("utf8");
  } else {
    try {
      text = await request.text();
    } catch {
      return {
        ok: false,
        response: authJson({ error: "Failed to read request body" }, 400),
      };
    }
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      return {
        ok: false,
        response: authJson({ error: "Request body too large" }, 413),
      };
    }
  }

  if (options?.allowEmpty && text.trim() === "") {
    return { ok: true, data: {} as T };
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        response: authJson({ error: "JSON body must be an object" }, 400),
      };
    }
    return { ok: true, data: parsed as T };
  } catch {
    return {
      ok: false,
      response: authJson({ error: "Invalid JSON body" }, 400),
    };
  }
}

/** Returns the first hop of `x-forwarded-for` if present, otherwise `"local"`. */
export function clientKey(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (!xff) return "local";
  const firstHop = xff.split(",")[0]?.trim();
  return firstHop || "local";
}

/** Hashes a normalized email with SHA-256 so raw email addresses are never stored in `rate_limits`. */
export function emailRateLimitKey(scope: string, normalizedEmail: string): string {
  const digest = createHash("sha256").update(normalizedEmail.trim().toLowerCase(), "utf8").digest("hex");
  return `${scope}:email:${digest}`;
}

/** Builds an IP rate-limit key for the given scope. */
export function ipRateLimitKey(scope: string, ip: string): string {
  return `${scope}:ip:${ip}`;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  windowStart: number;
}

const ONE_DAY_SECONDS = 86400;

/**
 * Enforces a fixed-window rate limit using an atomic UPSERT on `rate_limits`.
 * Opportunistically deletes rows with `window_start` older than 1 day.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  nowMs = Date.now(),
): Promise<RateLimitResult> {
  const nowSeconds = Math.floor(nowMs / 1000);
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  const staleBefore = nowSeconds - ONE_DAY_SECONDS;

  const client = await getClient();
  await client.execute({
    sql: "DELETE FROM rate_limits WHERE window_start < ?",
    args: [staleBefore],
  });

  const rs = await client.execute({
    sql: `INSERT INTO rate_limits (key, window_start, count)
          VALUES (?, ?, 1)
          ON CONFLICT(key, window_start) DO UPDATE SET count = rate_limits.count + 1
          RETURNING count`,
    args: [key, windowStart],
  });

  const count = Number(rs.rows[0]?.count ?? 1);
  return {
    allowed: count <= limit,
    count,
    windowStart,
  };
}
