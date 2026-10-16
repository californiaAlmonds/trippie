import { getUserByEmail, validateEmail } from "@/lib/accounts";
import {
  authJson,
  checkOrigin,
  clientKey,
  emailRateLimitKey,
  ipRateLimitKey,
  rateLimit,
  readJson,
} from "@/lib/auth/guard";
import { dummyVerify, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

const LOGIN_IP_LIMIT = 10;
const LOGIN_EMAIL_LIMIT = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60; // 15 minutes

export async function POST(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const body = await readJson<{ email?: unknown; password?: unknown }>(request);
  if (!body.ok) return body.response;

  const rawEmail = body.data.email;
  const rawPassword = body.data.password;
  if (typeof rawEmail !== "string" || typeof rawPassword !== "string" || !rawEmail.trim() || !rawPassword) {
    return authJson({ error: "Email and password are required" }, 400);
  }

  const normalizedEmail = rawEmail.trim().toLowerCase();
  if (normalizedEmail.length > 254) {
    return authJson({ error: "Invalid email or password" }, 401);
  }

  // Rate-limit by IP (10/15min) and email-hash (5/15min) BEFORE password hashing
  const ip = clientKey(request);
  const [ipRl, emailRl] = await Promise.all([
    rateLimit(ipRateLimitKey("login", ip), LOGIN_IP_LIMIT, LOGIN_WINDOW_SECONDS),
    rateLimit(emailRateLimitKey("login", normalizedEmail), LOGIN_EMAIL_LIMIT, LOGIN_WINDOW_SECONDS),
  ]);
  if (!ipRl.allowed || !emailRl.allowed) {
    return authJson({ error: "Too many login attempts. Please try again later." }, 429);
  }

  const emailCheck = validateEmail(normalizedEmail);
  if (!emailCheck.ok) {
    await dummyVerify(rawPassword);
    return authJson({ error: "Invalid email or password" }, 401);
  }

  try {
    const user = await getUserByEmail(emailCheck.email);
    if (!user) {
      await dummyVerify(rawPassword);
      return authJson({ error: "Invalid email or password" }, 401);
    }

    const ok = await verifyPassword(rawPassword, user.password_hash);
    if (!ok) {
      return authJson({ error: "Invalid email or password" }, 401);
    }

    if (!user.verified_at) {
      return authJson({ error: "Verify your email first" }, 403);
    }

    await createSession(user.id);
    return authJson({ user: { id: user.id, email: user.email } }, 200);
  } catch {
    return authJson({ error: "Could not sign in" }, 500);
  }
}
