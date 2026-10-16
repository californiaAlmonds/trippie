"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AIRPORTS } from "@/lib/airports";
import { orderedSites, SITES } from "@/lib/links";
import type { SearchResult } from "@/lib/search";
import type { TripWindow } from "@/lib/types";
import { addDays, monthBounds } from "@/lib/windows";

function monthDays(month: string): string[] {
  const { first, last } = monthBounds(month);
  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  return days;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

const field = "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

interface Query {
  origin: string;
  destination: string;
  month: string;
  minGap: number;
  maxGap: number;
}

const RECENT_KEY = "trippie.recent";
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
const readRecent = () => localStorage.getItem(RECENT_KEY) ?? "[]";

function parseRecent(raw: string): Query[] {
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter(
      (q): q is Query =>
        typeof q?.origin === "string" && typeof q.destination === "string" && typeof q.month === "string" &&
        Number.isInteger(q.minGap) && Number.isInteger(q.maxGap),
    );
  } catch {
    return [];
  }
}

function pushRecent(q: Query) {
  const same = (r: Query) => JSON.stringify(r) === JSON.stringify(q);
  const next = [q, ...parseRecent(readRecent()).filter((r) => !same(r))].slice(0, 5);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

export default function Planner({ defaultMonth }: { defaultMonth: string }) {
  const [origin, setOrigin] = useState("BLR");
  const [destination, setDestination] = useState("IXZ");
  const [month, setMonth] = useState(defaultMonth);
  const [minGap, setMinGap] = useState(5);
  const [maxGap, setMaxGap] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [selected, setSelected] = useState<TripWindow | null>(null);
  const recentRaw = useSyncExternalStore(subscribe, readRecent, () => "[]");
  const recent = useMemo(() => parseRecent(recentRaw), [recentRaw]);

  async function run(q: Query) {
    setLoading(true);
    setError("");
    setSelected(null);
    try {
      const qs = new URLSearchParams({ ...q, minGap: String(q.minGap), maxGap: String(q.maxGap) });
      const res = await fetch(`/api/search?${qs}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Search failed");
      setResult(body);
      setSelected(body.windows[0] ?? null);
      pushRecent(q);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  function search(e: React.FormEvent) {
    e.preventDefault();
    void run({ origin, destination, month, minGap, maxGap });
  }

  function reuse(q: Query) {
    setOrigin(q.origin);
    setDestination(q.destination);
    setMonth(q.month);
    setMinGap(q.minGap);
    setMaxGap(q.maxGap);
    void run(q);
  }

  const min = result ? Math.min(...result.calendar.map((c) => c.total)) : 0;
  const calendarByDate = useMemo(() => new Map(result?.calendar.map((c) => [c.date, c]) ?? []), [result]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Trippie</h1>
      <p className="mt-1 text-zinc-600 dark:text-zinc-400">
        Pick a month and how long you want to stay. We find the cheapest dates.
      </p>

      <form onSubmit={search} className="mt-6 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs">
          From
          <select className={field} value={origin} onChange={(e) => setOrigin(e.target.value)}>
            {AIRPORTS.map((a) => (
              <option key={a.code} value={a.code}>{a.name} ({a.code})</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          To
          <select className={field} value={destination} onChange={(e) => setDestination(e.target.value)}>
            {AIRPORTS.map((a) => (
              <option key={a.code} value={a.code}>{a.name} ({a.code})</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          Month
          <input type="month" className={field} value={month} onChange={(e) => setMonth(e.target.value)} required />
        </label>
        <label className="grid gap-1 text-xs">
          Stay (days) min
          <input type="number" min={1} max={30} className={`${field} w-20`} value={minGap}
            onChange={(e) => setMinGap(Number(e.target.value))} />
        </label>
        <label className="grid gap-1 text-xs">
          max
          <input type="number" min={1} max={30} className={`${field} w-20`} value={maxGap}
            onChange={(e) => setMaxGap(Number(e.target.value))} />
        </label>
        <button disabled={loading} className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {loading ? "Searching..." : "Find best dates"}
        </button>
      </form>

      {recent.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-zinc-500">Recent:</span>
          {recent.map((q) => (
            <button
              key={JSON.stringify(q)}
              type="button"
              onClick={() => reuse(q)}
              className="rounded-full border border-zinc-300 px-2.5 py-1 dark:border-zinc-700"
            >
              {q.origin}→{q.destination} {q.month} · {q.minGap === q.maxGap ? q.minGap : `${q.minGap}-${q.maxGap}`}d
            </button>
          ))}
        </div>
      )}

      {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}

      {result && (
        <>
          {result.isDemo && (
            <p className="mt-4 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">
              Demo data: these prices are simulated. Set TRAVELPAYOUTS_TOKEN in .env.local for real fares.
            </p>
          )}
          {result.windows.length === 0 ? (
            <p className="mt-6 text-zinc-600">No windows found. The provider has no fares for both legs.</p>
          ) : (
            <div className="mt-6 grid gap-6 md:grid-cols-[1fr_1fr]">
              <section>
                <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">Cheapest windows</h2>
                <ol className="grid gap-2">
                  {result.windows.slice(0, 15).map((w) => {
                    const active = selected === w;
                    return (
                      <li key={`${w.depart.date}-${w.ret.date}`}>
                        <button
                          onClick={() => setSelected(w)}
                          aria-pressed={active}
                          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                            active ? "border-sky-600 bg-sky-50 dark:bg-sky-950" : "border-zinc-200 dark:border-zinc-800"
                          }`}
                        >
                          <span>
                            {fmtDate(w.depart.date)} → {fmtDate(w.ret.date)}
                            <span className="ml-2 text-xs text-zinc-500">{w.gap} days</span>
                          </span>
                          <strong>{inr.format(w.total)}</strong>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>

              <section>
                {selected && <Booking window={selected} origin={origin} destination={destination} />}
                {selected && (
                  <History key={`${selected.depart.date}-${selected.ret.date}`} window={selected} origin={origin} destination={destination} />
                )}
              </section>
            </div>
          )}

          {result.calendar.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
                Cheapest round trip by departure day
              </h2>
              <div className="grid grid-cols-7 gap-1.5">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} className="text-center text-xs text-zinc-500">{d}</div>
                ))}
                {Array.from({ length: new Date(`${result.calendar[0].date.slice(0, 7)}-01T00:00:00Z`).getUTCDay() }, (_, i) => (
                  <div key={`pad${i}`} />
                ))}
                {monthDays(result.calendar[0].date.slice(0, 7)).map((date) => {
                  const c = calendarByDate.get(date);
                  if (!c) {
                    return (
                      <div key={date} className="rounded-md bg-zinc-100 p-2 text-center text-xs text-zinc-400 dark:bg-zinc-900">
                        {date.slice(8)}
                      </div>
                    );
                  }
                  // Colour by how far above the cheapest day (0% green to 25%+ red).
                  const t = Math.min(1, (c.total - min) / (min * 0.25));
                  return (
                    <div
                      key={date}
                      title={`${fmtDate(c.date)}: ${inr.format(c.total)} (${c.gap} days)`}
                      className="rounded-md p-2 text-center text-xs text-zinc-900"
                      style={{ backgroundColor: `hsl(${130 - 130 * t} 70% 80%)` }}
                    >
                      <div className="font-medium">{c.date.slice(8)}</div>
                      <div>{Math.round(c.total / 100) / 10}k</div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          <p className="mt-6 text-xs text-zinc-500">Source: {result.provider}. Fares are indicative; confirm on the booking site.</p>
        </>
      )}
    </div>
  );
}

function Booking({ window: w, origin, destination }: { window: TripWindow; origin: string; destination: string }) {
  const [best, ...others] = orderedSites(w.depart.source === w.ret.source ? w.depart.source : undefined);
  const link = (s: typeof best) => s.url(origin, destination, w.depart.date, w.ret.date);
  return (
    <div className="grid gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Book this window</h2>
      <a
        href={link(best)}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg bg-sky-600 p-4 text-white"
      >
        <div className="text-xs opacity-80">Best price</div>
        <div className="text-2xl font-semibold">{inr.format(w.total)}</div>
        <div className="text-sm">on {best.label}</div>
      </a>
      <ul className="text-xs text-zinc-500">
        {[w.depart, w.ret].map((leg, i) => (
          <li key={i}>
            {i === 0 ? "Outbound" : "Return"} {inr.format(leg.price)} via {SITES.find((s) => s.key === leg.source)?.label ?? leg.source}
            {leg.airline ? `, ${leg.airline}` : ""}
          </li>
        ))}
      </ul>
      <div>
        <div className="mb-1 text-xs text-zinc-500">Compare on other sites</div>
        <ul className="grid gap-1.5">
          {others.map((s) => (
            <li key={s.key}>
              <a
                href={link(s)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
              >
                {s.label}
                <span className="text-xs text-zinc-500">{s.verified ? "check price" : "check price (link untested)"}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface Point {
  day: string;
  total: number;
}

function History({ window: w, origin, destination }: { window: TripWindow; origin: string; destination: string }) {
  const [points, setPoints] = useState<Point[] | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams({
      origin,
      destination,
      month: w.depart.date.slice(0, 7),
      minGap: String(w.gap),
      maxGap: String(w.gap),
      depart: w.depart.date,
      return: w.ret.date,
    });
    let stale = false;
    fetch(`/api/history?${qs}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((p: Point[]) => !stale && setPoints(p))
      .catch(() => !stale && setPoints([]));
    return () => {
      stale = true;
    };
  }, [w, origin, destination]);

  if (!points) return null;
  const W = 300;
  const H = 70;
  const totals = points.map((p) => p.total);
  const lo = Math.min(...totals);
  const hi = Math.max(...totals);
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (t: number) => (hi === lo ? H / 2 : H - 4 - ((t - lo) / (hi - lo)) * (H - 8));

  return (
    <div className="mt-6">
      <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-zinc-500">Price history</h2>
      {points.length < 2 ? (
        <p className="text-xs text-zinc-500">
          {points.length === 0 ? "No snapshots yet." : "1 snapshot so far."} History builds up with each daily scrape.
        </p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Round trip price over time">
            <polyline fill="none" stroke="#0284c7" strokeWidth="2" points={points.map((p, i) => `${x(i)},${y(p.total)}`).join(" ")} />
          </svg>
          <p className="text-xs text-zinc-500">
            {points[0].day} to {points.at(-1)!.day}: low {inr.format(lo)}, high {inr.format(hi)}
          </p>
        </>
      )}
    </div>
  );
}
