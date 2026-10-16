import { orderedSites, SITES } from "@/lib/links";
import type { DayFare, TripWindow } from "@/lib/types";
import { fmtDate, inr } from "./format";
import GlassCard from "./ui/GlassCard";
import { ExternalLinkIcon } from "./ui/Icons";

type BookingTarget =
  | { mode: "round"; window: TripWindow }
  | { mode: "oneway"; day: DayFare };

interface BookingPanelProps {
  target: BookingTarget;
  origin: string;
  destination: string;
}

function sourceLabel(key: string): string {
  return SITES.find((s) => s.key === key)?.label ?? key;
}

export default function BookingPanel({
  target,
  origin,
  destination,
}: BookingPanelProps) {
  const isRound = target.mode === "round";
  const preferredSource = isRound
    ? target.window.depart.source === target.window.ret.source
      ? target.window.depart.source
      : undefined
    : target.day.source;

  const [best, ...others] = orderedSites(preferredSource);
  const totalPrice = isRound ? target.window.total : target.day.price;
  const linkFor = (s: typeof best) =>
    isRound
      ? s.url(origin, destination, target.window.depart.date, target.window.ret.date)
      : s.url(origin, destination, target.day.date);

  const legs: { label: string; leg: DayFare }[] = isRound
    ? [
        { label: "Outbound", leg: target.window.depart },
        { label: "Return", leg: target.window.ret },
      ]
    : [{ label: "Outbound", leg: target.day }];

  return (
    <GlassCard as="section" variant="strong" className="p-5 sm:p-6 grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {isRound ? "Book this window" : "Book this day"}
        </h2>
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          {origin} → {destination}
        </span>
      </div>

      {/* Hero best-price card */}
      <div className="glass-subtle rounded-2xl p-4 sm:p-5 grid gap-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
              Best price
            </div>
            <div className="mt-0.5 text-3xl sm:text-4xl font-semibold tabular-nums tracking-tight text-[var(--text-primary)]">
              {inr.format(totalPrice)}
            </div>
            <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
              on {best.label} ·{" "}
              {isRound
                ? `${fmtDate(target.window.depart.date)} – ${fmtDate(target.window.ret.date)}`
                : fmtDate(target.day.date)}
            </div>
          </div>
        </div>

        <a
          href={linkFor(best)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-accent focus-ring inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
        >
          <span>Book on {best.label}</span>
          <ExternalLinkIcon className="h-4 w-4 opacity-90" />
        </a>
      </div>

      {/* Per-leg breakdown */}
      <ul className="grid gap-1.5 text-xs text-[var(--text-secondary)]">
        {legs.map(({ label, leg }) => (
          <li
            key={label}
            className="glass-subtle flex items-center justify-between gap-2 rounded-xl px-3 py-2"
          >
            <span>
              <strong className="font-semibold text-[var(--text-primary)]">{label}</strong>{" "}
              <span className="tabular-nums font-medium">{inr.format(leg.price)}</span>{" "}
              via {sourceLabel(leg.source)}
              {leg.airline ? `, ${leg.airline}` : ""}
            </span>
            <span className="text-[11px] text-[var(--text-muted)] shrink-0">
              {fmtDate(leg.date)}
            </span>
          </li>
        ))}
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
                href={linkFor(s)}
                target="_blank"
                rel="noopener noreferrer"
                className="glass-subtle-interactive focus-ring flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium text-[var(--text-primary)]"
              >
                <span>{s.label}</span>
                <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                  <span>
                    {s.verified ? "check price" : "check price (link untested)"}
                  </span>
                  <ExternalLinkIcon className="h-3.5 w-3.5 opacity-75" />
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </GlassCard>
  );
}
