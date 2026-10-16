"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { SearchResult, TripMode } from "@/lib/search";
import type { DayFare, TripWindow } from "@/lib/types";
import AccountSlot from "./AccountSlot";
import BookingPanel from "./BookingPanel";
import DaysList from "./DaysList";
import {
  parseRecent,
  pushRecent,
  type Query,
  readRecent,
  subscribeRecent,
} from "./format";
import HeatCalendar from "./HeatCalendar";
import PriceHistory from "./PriceHistory";
import RecentSearches from "./RecentSearches";
import SearchForm from "./SearchForm";
import GlassCard from "./ui/GlassCard";
import { AlertIcon, InfoIcon, PlaneIcon } from "./ui/Icons";
import ResultsSkeleton from "./ui/Skeleton";
import WindowList from "./WindowList";

export default function Planner({ defaultMonth }: { defaultMonth: string }) {
  const [trip, setTrip] = useState<TripMode>("round");
  const [origin, setOrigin] = useState("BLR");
  const [destination, setDestination] = useState("IXZ");
  const [month, setMonth] = useState(defaultMonth);
  const [minGap, setMinGap] = useState(5);
  const [maxGap, setMaxGap] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<(SearchResult & { query: Query }) | null>(
    null,
  );
  const [selected, setSelected] = useState<TripWindow | null>(null);
  const [selectedDay, setSelectedDay] = useState<DayFare | null>(null);

  const recentRaw = useSyncExternalStore(subscribeRecent, readRecent, () => "[]");
  const recent = useMemo(() => parseRecent(recentRaw), [recentRaw]);

  async function run(q: Query) {
    setLoading(true);
    setError("");
    setSelected(null);
    setSelectedDay(null);
    try {
      const qs = new URLSearchParams(
        q.trip === "oneway"
          ? {
              origin: q.origin,
              destination: q.destination,
              month: q.month,
              trip: q.trip,
            }
          : {
              origin: q.origin,
              destination: q.destination,
              month: q.month,
              trip: q.trip,
              minGap: String(q.minGap),
              maxGap: String(q.maxGap),
            },
      );
      const res = await fetch(`/api/search?${qs}`);
      const body: SearchResult & { error?: string } = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Search failed");
      setResult({ ...body, query: q });
      setSelected(body.windows[0] ?? null);
      setSelectedDay(body.days[0] ?? null);
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
    void run({
      origin,
      destination,
      month,
      trip,
      minGap: trip === "oneway" ? 0 : minGap,
      maxGap: trip === "oneway" ? 0 : maxGap,
    });
  }

  function reuse(q: Query) {
    setOrigin(q.origin);
    setDestination(q.destination);
    setMonth(q.month);
    setTrip(q.trip);
    if (q.trip === "round") {
      setMinGap(q.minGap);
      setMaxGap(q.maxGap);
    }
    void run(q);
  }

  function swapAirports() {
    setOrigin(destination);
    setDestination(origin);
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[var(--accent)]">
            <PlaneIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
              Trippie
            </h1>
            <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
              Pick a month and how long you want to stay. We find the cheapest dates.
            </p>
          </div>
        </div>
        <div className="shrink-0">
          <AccountSlot />
        </div>
      </header>

      <main className="flex-1">
        <SearchForm
          trip={trip}
          origin={origin}
          destination={destination}
          month={month}
          minGap={minGap}
          maxGap={maxGap}
          loading={loading}
          onTripChange={setTrip}
          onOriginChange={setOrigin}
          onDestinationChange={setDestination}
          onSwapAirports={swapAirports}
          onMonthChange={setMonth}
          onMinGapChange={setMinGap}
          onMaxGapChange={setMaxGap}
          onSubmit={search}
        />

        <RecentSearches recent={recent} onSelect={reuse} />

        {error && (
          <GlassCard
            variant="danger"
            role="alert"
            className="mt-5 flex items-center gap-2.5 px-4 py-3 text-sm font-medium"
          >
            <AlertIcon className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </GlassCard>
        )}

        {loading && <ResultsSkeleton />}

        {result && !loading && (
          <>
            {result.isDemo && (
              <GlassCard
                variant="amber"
                className="mt-5 flex items-center gap-2.5 px-4 py-3 text-xs sm:text-sm font-medium"
              >
                <InfoIcon className="h-4 w-4 shrink-0" />
                <span>
                  Demo data: these prices are simulated. Set TRAVELPAYOUTS_TOKEN in
                  .env.local for real fares.
                </span>
              </GlassCard>
            )}

            {result.trip === "oneway" ? (
              result.days.length === 0 ? (
                <GlassCard className="mt-6 p-8 text-center text-sm text-[var(--text-secondary)]">
                  No fares found for this month. Try another route or month.
                </GlassCard>
              ) : (
                <div className="mt-6 grid gap-6 md:grid-cols-[1.12fr_0.88fr] items-start">
                  <DaysList
                    days={result.days}
                    selectedDay={selectedDay}
                    onSelect={setSelectedDay}
                  />
                  <div className="grid gap-6 md:sticky md:top-6">
                    {selectedDay && (
                      <BookingPanel
                        target={{ mode: "oneway", day: selectedDay }}
                        origin={result.query.origin}
                        destination={result.query.destination}
                      />
                    )}
                  </div>
                </div>
              )
            ) : result.windows.length === 0 ? (
              <GlassCard className="mt-6 p-8 text-center text-sm text-[var(--text-secondary)]">
                No windows found. The provider has no fares for both legs.
              </GlassCard>
            ) : (
              <div className="mt-6 grid gap-6 md:grid-cols-[1.12fr_0.88fr] items-start">
                <WindowList
                  windows={result.windows}
                  selected={selected}
                  onSelect={setSelected}
                />
                <div className="grid gap-6 md:sticky md:top-6">
                  {selected && (
                    <BookingPanel
                      target={{ mode: "round", window: selected }}
                      origin={result.query.origin}
                      destination={result.query.destination}
                    />
                  )}
                  {selected && (
                    <PriceHistory
                      key={`${selected.depart.date}-${selected.ret.date}`}
                      window={selected}
                      origin={result.query.origin}
                      destination={result.query.destination}
                    />
                  )}
                </div>
              </div>
            )}

            <HeatCalendar trip={result.trip} calendar={result.calendar} />
          </>
        )}
      </main>

      <footer className="mt-12 pt-4 text-center text-xs text-[var(--text-muted)]">
        {result
          ? `Source: ${result.provider}. Fares are indicative; confirm on the booking site.`
          : "Trippie · Fares are indicative; confirm final prices on the booking site."}
      </footer>
    </div>
  );
}
