export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
}

export const SUPPORTED_CURRENCIES: readonly CurrencyInfo[] = [
  { code: "INR", name: "Indian Rupee", symbol: "₹", decimals: 0 },
  { code: "USD", name: "US Dollar", symbol: "$", decimals: 2 },
  { code: "EUR", name: "Euro", symbol: "€", decimals: 2 },
  { code: "GBP", name: "British Pound", symbol: "£", decimals: 2 },
  { code: "AED", name: "UAE Dirham", symbol: "AED", decimals: 2 },
  { code: "SAR", name: "Saudi Riyal", symbol: "SAR", decimals: 2 },
  { code: "QAR", name: "Qatari Riyal", symbol: "QAR", decimals: 2 },
  { code: "KWD", name: "Kuwaiti Dinar", symbol: "KWD", decimals: 3 },
  { code: "OMR", name: "Omani Rial", symbol: "OMR", decimals: 3 },
  { code: "BHD", name: "Bahraini Dinar", symbol: "BHD", decimals: 3 },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", decimals: 2 },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM", decimals: 2 },
  { code: "THB", name: "Thai Baht", symbol: "฿", decimals: 2 },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", decimals: 2 },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$", decimals: 2 },
  { code: "CAD", name: "Canadian Dollar", symbol: "CA$", decimals: 2 },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", decimals: 0 },
  { code: "CNY", name: "Chinese Yuan", symbol: "CN¥", decimals: 2 },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$", decimals: 2 },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF", decimals: 2 },
  { code: "LKR", name: "Sri Lankan Rupee", symbol: "LKR", decimals: 2 },
  { code: "NPR", name: "Nepalese Rupee", symbol: "NPR", decimals: 2 },
  { code: "BDT", name: "Bangladeshi Taka", symbol: "৳", decimals: 2 },
  { code: "ZAR", name: "South African Rand", symbol: "R", decimals: 2 },
] as const;

const CURRENCY_BY_CODE = new Map<string, CurrencyInfo>(
  SUPPORTED_CURRENCIES.map((c) => [c.code, c]),
);

const COUNTRY_TO_CURRENCY: Readonly<Record<string, string>> = {
  // South Asia
  IN: "INR",
  LK: "LKR",
  NP: "NPR",
  BD: "BDT",

  // Americas & US Dollar territories
  US: "USD",
  PR: "USD",
  GU: "USD",
  VI: "USD",
  AS: "USD",
  MP: "USD",
  EC: "USD",
  SV: "USD",
  PA: "USD",
  TL: "USD",
  CA: "CAD",

  // United Kingdom & Crown dependencies
  GB: "GBP",
  UK: "GBP",
  IM: "GBP",
  JE: "GBP",
  GG: "GBP",
  GI: "GBP",

  // Eurozone & Euro-using territories
  DE: "EUR",
  FR: "EUR",
  IT: "EUR",
  ES: "EUR",
  NL: "EUR",
  BE: "EUR",
  AT: "EUR",
  PT: "EUR",
  IE: "EUR",
  FI: "EUR",
  GR: "EUR",
  LU: "EUR",
  SI: "EUR",
  CY: "EUR",
  MT: "EUR",
  SK: "EUR",
  EE: "EUR",
  LV: "EUR",
  LT: "EUR",
  HR: "EUR",
  AD: "EUR",
  MC: "EUR",
  SM: "EUR",
  VA: "EUR",
  ME: "EUR",
  XK: "EUR",
  RE: "EUR",
  GP: "EUR",
  MQ: "EUR",
  GF: "EUR",
  YT: "EUR",
  PM: "EUR",
  BL: "EUR",
  MF: "EUR",
  AX: "EUR",

  // Switzerland & Liechtenstein
  CH: "CHF",
  LI: "CHF",

  // Gulf / Middle East
  AE: "AED",
  SA: "SAR",
  QA: "QAR",
  KW: "KWD",
  OM: "OMR",
  BH: "BHD",

  // Asia-Pacific
  SG: "SGD",
  MY: "MYR",
  TH: "THB",
  AU: "AUD",
  CX: "AUD",
  CC: "AUD",
  NF: "AUD",
  NR: "AUD",
  TV: "AUD",
  KI: "AUD",
  NZ: "NZD",
  CK: "NZD",
  NU: "NZD",
  PN: "NZD",
  TK: "NZD",
  JP: "JPY",
  CN: "CNY",
  HK: "HKD",

  // Southern Africa
  ZA: "ZAR",
  NA: "ZAR",
  LS: "ZAR",
  SZ: "ZAR",
};

/** Checks if `code` is in `SUPPORTED_CURRENCIES` (case-insensitive). */
export function isSupportedCurrency(code: unknown): code is string {
  if (typeof code !== "string") return false;
  return CURRENCY_BY_CODE.has(code.trim().toUpperCase());
}

/** Maps an ISO-3166 alpha-2 country code to a supported currency code, or `null` if unmapped. */
export function countryToCurrency(iso2: string | null | undefined): string | null {
  if (typeof iso2 !== "string") return null;
  const code = iso2.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const cur = COUNTRY_TO_CURRENCY[code];
  return cur && CURRENCY_BY_CODE.has(cur) ? cur : null;
}

/** Extracts 2-letter region subtags from an HTTP `Accept-Language` header in priority order. */
export function parseAcceptLanguageRegions(acceptLanguage: string | null | undefined): string[] {
  if (typeof acceptLanguage !== "string" || !acceptLanguage.trim()) return [];

  const parsed: Array<{ region: string; q: number; idx: number }> = [];
  const parts = acceptLanguage.split(",");

  for (let i = 0; i < parts.length; i++) {
    const rawPart = parts[i]!.trim();
    if (!rawPart) continue;
    const segments = rawPart.split(";");
    const tag = segments[0]?.trim() ?? "";
    if (!tag || tag === "*") continue;

    let q = 1;
    for (let j = 1; j < segments.length; j++) {
      const param = segments[j]!.trim();
      if (param.startsWith("q=")) {
        const val = Number(param.slice(2));
        if (Number.isFinite(val) && val >= 0 && val <= 1) {
          q = val;
        } else {
          q = 0;
        }
      }
    }
    if (q <= 0) continue;

    // BCP 47 tag: language[-script][-region]... e.g. en-IN, zh-Hant-HK, de_DE
    const subtags = tag.split(/[-_]/);
    for (let s = 1; s < subtags.length; s++) {
      const sub = subtags[s]!;
      if (/^[A-Za-z]{2}$/.test(sub)) {
        parsed.push({ region: sub.toUpperCase(), q, idx: i });
        break;
      }
    }
  }

  parsed.sort((a, b) => (b.q !== a.q ? b.q - a.q : a.idx - b.idx));
  return parsed.map((p) => p.region);
}

/**
 * Picks a supported currency from an ISO-3166 country code, falling back to `Accept-Language`
 * region tags, and finally `'USD'`.
 */
export function pickCurrency(input: {
  country?: string | null;
  acceptLanguage?: string | null;
}): string {
  const fromCountry = countryToCurrency(input.country);
  if (fromCountry) return fromCountry;

  const regions = parseAcceptLanguageRegions(input.acceptLanguage);
  for (const region of regions) {
    const cur = countryToCurrency(region);
    if (cur) return cur;
  }

  return "USD";
}

/** Converts an amount in INR into `currency` using a `rates` map (`1 INR = rates[CUR]`). */
export function convertFromInr(
  amountInr: number,
  currency: string,
  rates: Record<string, number>,
): number {
  if (!Number.isFinite(amountInr)) return 0;
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "INR";
  if (code === "INR") return amountInr;
  const rate = rates[code] ?? rates[currency];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    return amountInr;
  }
  return amountInr * rate;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

/**
 * Formats a monetary amount using `Intl.NumberFormat` (with `en-IN` grouping for INR by default,
 * and currency-specific fraction digits).
 */
export function formatMoney(amount: number, currency: string, locale?: string): string {
  const rawCode = typeof currency === "string" ? currency.trim().toUpperCase() : "INR";
  const info = CURRENCY_BY_CODE.get(rawCode);
  const code = info ? info.code : /^[A-Z]{3}$/.test(rawCode) ? rawCode : "INR";
  const decimals = info ? info.decimals : code === "INR" || code === "JPY" ? 0 : 2;
  const resolvedLocale = locale?.trim() || (code === "INR" ? "en-IN" : "en-US");

  const key = `${resolvedLocale}|${code}|${decimals}`;
  let fmt = formatterCache.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(resolvedLocale, {
        style: "currency",
        currency: code,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    } catch {
      fmt = new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
    }
    formatterCache.set(key, fmt);
  }

  return fmt.format(Number.isFinite(amount) ? amount : 0);
}
