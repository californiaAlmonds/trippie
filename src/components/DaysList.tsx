import type { DayFare } from "@/lib/types";
import { fmtDate, inr } from "./format";
import GlassCard from "./ui/GlassCard";

interface DaysListProps {
  days: DayFare[];
  selectedDay: DayFare | null;
  onSelect: (d: DayFare) => void;
}

export default function DaysList({
  days,
  selectedDay,
  onSelect,
}: DaysListProps) {
  const topDays = days.slice(0, 15);
  const lowestPrice = topDays.length > 0 ? topDays[0].price : null;

  return (
    <GlassCard as="section" className="p-5 sm:p-6">
      <div className="mb-3.5 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Cheapest days
        </h2>
        <span className="text-xs text-[var(--text-muted)]">
          Top {topDays.length}
        </span>
      </div>

      <ol className="grid gap-2">
        {topDays.map((d) => {
          const active = selectedDay === d;
          const isLowest = lowestPrice !== null && d.price === lowestPrice;
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
                <span className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="font-medium text-[var(--text-primary)]">
                    {fmtDate(d.date)}
                  </span>
                  {d.airline && (
                    <span className="inline-flex items-center rounded-full bg-slate-500/10 px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
                      {d.airline}
                    </span>
                  )}
                  {isLowest && (
                    <span className="inline-flex items-center rounded-full border border-[var(--badge-lowest-border)] bg-[var(--badge-lowest-bg)] px-2 py-0.5 text-[11px] font-semibold tracking-tight text-[var(--badge-lowest-text)]">
                      Lowest
                    </span>
                  )}
                </span>
                <strong className="shrink-0 text-base font-semibold tabular-nums tracking-tight text-[var(--text-primary)]">
                  {inr.format(d.price)}
                </strong>
              </button>
            </li>
          );
        })}
      </ol>
    </GlassCard>
  );
}
