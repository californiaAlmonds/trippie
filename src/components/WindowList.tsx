import type { ReactNode } from "react";
import type { TripWindow } from "@/lib/types";
import { fmtDate, formatDeltaFromBest, inr } from "./format";

interface WindowListProps {
  windows: TripWindow[];
  selected: TripWindow | null;
  onSelect: (w: TripWindow) => void;
  headerAction?: ReactNode;
}

const deltaToneStyles = {
  green:
    "border-[var(--delta-green-border)] bg-[var(--delta-green-bg)] text-[var(--delta-green-text)]",
  amber:
    "border-[var(--delta-amber-border)] bg-[var(--delta-amber-bg)] text-[var(--delta-amber-text)]",
  red:
    "border-[var(--delta-red-border)] bg-[var(--delta-red-bg)] text-[var(--delta-red-text)]",
} as const;

export default function WindowList({
  windows,
  selected,
  onSelect,
  headerAction,
}: WindowListProps) {
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
                </span>

                <strong className="shrink-0 text-base sm:text-lg font-semibold tabular-nums tracking-tight text-[var(--text-primary)]">
                  {inr.format(w.total)}
                </strong>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
