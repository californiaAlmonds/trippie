import { createEmailToken, createUser, validateEmail } from "@/lib/accounts";
import { authJson, checkOrigin, clientKey, expectedOrigin, ipRateLimitKey, rateLimit, readJson } from "@/lib/auth/guard";
import { hashPassword, validatePasswordPolicy } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { buildVerifyEmail, mailConfigured, sendMail } from "@/lib/mailer";

const SIGNUP_IP_LIMIT = 5;
const SIGNUP_WINDOW_SECONDS = 3600; // 1 hour

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

  // Rate-limit per IP (5/hour) BEFORE password hashing
  const ip = clientKey(request);
  const rl = await rateLimit(ipRateLimitKey("signup", ip), SIGNUP_IP_LIMIT, SIGNUP_WINDOW_SECONDS);
  if (!rl.allowed) {
    return authJson({ error: "Too many signup attempts. Please try again later." }, 429);
  }

  const smtpReady = mailConfigured();
  const allowUnverifiedDev = process.env.ALLOW_UNVERIFIED_DEV === "1";
  const isProduction = process.env.NODE_ENV === "production";

  // In production without SMTP and without explicit local opt-in, reject BEFORE creating the user
  if (!smtpReady && !allowUnverifiedDev && isProduction) {
    return authJson({ error: "Email is not configured on this server" }, 503);
  }

  try {
    const passwordHash = await hashPassword(password);
    const autoVerify = !smtpReady && allowUnverifiedDev;
    const created = await createUser(emailRes.email, passwordHash, { verified: autoVerify });
    if (!created.ok) {
      return authJson({ error: "Could not create account" }, 409);
    }

    if (autoVerify) {
      await createSession(created.user.id);
      return authJson({ status: "signed_in", user: created.user }, 201);
    }

    const token = await createEmailToken(created.user.id, "verify");
    const baseOrigin = expectedOrigin(request);
    const verifyUrl = `${baseOrigin}/verify?token=${encodeURIComponent(token)}`;

    if (smtpReady) {
      await sendMail(buildVerifyEmail(created.user.email, verifyUrl));
      return authJson({ status: "verification_sent" }, 201);
    }

    // Non-production without SMTP and without ALLOW_UNVERIFIED_DEV=1: log only the link, no email address
    console.warn(`dev verification link: ${verifyUrl}`);
    return authJson({ status: "verification_sent" }, 201);
  } catch {
    return authJson({ error: "Could not complete signup" }, 500);
  }
}
