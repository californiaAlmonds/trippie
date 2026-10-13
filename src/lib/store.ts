import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { DayFare } from "./types.ts";
import { addDays, computeWindows, monthBounds } from "./windows.ts";

let db: DatabaseSync | undefined;

function open(): DatabaseSync {
  if (db) return db;
  mkdirSync("data", { recursive: true });
  db = new DatabaseSync(process.env.TRIPPIE_DB ?? "data/trippie.db");
  db.exec(`
    CREATE TABLE IF NOT EXISTS fares (
      snapshot_day TEXT NOT NULL,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      travel_date TEXT NOT NULL,
      price INTEGER NOT NULL,
      source TEXT NOT NULL,
      provider TEXT NOT NULL,
      PRIMARY KEY (snapshot_day, origin, destination, travel_date)
    )`);
  return db;
}

export function saveSnapshot(day: string, origin: string, destination: string, provider: string, fares: DayFare[]) {
  const d = open();
  const stmt = d.prepare(
    "INSERT OR REPLACE INTO fares (snapshot_day, origin, destination, travel_date, price, source, provider) VALUES (?,?,?,?,?,?,?)",
  );
  d.exec("BEGIN");
  try {
    for (const f of fares) stmt.run(day, origin, destination, f.date, f.price, f.source, provider);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export interface HistoryPoint {
  day: string;
  total: number;
}

/** Price over time of one specific depart/return pair. */
export function getWindowHistory(origin: string, destination: string, depart: string, ret: string): HistoryPoint[] {
  return open()
    .prepare(
      `SELECT o.snapshot_day AS day, o.price + i.price AS total
       FROM fares o JOIN fares i
         ON i.snapshot_day = o.snapshot_day AND i.origin = o.destination AND i.destination = o.origin
        AND i.travel_date = ?
       WHERE o.origin = ? AND o.destination = ? AND o.travel_date = ?
       ORDER BY o.snapshot_day`,
    )
    .all(ret, origin, destination, depart) as unknown as HistoryPoint[];
}

/** Cheapest window in the month as seen on each snapshot day. */
export function getBestWindowHistory(
  origin: string,
  destination: string,
  month: string,
  minGap: number,
  maxGap: number,
): HistoryPoint[] {
  const { first, last } = monthBounds(month);
  const q = open().prepare(
    `SELECT snapshot_day, travel_date AS date, price, source FROM fares
     WHERE origin = ? AND destination = ? AND travel_date BETWEEN ? AND ?`,
  );
  type Row = { snapshot_day: string; date: string; price: number; source: string };
  const group = (rows: Row[]) => {
    const m = new Map<string, DayFare[]>();
    for (const r of rows) m.set(r.snapshot_day, [...(m.get(r.snapshot_day) ?? []), r]);
    return m;
  };
  const out = group(q.all(origin, destination, first, last) as unknown as Row[]);
  const inn = group(q.all(destination, origin, addDays(first, minGap), addDays(last, maxGap)) as unknown as Row[]);
  const points: HistoryPoint[] = [];
  for (const [day, o] of [...out].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const best = computeWindows(o, inn.get(day) ?? [], minGap, maxGap)[0];
    if (best) points.push({ day, total: best.total });
  }
  return points;
}
