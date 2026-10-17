import { getAirport } from "@/lib/geo/airports";

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=86400",
} as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const airport = getAirport(code);
  if (!airport) {
    return Response.json({ error: "Unknown airport" }, { status: 404 });
  }
  return Response.json({ airport }, { status: 200, headers: CACHE_HEADERS });
}
