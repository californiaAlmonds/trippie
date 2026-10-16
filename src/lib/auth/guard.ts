export const AUTH_HEADERS = {
  "Cache-Control": "no-store",
} as const;

/** Builds a JSON Response with `Cache-Control: no-store`. */
export function authJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: AUTH_HEADERS });
}

/** Builds a 204 No Content Response with `Cache-Control: no-store`. */
export function authNoContent(): Response {
  return new Response(null, { status: 204, headers: AUTH_HEADERS });
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
 * Verifies the `Origin` header on POST/PATCH/DELETE requests.
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
 * Requires `Content-Type: application/json`, reads the body up to `maxBytes` (default 16 KB),
 * and safely parses a JSON object.
 */
export async function readJson<T = Record<string, unknown>>(
  request: Request,
  maxBytes = 16384,
  options?: { allowEmpty?: boolean },
): Promise<ReadJsonResult<T>> {
  const rawCt = request.headers.get("content-type") ?? "";
  const mediaType = rawCt.split(";")[0]?.trim().toLowerCase() ?? "";

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

  if (options?.allowEmpty && text.trim() === "" && (mediaType === "" || mediaType === "application/json")) {
    return { ok: true, data: {} as T };
  }

  if (mediaType !== "application/json") {
    return {
      ok: false,
      response: authJson({ error: "Content-Type must be application/json" }, 415),
    };
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

/**
 * Resolves the client rate-limit key: first hop of `x-forwarded-for` only when
 * `TRUSTED_PROXY=1`, otherwise the constant `'shared'`.
 */
export function clientKey(request: Request, trustedProxy = process.env.TRUSTED_PROXY): string {
  if (trustedProxy !== "1") return "shared";
  const xff = request.headers.get("x-forwarded-for");
  if (!xff) return "shared";
  const firstHop = xff.split(",")[0]?.trim() ?? "";
  return firstHop.length > 0 ? firstHop : "shared";
}
