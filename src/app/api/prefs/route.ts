import { authJson, checkOrigin, readJson } from "@/lib/auth/guard";
import { getSessionUser } from "@/lib/auth/session";
import { isSupportedCurrency } from "@/lib/geo/currency";
import { getUserCurrency, setUserCurrency } from "@/lib/prefs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return authJson({ error: "Sign in required" }, 401);
  }

  try {
    const currency = await getUserCurrency(user.id);
    return authJson({ currency }, 200);
  } catch {
    return authJson({ error: "Could not load preferences" }, 500);
  }
}

export async function PUT(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const body = await readJson<Record<string, unknown>>(request);
  if (!body.ok) return body.response;

  const user = await getSessionUser();
  if (!user) {
    return authJson({ error: "Sign in required" }, 401);
  }

  const rawCurrency = body.data.currency;
  const normalized = typeof rawCurrency === "string" ? rawCurrency.trim().toUpperCase() : "";
  if (!isSupportedCurrency(normalized)) {
    return authJson({ error: "Unsupported currency" }, 400);
  }

  try {
    await setUserCurrency(user.id, normalized);
    return authJson({ currency: normalized }, 200);
  } catch {
    return authJson({ error: "Could not save preferences" }, 500);
  }
}
