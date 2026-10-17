import { authJson, checkOrigin, clientKey, readJson } from "@/lib/auth/guard";
import { parseTrackBody, trackRoute } from "@/lib/routes/track";

export async function POST(request: Request): Promise<Response> {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;

  const params = parseTrackBody(parsed.data);
  if ("error" in params) {
    return authJson({ error: params.error }, 400);
  }

  try {
    const res = await trackRoute(params, { clientKey: clientKey(request) });
    return authJson(res, 202);
  } catch {
    return authJson({ error: "Failed to dispatch route scrape" }, 502);
  }
}
