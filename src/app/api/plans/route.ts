import { authJson, checkOrigin, readJson } from "@/lib/auth/guard";
import { getSessionUser } from "@/lib/auth/session";
import { createPlan, listPlans } from "@/lib/plans";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return authJson({ error: "Sign in required" }, 401);
  }

  try {
    const plans = await listPlans(user.id);
    return authJson({ plans }, 200);
  } catch {
    return authJson({ error: "Could not load plans" }, 500);
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
    const res = await createPlan(user.id, user.verified, body.data);
    if (!res.ok) {
      return authJson({ error: res.error }, res.status);
    }
    return authJson({ plan: res.plan }, 201);
  } catch {
    return authJson({ error: "Could not save plan" }, 500);
  }
}
