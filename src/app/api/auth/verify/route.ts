import { consumeToken, markUserVerified } from "@/lib/accounts";
import { authJson, checkOrigin, readJson } from "@/lib/auth/guard";
import { createSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const body = await readJson<{ token?: unknown }>(request);
  if (!body.ok) return body.response;

  const rawToken = body.data.token;
  if (typeof rawToken !== "string" || !rawToken.trim()) {
    return authJson({ error: "Invalid or expired verification token" }, 400);
  }

  try {
    const userId = await consumeToken(rawToken.trim(), "verify");
    if (!userId) {
      return authJson({ error: "Invalid or expired verification token" }, 400);
    }

    const user = await markUserVerified(userId);
    if (!user) {
      return authJson({ error: "Invalid or expired verification token" }, 400);
    }

    await createSession(user.id);
    return authJson({ user }, 200);
  } catch {
    return authJson({ error: "Could not verify email" }, 500);
  }
}
