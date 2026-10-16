import { authJson, checkOrigin, readJson } from "@/lib/auth/guard";
import { HashBusyError, hashPassword, validatePasswordPolicy } from "@/lib/auth/password";
import { peekEmailToken, resetPasswordWithToken } from "@/lib/auth/tokens";

export async function POST(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const body = await readJson<{ token?: unknown; password?: unknown }>(request);
  if (!body.ok) return body.response;

  const passwordRes = validatePasswordPolicy(body.data.password);
  if (!passwordRes.ok) {
    return authJson({ error: passwordRes.error }, 400);
  }
  const password = body.data.password as string;

  const rawToken = body.data.token;
  if (typeof rawToken !== "string" || !rawToken.trim()) {
    return authJson({ error: "Invalid or expired link" }, 400);
  }
  const token = rawToken.trim();

  try {
    const userId = await peekEmailToken(token, "reset");
    if (!userId) {
      return authJson({ error: "Invalid or expired link" }, 400);
    }

    const passwordHash = await hashPassword(password);
    const updated = await resetPasswordWithToken(token, passwordHash);
    if (!updated) {
      return authJson({ error: "Invalid or expired link" }, 400);
    }

    return authJson({ ok: true }, 200);
  } catch (err) {
    if (err instanceof HashBusyError) {
      return authJson({ error: "Server busy, try again shortly" }, 503);
    }
    return authJson({ error: "Could not reset password" }, 500);
  }
}
