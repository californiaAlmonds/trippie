"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { SearchResult, TripMode } from "@/lib/search";
import type { DayFare, TripWindow } from "@/lib/types";
import AccountSlot from "./AccountSlot";
import Banner from "./Banner";
import BookingPanel from "./BookingPanel";
import DayList from "./DayList";
import HistoryPanel from "./HistoryPanel";
import { BrandMarkIcon } from "./icons";
import OneWayBookingPanel from "./OneWayBookingPanel";
import PriceCalendar from "./PriceCalendar";
import RecentSearches from "./RecentSearches";
import {
  parseRecent,
  pushRecent,
  type Query,
  readRecent,
  serverSnapshotRecent,
  subscribeRecent,
} from "./recentStore";
import SearchForm from "./SearchForm";
import { EmptyState, ResultsSkeleton } from "./Skeletons";
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

  const recentRaw = useSyncExternalStore(
    subscribeRecent,
    readRecent,
    serverSnapshotRecent,
  );
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
    <div className="flex min-h-screen w-full flex-col">
      {/* Sticky translucent top bar */}
      <header className="sticky top-0 z-30 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-[var(--glass-highlight)] backdrop-blur-2xl backdrop-saturate-[1.75]">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <BrandMarkIcon className="h-7 w-7 shrink-0 shadow-xs rounded-lg" />
            <span className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
              Trippie
            </span>
          </div>
          <div className="flex items-center shrink-0">
            <AccountSlot />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-10">
        {/* Hero section */}
        <section className="mb-6 sm:mb-8">
          <h1 className="hero-title-gradient text-3xl sm:text-4xl font-bold tracking-tight">
            Find your cheapest flight window
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-[var(--text-secondary)]">
            Pick a month and how long you want to stay. We find the cheapest dates.
          </p>
        </section>

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

          {error && <Banner tone="error">{error}</Banner>}

          {loading && <ResultsSkeleton />}

          {!result && !loading && !error && (
            <EmptyState
              title="Ready when you are"
              description="Choose your departure and arrival airports, pick a month, and we will rank the lowest-fare windows across the entire month."
            />
          )}

          {result && !loading && (
            <div className="animate-results">
              {result.isDemo && (
                <Banner tone="demo">
                  Demo data: these prices are simulated. Set TRAVELPAYOUTS_TOKEN in
                  .env.local for real fares.
                </Banner>
              )}

              {result.trip === "oneway" ? (
                result.days.length === 0 ? (
                  <EmptyState
                    title="No fares found for this month"
                    description="Try another route or month."
                  />
                ) : (
                  <div className="mt-6 grid gap-6 md:grid-cols-[1.12fr_0.88fr] items-start">
                    <DayList
                      days={result.days}
                      selectedDay={selectedDay}
                      onSelect={setSelectedDay}
                    />
                    <div className="grid gap-6 md:sticky md:top-20">
                      {selectedDay && (
                        <OneWayBookingPanel
                          day={selectedDay}
                          origin={result.query.origin}
                          destination={result.query.destination}
                        />
                      )}
                    </div>
                  </div>
                )
              ) : result.windows.length === 0 ? (
                <EmptyState
                  title="No windows found"
                  description="The provider has no fares for both legs."
                />
              ) : (
                <div className="mt-6 grid gap-6 md:grid-cols-[1.12fr_0.88fr] items-start">
                  <WindowList
                    windows={result.windows}
                    selected={selected}
                    onSelect={setSelected}
                  />
                  <div className="grid gap-6 md:sticky md:top-20">
                    {selected && (
                      <BookingPanel
                        window={selected}
                        origin={result.query.origin}
                        destination={result.query.destination}
                      />
                    )}
                    {selected && (
                      <HistoryPanel
                        key={`${selected.depart.date}-${selected.ret.date}`}
                        window={selected}
                        origin={result.query.origin}
                        destination={result.query.destination}
                      />
                    )}
                  </div>
                </div>
              )}

              <PriceCalendar trip={result.trip} calendar={result.calendar} />
            </div>
          )}
        </main>

        <footer className="mt-12 pt-4 text-center text-xs text-[var(--text-muted)]">
          {result
            ? `Source: ${result.provider}. Fares are indicative; confirm on the booking site.`
            : "Trippie · Fares are indicative; confirm final prices on the booking site."}
        </footer>
      </div>
    </div>
  );
}
