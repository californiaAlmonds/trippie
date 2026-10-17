"use client";

import { orderedSites, SITES } from "@/lib/links";
import type { Cabin, DayFare, TripWindow } from "@/lib/types";
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

interface BookingPanelProps {
  window: TripWindow;
  origin: string;
  destination: string;
  cabin?: Cabin;
  lastCheckedAt?: string | null;
}

function sourceLabel(key: string): string {
  return SITES.find((s) => s.key === key)?.label ?? key;
}

export default function BookingPanel({
  window: w,
  origin,
  destination,
  cabin = "economy",
}: BookingPanelProps) {
  const { currency, format } = useCurrency();
  const preferredSource =
    w.depart.source === w.ret.source ? w.depart.source : undefined;
  const [best, ...others] = orderedSites(preferredSource);
  const link = (s: typeof best) =>
    buildBookingUrl(s, origin, destination, w.depart.date, w.ret.date, {
      currency,
      cabin,
    });

  const airlines = Array.from(
    new Set([w.depart.airline, w.ret.airline].filter(Boolean)),
  ).join(" · ");

  const legs: { label: string; leg: DayFare }[] = [
    { label: "Outbound", leg: w.depart },
    { label: "Return", leg: w.ret },
  ];

  return (
    <section className="glass-strong p-5 sm:p-6 grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Book this window
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
              {format(w.total)}
            </div>
            <div className="mt-1 text-sm font-medium text-white/95">
              on {best.label}
              {airlines ? ` · ${airlines}` : ""}
            </div>
            <div className="mt-0.5 text-xs text-white/80">
              {fmtDate(w.depart.date)} – {fmtDate(w.ret.date)} ({w.gap} days)
            </div>
          </div>
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
            <ExternalLinkIcon className="h-4 w-4" />
          </span>
        </div>
      </a>

      {/* Per-leg breakdown */}
      <ul className="grid gap-2 text-xs text-[var(--text-secondary)]">
        {legs.map(({ label, leg }) => {
          const times = formatFlightTimes(leg);
          const duration = formatDuration(leg.durationMin);
          const stops = formatStops(leg.stops);
          const checkedLabel = leg.checkedAt
            ? formatRelativeChecked(leg.checkedAt)
            : "Estimate (cached fare, time unknown)";
          const detailParts = [
            times,
            duration,
            stops,
            leg.flightNo,
            leg.aircraft,
          ].filter(Boolean);

          return (
            <li
              key={label}
              className="glass-subtle rounded-xl px-3.5 py-2.5 grid gap-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-1.5">
                  <strong className="font-semibold text-[var(--text-primary)]">
                    {label}
                  </strong>{" "}
                  <span className="tabular-nums font-medium">
                    {format(leg.price)}
                  </span>{" "}
                  <span>
                    via {sourceLabel(leg.source)}
                    {leg.airline ? `, ${leg.airline}` : ""}
                  </span>
                  {leg.estimate && (
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
                  {fmtDate(leg.date)}
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
            </li>
          );
        })}
      </ul>

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
