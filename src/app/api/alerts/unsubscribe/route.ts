import { AppSecretError, appSecretConfigured, unsubscribePlanWithToken } from "@/lib/alerts/unsubscribe";
import { authJson, checkOrigin, clientKey, readJson } from "@/lib/auth/guard";
import { ipRateLimitKey, rateLimit } from "@/lib/auth/rateLimit";

const UNSUBSCRIBE_IP_LIMIT = 20;
const UNSUBSCRIBE_WINDOW_SECONDS = 60 * 60; // 1 hour

export async function POST(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const body = await readJson<{ token?: unknown }>(request);
  if (!body.ok) return body.response;

  const ip = clientKey(request);
  const rl = await rateLimit(
    ipRateLimitKey("unsubscribe", ip),
    UNSUBSCRIBE_IP_LIMIT,
    UNSUBSCRIBE_WINDOW_SECONDS,
  );
  if (!rl.allowed) {
    return authJson({ error: "Too many attempts. Please try again later." }, 429);
  }

  if (!appSecretConfigured()) {
    return authJson({ error: "Alerts are not configured" }, 503);
  }

  const rawToken = body.data.token;
  if (typeof rawToken !== "string" || !rawToken.trim()) {
    return authJson({ error: "Invalid or expired link" }, 400);
  }

  try {
    const ok = await unsubscribePlanWithToken(rawToken.trim());
    if (!ok) {
      return authJson({ error: "Invalid or expired link" }, 400);
    }
    return authJson({ ok: true }, 200);
  } catch (err) {
    if (err instanceof AppSecretError) {
      return authJson({ error: "Alerts are not configured" }, 503);
    }
    return authJson({ error: "Could not unsubscribe" }, 500);
  }
}
