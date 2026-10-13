"use client";

import { useState } from "react";
import { AIRPORTS } from "@/lib/airports";
import { orderedSites } from "@/lib/links";
import type { SearchResult } from "@/lib/search";
import type { TripWindow } from "@/lib/types";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

const field = "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

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

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSelected(null);
    try {
      const qs = new URLSearchParams({ origin, destination, month, minGap: String(minGap), maxGap: String(maxGap) });
      const res = await fetch(`/api/search?${qs}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Search failed");
      setResult(body);
      setSelected(body.windows[0] ?? null);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  const max = result ? Math.max(...result.calendar.map((c) => c.total)) : 0;
  const min = result ? Math.min(...result.calendar.map((c) => c.total)) : 0;

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
              </section>
            </div>
          )}

          {result.calendar.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
                Cheapest round trip by departure day
              </h2>
              <div className="grid grid-cols-7 gap-1.5">
                {result.calendar.map((c) => {
                  const t = max === min ? 0 : (c.total - min) / (max - min);
                  return (
                    <div
                      key={c.date}
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
