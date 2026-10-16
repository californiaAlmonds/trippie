import { authJson, authNoContent, checkOrigin, readJson } from "@/lib/auth/guard";
import { getSessionUser } from "@/lib/auth/session";
import { clearRecentSearches, listRecentSearches, upsertRecentSearch } from "@/lib/plans";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return authJson({ error: "Sign in required" }, 401);
  }

  try {
    const recent = await listRecentSearches(user.id);
    return authJson({ recent }, 200);
  } catch {
    return authJson({ error: "Could not load recent searches" }, 500);
  }
}

export async function POST(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const body = await readJson<Record<string, unknown>>(request);
  if (!body.ok) return body.response;

  const user = await getSessionUser();
  if (!user) {
    return authJson({ error: "Sign in required" }, 401);
  }

  try {
    const res = await upsertRecentSearch(user.id, body.data);
    if (!res.ok) {
      return authJson({ error: res.error }, 400);
    }
    return authNoContent();
  } catch {
    return authJson({ error: "Could not save recent search" }, 500);
  }
}

export async function DELETE(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const user = await getSessionUser();
  if (!user) {
    return authJson({ error: "Sign in required" }, 401);
  }

  try {
    await clearRecentSearches(user.id);
    return authNoContent();
  } catch {
    return authJson({ error: "Could not clear recent searches" }, 500);
  }
}
