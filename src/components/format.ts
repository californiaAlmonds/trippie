import type { TripMode } from "@/lib/search";

export interface Query {
  origin: string;
  destination: string;
  month: string;
  trip: TripMode;
  minGap: number;
  maxGap: number;
}

export const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

const RECENT_KEY = "trippie.recent";
const listeners = new Set<() => void>();

export const subscribeRecent = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

export const readRecent = () => localStorage.getItem(RECENT_KEY) ?? "[]";

export function parseRecent(raw: string): Query[] {
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const out: Query[] = [];
    for (const q of list) {
      if (
        typeof q?.origin === "string" &&
        typeof q.destination === "string" &&
        typeof q.month === "string" &&
        (q.trip === undefined || q.trip === "round" || q.trip === "oneway") &&
        Number.isInteger(q.minGap) &&
        Number.isInteger(q.maxGap)
      ) {
        out.push({
          origin: q.origin,
          destination: q.destination,
          month: q.month,
          trip: q.trip ?? "round",
          minGap: q.minGap,
          maxGap: q.maxGap,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function pushRecent(q: Query) {
  const same = (r: Query) => JSON.stringify(r) === JSON.stringify(q);
  const next = [q, ...parseRecent(readRecent()).filter((r) => !same(r))].slice(0, 5);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}
