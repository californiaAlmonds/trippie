import { authJson, checkOrigin, readJson } from "@/lib/auth/guard";
import { hashPassword, validatePasswordPolicy } from "@/lib/auth/password";
import { consumeEmailToken } from "@/lib/auth/tokens";
import { resetUserPassword } from "@/lib/auth/users";

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

  try {
    const userId = await consumeEmailToken(rawToken.trim(), "reset");
    if (!userId) {
      return authJson({ error: "Invalid or expired link" }, 400);
    }

    const passwordHash = await hashPassword(password);
    await resetUserPassword(userId, passwordHash);
    return authJson({ ok: true }, 200);
  } catch {
    return authJson({ error: "Could not reset password" }, 500);
  }
}
