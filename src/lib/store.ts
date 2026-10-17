import { existsSync, mkdirSync } from "node:fs";
import { type Client, createClient, type InStatement, type ResultSet, type TransactionMode } from "@libsql/client";
import { migrate } from "./migrations.ts";
import type { Cabin, DayFare, PriceStats, RouteFreshness } from "./types.ts";
import { addDays, computeWindows, diffDays, monthBounds } from "./windows.ts";

export type { PriceStats, RouteFreshness } from "./types.ts";

export type FareStatus = "ok" | "no_flights" | "blocked" | "parse_error";

export interface FareRecord {
  day: string; // snapshot day
  origin: string;
  destination: string;
  date: string; // travel date
  cabin?: Cabin;
  price: number | null;
  airline?: string | null;
  stops?: number | null;
  depTime?: string | null;
  arrTime?: string | null;
  arrDayOffset?: number | null;
  durationMin?: number | null;
  flightNo?: string | null;
  aircraft?: string | null;
  status: FareStatus;
  scrapedAt?: string;
}

let ready: Promise<unknown> | undefined;
let rawClient: Client | undefined;
let conn: Db | undefined;
let activeUrl: string | undefined;

/** True when a hosted Turso DB is configured or a local scrape DB file exists. */
export function dbConfigured(): boolean {
  return Boolean(process.env.TURSO_DATABASE_URL) || existsSync("data/trippie.db");
}

interface Db {
  execute(stmt: InStatement): Promise<ResultSet>;
  batch(stmts: InStatement[], mode: TransactionMode): Promise<ResultSet[]>;
}

// Remote libSQL over HTTP occasionally drops an idle keep-alive socket; all our writes are safe to repeat.
const RETRYABLE = /ECONNRESET|socket connection was closed|fetch failed/i;
async function retry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!RETRYABLE.test(String(e))) throw e;
    await new Promise((r) => setTimeout(r, 1_000));
    return fn();
  }
}

async function ensureReady(): Promise<{ client: Client; conn: Db }> {
  const url = process.env.TURSO_DATABASE_URL ?? "file:data/trippie.db";
  if (!rawClient || !conn || !ready || activeUrl !== url) {
    if (url === "file:data/trippie.db") mkdirSync("data", { recursive: true });
    const client = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    rawClient = client;
    activeUrl = url;
    conn = {
      execute: (stmt) => retry(() => client.execute(stmt)),
      batch: (stmts, mode) => retry(() => client.batch(stmts, mode)),
    };
    const initPromise = retry(() => migrate(client)).catch((err) => {
      if (ready === initPromise) {
        ready = undefined;
        rawClient = undefined;
        conn = undefined;
        activeUrl = undefined;
      }
      try {
        client.close();
      } catch {
        // Ignore close errors after failed init
      }
      throw err;
    });
    ready = initPromise;
  }
  await ready;
  return { client: rawClient!, conn: conn! };
}

/** Raw libSQL client (no retry wrapper) after migrations have been applied. */
export async function getClient(): Promise<Client> {
  return (await ensureReady()).client;
}

async function db(): Promise<Db> {
  return (await ensureReady()).conn;
}

export async function saveFares(records: FareRecord[], provider = "google-flights") {
  if (!records.length) return;
  const now = new Date().toISOString();
  await (await db()).batch(
    records.map((r) => ({
      sql: `INSERT OR REPLACE INTO fares
            (snapshot_day, origin, destination, travel_date, cabin, price, airline, stops,
             dep_time, arr_time, arr_day_offset, duration_min, flight_no, aircraft,
             status, provider, scraped_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        r.day,
        r.origin,
        r.destination,
        r.date,
        r.cabin ?? "economy",
        r.price,
        r.airline ?? null,
        r.stops ?? null,
        r.depTime ?? null,
        r.arrTime ?? null,
        r.arrDayOffset ?? null,
        r.durationMin ?? null,
        r.flightNo ?? null,
        r.aircraft ?? null,
        r.status,
        provider,
        r.scrapedAt ?? now,
      ],
    })),
    "write",
  );
}

export interface DoneDatesOptions {
  refreshAgeHours?: number;
  now?: Date | number;
  minScrapedAt?: string;
}

/**
 * Travel dates already scraped today, so a re-run resumes instead of repeating.
 * When `refreshAgeHours` (or `minScrapedAt`) is provided, only dates whose scrape is newer than
 * the cutoff are considered done, allowing older scrapes from earlier the same UTC day to be refreshed.
 */
export async function doneDates(
  day: string,
  origin: string,
  destination: string,
  cabin: Cabin = "economy",
  options?: DoneDatesOptions | number | string,
): Promise<Set<string>> {
  let minScrapedAt: string | undefined;
  if (typeof options === "string") {
    minScrapedAt = options;
  } else if (typeof options === "number" && Number.isFinite(options) && options > 0) {
    minScrapedAt = new Date(Date.now() - options * 3_600_000).toISOString();
  } else if (options && typeof options === "object") {
    if (options.minScrapedAt) {
      minScrapedAt = options.minScrapedAt;
    } else if (
      typeof options.refreshAgeHours === "number" &&
      Number.isFinite(options.refreshAgeHours) &&
      options.refreshAgeHours > 0
    ) {
      const nowMs =
        options.now instanceof Date
          ? options.now.getTime()
          : typeof options.now === "number"
            ? options.now
            : Date.now();
      minScrapedAt = new Date(nowMs - options.refreshAgeHours * 3_600_000).toISOString();
    }
  }

  const rs = minScrapedAt
    ? await (await db()).execute({
        sql: `SELECT travel_date FROM fares
              WHERE snapshot_day = ? AND origin = ? AND destination = ? AND cabin = ?
                AND status IN ('ok','no_flights') AND scraped_at >= ?`,
        args: [day, origin, destination, cabin, minScrapedAt],
      })
    : await (await db()).execute({
        sql: `SELECT travel_date FROM fares
              WHERE snapshot_day = ? AND origin = ? AND destination = ? AND cabin = ? AND status IN ('ok','no_flights')`,
        args: [day, origin, destination, cabin],
      });
  return new Set(rs.rows.map((r) => String(r.travel_date)));
}

export async function startRun(): Promise<number> {
  const rs = await (await db()).execute({
    sql: "INSERT INTO runs (started_at) VALUES (?)",
    args: [new Date().toISOString()],
  });
  return Number(rs.lastInsertRowid);
}

export async function finishRun(id: number, ok: number, failed: number, note: string) {
  await (await db()).execute({
    sql: "UPDATE runs SET finished_at = ?, ok = ?, failed = ?, note = ? WHERE id = ?",
    args: [new Date().toISOString(), ok, failed, note, id],
  });
}

function rowToDayFare(r: Record<string, unknown>): DayFare {
  const fare: DayFare = {
    date: String(r.date),
    price: Number(r.price),
    source: "google",
    airline: r.airline ? String(r.airline) : undefined,
    stops: r.stops == null ? undefined : Number(r.stops),
  };
  if (r.dep_time != null) fare.depTime = String(r.dep_time);
  if (r.arr_time != null) fare.arrTime = String(r.arr_time);
  if (r.arr_day_offset != null && Number(r.arr_day_offset) > 0) fare.arrDayOffset = Number(r.arr_day_offset);
  if (r.duration_min != null) fare.durationMin = Number(r.duration_min);
  if (r.flight_no != null) fare.flightNo = String(r.flight_no);
  if (r.aircraft != null) fare.aircraft = String(r.aircraft);
  if (r.scraped_at != null) fare.checkedAt = String(r.scraped_at);
  return fare;
}

/** Most recent successful fare per travel date. */
export async function getLatestFares(
  origin: string,
  destination: string,
  from: string,
  to: string,
  cabin: Cabin = "economy",
): Promise<DayFare[]> {
  const rs = await (await db()).execute({
    sql: `SELECT f.travel_date AS date, f.price, f.airline, f.stops,
                 f.dep_time, f.arr_time, f.arr_day_offset, f.duration_min,
                 f.flight_no, f.aircraft, f.scraped_at
          FROM fares f
          WHERE f.origin = ? AND f.destination = ? AND f.cabin = ? AND f.travel_date BETWEEN ? AND ?
            AND f.status = 'ok' AND f.price IS NOT NULL
            AND f.snapshot_day = (SELECT MAX(snapshot_day) FROM fares
                                  WHERE origin = f.origin AND destination = f.destination
                                    AND travel_date = f.travel_date AND cabin = f.cabin AND status = 'ok')
          ORDER BY f.travel_date`,
    args: [origin, destination, cabin, from, to],
  });
  return rs.rows.map((r) => rowToDayFare(r as Record<string, unknown>));
}

/** Most recent status='ok' fare per travel date, included only if its snapshot_day >= minSnapshotDay. */
export async function getFreshFares(
  origin: string,
  destination: string,
  from: string,
  to: string,
  minSnapshotDay: string,
  cabin: Cabin = "economy",
): Promise<DayFare[]> {
  const rs = await (await db()).execute({
    sql: `SELECT f.travel_date AS date, f.price, f.airline, f.stops,
                 f.dep_time, f.arr_time, f.arr_day_offset, f.duration_min,
                 f.flight_no, f.aircraft, f.scraped_at
          FROM fares f
          WHERE f.origin = ? AND f.destination = ? AND f.cabin = ? AND f.travel_date BETWEEN ? AND ?
            AND f.status = 'ok' AND f.price IS NOT NULL
            AND f.snapshot_day >= ?
            AND f.snapshot_day = (SELECT MAX(snapshot_day) FROM fares
                                  WHERE origin = f.origin AND destination = f.destination
                                    AND travel_date = f.travel_date AND cabin = f.cabin AND status = 'ok')
          ORDER BY f.travel_date`,
    args: [origin, destination, cabin, from, to, minSnapshotDay],
  });
  return rs.rows.map((r) => rowToDayFare(r as Record<string, unknown>));
}

export interface HistoryPoint {
  day: string;
  total: number;
}

/** Price over time of one specific depart/return pair. */
export async function getWindowHistory(
  origin: string,
  destination: string,
  depart: string,
  ret: string,
  cabin: Cabin = "economy",
): Promise<HistoryPoint[]> {
  const rs = await (await db()).execute({
    sql: `SELECT o.snapshot_day AS day, o.price + i.price AS total
          FROM fares o JOIN fares i
            ON i.snapshot_day = o.snapshot_day AND i.origin = o.destination AND i.destination = o.origin
           AND i.cabin = o.cabin AND i.travel_date = ? AND i.status = 'ok'
          WHERE o.origin = ? AND o.destination = ? AND o.cabin = ? AND o.travel_date = ? AND o.status = 'ok'
          ORDER BY o.snapshot_day`,
    args: [ret, origin, destination, cabin, depart],
  });
  return rs.rows.map((r) => ({ day: String(r.day), total: Number(r.total) }));
}

/** Cheapest window in the month as seen on each snapshot day. */
export async function getBestWindowHistory(
  origin: string,
  destination: string,
  month: string,
  minGap: number,
  maxGap: number,
  cabin: Cabin = "economy",
): Promise<HistoryPoint[]> {
  const { first, last } = monthBounds(month);
  const database = await db();
  const load = async (o: string, d: string, from: string, to: string) => {
    const rs = await database.execute({
      sql: `SELECT snapshot_day, travel_date AS date, price FROM fares
            WHERE origin = ? AND destination = ? AND cabin = ? AND travel_date BETWEEN ? AND ? AND status = 'ok' AND price IS NOT NULL`,
      args: [o, d, cabin, from, to],
    });
    const byDay = new Map<string, DayFare[]>();
    for (const r of rs.rows) {
      const day = String(r.snapshot_day);
      byDay.set(day, [...(byDay.get(day) ?? []), { date: String(r.date), price: Number(r.price), source: "google" }]);
    }
    return byDay;
  };
  const out = await load(origin, destination, first, last);
  const inn = await load(destination, origin, addDays(first, minGap), addDays(last, maxGap));
  const points: HistoryPoint[] = [];
  for (const [day, o] of [...out].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const best = computeWindows(o, inn.get(day) ?? [], minGap, maxGap)[0];
    if (best) points.push({ day, total: best.total });
  }
  return points;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1] ?? sorted[base];
  return Math.round(sorted[base] + rest * (next - sorted[base]));
}

export function computePriceStats(samples: { day: string; price: number }[]): PriceStats | null {
  if (samples.length === 0) return null;
  const prices = samples.map((s) => s.price).sort((a, b) => a - b);
  let since = samples[0].day;
  for (const s of samples) {
    if (s.day < since) since = s.day;
  }
  return {
    min: prices[0],
    max: prices[prices.length - 1],
    p25: quantile(prices, 0.25),
    median: quantile(prices, 0.5),
    samples: prices.length,
    since,
  };
}

/** Price distribution across all status='ok' scraped fares in [from, to] for a route+cabin. */
export async function getRouteStats(
  origin: string,
  destination: string,
  from: string,
  to: string,
  cabin: Cabin = "economy",
): Promise<PriceStats | null> {
  const rs = await (await db()).execute({
    sql: `SELECT snapshot_day AS day, price FROM fares
          WHERE origin = ? AND destination = ? AND cabin = ? AND travel_date BETWEEN ? AND ?
            AND status = 'ok' AND price IS NOT NULL`,
    args: [origin, destination, cabin, from, to],
  });
  return computePriceStats(rs.rows.map((r) => ({ day: String(r.day), price: Number(r.price) })));
}

/** Price distribution across per-day current (latest snapshot) status='ok' fares in [from, to] for a route+cabin. */
export async function getOneWayStats(
  origin: string,
  destination: string,
  from: string,
  to: string,
  cabin: Cabin = "economy",
): Promise<PriceStats | null> {
  const rs = await (await db()).execute({
    sql: `SELECT f.snapshot_day AS day, f.price
          FROM fares f
          WHERE f.origin = ? AND f.destination = ? AND f.cabin = ? AND f.travel_date BETWEEN ? AND ?
            AND f.status = 'ok' AND f.price IS NOT NULL
            AND f.snapshot_day = (SELECT MAX(snapshot_day) FROM fares
                                  WHERE origin = f.origin AND destination = f.destination
                                    AND travel_date = f.travel_date AND cabin = f.cabin
                                    AND status = 'ok' AND price IS NOT NULL)
          ORDER BY f.travel_date`,
    args: [origin, destination, cabin, from, to],
  });
  return computePriceStats(rs.rows.map((r) => ({ day: String(r.day), price: Number(r.price) })));
}

/** Price distribution over snapshot days of the best round-trip window total that day. */
export async function getBestWindowStats(
  origin: string,
  destination: string,
  month: string,
  minGap: number,
  maxGap: number,
  cabin: Cabin = "economy",
): Promise<PriceStats | null> {
  const points = await getBestWindowHistory(origin, destination, month, minGap, maxGap, cabin);
  return computePriceStats(points.map((p) => ({ day: p.day, price: p.total })));
}

export interface FreshnessRouteParams {
  origin: string;
  destination: string;
  month: string;
  trip: "round" | "oneway";
  minGap: number;
  maxGap: number;
  cabin: Cabin;
}

export const FRESH_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const FRESH_COVERAGE_THRESHOLD = 0.6; // 60% per-leg fresh date coverage
const COLLECTING_WINDOW_MS = 30 * 60 * 1000;

export async function computeLegFreshness(
  origin: string,
  destination: string,
  cabin: string,
  from: string,
  to: string,
  freshCutoffIso: string,
): Promise<{ covered: boolean; newestScrapedAt: string | null }> {
  const expectedDates = diffDays(from, to) + 1;
  if (expectedDates <= 0) {
    return { covered: false, newestScrapedAt: null };
  }
  const database = await db();
  const rs = await database.execute({
    sql: `SELECT COUNT(DISTINCT travel_date) AS fresh_days, MAX(scraped_at) AS newest
          FROM fares
          WHERE origin = ? AND destination = ? AND cabin = ?
            AND travel_date BETWEEN ? AND ?
            AND status = 'ok' AND price IS NOT NULL
            AND scraped_at > ?`,
    args: [origin, destination, cabin, from, to, freshCutoffIso],
  });
  const freshDays = Number(rs.rows[0]?.fresh_days ?? 0);
  const newest = rs.rows[0]?.newest != null ? String(rs.rows[0].newest) : null;
  return {
    covered: freshDays / expectedDates >= FRESH_COVERAGE_THRESHOLD,
    newestScrapedAt: newest,
  };
}

export async function computeRouteFreshnessCoverage(
  route: FreshnessRouteParams,
  nowMs = Date.now(),
): Promise<{ covered: boolean; faresFreshAt: string | null }> {
  const { first, last } = monthBounds(route.month);
  const freshCutoffIso = new Date(nowMs - FRESH_TTL_MS).toISOString();
  const outFresh = await computeLegFreshness(
    route.origin,
    route.destination,
    route.cabin,
    first,
    last,
    freshCutoffIso,
  );
  if (route.trip === "oneway") {
    return {
      covered: outFresh.covered,
      faresFreshAt: outFresh.covered ? outFresh.newestScrapedAt : null,
    };
  }
  const inFrom = addDays(first, route.minGap);
  const inTo = addDays(last, route.maxGap);
  const inFresh = await computeLegFreshness(
    route.destination,
    route.origin,
    route.cabin,
    inFrom,
    inTo,
    freshCutoffIso,
  );
  if (outFresh.covered && inFresh.covered && outFresh.newestScrapedAt && inFresh.newestScrapedAt) {
    return {
      covered: true,
      faresFreshAt:
        outFresh.newestScrapedAt < inFresh.newestScrapedAt
          ? outFresh.newestScrapedAt
          : inFresh.newestScrapedAt,
    };
  }
  return { covered: false, faresFreshAt: null };
}

/** Returns lastCheckedAt (newest scraped_at for this route+cabin+range), tracked, collecting, and per-leg covered flags. */
export async function getFreshness(
  routeOrOrigin: FreshnessRouteParams | string,
  destinationOrNow?: string | number | Date,
  month?: string,
  trip: "round" | "oneway" = "round",
  minGap = 0,
  maxGap = 0,
  cabin: Cabin = "economy",
  nowArg?: number | Date,
): Promise<RouteFreshness> {
  let p: FreshnessRouteParams;
  let nowMs: number;
  if (typeof routeOrOrigin === "object") {
    p = routeOrOrigin;
    nowMs =
      destinationOrNow instanceof Date
        ? destinationOrNow.getTime()
        : typeof destinationOrNow === "number"
          ? destinationOrNow
          : Date.now();
  } else {
    p = {
      origin: routeOrOrigin,
      destination: String(destinationOrNow ?? ""),
      month: String(month ?? ""),
      trip,
      minGap,
      maxGap,
      cabin,
    };
    nowMs = nowArg instanceof Date ? nowArg.getTime() : typeof nowArg === "number" ? nowArg : Date.now();
  }

  const { first, last } = monthBounds(p.month);
  const database = await db();
  const inFrom = addDays(first, p.minGap);
  const inTo = addDays(last, p.maxGap);

  const [fareRs, trackRs, coverage] = await Promise.all([
    database.execute({
      sql: `SELECT MAX(scraped_at) AS newest FROM fares
            WHERE cabin = ? AND status = 'ok' AND price IS NOT NULL
              AND ((origin = ? AND destination = ? AND travel_date BETWEEN ? AND ?)
                OR (? = 'round' AND origin = ? AND destination = ? AND travel_date BETWEEN ? AND ?))`,
      args: [p.cabin, p.origin, p.destination, first, last, p.trip, p.destination, p.origin, inFrom, inTo],
    }),
    database.execute({
      sql: `SELECT last_dispatched_at, last_scraped_at FROM tracked_routes
            WHERE origin = ? AND destination = ? AND month = ? AND trip = ?
              AND min_gap = ? AND max_gap = ? AND cabin = ?`,
      args: [p.origin, p.destination, p.month, p.trip, p.minGap, p.maxGap, p.cabin],
    }),
    computeRouteFreshnessCoverage(p, nowMs),
  ]);

  const newest = fareRs.rows[0]?.newest;
  const lastCheckedAt = newest != null ? String(newest) : null;
  const tr = trackRs.rows[0];
  const tracked = Boolean(tr);
  let collecting = false;
  if (tr && tr.last_dispatched_at != null) {
    const dispIso = String(tr.last_dispatched_at);
    const dispMs = Date.parse(dispIso);
    const scrapedIso = tr.last_scraped_at != null ? String(tr.last_scraped_at) : null;
    if (
      Number.isFinite(dispMs) &&
      nowMs - dispMs <= COLLECTING_WINDOW_MS &&
      (scrapedIso === null || scrapedIso < dispIso)
    ) {
      collecting = true;
    }
  }

  return {
    lastCheckedAt,
    tracked,
    collecting,
    covered: coverage.covered,
  };
}


