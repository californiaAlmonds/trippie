import type { NextRequest } from "next/server";
import { parseSearch } from "@/lib/search";
import { getBestWindowHistory, getWindowHistory } from "@/lib/store";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

// ?depart=&return= for one specific window; otherwise the best window in the month per snapshot day.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const params = parseSearch(sp);
  if ("error" in params) return Response.json({ error: params.error }, { status: 400 });
  if (params.trip !== "round") return Response.json({ error: "History is only available for round trips" }, { status: 400 });
  const depart = sp.get("depart");
  const ret = sp.get("return");
  if (depart && ret) {
    if (!isoDate.test(depart) || !isoDate.test(ret)) return Response.json({ error: "Invalid date" }, { status: 400 });
    return Response.json(await getWindowHistory(params.origin, params.destination, depart, ret));
  }
  return Response.json(
    await getBestWindowHistory(params.origin, params.destination, params.month, params.minGap, params.maxGap),
  );
}
