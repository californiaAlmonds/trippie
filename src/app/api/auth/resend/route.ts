import { after } from "next/server";
import { authJson, checkOrigin, readJson } from "@/lib/auth/guard";
import { rateLimit, RESEND_USER_LIMIT, RESEND_WINDOW_SECONDS, userRateLimitKey } from "@/lib/auth/rateLimit";
import { getSessionUser } from "@/lib/auth/session";
import { runVerificationEmailTask } from "@/lib/auth/tokens";
import { mailConfigured } from "@/lib/mailer";

export async function POST(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const body = await readJson(request, 16384, { allowEmpty: true });
  if (!body.ok) return body.response;

  const user = await getSessionUser();
  if (!user) {
    return authJson({ error: "Not authenticated" }, 401);
  }
  if (user.verified) {
    return authJson({ error: "Account is already verified" }, 400);
  }

  const rl = await rateLimit(userRateLimitKey("resend", user.id), RESEND_USER_LIMIT, RESEND_WINDOW_SECONDS);
  if (!rl.allowed) {
    return authJson({ error: "Too many verification emails requested. Please try again later." }, 429);
  }

  if (process.env.NODE_ENV === "production" && !mailConfigured()) {
    return authJson({ error: "Email is not configured" }, 503);
  }

  after(async () => {
    await runVerificationEmailTask(user.id, user.email);
  });

  return authJson({ ok: true }, 200);
}
