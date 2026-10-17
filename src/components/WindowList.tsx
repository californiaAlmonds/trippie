"use client";

import type { ReactNode } from "react";
import type { DayFare, TripWindow } from "@/lib/types";
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

interface WindowListProps {
  windows: TripWindow[];
  selected: TripWindow | null;
  onSelect: (w: TripWindow) => void;
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

function formatLegBrief(leg: DayFare): string {
  return [
    leg.airline,
    formatFlightTimes(leg),
    formatDuration(leg.durationMin),
    formatStops(leg.stops),
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function WindowList({
  windows,
  selected,
  onSelect,
  headerAction,
}: WindowListProps) {
  const { format } = useCurrency();
  const topWindows = windows.slice(0, 15);
  const bestTotal = topWindows.length > 0 ? topWindows[0].total : 0;

  return (
    <section className="glass p-5 sm:p-6">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Cheapest windows
          </h2>
          <span className="text-xs text-[var(--text-muted)] tabular-nums">
            Top {topWindows.length}
          </span>
        </div>
        {headerAction}
      </div>

      <ol className="grid gap-2">
        {topWindows.map((w, idx) => {
          const active = selected === w;
          const isBest = idx === 0 || w.total === bestTotal;
          const delta = formatDeltaFromBest(w.total, bestTotal);
          const outBrief = formatLegBrief(w.depart);
          const retBrief = formatLegBrief(w.ret);
          const hasEstimate = Boolean(
            w.depart.estimate ||
              w.ret.estimate ||
              !w.depart.checkedAt ||
              !w.ret.checkedAt,
          );
          const legCheckedAt =
            w.depart.checkedAt && w.ret.checkedAt
              ? w.depart.checkedAt <= w.ret.checkedAt
                ? w.depart.checkedAt
                : w.ret.checkedAt
              : null;
          const checkedLabel = legCheckedAt
            ? formatRelativeChecked(legCheckedAt)
            : "Estimate (cached fare, time unknown)";

          return (
            <li key={`${w.depart.date}-${w.ret.date}`}>
              <button
                type="button"
                onClick={() => onSelect(w)}
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
                      {fmtDate(w.depart.date)} → {fmtDate(w.ret.date)}
                    </span>

                    <span className="inline-flex items-center rounded-full bg-slate-500/10 px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
                      {w.gap} days
                    </span>

                    {isBest ? (
                      <span className="inline-flex items-center rounded-full border border-[var(--badge-lowest-border)] bg-[var(--badge-lowest-bg)] px-2 py-0.5 text-[11px] font-semibold tracking-tight text-[var(--badge-lowest-text)]">
                        Best
                      </span>
                    ) : (
                      <span
                        title={`${delta.pct}% above cheapest window`}
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums tracking-tight ${
                          deltaToneStyles[delta.tone]
                        }`}
                      >
                        {delta.label}
                      </span>
                    )}

                    {hasEstimate && (
                      <span
                        title={ESTIMATE_TOOLTIP}
                        aria-description={ESTIMATE_TOOLTIP}
                        className="inline-flex items-center rounded-full border border-[var(--delta-amber-border)] bg-[var(--delta-amber-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--delta-amber-text)]"
                      >
                        Estimate
                      </span>
                    )}
                  </span>

                  {(outBrief || retBrief || checkedLabel) && (
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-8 text-xs text-[var(--text-secondary)]">
                      {outBrief && (
                        <span className="tabular-nums">Out: {outBrief}</span>
                      )}
                      {retBrief && (
                        <span className="tabular-nums">
                          {outBrief ? `· Ret: ${retBrief}` : `Ret: ${retBrief}`}
                        </span>
                      )}
                      {checkedLabel && (
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {outBrief || retBrief ? `· ${checkedLabel}` : checkedLabel}
                        </span>
                      )}
                    </span>
                  )}
                </span>

                <strong className="shrink-0 text-base sm:text-lg font-semibold tabular-nums tracking-tight text-[var(--text-primary)]">
                  {format(w.total)}
                </strong>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
