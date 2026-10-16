import { useMemo } from "react";
import type { TripMode } from "@/lib/search";
import { addDays, monthBounds } from "@/lib/windows";
import { fmtDate, inr } from "./format";

interface CalendarEntry {
  date: string;
  total: number;
  gap?: number;
}

interface PriceCalendarProps {
  trip: TripMode;
  calendar: CalendarEntry[];
}

function monthDays(month: string): string[] {
  const { first, last } = monthBounds(month);
  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  return days;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export default function PriceCalendar({ trip, calendar }: PriceCalendarProps) {
  const calendarByDate = useMemo(
    () => new Map(calendar.map((c) => [c.date, c])),
    [calendar],
  );

  if (calendar.length === 0) return null;

  const min = Math.min(...calendar.map((c) => c.total));
  const monthKey = calendar[0].date.slice(0, 7);
  const firstDow = new Date(`${monthKey}-01T00:00:00Z`).getUTCDay();
  const days = monthDays(monthKey);

  return (
    <section className="glass mt-8 p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {trip === "oneway"
            ? "One-way fare by departure day"
            : "Cheapest round trip by departure day"}
        </h2>

        <div className="inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span>cheaper</span>
          <span
            aria-hidden="true"
            className="h-2 w-16 rounded-full border border-black/5 dark:border-white/10"
            style={{
              background:
                "linear-gradient(90deg, hsl(135 var(--heat-sat) var(--heat-light)), hsl(65 var(--heat-sat) var(--heat-light)), hsl(5 var(--heat-sat) var(--heat-light)))",
            }}
          />
          <span>pricier</span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]"
          >
            {d}
          </div>
        ))}

        {Array.from({ length: firstDow }, (_, i) => (
          <div key={`pad-${i}`} aria-hidden="true" />
        ))}

        {days.map((date) => {
          const c = calendarByDate.get(date);
          if (!c) {
            return (
              <div
                key={date}
                className="flex flex-col items-center justify-center rounded-xl border border-transparent py-2 px-1 text-center text-xs text-[var(--text-muted)] opacity-55"
                style={{ backgroundColor: "var(--heat-empty-bg)" }}
              >
                <span className="font-medium tabular-nums">{date.slice(8)}</span>
                <span className="text-[10px]">—</span>
              </div>
            );
          }

          // Colour by how far above the cheapest day (0% green to 25%+ red).
          const t = min > 0 ? Math.min(1, (c.total - min) / (min * 0.25)) : 0;
          const hue = Math.round(135 - 130 * t);

          return (
            <div
              key={date}
              title={`${fmtDate(c.date)}: ${inr.format(c.total)}${
                c.gap ? ` (${c.gap} days)` : ""
              }`}
              className="flex flex-col items-center justify-center rounded-xl border border-white/40 dark:border-white/10 py-2 px-1 text-center text-xs shadow-xs transition-transform hover:scale-[1.03]"
              style={{
                backgroundColor: `hsl(${hue} var(--heat-sat) var(--heat-light))`,
                color: "var(--heat-text)",
              }}
            >
              <div className="font-semibold tabular-nums leading-tight">
                {c.date.slice(8)}
              </div>
              <div className="mt-0.5 text-[11px] font-medium tabular-nums opacity-90 leading-tight">
                {Math.round(c.total / 100) / 10}k
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
