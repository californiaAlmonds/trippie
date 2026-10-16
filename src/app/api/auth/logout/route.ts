import { authJson, authNoContent, checkOrigin, readJson } from "@/lib/auth/guard";
import { destroySession } from "@/lib/auth/session";

export async function POST(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const body = await readJson(request, 16384, { allowEmpty: true });
  if (!body.ok) return body.response;

  try {
    await destroySession();
    return authNoContent();
  } catch {
    return authJson({ error: "Could not sign out" }, 500);
  }
}
