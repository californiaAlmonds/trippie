"use client";

import { useId, useMemo } from "react";
import { useCurrency } from "../currency/CurrencyProvider";
import type { PriceStats } from "../PriceInsightsCard";

interface PriceLimitSliderProps {
  stats?: PriceStats | null;
  currentBest?: number | null;
  targetPriceInr: number;
  onChangeInr: (nextInr: number) => void;
  disabled?: boolean;
  label?: string;
}

const MIN_INR = 500;
const MAX_INR = 1_000_000;

export function clampAndRoundInr(rawInr: number): number {
  if (!Number.isFinite(rawInr)) return MIN_INR;
  const rounded = Math.round(rawInr / 50) * 50;
  return Math.min(MAX_INR, Math.max(MIN_INR, rounded));
}

export function computeCurrencyStep(minCur: number, maxCur: number, currency: string): number {
  if (currency === "INR") return 50;
  const span = Math.max(1, maxCur - minCur);
  if (span <= 150) return 1;
  if (span <= 600) return 5;
  if (span <= 2500) return 10;
  if (span <= 10000) return 50;
  if (span <= 50000) return 100;
  return 500;
}

export function computeDefaultTargetInr(
  stats?: PriceStats | null,
  currentBest?: number | null,
): number {
  if (stats && stats.samples > 0 && stats.p25 > 0) {
    return clampAndRoundInr(stats.p25);
  }
  if (typeof currentBest === "number" && currentBest > 0) {
    return clampAndRoundInr(currentBest * 0.95);
  }
  return 10_000;
}

function pctInRange(val: number, lo: number, hi: number): number {
  if (hi <= lo) return 50;
  return Math.min(100, Math.max(0, ((val - lo) / (hi - lo)) * 100));
}

export default function PriceLimitSlider({
  stats,
  currentBest,
  targetPriceInr,
  onChangeInr,
  disabled = false,
  label = "Alert price limit",
}: PriceLimitSliderProps) {
  const { currency, convert, toInr, format } = useCurrency();
  const sliderId = useId();

  const { minInr, maxInr } = useMemo(() => {
    if (stats && stats.samples > 0 && stats.min > 0 && stats.max >= stats.min) {
      const lo = clampAndRoundInr(stats.min * 0.8);
      const hi = Math.max(lo + 500, clampAndRoundInr(stats.max * 1.1));
      return { minInr: lo, maxInr: hi };
    }
    const base =
      typeof currentBest === "number" && currentBest > 0
        ? currentBest
        : targetPriceInr > 0
          ? targetPriceInr
          : 12_000;
    const lo = clampAndRoundInr(base * 0.5);
    const hi = Math.max(lo + 500, clampAndRoundInr(base * 1.5));
    return { minInr: lo, maxInr: hi };
  }, [stats, currentBest, targetPriceInr]);

  const effectiveMinInr = Math.min(minInr, targetPriceInr);
  const effectiveMaxInr = Math.max(maxInr, targetPriceInr);

  const minCurRaw = convert(effectiveMinInr);
  const maxCurRaw = convert(effectiveMaxInr);
  const step = computeCurrencyStep(minCurRaw, maxCurRaw, currency);

  const minCur = Math.max(1, Math.floor(minCurRaw / step) * step);
  const maxCur = Math.max(minCur + step, Math.ceil(maxCurRaw / step) * step);

  const currentCurVal = Math.min(
    maxCur,
    Math.max(minCur, Math.round(convert(targetPriceInr) / step) * step),
  );

  const formattedValueText = format(targetPriceInr);

  const bestMarkerPct =
    typeof currentBest === "number" && currentBest > 0
      ? pctInRange(currentBest, effectiveMinInr, effectiveMaxInr)
      : null;

  const lowestTickInr = stats && stats.samples > 0 ? stats.min : null;
  const typicalTickInr = stats && stats.samples > 0 ? stats.median : null;
  const highestTickInr = stats && stats.samples > 0 ? stats.max : null;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={sliderId}
          className="text-xs font-medium text-[var(--text-secondary)]"
        >
          {label}
        </label>
        <strong className="text-xs sm:text-sm font-semibold tabular-nums text-[var(--accent)]">
          {formattedValueText}
        </strong>
      </div>

      <div className="relative flex items-center py-2">
        <input
          id={sliderId}
          type="range"
          min={minCur}
          max={maxCur}
          step={step}
          value={currentCurVal}
          disabled={disabled}
          aria-label={label}
          aria-valuetext={formattedValueText}
          onChange={(e) => {
            const curVal = Number(e.target.value);
            const nextInr = clampAndRoundInr(toInr(curVal));
            onChangeInr(nextInr);
          }}
          className="focus-ring min-h-[44px] w-full accent-[var(--accent)] cursor-pointer disabled:opacity-50"
        />
        {bestMarkerPct !== null && (
          <span
            aria-hidden="true"
            title={`Current best: ${format(currentBest!)}`}
            className="pointer-events-none absolute top-1 h-2 w-0.5 bg-[var(--badge-lowest-text)]"
            style={{ left: `${bestMarkerPct}%` }}
          />
        )}
      </div>

      {/* Tick labels */}
      {lowestTickInr !== null && typicalTickInr !== null && highestTickInr !== null ? (
        <div className="grid grid-cols-3 gap-1 text-[10px] text-[var(--text-muted)] tabular-nums">
          <div className="text-left">
            <div className="font-medium text-[var(--text-secondary)]">Lowest seen</div>
            <div>{format(lowestTickInr)}</div>
          </div>
          <div className="text-center">
            <div className="font-medium text-[var(--text-secondary)]">Typical</div>
            <div>{format(typicalTickInr)}</div>
          </div>
          <div className="text-right">
            <div className="font-medium text-[var(--text-secondary)]">Highest seen</div>
            <div>{format(highestTickInr)}</div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--text-muted)] tabular-nums">
          <span>{format(effectiveMinInr)}</span>
          {typeof currentBest === "number" && currentBest > 0 && (
            <span className="font-medium text-[var(--badge-lowest-text)]">
              Current best: {format(currentBest)}
            </span>
          )}
          <span>{format(effectiveMaxInr)}</span>
        </div>
      )}
    </div>
  );
}
