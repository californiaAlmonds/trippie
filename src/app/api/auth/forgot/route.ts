import { randomBytes } from "node:crypto";
import { createEmailToken, getUserByEmail, validateEmail } from "@/lib/accounts";
import {
  authJson,
  checkOrigin,
  clientKey,
  emailRateLimitKey,
  expectedOrigin,
  ipRateLimitKey,
  rateLimit,
  readJson,
} from "@/lib/auth/guard";
import { hashEmailToken } from "@/lib/auth/tokens";
import { buildResetEmail, mailConfigured, sendMail } from "@/lib/mailer";

const FORGOT_IP_LIMIT = 5;
const FORGOT_EMAIL_LIMIT = 3;
const FORGOT_WINDOW_SECONDS = 3600; // 1 hour

export async function POST(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const body = await readJson<{ email?: unknown }>(request);
  if (!body.ok) return body.response;

  const emailRes = validateEmail(body.data.email);
  if (!emailRes.ok) {
    return authJson({ error: emailRes.error }, 400);
  }

  const ip = clientKey(request);
  const [ipRl, emailRl] = await Promise.all([
    rateLimit(ipRateLimitKey("forgot", ip), FORGOT_IP_LIMIT, FORGOT_WINDOW_SECONDS),
    rateLimit(emailRateLimitKey("forgot", emailRes.email), FORGOT_EMAIL_LIMIT, FORGOT_WINDOW_SECONDS),
  ]);
  if (!ipRl.allowed || !emailRl.allowed) {
    return authJson({ error: "Too many password reset requests. Please try again later." }, 429);
  }

  try {
    const user = await getUserByEmail(emailRes.email);
    if (!user) {
      // Perform equivalent token generation & hashing work for timing consistency
      hashEmailToken(randomBytes(32).toString("base64url"));
      return authJson({ status: "ok" }, 200);
    }

    const token = await createEmailToken(user.id, "reset");
    const baseOrigin = expectedOrigin(request);
    const resetUrl = `${baseOrigin}/reset?token=${encodeURIComponent(token)}`;

    if (mailConfigured()) {
      await sendMail(buildResetEmail(user.email, resetUrl)).catch(() => undefined);
    } else if (process.env.NODE_ENV !== "production") {
      console.warn(`dev reset link: ${resetUrl}`);
    }

    return authJson({ status: "ok" }, 200);
  } catch {
    return authJson({ status: "ok" }, 200);
  }
}
