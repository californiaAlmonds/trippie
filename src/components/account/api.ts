import type { TripMode } from "@/lib/search";

export interface AccountUser {
  id: string | number;
  email: string;
  verified: boolean;
}

export interface Plan {
  id: string | number;
  origin: string;
  destination: string;
  month: string;
  trip: TripMode;
  minGap: number;
  maxGap: number;
  alertEnabled: boolean;
  targetPrice: number | null;
  lastAlertPrice: number | null;
  expired: boolean;
  createdAt: string | number;
}

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

function statusFallbackMessage(status: number): string {
  if (status === 401) return "Please sign in to continue.";
  if (status === 403) return "Action not allowed.";
  if (status === 404) return "Not found.";
  if (status === 409) return "This item already exists or limit was reached.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status === 503) return "Service temporarily unavailable. Please try again shortly.";
  return "Something went wrong. Please try again.";
}

/**
 * Typed fetch wrapper that never throws on non-2xx or network errors.
 * Automatically sets `Content-Type: application/json` on mutations.
 */
export async function api<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
  const method = options.method ?? "GET";
  const isMutation = method !== "GET";

  const headers: Record<string, string> = {};
  if (isMutation) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const res = await fetch(path, {
      method,
      headers,
      body: isMutation ? JSON.stringify(options.body ?? {}) : undefined,
      credentials: "same-origin",
      signal: options.signal,
    });

    if (res.status === 204) {
      return { ok: true, status: 204, data: null };
    }

    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }

    if (res.ok) {
      return {
        ok: true,
        status: res.status,
        data: (parsed as T) ?? null,
      };
    }

    const errMsg =
      typeof (parsed as { error?: unknown })?.error === "string"
        ? (parsed as { error: string }).error
        : statusFallbackMessage(res.status);

    return {
      ok: false,
      status: res.status,
      data: (parsed as T) ?? null,
      error: errMsg,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      data: null,
      error: "Network error. Please check your connection and try again.",
    };
  }
}

/**
 * Helper to detect when a parallel backend endpoint (/api/plans or /api/recent)
 * is not mounted yet or unreachable, so callers can degrade gracefully.
 */
export function isEndpointUnavailable(res: ApiResult<unknown>): boolean {
  return res.status === 0 || res.status === 404 || res.status === 405;
}
