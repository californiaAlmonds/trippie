import type { TripMode } from "@/lib/search";
import type { Cabin } from "@/lib/types";

export interface Query {
  origin: string;
  destination: string;
  month: string;
  trip: TripMode;
  minGap: number;
  maxGap: number;
  cabin?: Cabin;
}

const RECENT_KEY = "trippie.recent";
const listeners = new Set<() => void>();

export const subscribeRecent = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

export const readRecent = () => localStorage.getItem(RECENT_KEY) ?? "[]";

export const serverSnapshotRecent = () => "[]";

function normalizeQuery(q: Query): Query & { cabin: Cabin } {
  return {
    origin: q.origin,
    destination: q.destination,
    month: q.month,
    trip: q.trip ?? "round",
    minGap: q.minGap,
    maxGap: q.maxGap,
    cabin: q.cabin === "business" ? "business" : "economy",
  };
}

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
        (q.cabin === undefined || q.cabin === "economy" || q.cabin === "business") &&
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
          cabin: q.cabin === "business" ? "business" : "economy",
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function pushRecent(q: Query) {
  const norm = normalizeQuery(q);
  const same = (r: Query) =>
    JSON.stringify(normalizeQuery(r)) === JSON.stringify(norm);
  const next = [norm, ...parseRecent(readRecent()).filter((r) => !same(r))].slice(0, 5);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

export function clearRecent() {
  localStorage.removeItem(RECENT_KEY);
  listeners.forEach((l) => l());
}

