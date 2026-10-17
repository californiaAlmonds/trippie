"use client";

import type { TripMode } from "@/lib/search";
import { useCurrency } from "./currency/CurrencyProvider";
import { fmtDate } from "./format";
import { SparklineEmptyIcon } from "./icons";

export interface PriceStats {
  min: number;
  max: number;
  p25: number;
  median: number;
  samples: number;
  since: string;
}

export interface RouteStatsBundle {
  outbound: PriceStats | null;
  inbound: PriceStats | null;
  total: PriceStats | null;
}

export interface RouteFreshness {
  lastCheckedAt: string | null;
  tracked: boolean;
  collecting: boolean;
}

interface PriceInsightsCardProps {
  trip: TripMode;
  stats?: RouteStatsBundle | null;
  currentBest?: number | null;
}

function clampPct(value: number, min: number, max: number): number {
  if (max <= min) return 50;
  const raw = ((value - min) / (max - min)) * 100;
  return Math.min(100, Math.max(0, raw));
}

function formatSinceDate(since: string): string {
  if (!since) return "";
  const iso = since.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return fmtDate(iso);
  }
  return since;
}

export default function PriceInsightsCard({
  trip,
  stats,
  currentBest,
}: PriceInsightsCardProps) {
  const { format } = useCurrency();

  const primary = stats?.total ?? (trip === "oneway" ? stats?.outbound ?? null : null);

  if (!primary || primary.samples <= 0) {
    return (
      <section className="glass p-5 sm:p-6 grid gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Price insights
          </h2>
        </div>
        <div className="glass-subtle flex items-center gap-3 rounded-2xl px-3.5 py-3 text-xs text-[var(--text-muted)]">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-500/10 text-[var(--accent)]">
            <SparklineEmptyIcon className="h-4 w-4" />
          </span>
          <p>Not enough history yet. Insights appear once route prices are tracked.</p>
        </div>
      </section>
    );
  }

  const p25Pct = clampPct(primary.p25, primary.min, primary.max);
  const medianPct = clampPct(primary.median, primary.min, primary.max);
  const bandLeft = Math.min(p25Pct, medianPct);
  const bandWidth = Math.max(6, Math.abs(medianPct - p25Pct));
  const bestPct =
    typeof currentBest === "number" && currentBest > 0
      ? clampPct(currentBest, primary.min, primary.max)
      : null;

  const sinceText = formatSinceDate(primary.since);

  return (
    <section className="glass p-5 sm:p-6 grid gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Price insights
        </h2>
        <span className="text-[11px] font-medium tabular-nums text-[var(--text-muted)]">
          {primary.samples} {primary.samples === 1 ? "sample" : "samples"}
          {sinceText ? ` · tracking since ${sinceText}` : ""}
        </span>
      </div>

      <div className="glass-subtle rounded-2xl p-3.5 grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              Typical:{" "}
            </span>
            <strong className="text-sm sm:text-base font-semibold tabular-nums text-[var(--text-primary)]">
              {format(primary.p25)}–{format(primary.median)}
            </strong>
          </div>
          {typeof currentBest === "number" && currentBest > 0 && (
            <span className="inline-flex items-center rounded-full border border-[var(--badge-lowest-border)] bg-[var(--badge-lowest-bg)] px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--badge-lowest-text)]">
              Current best: {format(currentBest)}
            </span>
          )}
        </div>

        {/* Mini range bar with current best marker */}
        <div className="grid gap-1.5">
          <div
            role="img"
            aria-label={`Price range from lowest seen ${format(primary.min)} to highest seen ${format(primary.max)}${
              typeof currentBest === "number" && currentBest > 0
                ? `, current best ${format(currentBest)}`
                : ""
            }`}
            className="relative h-2.5 w-full rounded-full bg-slate-500/15 dark:bg-white/10"
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-0 rounded-full bg-[var(--accent)]/45"
              style={{
                left: `${bandLeft}%`,
                width: `${Math.min(100 - bandLeft, bandWidth)}%`,
              }}
            />
            {bestPct !== null && (
              <span
                aria-hidden="true"
                title={`Current best: ${format(currentBest!)}`}
                className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--accent)] shadow-xs"
                style={{ left: `${bestPct}%` }}
              />
            )}
          </div>

          <div className="flex items-center justify-between gap-2 text-[11px] tabular-nums text-[var(--text-secondary)]">
            <span>
              Lowest seen{" "}
              <strong className="font-semibold text-[var(--text-primary)]">
                {format(primary.min)}
              </strong>
            </span>
            <span>
              Highest seen{" "}
              <strong className="font-semibold text-[var(--text-primary)]">
                {format(primary.max)}
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* Per-leg insights for round trip when available */}
      {trip === "round" && (stats?.outbound || stats?.inbound) && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs text-[var(--text-secondary)]">
          {stats?.outbound && (
            <div className="glass-subtle rounded-xl px-3 py-2 flex items-center justify-between gap-2">
              <span className="font-medium text-[var(--text-primary)]">Outbound typical</span>
              <span className="tabular-nums font-semibold">
                {format(stats.outbound.p25)}–{format(stats.outbound.median)}
              </span>
            </div>
          )}
          {stats?.inbound && (
            <div className="glass-subtle rounded-xl px-3 py-2 flex items-center justify-between gap-2">
              <span className="font-medium text-[var(--text-primary)]">Return typical</span>
              <span className="tabular-nums font-semibold">
                {format(stats.inbound.p25)}–{format(stats.inbound.median)}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
