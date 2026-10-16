import { existsSync, mkdirSync } from "node:fs";
import { createClient, type InStatement, type ResultSet, type TransactionMode } from "@libsql/client";
import type { DayFare } from "./types.ts";
import { addDays, computeWindows, monthBounds } from "./windows.ts";

export type FareStatus = "ok" | "no_flights" | "blocked" | "parse_error";

export interface FareRecord {
  day: string; // snapshot day
  origin: string;
  destination: string;
  date: string; // travel date
  price: number | null;
  airline?: string | null;
  stops?: number | null;
  status: FareStatus;
}

let ready: Promise<unknown> | undefined;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS fares (
    snapshot_day TEXT NOT NULL,
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    travel_date TEXT NOT NULL,
    price INTEGER,
    airline TEXT,
    stops INTEGER,
    status TEXT NOT NULL CHECK (status IN ('ok','no_flights','blocked','parse_error')),
    provider TEXT NOT NULL,
    scraped_at TEXT NOT NULL,
    PRIMARY KEY (snapshot_day, origin, destination, travel_date)
  );
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    ok INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    note TEXT
  );`;

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

let conn: Db | undefined;

async function db(): Promise<Db> {
  if (!conn) {
    const url = process.env.TURSO_DATABASE_URL ?? "file:data/trippie.db";
    if (url.startsWith("file:")) mkdirSync("data", { recursive: true });
    const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
    conn = {
      execute: (stmt) => retry(() => client.execute(stmt)),
      batch: (stmts, mode) => retry(() => client.batch(stmts, mode)),
    };
    ready = retry(() => client.executeMultiple(SCHEMA));
  }
  await ready;
  return conn;
}

export async function saveFares(records: FareRecord[], provider = "google-flights") {
  if (!records.length) return;
  const now = new Date().toISOString();
  await (await db()).batch(
    records.map((r) => ({
      sql: `INSERT OR REPLACE INTO fares
            (snapshot_day, origin, destination, travel_date, price, airline, stops, status, provider, scraped_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [r.day, r.origin, r.destination, r.date, r.price, r.airline ?? null, r.stops ?? null, r.status, provider, now],
    })),
    "write",
  );
}

/** Travel dates already scraped today, so a re-run resumes instead of repeating. */
export async function doneDates(day: string, origin: string, destination: string): Promise<Set<string>> {
  const rs = await (await db()).execute({
    sql: `SELECT travel_date FROM fares
          WHERE snapshot_day = ? AND origin = ? AND destination = ? AND status IN ('ok','no_flights')`,
    args: [day, origin, destination],
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

/** Most recent successful fare per travel date. */
export async function getLatestFares(origin: string, destination: string, from: string, to: string): Promise<DayFare[]> {
  const rs = await (await db()).execute({
    sql: `SELECT f.travel_date AS date, f.price, f.airline, f.stops FROM fares f
          WHERE f.origin = ? AND f.destination = ? AND f.travel_date BETWEEN ? AND ?
            AND f.status = 'ok' AND f.price IS NOT NULL
            AND f.snapshot_day = (SELECT MAX(snapshot_day) FROM fares
                                  WHERE origin = f.origin AND destination = f.destination
                                    AND travel_date = f.travel_date AND status = 'ok')
          ORDER BY f.travel_date`,
    args: [origin, destination, from, to],
  });
  return rs.rows.map((r) => ({
    date: String(r.date),
    price: Number(r.price),
    source: "google",
    airline: r.airline ? String(r.airline) : undefined,
    stops: r.stops == null ? undefined : Number(r.stops),
  }));
}

export interface HistoryPoint {
  day: string;
  total: number;
}

/** Price over time of one specific depart/return pair. */
export async function getWindowHistory(origin: string, destination: string, depart: string, ret: string): Promise<HistoryPoint[]> {
  const rs = await (await db()).execute({
    sql: `SELECT o.snapshot_day AS day, o.price + i.price AS total
          FROM fares o JOIN fares i
            ON i.snapshot_day = o.snapshot_day AND i.origin = o.destination AND i.destination = o.origin
           AND i.travel_date = ? AND i.status = 'ok'
          WHERE o.origin = ? AND o.destination = ? AND o.travel_date = ? AND o.status = 'ok'
          ORDER BY o.snapshot_day`,
    args: [ret, origin, destination, depart],
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
): Promise<HistoryPoint[]> {
  const { first, last } = monthBounds(month);
  const database = await db();
  const load = async (o: string, d: string, from: string, to: string) => {
    const rs = await database.execute({
      sql: `SELECT snapshot_day, travel_date AS date, price FROM fares
            WHERE origin = ? AND destination = ? AND travel_date BETWEEN ? AND ? AND status = 'ok'`,
      args: [o, d, from, to],
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
