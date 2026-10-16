import { authJson, authNoContent, checkOrigin, clientKey, readJson } from "@/lib/auth/guard";
import { HashBusyError, verifyPassword } from "@/lib/auth/password";
import {
  clearRateLimit,
  emailRateLimitKey,
  ipRateLimitKey,
  LOGIN_EMAIL_LIMIT,
  LOGIN_IP_LIMIT,
  LOGIN_SHARED_IP_LIMIT,
  LOGIN_WINDOW_SECONDS,
  rateLimit,
} from "@/lib/auth/rateLimit";
import { destroySession, getSessionUser } from "@/lib/auth/session";
import { deleteUserAccount, getUserById } from "@/lib/auth/users";

export async function GET() {
  try {
    const user = await getSessionUser();
    return authJson({ user }, 200);
  } catch {
    return authJson({ user: null }, 200);
  }
}

export async function DELETE(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const body = await readJson<{ password?: unknown }>(request);
  if (!body.ok) return body.response;

  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return authJson({ error: "Not authenticated" }, 401);
  }

  const password = body.data.password;
  if (typeof password !== "string" || !password) {
    return authJson({ error: "Password is required" }, 400);
  }

  // Rate limited like login (5 per 15 min per email AND 20 per 15 min per IP, or 200 when shared), checked before hashing
  const ip = clientKey(request);
  const ipLimit = ip === "shared" ? LOGIN_SHARED_IP_LIMIT : LOGIN_IP_LIMIT;
  const emailKey = emailRateLimitKey("delete", sessionUser.email);
  const [ipRl, emailRl] = await Promise.all([
    rateLimit(ipRateLimitKey("delete", ip), ipLimit, LOGIN_WINDOW_SECONDS),
    rateLimit(emailKey, LOGIN_EMAIL_LIMIT, LOGIN_WINDOW_SECONDS),
  ]);
  if (!ipRl.allowed || !emailRl.allowed) {
    return authJson({ error: "Too many attempts. Please try again later." }, 429);
  }

  try {
    const dbUser = await getUserById(sessionUser.id);
    if (!dbUser) {
      return authJson({ error: "Not authenticated" }, 401);
    }

    const valid = await verifyPassword(password, dbUser.password_hash);
    if (!valid) {
      return authJson({ error: "Invalid email or password" }, 401);
    }

    await clearRateLimit(emailKey);
    await deleteUserAccount(sessionUser.id);
    await destroySession();
    return authNoContent();
  } catch (err) {
    if (err instanceof HashBusyError) {
      return authJson({ error: "Server busy, try again shortly" }, 503);
    }
    return authJson({ error: "Could not delete account" }, 500);
  }
}
