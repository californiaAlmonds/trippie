import { connection } from "next/server";
import { getRates } from "@/lib/geo/rates";

const RATES_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
} as const;

export async function GET() {
  await connection();
  try {
    const data = await getRates();
    return Response.json(data, { status: 200, headers: RATES_CACHE_HEADERS });
  } catch {
    return Response.json(
      { error: "Could not load exchange rates" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
