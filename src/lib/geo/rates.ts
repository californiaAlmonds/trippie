import { SUPPORTED_CURRENCIES } from "./currency.ts";

export interface RatesPayload {
  base: "INR";
  date: string;
  rates: Record<string, number>;
  attribution: {
    text: string;
    url: string;
  };
}

export const PRIMARY_RATES_URL = "https://open.er-api.com/v6/latest/INR";
export const FALLBACK_RATES_URL = "https://api.frankfurter.app/latest?from=INR";

export const PRIMARY_ATTRIBUTION = {
  text: "Rates By Exchange Rate API",
  url: "https://www.exchangerate-api.com",
} as const;

export const FALLBACK_ATTRIBUTION = {
  text: "Rates by European Central Bank (via Frankfurter)",
  url: "https://www.frankfurter.app",
} as const;

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const FETCH_TIMEOUT_MS = 10_000; // 10 seconds

const SUPPORTED_CODES = new Set(SUPPORTED_CURRENCIES.map((c) => c.code));

let cachedEntry: {
  at: number;
  payload: RatesPayload;
  fetchRef: typeof fetch | undefined;
} | null = null;

let lastGoodPayload: RatesPayload | null = null;

function clonePayload(p: RatesPayload): RatesPayload {
  return {
    base: "INR",
    date: p.date,
    rates: { ...p.rates },
    attribution: { ...p.attribution },
  };
}

/** Resets the in-memory rates cache and last-good fallback (for unit tests). */
export function resetRatesCache(options?: { keepLastGood?: boolean }): void {
  cachedEntry = null;
  if (!options?.keepLastGood) {
    lastGoodPayload = null;
  }
}

function parseIsoDate(raw: unknown): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const parsedMs = Date.parse(trimmed);
    if (Number.isFinite(parsedMs)) {
      return new Date(parsedMs).toISOString().slice(0, 10);
    }
  }
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return null;
}

function filterSupportedRates(
  rawRates: Record<string, unknown>,
  fallbackRates?: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};

  if (fallbackRates) {
    for (const [k, v] of Object.entries(fallbackRates)) {
      if (SUPPORTED_CODES.has(k) && typeof v === "number" && Number.isFinite(v) && v > 0) {
        out[k] = v;
      }
    }
  }

  for (const [rawKey, rawVal] of Object.entries(rawRates)) {
    const code = rawKey.trim().toUpperCase();
    if (!SUPPORTED_CODES.has(code)) continue;
    const num = typeof rawVal === "number" ? rawVal : Number(rawVal);
    if (Number.isFinite(num) && num > 0) {
      out[code] = num;
    }
  }

  out.INR = 1;
  return out;
}

async function fetchJsonWithTimeout(
  url: string,
  fetchFn: typeof fetch,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    const data: unknown = await res.json();
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new Error(`Invalid JSON object from ${url}`);
    }
    return data as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPrimary(fetchFn: typeof fetch): Promise<RatesPayload> {
  const data = await fetchJsonWithTimeout(PRIMARY_RATES_URL, fetchFn);
  if (data.result !== undefined && data.result !== "success") {
    throw new Error(`ExchangeRate-API returned result=${String(data.result)}`);
  }
  const rawRates = data.rates;
  if (typeof rawRates !== "object" || rawRates === null || Array.isArray(rawRates)) {
    throw new Error("ExchangeRate-API response missing rates object");
  }

  const rates = filterSupportedRates(rawRates as Record<string, unknown>, lastGoodPayload?.rates);
  if (Object.keys(rates).length < 2) {
    throw new Error("ExchangeRate-API returned no supported exchange rates");
  }

  const date =
    parseIsoDate(data.date) ??
    parseIsoDate(data.time_last_update_unix) ??
    parseIsoDate(data.time_last_update_utc) ??
    new Date().toISOString().slice(0, 10);

  return {
    base: "INR",
    date,
    rates,
    attribution: { ...PRIMARY_ATTRIBUTION },
  };
}

async function fetchFallback(fetchFn: typeof fetch): Promise<RatesPayload> {
  const data = await fetchJsonWithTimeout(FALLBACK_RATES_URL, fetchFn);
  const rawRates = data.rates;
  if (typeof rawRates !== "object" || rawRates === null || Array.isArray(rawRates)) {
    throw new Error("Frankfurter response missing rates object");
  }

  // Fill any missing currencies from lastGoodPayload if available
  const rates = filterSupportedRates(rawRates as Record<string, unknown>, lastGoodPayload?.rates);
  if (Object.keys(rates).length < 2) {
    throw new Error("Frankfurter returned no supported exchange rates");
  }

  const date =
    parseIsoDate(data.date) ??
    lastGoodPayload?.date ??
    new Date().toISOString().slice(0, 10);

  return {
    base: "INR",
    date,
    rates,
    attribution: { ...FALLBACK_ATTRIBUTION },
  };
}

/**
 * Fetches daily INR exchange rates for `SUPPORTED_CURRENCIES` with a 12h in-memory cache,
 * primary (open.er-api.com) -> fallback (api.frankfurter.app, filling missing currencies from
 * last-good) -> last-good cache fallback. Never throws if a last-good result exists.
 */
export async function getRates(fetchImpl?: typeof fetch): Promise<RatesPayload> {
  const now = Date.now();
  if (
    cachedEntry &&
    now - cachedEntry.at < CACHE_TTL_MS &&
    cachedEntry.fetchRef === fetchImpl
  ) {
    return clonePayload(cachedEntry.payload);
  }

  const fetchFn = fetchImpl ?? fetch;

  try {
    const primary = await fetchPrimary(fetchFn);
    cachedEntry = { at: Date.now(), payload: primary, fetchRef: fetchImpl };
    lastGoodPayload = clonePayload(primary);
    return clonePayload(primary);
  } catch (primaryErr) {
    try {
      const fallback = await fetchFallback(fetchFn);
      cachedEntry = { at: Date.now(), payload: fallback, fetchRef: fetchImpl };
      lastGoodPayload = clonePayload(fallback);
      return clonePayload(fallback);
    } catch {
      if (lastGoodPayload) {
        return clonePayload(lastGoodPayload);
      }
      throw primaryErr;
    }
  }
}
