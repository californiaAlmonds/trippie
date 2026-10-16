import { after } from "next/server";
import { authJson, checkOrigin, clientKey, readJson } from "@/lib/auth/guard";
import {
  emailRateLimitKey,
  FORGOT_EMAIL_LIMIT,
  FORGOT_IP_LIMIT,
  FORGOT_SHARED_IP_LIMIT,
  FORGOT_WINDOW_SECONDS,
  ipRateLimitKey,
  rateLimit,
} from "@/lib/auth/rateLimit";
import { runForgotPasswordTask } from "@/lib/auth/tokens";

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
  const ipLimit = ip === "shared" ? FORGOT_SHARED_IP_LIMIT : FORGOT_IP_LIMIT;
  const [ipRl, emailRl] = await Promise.all([
    rateLimit(ipRateLimitKey("forgot", ip), ipLimit, FORGOT_WINDOW_SECONDS),
    rateLimit(emailRateLimitKey("forgot", rawEmail), FORGOT_EMAIL_LIMIT, FORGOT_WINDOW_SECONDS),
  ]);
  if (!ipRl.allowed || !emailRl.allowed) {
    return authJson({ error: "Too many password reset requests. Please try again later." }, 429);
  }

  after(async () => {
    await runForgotPasswordTask(rawEmail);
  });

  return authJson({ ok: true }, 202);
}
