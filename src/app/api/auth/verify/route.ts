import { authJson, checkOrigin, readJson } from "@/lib/auth/guard";
import { peekEmailToken, verifyEmailWithToken } from "@/lib/auth/tokens";

export async function POST(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const body = await readJson<{ token?: unknown }>(request);
  if (!body.ok) return body.response;

  const rawToken = body.data.token;
  if (typeof rawToken !== "string" || !rawToken.trim()) {
    return authJson({ error: "Invalid or expired link" }, 400);
  }
  const token = rawToken.trim();

  try {
    const userId = await peekEmailToken(token, "verify");
    if (!userId) {
      return authJson({ error: "Invalid or expired link" }, 400);
    }

    const updated = await verifyEmailWithToken(token);
    if (!updated) {
      return authJson({ error: "Invalid or expired link" }, 400);
    }

    return authJson({ ok: true }, 200);
  } catch {
    return authJson({ error: "Could not verify email" }, 500);
  }
}
