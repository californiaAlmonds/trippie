"use client";

import { orderedSites, SITES } from "@/lib/links";
import type { Cabin, DayFare } from "@/lib/types";
import { useCurrency } from "./currency/CurrencyProvider";
import {
  buildBookingUrl,
  ESTIMATE_TOOLTIP,
  fmtDate,
  formatDuration,
  formatFlightTimes,
  formatRelativeChecked,
  formatStops,
} from "./format";
import { ExternalLinkIcon } from "./icons";

interface OneWayBookingPanelProps {
  day: DayFare;
  origin: string;
  destination: string;
  cabin?: Cabin;
  lastCheckedAt?: string | null;
}

function sourceLabel(key: string): string {
  return SITES.find((s) => s.key === key)?.label ?? key;
}

export default function OneWayBookingPanel({
  day,
  origin,
  destination,
  cabin = "economy",
}: OneWayBookingPanelProps) {
  const { currency, format } = useCurrency();
  const [best, ...others] = orderedSites(day.source);
  const link = (s: typeof best) =>
    buildBookingUrl(s, origin, destination, day.date, undefined, {
      currency,
      cabin,
    });

  const times = formatFlightTimes(day);
  const duration = formatDuration(day.durationMin);
  const stops = formatStops(day.stops);
  const checkedLabel = day.checkedAt
    ? formatRelativeChecked(day.checkedAt)
    : "Estimate (cached fare, time unknown)";
  const detailParts = [
    times,
    duration,
    stops,
    day.flightNo,
    day.aircraft,
  ].filter(Boolean);

  return (
    <section className="glass-strong p-5 sm:p-6 grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Book this day
        </h2>
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          {origin} → {destination}
          {cabin === "business" ? " · Business" : ""}
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
              {format(day.price)}
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
      <div className="glass-subtle rounded-xl px-3.5 py-2.5 grid gap-1 text-xs text-[var(--text-secondary)]">
        <div className="flex items-center justify-between gap-2">
          <span className="flex flex-wrap items-center gap-1.5">
            <strong className="font-semibold text-[var(--text-primary)]">
              Outbound
            </strong>{" "}
            <span className="tabular-nums font-medium">
              {format(day.price)}
            </span>{" "}
            <span>
              via {sourceLabel(day.source)}
              {day.airline ? `, ${day.airline}` : ""}
            </span>
            {day.estimate && (
              <span
                title={ESTIMATE_TOOLTIP}
                aria-description={ESTIMATE_TOOLTIP}
                className="inline-flex items-center rounded-full border border-[var(--delta-amber-border)] bg-[var(--delta-amber-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--delta-amber-text)]"
              >
                Estimate
              </span>
            )}
          </span>
          <span className="text-[11px] text-[var(--text-muted)] shrink-0">
            {fmtDate(day.date)}
          </span>
        </div>

        {(detailParts.length > 0 || checkedLabel) && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
            {detailParts.length > 0 ? (
              <span className="tabular-nums text-[var(--text-secondary)]">
                {detailParts.join(" · ")}
              </span>
            ) : (
              <span />
            )}
            {checkedLabel && <span>{checkedLabel}</span>}
          </div>
        )}
      </div>

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
                className="glass-subtle-interactive focus-ring flex min-h-[44px] items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium text-[var(--text-primary)]"
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
