import { parseAcceptLanguageRegions, pickCurrency } from "@/lib/geo/currency";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

export async function GET(request: Request) {
  const rawVercelCountry = request.headers.get("x-vercel-ip-country")?.trim().toUpperCase() ?? "";
  const acceptLanguage = request.headers.get("accept-language");

  let country: string | null = null;
  if (/^[A-Z]{2}$/.test(rawVercelCountry) && rawVercelCountry !== "XX" && rawVercelCountry !== "T1") {
    country = rawVercelCountry;
  } else {
    const regions = parseAcceptLanguageRegions(acceptLanguage);
    country = regions[0] ?? null;
  }

  const currency = pickCurrency({ country, acceptLanguage });
  return Response.json({ country, currency }, { status: 200, headers: NO_STORE_HEADERS });
}
