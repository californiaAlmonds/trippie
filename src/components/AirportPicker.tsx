"use client";

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import AirportCard, {
  type Airport,
  countryToFlagEmoji,
  FALLBACK_AIRPORTS,
  getFallbackAirport,
} from "./AirportCard";
import { SpinnerIcon } from "./icons";

interface AirportPickerProps {
  label: string;
  value: string;
  onChange: (code: string) => void;
}

const queryCache = new Map<string, Airport[]>();
const airportByCodeCache = new Map<string, Airport>(
  FALLBACK_AIRPORTS.map((a) => [a.iata, a]),
);

function filterFallbackAirports(q: string): Airport[] {
  const term = q.trim().toLowerCase();
  if (!term) return FALLBACK_AIRPORTS;
  return FALLBACK_AIRPORTS.filter(
    (a) =>
      a.iata.toLowerCase().includes(term) ||
      a.city.toLowerCase().includes(term) ||
      a.name.toLowerCase().includes(term) ||
      a.countryName.toLowerCase().includes(term) ||
      (a.icao?.toLowerCase().includes(term) ?? false),
  );
}

export function lookupKnownAirportCity(code: string): string {
  const upper = code.trim().toUpperCase();
  return airportByCodeCache.get(upper)?.city ?? getFallbackAirport(upper).city;
}

const SIZE_HINTS: Record<Airport["size"], string> = {
  large: "Large",
  medium: "Medium",
  small: "Small",
};

export default function AirportPicker({
  label,
  value,
  onChange,
}: AirportPickerProps) {
  const inputId = useId();
  const listboxId = useId();

  const [fetchedAirport, setFetchedAirport] = useState<Airport | null>(null);
  const [open, setOpen] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [options, setOptions] = useState<Airport[]>(FALLBACK_AIRPORTS);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [searching, setSearching] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const upperValue = value.trim().toUpperCase();

  const selectedAirport = useMemo<Airport>(() => {
    if (fetchedAirport && fetchedAirport.iata.toUpperCase() === upperValue) {
      return fetchedAirport;
    }
    return airportByCodeCache.get(upperValue) ?? getFallbackAirport(upperValue);
  }, [fetchedAirport, upperValue]);

  // Fetch airport details from /api/airports/{code} if not already in cache
  useEffect(() => {
    if (!upperValue || airportByCodeCache.has(upperValue)) return;

    const ctrl = new AbortController();
    fetch(`/api/airports/${encodeURIComponent(upperValue)}`, {
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const data: { airport?: Airport } = await res.json();
        return data?.airport ?? null;
      })
      .then((airport) => {
        if (airport && typeof airport.iata === "string") {
          airportByCodeCache.set(airport.iata.toUpperCase(), airport);
          setFetchedAirport(airport);
        }
      })
      .catch(() => {
        // Keep fallback airport
      });

    return () => {
      ctrl.abort();
    };
  }, [upperValue]);

  // Debounced 150ms abortable search against /api/airports with memory cache + local fallback
  useEffect(() => {
    if (!open) return;

    const q = isEditing ? queryText.trim() : "";
    if (!q) {
      const timer = window.setTimeout(() => {
        setOptions(FALLBACK_AIRPORTS);
        setActiveIndex(0);
        setSearching(false);
      }, 0);
      return () => {
        window.clearTimeout(timer);
      };
    }

    const cacheKey = q.toLowerCase();
    const hit = queryCache.get(cacheKey);

    const ctrl = new AbortController();
    const delay = hit ? 0 : 150;

    const timer = window.setTimeout(async () => {
      if (hit) {
        setOptions(hit);
        setActiveIndex(0);
        setSearching(false);
        return;
      }

      setSearching(true);
      try {
        const sp = new URLSearchParams({ q, limit: "15" });
        const res = await fetch(`/api/airports?${sp}`, {
          signal: ctrl.signal,
        });
        if (res.ok) {
          const data: { airports?: Airport[] } = await res.json();
          if (Array.isArray(data?.airports) && data.airports.length > 0) {
            for (const a of data.airports) {
              if (a?.iata) {
                airportByCodeCache.set(a.iata.toUpperCase(), a);
              }
            }
            queryCache.set(cacheKey, data.airports);
            setOptions(data.airports);
            setActiveIndex(0);
            setSearching(false);
            return;
          }
          if (Array.isArray(data?.airports) && data.airports.length === 0) {
            const localMatches = filterFallbackAirports(q);
            queryCache.set(cacheKey, localMatches);
            setOptions(localMatches);
            setActiveIndex(0);
            setSearching(false);
            return;
          }
        }
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") {
          return;
        }
      }

      const fallback = filterFallbackAirports(q);
      setOptions(fallback);
      setActiveIndex(0);
      setSearching(false);
    }, delay);

    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [open, isEditing, queryText]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (
        containerRef.current &&
        e.target instanceof Node &&
        !containerRef.current.contains(e.target)
      ) {
        setOpen(false);
        setIsEditing(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  const selectOption = useCallback(
    (airport: Airport) => {
      const code = airport.iata.toUpperCase();
      airportByCodeCache.set(code, airport);
      setFetchedAirport(airport);
      onChange(code);
      setOpen(false);
      setIsEditing(false);
      setQueryText("");
    },
    [onChange],
  );

  const displayValue = isEditing
    ? queryText
    : `${selectedAirport.city} (${selectedAirport.iata})`;

  const safeActiveIndex = useMemo(() => {
    if (options.length === 0) return -1;
    return Math.min(Math.max(0, activeIndex), options.length - 1);
  }, [activeIndex, options.length]);

  const activeOptionId =
    open && safeActiveIndex >= 0 && options[safeActiveIndex]
      ? `${listboxId}-opt-${options[safeActiveIndex].iata}`
      : undefined;

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      if (options.length > 0) {
        setActiveIndex((prev) => (prev + 1) % options.length);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(Math.max(0, options.length - 1));
        return;
      }
      if (options.length > 0) {
        setActiveIndex((prev) => (prev - 1 + options.length) % options.length);
      }
      return;
    }

    if (e.key === "Enter") {
      if (open) {
        e.preventDefault();
        if (safeActiveIndex >= 0 && options[safeActiveIndex]) {
          selectOption(options[safeActiveIndex]);
        } else if (/^[A-Za-z]{3}$/.test(queryText.trim())) {
          const code = queryText.trim().toUpperCase();
          selectOption(airportByCodeCache.get(code) ?? getFallbackAirport(code));
        }
      }
      return;
    }

    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setIsEditing(false);
        setQueryText("");
      }
      return;
    }
  }

  return (
    <div ref={containerRef} className="relative grid w-full min-w-0 gap-1.5">
      <label
        htmlFor={inputId}
        className="text-xs font-medium tracking-wide text-[var(--text-secondary)]"
      >
        {label}
      </label>

      <div className="relative flex items-center">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          value={displayValue}
          placeholder="Type city or airport code…"
          onFocus={() => {
            setOpen(true);
            setIsEditing(true);
            setQueryText("");
          }}
          onClick={() => {
            if (!open) {
              setOpen(true);
              setIsEditing(true);
              setQueryText("");
            }
          }}
          onChange={(e) => {
            setIsEditing(true);
            setQueryText(e.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="glass-field min-h-[44px] w-full rounded-2xl pl-3.5 pr-16 py-2 text-sm font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/70"
        />

        <div className="pointer-events-none absolute right-3 flex items-center gap-1.5">
          {searching && (
            <SpinnerIcon className="h-3.5 w-3.5 animate-spin text-[var(--accent)]" />
          )}
          <span className="inline-flex items-center rounded-lg bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-bold tabular-nums text-[var(--accent)]">
            {selectedAirport.iata}
          </span>
        </div>
      </div>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`${label} airport suggestions`}
          className="glass-strong absolute left-0 right-0 top-[4.5rem] z-40 max-h-72 overflow-y-auto p-2 grid gap-1 animate-results"
        >
          {options.length === 0 ? (
            <li className="px-3 py-3 text-xs text-[var(--text-muted)] text-center">
              No matching airports found
            </li>
          ) : (
            options.map((a, idx) => {
              const isActive = idx === safeActiveIndex;
              const isSelected = a.iata === selectedAirport.iata;
              const flag = a.country ? countryToFlagEmoji(a.country) : "✈️";
              return (
                <li
                  key={a.iata}
                  id={`${listboxId}-opt-${a.iata}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(a);
                  }}
                  className={`flex min-h-[44px] items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-left text-xs sm:text-sm cursor-pointer transition-colors ${
                    isActive
                      ? "glass-selected"
                      : "hover:bg-[var(--glass-bg-subtle-hover)]"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="inline-flex h-7 min-w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] px-1.5 text-xs font-bold tabular-nums text-[var(--accent)]">
                      {a.iata}
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold text-[var(--text-primary)] truncate">
                        <span aria-hidden="true" className="mr-1.5">
                          {flag}
                        </span>
                        {a.city}
                        {a.countryName ? (
                          <span className="font-normal text-[var(--text-secondary)]">
                            , {a.countryName}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] truncate">
                        {a.name}
                      </div>
                    </div>
                  </div>

                  <span className="shrink-0 rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    {SIZE_HINTS[a.size] ?? a.size}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      )}

      <AirportCard airport={selectedAirport} />
    </div>
  );
}
