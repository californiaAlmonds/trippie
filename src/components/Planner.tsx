"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { SearchResult, TripMode } from "@/lib/search";
import type { Cabin, DayFare, TripWindow } from "@/lib/types";
import AccountSlot from "./AccountSlot";
import { AccountProvider, useAccount } from "./account/AccountProvider";
import AuthDialog from "./account/AuthDialog";
import { api } from "./account/api";
import UnverifiedBanner from "./account/UnverifiedBanner";
import Banner from "./Banner";
import BookingPanel from "./BookingPanel";
import {
  CurrencyPicker,
  CurrencyProvider,
  useCurrency,
} from "./currency/CurrencyProvider";
import DayList from "./DayList";
import HistoryPanel from "./HistoryPanel";
import { BrandMarkIcon, SpinnerIcon } from "./icons";
import NativeBridge, { parseDeepLinkQuery } from "./native/NativeBridge";
import OneWayBookingPanel from "./OneWayBookingPanel";
import PriceCalendar from "./PriceCalendar";
import PriceInsightsCard, {
  type RouteFreshness,
  type RouteStatsBundle,
} from "./PriceInsightsCard";
import SavedPlansDrawer from "./plans/SavedPlansDrawer";
import SavePlanControl from "./plans/SavePlanControl";
import RecentSearches from "./RecentSearches";
import {
  clearRecent,
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

type ExtendedSearchResult = SearchResult & {
  stats?: RouteStatsBundle | null;
  freshness?: RouteFreshness | null;
};

type TrackRouteStatus = "idle" | "collecting" | "throttled" | "disabled";

const TWELVE_HOURS_MS = 12 * 60 * 60_000;
const POLL_INTERVAL_MS = 30_000;
const MAX_POLL_DURATION_MS = 12 * 60_000;

function isStaleOrMissingFreshness(freshness?: RouteFreshness | null): boolean {
  if (!freshness || !freshness.lastCheckedAt) return true;
  const ms = Date.parse(freshness.lastCheckedAt);
  if (!Number.isFinite(ms)) return true;
  return Date.now() - ms > TWELVE_HOURS_MS;
}

function buildSearchQueryString(q: Query): URLSearchParams {
  const cabin = q.cabin === "business" ? "business" : "economy";
  return new URLSearchParams(
    q.trip === "oneway"
      ? {
          origin: q.origin,
          destination: q.destination,
          month: q.month,
          trip: q.trip,
          cabin,
        }
      : {
          origin: q.origin,
          destination: q.destination,
          month: q.month,
          trip: q.trip,
          minGap: String(q.minGap),
          maxGap: String(q.maxGap),
          cabin,
        },
  );
}

function PlannerContent({
  defaultMonth,
  registerReuse,
}: {
  defaultMonth: string;
  registerReuse: (fn: (q: Query) => void) => void;
}) {
  const { user } = useAccount();
  const { currency, ratesDate, attribution } = useCurrency();

  const [trip, setTrip] = useState<TripMode>("round");
  const [cabin, setCabin] = useState<Cabin>("economy");
  const [origin, setOrigin] = useState("BLR");
  const [destination, setDestination] = useState("IXZ");
  const [month, setMonth] = useState(defaultMonth);
  const [minGap, setMinGap] = useState(5);
  const [maxGap, setMaxGap] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<(ExtendedSearchResult & { query: Query }) | null>(
    null,
  );
  const [selected, setSelected] = useState<TripWindow | null>(null);
  const [selectedDay, setSelectedDay] = useState<DayFare | null>(null);

  const [trackStatus, setTrackStatus] = useState<TrackRouteStatus>("idle");
  const [trackEtaMin, setTrackEtaMin] = useState<number | null>(null);
  const searchIdRef = useRef(0);
  const pollStartedRef = useRef<{ queryKey: string; startedAt: number } | null>(
    null,
  );

  const recentRaw = useSyncExternalStore(
    subscribeRecent,
    readRecent,
    serverSnapshotRecent,
  );
  const localRecent = useMemo(() => parseRecent(recentRaw), [recentRaw]);

  const [serverRecent, setServerRecent] = useState<Query[] | null>(null);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    void api<{ recent?: unknown }>("/api/recent").then((res) => {
      if (cancelled) return;
      if (res.ok && Array.isArray(res.data?.recent)) {
        const parsed = parseRecent(JSON.stringify(res.data.recent));
        setServerRecent(parsed);
      } else {
        // Fall back to local list if /api/recent fails or isn't mounted yet
        setServerRecent(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const recent = user && serverRecent !== null ? serverRecent : localRecent;

  const run = useCallback(
    async (rawQuery: Query) => {
      const q: Query = {
        ...rawQuery,
        cabin: rawQuery.cabin === "business" ? "business" : "economy",
      };
      const mySearchId = ++searchIdRef.current;
      pollStartedRef.current = null;

      setLoading(true);
      setError("");
      setSelected(null);
      setSelectedDay(null);
      setTrackStatus("idle");
      setTrackEtaMin(null);

      try {
        const qs = buildSearchQueryString(q);
        const res = await fetch(`/api/search?${qs}`);
        const body: ExtendedSearchResult & { error?: string } = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Search failed");
        if (searchIdRef.current !== mySearchId) return;

        setResult({ ...body, query: q });
        setSelected(body.windows[0] ?? null);
        setSelectedDay(body.days[0] ?? null);
        pushRecent(q);

        if (user) {
          setServerRecent((prev) => {
            if (prev === null) return null;
            const same = (r: Query) =>
              JSON.stringify({ ...r, cabin: r.cabin ?? "economy" }) ===
              JSON.stringify(q);
            return [q, ...prev.filter((r) => !same(r))].slice(0, 5);
          });
          void api("/api/recent", { method: "POST", body: q });
        }

        // Trigger POST /api/routes/track if freshness is missing or lastCheckedAt is null or older than 12h
        const freshness = body.freshness;
        if (freshness?.collecting) {
          setTrackStatus("collecting");
        }

        if (isStaleOrMissingFreshness(freshness)) {
          void api<{
            status?: "queued" | "fresh" | "throttled" | "disabled";
            etaMinutes?: number | null;
          }>("/api/routes/track", {
            method: "POST",
            body: {
              origin: q.origin,
              destination: q.destination,
              month: q.month,
              trip: q.trip,
              minGap: q.trip === "oneway" ? 0 : q.minGap,
              maxGap: q.trip === "oneway" ? 0 : q.maxGap,
              cabin: q.cabin ?? "economy",
            },
          }).then((trackRes) => {
            if (searchIdRef.current !== mySearchId) return;
            if (!trackRes.ok || !trackRes.data) return;
            const st = trackRes.data.status;
            if (st === "queued") {
              setTrackStatus("collecting");
              if (typeof trackRes.data.etaMinutes === "number") {
                setTrackEtaMin(trackRes.data.etaMinutes);
              }
            } else if (st === "throttled") {
              if (!freshness?.collecting) setTrackStatus("throttled");
            } else if (st === "disabled") {
              if (!freshness?.collecting) setTrackStatus("disabled");
            }
          });
        }
      } catch (err) {
        if (searchIdRef.current !== mySearchId) return;
        setResult(null);
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        if (searchIdRef.current === mySearchId) {
          setLoading(false);
        }
      }
    },
    [user],
  );

  // Poll /api/search every 30s for up to 12 min while collecting live prices
  const activeQuery = result?.query ?? null;
  const activeQueryKey = useMemo(
    () => (activeQuery ? buildSearchQueryString(activeQuery).toString() : null),
    [activeQuery],
  );
  const initialCheckedAt = result?.freshness?.lastCheckedAt ?? null;

  useEffect(() => {
    if (trackStatus !== "collecting" || !activeQuery || !activeQueryKey) return;

    if (
      !pollStartedRef.current ||
      pollStartedRef.current.queryKey !== activeQueryKey
    ) {
      pollStartedRef.current = {
        queryKey: activeQueryKey,
        startedAt: Date.now(),
      };
    }

    let cancelled = false;
    const startedAt = pollStartedRef.current.startedAt;
    const qs = activeQueryKey;

    const intervalId = window.setInterval(async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > MAX_POLL_DURATION_MS) {
        setTrackStatus("idle");
        window.clearInterval(intervalId);
        return;
      }

      try {
        const res = await fetch(`/api/search?${qs}`);
        if (!res.ok || cancelled) return;
        const nextBody: ExtendedSearchResult = await res.json();
        if (cancelled) return;

        const nextCheckedAt = nextBody.freshness?.lastCheckedAt ?? null;
        const changed = nextCheckedAt !== null && nextCheckedAt !== initialCheckedAt;

        if (changed || nextBody.freshness?.collecting === false) {
          setResult({ ...nextBody, query: activeQuery });
          setSelected((prev) => {
            if (!prev) return nextBody.windows[0] ?? null;
            const match = nextBody.windows.find(
              (w) =>
                w.depart.date === prev.depart.date &&
                w.ret.date === prev.ret.date,
            );
            return match ?? nextBody.windows[0] ?? null;
          });
          setSelectedDay((prev) => {
            if (!prev) return nextBody.days[0] ?? null;
            const match = nextBody.days.find((d) => d.date === prev.date);
            return match ?? nextBody.days[0] ?? null;
          });
          if (!nextBody.freshness?.collecting) {
            setTrackStatus("idle");
            window.clearInterval(intervalId);
          }
        }
      } catch {
        // Ignore transient poll errors
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [trackStatus, activeQuery, activeQueryKey, initialCheckedAt]);

  const reuse = useCallback(
    (q: Query) => {
      const nextCabin: Cabin = q.cabin === "business" ? "business" : "economy";
      setOrigin(q.origin);
      setDestination(q.destination);
      setMonth(q.month);
      setTrip(q.trip);
      setCabin(nextCabin);
      if (q.trip === "round") {
        setMinGap(q.minGap);
        setMaxGap(q.maxGap);
      }
      void run({ ...q, cabin: nextCabin });
    },
    [run],
  );

  useEffect(() => {
    registerReuse(reuse);
  }, [registerReuse, reuse]);

  const deepLinkHandledRef = useRef(false);

  useEffect(() => {
    if (deepLinkHandledRef.current) return;
    if (typeof window === "undefined") return;
    const q = parseDeepLinkQuery(window.location.search);
    if (!q) return;
    deepLinkHandledRef.current = true;
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.hash,
    );
    queueMicrotask(() => {
      reuse(q);
    });
  }, [reuse]);

  function search(e: React.FormEvent) {
    e.preventDefault();
    void run({
      origin,
      destination,
      month,
      trip,
      minGap: trip === "oneway" ? 0 : minGap,
      maxGap: trip === "oneway" ? 0 : maxGap,
      cabin,
    });
  }

  function handleClearRecent() {
    clearRecent();
    if (user) {
      setServerRecent((prev) => (prev !== null ? [] : null));
      void api("/api/recent", { method: "DELETE" });
    }
  }

  function swapAirports() {
    setOrigin(destination);
    setDestination(origin);
  }

  const currentBest = useMemo(() => {
    if (!result) return null;
    if (result.trip === "oneway") {
      return result.days[0]?.price ?? null;
    }
    return result.windows[0]?.total ?? null;
  }, [result]);

  const primaryStats = useMemo(() => {
    if (!result?.stats) return null;
    return (
      result.stats.total ??
      (result.trip === "oneway" ? result.stats.outbound : null)
    );
  }, [result]);

  const lastCheckedAt = result?.freshness?.lastCheckedAt ?? null;

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
          <div className="flex items-center gap-2 shrink-0">
            <CurrencyPicker />
            <AccountSlot />
          </div>
        </div>
      </header>

      <UnverifiedBanner />

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
            cabin={cabin}
            origin={origin}
            destination={destination}
            month={month}
            minGap={minGap}
            maxGap={maxGap}
            loading={loading}
            onTripChange={setTrip}
            onCabinChange={setCabin}
            onOriginChange={setOrigin}
            onDestinationChange={setDestination}
            onSwapAirports={swapAirports}
            onMonthChange={setMonth}
            onMinGapChange={setMinGap}
            onMaxGapChange={setMaxGap}
            onSubmit={search}
          />

          <RecentSearches
            recent={recent}
            onSelect={reuse}
            onClear={handleClearRecent}
          />

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

              {trackStatus === "collecting" && (
                <div
                  role="status"
                  className="glass mt-5 overflow-hidden p-4 sm:p-4"
                >
                  <div className="flex items-center gap-3 text-xs sm:text-sm font-medium text-[var(--text-primary)]">
                    <SpinnerIcon className="h-4 w-4 shrink-0 animate-spin text-[var(--accent)]" />
                    <span>
                      Collecting live prices for this route… usually ready in ~
                      {trackEtaMin ?? 6} min
                    </span>
                  </div>
                  <div
                    aria-hidden="true"
                    className="skeleton-shimmer mt-2.5 h-1.5 w-full rounded-full"
                  />
                </div>
              )}

              {(trackStatus === "throttled" || trackStatus === "disabled") && (
                <p className="mt-4 text-xs text-[var(--text-muted)]">
                  {trackStatus === "throttled"
                    ? "Live price refresh was recently requested for this route; showing cached fares."
                    : "Live route tracking is currently disabled; showing cached fares."}
                </p>
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
                      lastCheckedAt={lastCheckedAt}
                      headerAction={
                        <SavePlanControl
                          key={JSON.stringify(result.query)}
                          query={result.query}
                          stats={primaryStats}
                          currentBest={currentBest}
                        />
                      }
                    />
                    <div className="grid gap-6 md:sticky md:top-20">
                      {selectedDay && (
                        <OneWayBookingPanel
                          day={selectedDay}
                          origin={result.query.origin}
                          destination={result.query.destination}
                          cabin={result.query.cabin ?? result.cabin ?? "economy"}
                          lastCheckedAt={lastCheckedAt}
                        />
                      )}
                      <PriceInsightsCard
                        trip={result.trip}
                        stats={result.stats}
                        currentBest={currentBest}
                      />
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
                    lastCheckedAt={lastCheckedAt}
                    headerAction={
                      <SavePlanControl
                        key={JSON.stringify(result.query)}
                        query={result.query}
                        stats={primaryStats}
                        currentBest={currentBest}
                      />
                    }
                  />
                  <div className="grid gap-6 md:sticky md:top-20">
                    {selected && (
                      <BookingPanel
                        window={selected}
                        origin={result.query.origin}
                        destination={result.query.destination}
                        cabin={result.query.cabin ?? result.cabin ?? "economy"}
                        lastCheckedAt={lastCheckedAt}
                      />
                    )}
                    <PriceInsightsCard
                      trip={result.trip}
                      stats={result.stats}
                      currentBest={currentBest}
                    />
                    {selected && (
                      <HistoryPanel
                        key={`${selected.depart.date}-${selected.ret.date}`}
                        window={selected}
                        origin={result.query.origin}
                        destination={result.query.destination}
                        cabin={result.query.cabin ?? result.cabin ?? "economy"}
                      />
                    )}
                  </div>
                </div>
              )}

              <PriceCalendar trip={result.trip} calendar={result.calendar} />
            </div>
          )}
        </main>

        <footer className="mt-12 pt-4 text-center text-xs text-[var(--text-muted)] grid gap-1">
          <div>
            {result
              ? `Source: ${result.provider}. Fares are indicative; confirm on the booking site.`
              : "Trippie · Fares are indicative; confirm final prices on the booking site."}
          </div>
          {currency !== "INR" && (
            <div>
              Converted from INR
              {ratesDate ? ` · rates ${ratesDate}` : ""}
              {attribution?.text && attribution?.url ? (
                <>
                  {" · "}
                  <a
                    href={attribution.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-[var(--text-primary)]"
                  >
                    {attribution.text}
                  </a>
                </>
              ) : null}
            </div>
          )}
        </footer>
      </div>

      <AuthDialog />
      <SavedPlansDrawer />
    </div>
  );
}

export default function Planner({ defaultMonth }: { defaultMonth: string }) {
  const [reuseHandler, setReuseHandler] = useState<((q: Query) => void) | null>(
    null,
  );

  const registerReuse = useCallback((fn: (q: Query) => void) => {
    setReuseHandler(() => fn);
  }, []);

  const handleSearchAgain = useCallback(
    (q: Query) => {
      reuseHandler?.(q);
    },
    [reuseHandler],
  );

  return (
    <AccountProvider onSearchAgain={handleSearchAgain}>
      <CurrencyProvider>
        <NativeBridge />
        <PlannerContent
          defaultMonth={defaultMonth}
          registerReuse={registerReuse}
        />
      </CurrencyProvider>
    </AccountProvider>
  );
}
