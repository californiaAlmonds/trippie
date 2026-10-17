import type { NextRequest } from "next/server";
import { searchAirports } from "@/lib/geo/airports";

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=86400",
} as const;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const rawQ = sp.get("q") ?? "";
  const q = rawQ.trim();

  if (q.length < 1 || q.length > 64) {
    return Response.json(
      { error: "Query parameter q must be between 1 and 64 characters" },
      { status: 400 },
    );
  }

  const rawLimit = sp.get("limit");
  let limit = 8;
  if (rawLimit !== null && rawLimit.trim() !== "") {
    const parsed = Number(rawLimit);
    if (Number.isFinite(parsed)) {
      limit = Math.max(1, Math.min(20, Math.floor(parsed)));
    }
  }

  const airports = searchAirports(q, limit);
  return Response.json({ airports }, { status: 200, headers: CACHE_HEADERS });
}
