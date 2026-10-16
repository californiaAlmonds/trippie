import { authJson, checkOrigin, clientKey, readJson } from "@/lib/auth/guard";
import { hashPassword, validateEmail, validatePasswordPolicy } from "@/lib/auth/password";
import { ipRateLimitKey, rateLimit, SIGNUP_IP_LIMIT, SIGNUP_WINDOW_SECONDS } from "@/lib/auth/rateLimit";
import { createSession } from "@/lib/auth/session";
import { buildVerifyLink, createEmailToken } from "@/lib/auth/tokens";
import { createUser } from "@/lib/auth/users";
import { buildVerifyEmail, mailConfigured, sendMail } from "@/lib/mailer";

export async function POST(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const body = await readJson<{ email?: unknown; password?: unknown }>(request);
  if (!body.ok) return body.response;

  const emailRes = validateEmail(body.data.email);
  if (!emailRes.ok) {
    return authJson({ error: emailRes.error }, 400);
  }

  const passwordRes = validatePasswordPolicy(body.data.password);
  if (!passwordRes.ok) {
    return authJson({ error: passwordRes.error }, 400);
  }
  const password = body.data.password as string;

  const ip = clientKey(request);
  const ipRl = await rateLimit(ipRateLimitKey("signup", ip), SIGNUP_IP_LIMIT, SIGNUP_WINDOW_SECONDS);
  if (!ipRl.allowed) {
    return authJson({ error: "Too many signup attempts. Please try again later." }, 429);
  }

  const smtpReady = mailConfigured();
  const allowUnverifiedDev = process.env.ALLOW_UNVERIFIED_DEV === "1";
  const isProduction = process.env.NODE_ENV === "production";

  if (!smtpReady && !allowUnverifiedDev && isProduction) {
    return authJson({ error: "Email is not configured; sign-up is disabled" }, 503);
  }

  try {
    const passwordHash = await hashPassword(password);
    const created = await createUser(emailRes.email, passwordHash, { verified: allowUnverifiedDev });
    if (!created.ok) {
      return authJson({ error: "Could not create account" }, 409);
    }

    await createSession(created.user.id);

    if (!allowUnverifiedDev) {
      const token = await createEmailToken(created.user.id, "verify");
      const verifyUrl = buildVerifyLink(token);
      await sendMail(buildVerifyEmail(created.user.email, verifyUrl));
    }

    return authJson({ user: created.user }, 201);
  } catch {
    return authJson({ error: "Could not create account" }, 500);
  }
}
