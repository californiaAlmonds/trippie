import { orderedSites, SITES } from "@/lib/links";
import type { DayFare } from "@/lib/types";
import { fmtDate, inr } from "./format";
import { ExternalLinkIcon } from "./icons";

interface OneWayBookingPanelProps {
  day: DayFare;
  origin: string;
  destination: string;
}

function sourceLabel(key: string): string {
  return SITES.find((s) => s.key === key)?.label ?? key;
}

export default function OneWayBookingPanel({
  day,
  origin,
  destination,
}: OneWayBookingPanelProps) {
  const [best, ...others] = orderedSites(day.source);
  const link = (s: typeof best) => s.url(origin, destination, day.date);

  return (
    <section className="glass-strong p-5 sm:p-6 grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Book this day
        </h2>
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          {origin} → {destination}
        </span>
      </div>

      {/* Hero price card in blue glass */}
      <a
        href={link(best)}
        target="_blank"
        rel="noopener noreferrer"
        className="glass-blue focus-ring block rounded-2xl p-4 sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-white/80">
              Best price
            </div>
            <div className="mt-0.5 text-2xl sm:text-3xl font-semibold tabular-nums tracking-tight text-white">
              {inr.format(day.price)}
            </div>
            <div className="mt-1 text-sm font-medium text-white/95">
              on {best.label}
              {day.airline ? ` · ${day.airline}` : ""}
            </div>
            <div className="mt-0.5 text-xs text-white/80">
              {fmtDate(day.date)} · One way
            </div>
          </div>
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
            <ExternalLinkIcon className="h-4 w-4" />
          </span>
        </div>
      </a>

      {/* Outbound leg breakdown */}
      <p className="glass-subtle flex items-center justify-between gap-2 rounded-xl px-3.5 py-2 text-xs text-[var(--text-secondary)]">
        <span>
          <strong className="font-semibold text-[var(--text-primary)]">
            Outbound
          </strong>{" "}
          <span className="tabular-nums font-medium">
            {inr.format(day.price)}
          </span>{" "}
          via {sourceLabel(day.source)}
          {day.airline ? `, ${day.airline}` : ""}
        </span>
        <span className="text-[11px] text-[var(--text-muted)] shrink-0">
          {fmtDate(day.date)}
        </span>
      </p>

      {/* Compare on other sites */}
      <div className="grid gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Compare on other sites
        </div>
        <ul className="grid gap-1.5">
          {others.map((s) => (
            <li key={s.key}>
              <a
                href={link(s)}
                target="_blank"
                rel="noopener noreferrer"
                className="glass-subtle-interactive focus-ring flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium text-[var(--text-primary)]"
              >
                <span>{s.label}</span>
                <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                  <span>check price</span>
                  {!s.verified && (
                    <span className="inline-flex items-center rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                      link untested
                    </span>
                  )}
                  <ExternalLinkIcon className="h-3.5 w-3.5 opacity-75" />
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
