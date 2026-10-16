import { getProvider } from "./providers/index.ts";
import type { DayFare, TripWindow } from "./types.ts";
import { addDays, computeWindows, monthBounds } from "./windows.ts";

export type TripMode = "round" | "oneway";

export interface SearchParams {
  origin: string;
  destination: string;
  month: string;
  trip: TripMode;
  minGap: number;
  maxGap: number;
}

export interface SearchResult {
  provider: string;
  isDemo: boolean;
  trip: TripMode;
  windows: TripWindow[];
  days: DayFare[];
  /** Cheapest window (or one-way fare) per departure date, across all dates in the month. */
  calendar: { date: string; total: number; gap?: number }[];
  outbound: DayFare[];
  inbound: DayFare[];
}

export function parseSearch(sp: URLSearchParams): SearchParams | { error: string } {
  const origin = (sp.get("origin") ?? "").toUpperCase();
  const destination = (sp.get("destination") ?? "").toUpperCase();
  const month = sp.get("month") ?? "";
  const trip = sp.get("trip") ?? "round";
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) return { error: "Invalid airport code" };
  if (origin === destination) return { error: "Origin and destination must differ" };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: "month must be YYYY-MM" };
  if (month < new Date().toISOString().slice(0, 7)) return { error: "month is in the past" };
  if (trip !== "round" && trip !== "oneway") return { error: "trip must be round or oneway" };
  if (trip === "oneway") return { origin, destination, month, trip, minGap: 0, maxGap: 0 };
  const minGap = Number(sp.get("minGap"));
  const maxGap = Number(sp.get("maxGap") ?? sp.get("minGap"));
  if (!Number.isInteger(minGap) || !Number.isInteger(maxGap) || minGap < 1 || maxGap > 30 || minGap > maxGap)
    return { error: "gap must be integers with 1 <= minGap <= maxGap <= 30" };
  return { origin, destination, month, trip, minGap, maxGap };
}

const TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; value: SearchResult }>();

export async function runSearch(p: SearchParams, limit = 60): Promise<SearchResult> {
  const provider = getProvider();
  const key = `${provider.name}|${p.trip}|${p.origin}|${p.destination}|${p.month}|${p.minGap}|${p.maxGap}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const { first, last } = monthBounds(p.month);
  const [outbound, inbound] =
    p.trip === "oneway"
      ? [await provider.getOneWayFares(p.origin, p.destination, first, last), [] as DayFare[]]
      : await Promise.all([
          provider.getOneWayFares(p.origin, p.destination, first, last),
          provider.getOneWayFares(p.destination, p.origin, addDays(first, p.minGap), addDays(last, p.maxGap)),
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
    windows: all.slice(0, limit),
    days,
    calendar,
    outbound,
    inbound,
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}
