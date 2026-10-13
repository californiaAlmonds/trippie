import type { NextRequest } from "next/server";
import { parseSearch, runSearch } from "@/lib/search";

export async function GET(request: NextRequest) {
  const params = parseSearch(request.nextUrl.searchParams);
  if ("error" in params) return Response.json({ error: params.error }, { status: 400 });
  try {
    return Response.json(await runSearch(params));
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Fare provider failed" }, { status: 502 });
  }
}
