import { authJson, checkOrigin, clientKey, readJson } from "@/lib/auth/guard";
import { dummyVerify, isLoginPasswordAcceptable, validateEmail, verifyPassword } from "@/lib/auth/password";
import {
  clearRateLimit,
  emailRateLimitKey,
  ipRateLimitKey,
  LOGIN_EMAIL_LIMIT,
  LOGIN_IP_LIMIT,
  LOGIN_WINDOW_SECONDS,
  rateLimit,
} from "@/lib/auth/rateLimit";
import { createSession } from "@/lib/auth/session";
import { getUserByEmail } from "@/lib/auth/users";

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

  // Check rate limits BEFORE hashing (5 per 15 min per email AND 20 per 15 min per IP)
  const ip = clientKey(request);
  const emailKey = emailRateLimitKey("login", normalizedEmail);
  const [ipRl, emailRl] = await Promise.all([
    rateLimit(ipRateLimitKey("login", ip), LOGIN_IP_LIMIT, LOGIN_WINDOW_SECONDS),
    rateLimit(emailKey, LOGIN_EMAIL_LIMIT, LOGIN_WINDOW_SECONDS),
  ]);
  if (!ipRl.allowed || !emailRl.allowed) {
    return authJson({ error: "Too many login attempts. Please try again later." }, 429);
  }

  if (!isLoginPasswordAcceptable(rawPassword)) {
    await dummyVerify("invalid-length-password");
    return authJson({ error: "Invalid email or password" }, 401);
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

    await clearRateLimit(emailKey);
    await createSession(user.id);
    return authJson(
      {
        user: {
          id: user.id,
          email: user.email,
          verified: Boolean(user.verified_at),
        },
      },
      200,
    );
  } catch {
    return authJson({ error: "Could not sign in" }, 500);
  }
}
