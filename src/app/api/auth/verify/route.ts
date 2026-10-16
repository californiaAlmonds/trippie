import { authJson, checkOrigin, readJson } from "@/lib/auth/guard";
import { consumeEmailToken } from "@/lib/auth/tokens";
import { markUserVerified } from "@/lib/auth/users";

export async function POST(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const body = await readJson<{ token?: unknown }>(request);
  if (!body.ok) return body.response;

  const rawToken = body.data.token;
  if (typeof rawToken !== "string" || !rawToken.trim()) {
    return authJson({ error: "Invalid or expired link" }, 400);
  }

  try {
    const userId = await consumeEmailToken(rawToken.trim(), "verify");
    if (!userId) {
      return authJson({ error: "Invalid or expired link" }, 400);
    }

    const updated = await markUserVerified(userId);
    if (!updated) {
      return authJson({ error: "Invalid or expired link" }, 400);
    }

    return authJson({ ok: true }, 200);
  } catch {
    return authJson({ error: "Could not verify email" }, 500);
  }
}
