import { authJson, checkOrigin, clientKey, readJson } from "@/lib/auth/guard";
import { validateEmail } from "@/lib/auth/password";
import {
  emailRateLimitKey,
  FORGOT_EMAIL_LIMIT,
  FORGOT_IP_LIMIT,
  FORGOT_WINDOW_SECONDS,
  ipRateLimitKey,
  rateLimit,
} from "@/lib/auth/rateLimit";
import { buildResetLink, createEmailToken } from "@/lib/auth/tokens";
import { getUserByEmail } from "@/lib/auth/users";
import { buildResetEmail, mailConfigured, sendMail } from "@/lib/mailer";

export async function POST(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const body = await readJson<{ email?: unknown }>(request);
  if (!body.ok) return body.response;

  const rawEmail = typeof body.data.email === "string" ? body.data.email.trim().toLowerCase() : "";
  if (!rawEmail) {
    return authJson({ error: "Valid email is required" }, 400);
  }

  const ip = clientKey(request);
  const [ipRl, emailRl] = await Promise.all([
    rateLimit(ipRateLimitKey("forgot", ip), FORGOT_IP_LIMIT, FORGOT_WINDOW_SECONDS),
    rateLimit(emailRateLimitKey("forgot", rawEmail), FORGOT_EMAIL_LIMIT, FORGOT_WINDOW_SECONDS),
  ]);
  if (!ipRl.allowed || !emailRl.allowed) {
    return authJson({ error: "Too many password reset requests. Please try again later." }, 429);
  }

  const emailRes = validateEmail(rawEmail);
  if (!emailRes.ok) {
    return authJson({ ok: true }, 202);
  }

  try {
    const user = await getUserByEmail(emailRes.email);
    if (user && (mailConfigured() || process.env.NODE_ENV !== "production")) {
      const token = await createEmailToken(user.id, "reset");
      const resetUrl = buildResetLink(token);
      await sendMail(buildResetEmail(user.email, resetUrl));
    }
  } catch {
    console.error("forgot-password failed");
  }

  return authJson({ ok: true }, 202);
}
