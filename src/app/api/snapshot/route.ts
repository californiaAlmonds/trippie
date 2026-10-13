import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getProvider } from "@/lib/providers";
import { parseSearch } from "@/lib/search";
import { saveSnapshot } from "@/lib/store";
import { addDays, monthBounds } from "@/lib/windows";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("x-cron-secret") ?? "";
  if (!secret || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

// Records today's fares for a route+month; call daily from a scheduler to build price history.
export async function POST(request: NextRequest) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = parseSearch(request.nextUrl.searchParams);
  if ("error" in params) return Response.json({ error: params.error }, { status: 400 });

  const provider = getProvider();
  if (provider.isDemo) return Response.json({ error: "Refusing to store demo data" }, { status: 409 });

  const { origin, destination, month, minGap, maxGap } = params;
  const { first, last } = monthBounds(month);
  const today = new Date().toISOString().slice(0, 10);
  const [out, inn] = await Promise.all([
    provider.getOneWayFares(origin, destination, first, last),
    provider.getOneWayFares(destination, origin, addDays(first, minGap), addDays(last, maxGap)),
  ]);
  saveSnapshot(today, origin, destination, provider.name, out);
  saveSnapshot(today, destination, origin, provider.name, inn);
  return Response.json({ stored: out.length + inn.length });
}
