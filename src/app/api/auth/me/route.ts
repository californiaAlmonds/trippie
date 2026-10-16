import { deleteUserAccount, getUserById } from "@/lib/accounts";
import { authJson, checkOrigin, readJson } from "@/lib/auth/guard";
import { verifyPassword } from "@/lib/auth/password";
import { destroySession, getCurrentUser } from "@/lib/auth/session";

export async function GET() {
  try {
    const user = await getCurrentUser();
    return authJson({ user: user ? { id: user.id, email: user.email } : null }, 200);
  } catch {
    return authJson({ user: null }, 200);
  }
}

export async function DELETE(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const body = await readJson<{ password?: unknown }>(request);
  if (!body.ok) return body.response;

  const sessionUser = await getCurrentUser();
  if (!sessionUser) {
    return authJson({ error: "Not authenticated" }, 401);
  }

  const password = body.data.password;
  if (typeof password !== "string" || !password) {
    return authJson({ error: "Invalid password" }, 401);
  }

  try {
    const dbUser = await getUserById(sessionUser.id);
    if (!dbUser) {
      return authJson({ error: "Not authenticated" }, 401);
    }

    const valid = await verifyPassword(password, dbUser.password_hash);
    if (!valid) {
      return authJson({ error: "Invalid password" }, 401);
    }

    await deleteUserAccount(sessionUser.id);
    await destroySession();
    return authJson({ status: "ok" }, 200);
  } catch {
    return authJson({ error: "Could not delete account" }, 500);
  }
}
