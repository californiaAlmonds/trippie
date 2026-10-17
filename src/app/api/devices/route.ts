import { authJson, authNoContent, checkOrigin, readJson } from "@/lib/auth/guard";
import { rateLimit, userRateLimitKey } from "@/lib/auth/rateLimit";
import { getSessionUser } from "@/lib/auth/session";
import {
  DEVICE_RATE_LIMIT,
  DEVICE_RATE_WINDOW_SECONDS,
  isValidDevicePlatform,
  isValidDeviceToken,
  registerDevice,
  unregisterDevice,
} from "@/lib/push/devices";

export async function POST(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const body = await readJson<Record<string, unknown>>(request);
  if (!body.ok) return body.response;

  const user = await getSessionUser();
  if (!user) {
    return authJson({ error: "Sign in required" }, 401);
  }

  const rl = await rateLimit(
    userRateLimitKey("devices", user.id),
    DEVICE_RATE_LIMIT,
    DEVICE_RATE_WINDOW_SECONDS,
  );
  if (!rl.allowed) {
    return authJson({ error: "Too many device requests. Please try again later." }, 429);
  }

  const token = body.data.token;
  const platform = body.data.platform ?? "android";

  if (!isValidDeviceToken(token) || !isValidDevicePlatform(platform)) {
    return authJson({ error: "Invalid device registration payload" }, 400);
  }

  try {
    await registerDevice(user.id, token, platform);
    return authNoContent();
  } catch {
    return authJson({ error: "Could not register device" }, 500);
  }
}

export async function DELETE(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const body = await readJson<Record<string, unknown>>(request);
  if (!body.ok) return body.response;

  const user = await getSessionUser();
  if (!user) {
    return authJson({ error: "Sign in required" }, 401);
  }

  const rl = await rateLimit(
    userRateLimitKey("devices", user.id),
    DEVICE_RATE_LIMIT,
    DEVICE_RATE_WINDOW_SECONDS,
  );
  if (!rl.allowed) {
    return authJson({ error: "Too many device requests. Please try again later." }, 429);
  }

  const token = body.data.token;
  if (!isValidDeviceToken(token)) {
    return authJson({ error: "Invalid device token" }, 400);
  }

  try {
    await unregisterDevice(user.id, token);
    return authNoContent();
  } catch {
    return authJson({ error: "Could not remove device" }, 500);
  }
}
