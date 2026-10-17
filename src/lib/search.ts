import { isKnownAirport } from "./geo/airports.ts";
import { getProvider } from "./providers/index.ts";
import { dbConfigured, getBestWindowStats, getFreshness, getOneWayStats, getRouteStats } from "./store.ts";
import type { Cabin, DayFare, PriceStats, RouteFreshness, TripWindow } from "./types.ts";
import { addDays, computeWindows, monthBounds } from "./windows.ts";

export type TripMode = "round" | "oneway";

export const MAX_FUTURE_MONTHS = 12;

export function maxAllowedMonth(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + MAX_FUTURE_MONTHS, 1));
  return d.toISOString().slice(0, 7);
}

export interface SearchParams {
  origin: string;
  destination: string;
  month: string;
  trip: TripMode;
  minGap: number;
  maxGap: number;
  cabin: Cabin;
}

export interface SearchResult {
  provider: string;
  isDemo: boolean;
  trip: TripMode;
  cabin: Cabin;
  windows: TripWindow[];
  days: DayFare[];
  /** Cheapest window (or one-way fare) per departure date, across all dates in the month. */
  calendar: { date: string; total: number; gap?: number }[];
  outbound: DayFare[];
  inbound: DayFare[];
  stats: {
    outbound: PriceStats | null;
    inbound: PriceStats | null;
    total: PriceStats | null;
  };
  freshness: RouteFreshness;
}

export function parseSearch(sp: URLSearchParams, now = new Date()): SearchParams | { error: string } {
  const origin = (sp.get("origin") ?? "").toUpperCase();
  const destination = (sp.get("destination") ?? "").toUpperCase();
  const month = sp.get("month") ?? "";
  const trip = sp.get("trip") ?? "round";
  const cabin = sp.get("cabin") ?? "economy";
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) return { error: "Invalid airport code" };
  if (!isKnownAirport(origin) || !isKnownAirport(destination)) return { error: "Unknown airport" };
  if (origin === destination) return { error: "Origin and destination must differ" };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: "month must be YYYY-MM" };
  const currentMonth = now.toISOString().slice(0, 7);
  if (month < currentMonth) return { error: "month is in the past" };
  if (month > maxAllowedMonth(now)) return { error: "month is more than 12 months ahead" };
  if (trip !== "round" && trip !== "oneway") return { error: "trip must be round or oneway" };
  if (cabin !== "economy" && cabin !== "business") return { error: "cabin must be economy or business" };
  if (trip === "oneway") return { origin, destination, month, trip, minGap: 0, maxGap: 0, cabin };
  const minGap = Number(sp.get("minGap"));
  const maxGap = Number(sp.get("maxGap") ?? sp.get("minGap"));
  if (!Number.isInteger(minGap) || !Number.isInteger(maxGap) || minGap < 1 || maxGap > 30 || minGap > maxGap)
    return { error: "gap must be integers with 1 <= minGap <= maxGap <= 30" };
  return { origin, destination, month, trip, minGap, maxGap, cabin };
}

const TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; value: SearchResult }>();

export async function runSearch(p: SearchParams, limit = 60): Promise<SearchResult> {
  const provider = getProvider();
  const { first, last } = monthBounds(p.month);
  const inFrom = addDays(first, p.minGap);
  const inTo = addDays(last, p.maxGap);

  const hasDb = dbConfigured();
  const [freshness, stats] = hasDb
    ? await Promise.all([
        getFreshness(p),
        (async () => {
          if (p.trip === "oneway") {
            const outStats = await getOneWayStats(p.origin, p.destination, first, last, p.cabin);
            return { outbound: outStats, inbound: null, total: outStats };
          }
          const [outStats, inStats, totalStats] = await Promise.all([
            getRouteStats(p.origin, p.destination, first, last, p.cabin),
            getRouteStats(p.destination, p.origin, inFrom, inTo, p.cabin),
            getBestWindowStats(p.origin, p.destination, p.month, p.minGap, p.maxGap, p.cabin),
          ]);
          return { outbound: outStats, inbound: inStats, total: totalStats };
        })(),
      ])
    : [
        { lastCheckedAt: null, tracked: false, collecting: false } satisfies RouteFreshness,
        { outbound: null, inbound: null, total: null },
      ];

  const dbUrl = process.env.TURSO_DATABASE_URL ?? "";
  const key = `${dbUrl}|${provider.name}|${p.trip}|${p.cabin}|${p.origin}|${p.destination}|${p.month}|${p.minGap}|${p.maxGap}|${freshness.lastCheckedAt ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return { ...hit.value, stats, freshness };
  }

  const [outbound, inbound] =
    p.trip === "oneway"
      ? [await provider.getOneWayFares(p.origin, p.destination, first, last, p.cabin), [] as DayFare[]]
      : await Promise.all([
          provider.getOneWayFares(p.origin, p.destination, first, last, p.cabin),
          provider.getOneWayFares(p.destination, p.origin, inFrom, inTo, p.cabin),
        ]);
  const days = [...outbound].sort((a, b) => a.price - b.price || (a.date < b.date ? -1 : 1)).slice(0, limit);
  const all = p.trip === "oneway" ? [] : computeWindows(outbound, inbound, p.minGap, p.maxGap);
  const cheapestByDate = new Map<string, TripWindow>();
  for (const w of all) if (!cheapestByDate.has(w.depart.date)) cheapestByDate.set(w.depart.date, w);
  const calendar =
    p.trip === "oneway"
      ? outbound.map((d) => ({ date: d.date, total: d.price })).sort((a, b) => (a.date < b.date ? -1 : 1))
      : [...cheapestByDate.values()]
          .map((w) => ({ date: w.depart.date, total: w.total, gap: w.gap }))
          .sort((a, b) => (a.date < b.date ? -1 : 1));
  const value: SearchResult = {
    provider: provider.name,
    isDemo: provider.isDemo,
    trip: p.trip,
    cabin: p.cabin,
    windows: all.slice(0, limit),
    days,
    calendar,
    outbound,
    inbound,
    stats,
    freshness,
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

