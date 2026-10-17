"use client";

import type { ReactNode } from "react";
import type { DayFare } from "@/lib/types";
import { useCurrency } from "./currency/CurrencyProvider";
import {
  ESTIMATE_TOOLTIP,
  fmtDate,
  formatDeltaFromBest,
  formatDuration,
  formatFlightTimes,
  formatRelativeChecked,
  formatStops,
} from "./format";

interface DayListProps {
  days: DayFare[];
  selectedDay: DayFare | null;
  onSelect: (d: DayFare) => void;
  headerAction?: ReactNode;
  lastCheckedAt?: string | null;
}

const deltaToneStyles = {
  green:
    "border-[var(--delta-green-border)] bg-[var(--delta-green-bg)] text-[var(--delta-green-text)]",
  amber:
    "border-[var(--delta-amber-border)] bg-[var(--delta-amber-bg)] text-[var(--delta-amber-text)]",
  red:
    "border-[var(--delta-red-border)] bg-[var(--delta-red-bg)] text-[var(--delta-red-text)]",
} as const;

export default function DayList({
  days,
  selectedDay,
  onSelect,
  headerAction,
  lastCheckedAt,
}: DayListProps) {
  const { format } = useCurrency();
  const topDays = days.slice(0, 15);
  const bestPrice = topDays.length > 0 ? topDays[0].price : 0;

  return (
    <section className="glass p-5 sm:p-6">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Cheapest days
          </h2>
          <span className="text-xs text-[var(--text-muted)] tabular-nums">
            Top {topDays.length}
          </span>
        </div>
        {headerAction}
      </div>

      <ol className="grid gap-2">
        {topDays.map((d, idx) => {
          const active = selectedDay === d;
          const isBest = idx === 0 || d.price === bestPrice;
          const delta = formatDeltaFromBest(d.price, bestPrice);
          const times = formatFlightTimes(d);
          const duration = formatDuration(d.durationMin);
          const stops = formatStops(d.stops);
          const checkedLabel = formatRelativeChecked(d.checkedAt ?? lastCheckedAt);

          const flightMeta = [d.airline, times, duration, stops]
            .filter(Boolean)
            .join(" · ");

          return (
            <li key={d.date}>
              <button
                type="button"
                onClick={() => onSelect(d)}
                aria-pressed={active}
                className={`focus-ring flex w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-3 text-left text-sm cursor-pointer ${
                  active ? "glass-selected" : "glass-subtle-interactive"
                }`}
              >
                <span className="grid gap-1 min-w-0">
                  <span className="flex flex-wrap items-center gap-2 min-w-0">
                    <span
                      aria-label={`Rank ${idx + 1}`}
                      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${
                        idx === 0
                          ? "bg-[var(--accent)] text-white"
                          : "bg-slate-500/10 text-[var(--text-muted)]"
                      }`}
                    >
                      #{idx + 1}
                    </span>

                    <span className="font-medium text-[var(--text-primary)]">
                      {fmtDate(d.date)}
                    </span>

                    {isBest ? (
                      <span className="inline-flex items-center rounded-full border border-[var(--badge-lowest-border)] bg-[var(--badge-lowest-bg)] px-2 py-0.5 text-[11px] font-semibold tracking-tight text-[var(--badge-lowest-text)]">
                        Best
                      </span>
                    ) : (
                      <span
                        title={`${delta.pct}% above cheapest day`}
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums tracking-tight ${
                          deltaToneStyles[delta.tone]
                        }`}
                      >
                        {delta.label}
                      </span>
                    )}

                    {d.estimate && (
                      <span
                        title={ESTIMATE_TOOLTIP}
                        aria-description={ESTIMATE_TOOLTIP}
                        className="inline-flex items-center rounded-full border border-[var(--delta-amber-border)] bg-[var(--delta-amber-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--delta-amber-text)]"
                      >
                        Estimate
                      </span>
                    )}
                  </span>

                  {(flightMeta || checkedLabel) && (
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-8 text-xs text-[var(--text-secondary)]">
                      {flightMeta && <span className="tabular-nums">{flightMeta}</span>}
                      {checkedLabel && (
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {flightMeta ? `· ${checkedLabel}` : checkedLabel}
                        </span>
                      )}
                    </span>
                  )}
                </span>

                <strong className="shrink-0 text-base sm:text-lg font-semibold tabular-nums tracking-tight text-[var(--text-primary)]">
                  {format(d.price)}
                </strong>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
