import { upsertTrackedRoute } from "../routes/track.ts";
import { parseSearch, type SearchParams, type TripMode } from "../search.ts";
import { getClient } from "../store.ts";
import type { Cabin } from "../types.ts";
import { addDays, monthBounds } from "../windows.ts";

export const MAX_ROUTES_PER_RUN = 25;
export const RECENCY_DAYS = 14;

export interface Leg {
  origin: string;
  destination: string;
  cabin: Cabin;
  dates: string[];
}

/** One-way dates to scrape for a route: outbound across the month, return across month + gap spill. */
export function legsFor(p: SearchParams, today: string): Leg[] {
  const { first, last } = monthBounds(p.month);
  const cabin: Cabin = p.cabin ?? "economy";
  const range = (from: string, to: string) => {
    const dates: string[] = [];
    for (let d = from < today ? today : from; d <= to; d = addDays(d, 1)) dates.push(d);
    return dates;
  };
  const out: Leg = { origin: p.origin, destination: p.destination, cabin, dates: range(first, last) };
  if (p.trip === "oneway") return [out];
  return [
    out,
    {
      origin: p.destination,
      destination: p.origin,
      cabin,
      dates: range(addDays(first, p.minGap), addDays(last, p.maxGap)),
    },
  ];
}

/**
 * Deduplicates legs across multiple routes so that each (origin, destination, cabin, date)
 * is scraped at most once per run.
 */
export function dedupeLegs(routes: SearchParams[], today: string): Leg[] {
  const byLegKey = new Map<string, { origin: string; destination: string; cabin: Cabin; dates: Set<string> }>();
  for (const r of routes) {
    for (const leg of legsFor(r, today)) {
      const key = `${leg.origin}|${leg.destination}|${leg.cabin}`;
      let entry = byLegKey.get(key);
      if (!entry) {
        entry = { origin: leg.origin, destination: leg.destination, cabin: leg.cabin, dates: new Set() };
        byLegKey.set(key, entry);
      }
      for (const d of leg.dates) entry.dates.add(d);
    }
  }
  return [...byLegKey.values()].map((e) => ({
    origin: e.origin,
    destination: e.destination,
    cabin: e.cabin,
    dates: [...e.dates].sort(),
  }));
}

export interface SelectRoutesOptions {
  configRoutes?: Record<string, unknown>[];
  alertsOnly?: boolean;
  now?: Date;
}

function validateRouteRecord(raw: Record<string, unknown>, currentMonth: string): SearchParams | "expired" | { error: string } {
  const month = typeof raw.month === "string" ? raw.month : "";
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month < currentMonth) {
    return "expired";
  }
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined && v !== null) sp.set(k, String(v));
  }
  return parseSearch(sp);
}

/**
 * Selects up to 25 active routes to scrape:
 * - Syncs non-expired saved plans into tracked_routes (source='plan').
 * - Upserts non-expired configRoutes (source='config').
 * - Filters out expired months, keeps plan routes and routes requested within 14 days (or alertsOnly).
 * - Orders by most recently requested first, capped at 25.
 */
export async function selectRoutesToScrape(options?: SelectRoutesOptions): Promise<SearchParams[]> {
  const now = options?.now ?? new Date();
  const nowIso = now.toISOString();
  const currentMonth = nowIso.slice(0, 7);
  const cutoffIso = new Date(now.getTime() - RECENCY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const client = await getClient();

  // Sync saved plans into tracked_routes with source='plan'
  await client.execute({
    sql: `INSERT INTO tracked_routes (origin, destination, month, trip, min_gap, max_gap, cabin, source, last_requested_at)
          SELECT origin, destination, month, trip, min_gap, max_gap, cabin, 'plan', MAX(created_at)
          FROM plans
          WHERE month >= ?
          GROUP BY origin, destination, month, trip, min_gap, max_gap, cabin
          ON CONFLICT(origin, destination, month, trip, min_gap, max_gap, cabin)
          DO UPDATE SET
            source = 'plan',
            last_requested_at = CASE
              WHEN excluded.last_requested_at > tracked_routes.last_requested_at THEN excluded.last_requested_at
              ELSE tracked_routes.last_requested_at
            END`,
    args: [currentMonth],
  });

  if (options?.alertsOnly) {
    const rs = await client.execute({
      sql: `SELECT tr.origin, tr.destination, tr.month, tr.trip, tr.min_gap, tr.max_gap, tr.cabin
            FROM tracked_routes tr
            WHERE tr.month >= ?
              AND EXISTS (
                SELECT 1 FROM plans p
                WHERE p.alert_enabled = 1
                  AND p.origin = tr.origin AND p.destination = tr.destination
                  AND p.month = tr.month AND p.trip = tr.trip
                  AND p.min_gap = tr.min_gap AND p.max_gap = tr.max_gap
                  AND p.cabin = tr.cabin
              )
            ORDER BY tr.last_requested_at DESC, tr.origin ASC, tr.destination ASC, tr.month ASC, tr.cabin ASC
            LIMIT ?`,
      args: [currentMonth, MAX_ROUTES_PER_RUN],
    });
    return rs.rows.map((r) => ({
      origin: String(r.origin),
      destination: String(r.destination),
      month: String(r.month),
      trip: String(r.trip) as TripMode,
      minGap: Number(r.min_gap),
      maxGap: Number(r.max_gap),
      cabin: (r.cabin === "business" ? "business" : "economy") as Cabin,
    }));
  }

  for (const raw of options?.configRoutes ?? []) {
    const parsed = validateRouteRecord(raw, currentMonth);
    if (parsed === "expired") continue;
    if ("error" in parsed) throw new Error(`Invalid config route: ${parsed.error}`);
    await upsertTrackedRoute(parsed, "config", nowIso);
  }

  const rs = await client.execute({
    sql: `SELECT tr.origin, tr.destination, tr.month, tr.trip, tr.min_gap, tr.max_gap, tr.cabin
          FROM tracked_routes tr
          WHERE tr.month >= ?
            AND (
              tr.last_requested_at >= ?
              OR tr.source = 'config'
              OR (
                tr.source = 'plan'
                AND (
                  EXISTS (
                    SELECT 1 FROM plans p
                    WHERE p.origin = tr.origin AND p.destination = tr.destination
                      AND p.month = tr.month AND p.trip = tr.trip
                      AND p.min_gap = tr.min_gap AND p.max_gap = tr.max_gap
                      AND p.cabin = tr.cabin
                  )
                  OR NOT EXISTS (SELECT 1 FROM plans)
                )
              )
            )
          ORDER BY tr.last_requested_at DESC, tr.origin ASC, tr.destination ASC, tr.month ASC, tr.cabin ASC
          LIMIT ?`,
    args: [currentMonth, cutoffIso, MAX_ROUTES_PER_RUN],
  });

  return rs.rows.map((r) => ({
    origin: String(r.origin),
    destination: String(r.destination),
    month: String(r.month),
    trip: String(r.trip) as TripMode,
    minGap: Number(r.min_gap),
    maxGap: Number(r.max_gap),
    cabin: (r.cabin === "business" ? "business" : "economy") as Cabin,
  }));
}

