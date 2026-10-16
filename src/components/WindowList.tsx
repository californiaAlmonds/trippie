import type { TripWindow } from "@/lib/types";
import { fmtDate, inr } from "./format";
import GlassCard from "./ui/GlassCard";

interface WindowListProps {
  windows: TripWindow[];
  selected: TripWindow | null;
  onSelect: (w: TripWindow) => void;
}

export default function WindowList({
  windows,
  selected,
  onSelect,
}: WindowListProps) {
  const topWindows = windows.slice(0, 15);
  const lowestTotal = topWindows.length > 0 ? topWindows[0].total : null;

  return (
    <GlassCard as="section" className="p-5 sm:p-6">
      <div className="mb-3.5 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Cheapest windows
        </h2>
        <span className="text-xs text-[var(--text-muted)]">
          Top {topWindows.length}
        </span>
      </div>

      <ol className="grid gap-2">
        {topWindows.map((w) => {
          const active = selected === w;
          const isLowest = lowestTotal !== null && w.total === lowestTotal;
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
                  <span className="font-medium text-[var(--text-primary)]">
                    {fmtDate(w.depart.date)} → {fmtDate(w.ret.date)}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-slate-500/10 px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
                    {w.gap} days
                  </span>
                  {isLowest && (
                    <span className="inline-flex items-center rounded-full border border-[var(--badge-lowest-border)] bg-[var(--badge-lowest-bg)] px-2 py-0.5 text-[11px] font-semibold tracking-tight text-[var(--badge-lowest-text)]">
                      Lowest
                    </span>
                  )}
                </span>
                <strong className="shrink-0 text-base font-semibold tabular-nums tracking-tight text-[var(--text-primary)]">
                  {inr.format(w.total)}
                </strong>
              </button>
            </li>
          );
        })}
      </ol>
    </GlassCard>
  );
}
