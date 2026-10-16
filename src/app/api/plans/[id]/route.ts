import { authJson, authNoContent, checkOrigin, readJson } from "@/lib/auth/guard";
import { getSessionUser } from "@/lib/auth/session";
import { deletePlan, updatePlan } from "@/lib/plans";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const body = await readJson<Record<string, unknown>>(request);
  if (!body.ok) return body.response;

  const user = await getSessionUser();
  if (!user) {
    return authJson({ error: "Sign in required" }, 401);
  }

  const { id } = await params;

  try {
    const res = await updatePlan(user.id, user.verified, id, body.data);
    if (!res.ok) {
      return authJson({ error: res.error }, res.status);
    }
    return authJson({ plan: res.plan }, 200);
  } catch {
    return authJson({ error: "Could not update plan" }, 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const user = await getSessionUser();
  if (!user) {
    return authJson({ error: "Sign in required" }, 401);
  }

  const { id } = await params;

  try {
    const deleted = await deletePlan(user.id, id);
    if (!deleted) {
      return authJson({ error: "Not found" }, 404);
    }
    return authNoContent();
  } catch {
    return authJson({ error: "Could not delete plan" }, 500);
  }
}
