import { authJson, authNoContent, checkOrigin, readJson } from "@/lib/auth/guard";
import { destroySession, getSessionUser } from "@/lib/auth/session";
import { unregisterDeviceOnLogout } from "@/lib/push/devices";

export async function POST(request: Request) {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  let deviceToken: unknown;
  const body = await readJson<Record<string, unknown>>(request, 16384, { allowEmpty: true });
  if (body.ok) {
    deviceToken = body.data.deviceToken;
  } else if (body.response.status === 413) {
    return body.response;
  }

  try {
    const user = await getSessionUser();
    await unregisterDeviceOnLogout(user?.id ?? null, deviceToken);
    await destroySession();
    return authNoContent();
  } catch {
    return authJson({ error: "Could not sign out" }, 500);
  }
}
