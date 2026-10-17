"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useCurrency } from "../currency/CurrencyProvider";
import { SpinnerIcon } from "../icons";
import type { PriceStats } from "../PriceInsightsCard";
import {
  clampAndRoundInr,
  computeCurrencyStep,
  computeDefaultTargetInr,
  computeInrRange,
  computeSliderBounds,
  inrToSliderValue,
  pctInRange,
  sliderValueToInr,
} from "./sliderMath";

export { clampAndRoundInr, computeCurrencyStep, computeDefaultTargetInr };

interface PriceLimitSliderProps {
  stats?: PriceStats | null;
  currentBest?: number | null;
  targetPriceInr: number;
  onChangeInr: (nextInr: number) => void;
  onCommitInr?: (nextInr: number) => void;
  disabled?: boolean;
  saving?: boolean;
  label?: string;
}

const COMMIT_DEBOUNCE_MS = 600;

export default function PriceLimitSlider({
  stats,
  currentBest,
  targetPriceInr,
  onChangeInr,
  onCommitInr,
  disabled = false,
  saving = false,
  label = "Alert price limit",
}: PriceLimitSliderProps) {
  const { currency, convert, toInr, format } = useCurrency();
  const sliderId = useId();

  const [sliderState, setSliderState] = useState<{
    currency: string;
    lastEmittedInr: number;
    anchorInr: number;
    curVal: number | null;
  }>(() => ({
    currency,
    lastEmittedInr: targetPriceInr,
    anchorInr: targetPriceInr > 0 ? targetPriceInr : 12_000,
    curVal: null,
  }));

  const isSynced =
    sliderState.currency === currency &&
    sliderState.lastEmittedInr === targetPriceInr &&
    sliderState.curVal !== null;

  const anchorInr = isSynced
    ? sliderState.anchorInr
    : targetPriceInr > 0
      ? targetPriceInr
      : 12_000;

  const { minInr, maxInr } = useMemo(
    () => computeInrRange(stats, currentBest, anchorInr),
    [stats, currentBest, anchorInr],
  );

  const bounds = useMemo(
    () =>
      computeSliderBounds({
        minInr,
        maxInr,
        anchorInr,
        currency,
        convert,
        toInr,
      }),
    [minInr, maxInr, anchorInr, currency, convert, toInr],
  );

  const { effectiveMinInr, effectiveMaxInr, minCur, maxCur, step } = bounds;

  const currentCurVal = isSynced
    ? Math.min(maxCur, Math.max(minCur, sliderState.curVal!))
    : inrToSliderValue(targetPriceInr, bounds, convert);

  const onCommitRef = useRef(onCommitInr);
  useEffect(() => {
    onCommitRef.current = onCommitInr;
  }, [onCommitInr]);

  const dirtyInrRef = useRef<number | null>(null);
  const pointerDownRef = useRef(false);
  const debounceTimerRef = useRef<number | null>(null);
  const windowPointerCleanupRef = useRef<(() => void) | null>(null);

  const flushCommit = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (dirtyInrRef.current !== null) {
      const val = dirtyInrRef.current;
      dirtyInrRef.current = null;
      onCommitRef.current?.(val);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (windowPointerCleanupRef.current) {
        windowPointerCleanupRef.current();
        windowPointerCleanupRef.current = null;
      }
      dirtyInrRef.current = null;
    };
  }, []);

  const handlePointerDown = useCallback(() => {
    pointerDownRef.current = true;
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (windowPointerCleanupRef.current) {
      windowPointerCleanupRef.current();
    }
    const handleWindowPointerEnd = () => {
      pointerDownRef.current = false;
      window.removeEventListener("pointerup", handleWindowPointerEnd);
      window.removeEventListener("pointercancel", handleWindowPointerEnd);
      windowPointerCleanupRef.current = null;
      flushCommit();
    };
    windowPointerCleanupRef.current = () => {
      window.removeEventListener("pointerup", handleWindowPointerEnd);
      window.removeEventListener("pointercancel", handleWindowPointerEnd);
    };
    window.addEventListener("pointerup", handleWindowPointerEnd, { once: true });
    window.addEventListener("pointercancel", handleWindowPointerEnd, {
      once: true,
    });
  }, [flushCommit]);

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
        <span className="inline-flex items-center gap-2">
          {saving && (
            <span
              role="status"
              aria-live="polite"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]"
            >
              <SpinnerIcon className="h-3 w-3 animate-spin text-[var(--accent)]" />
              <span>Saving…</span>
            </span>
          )}
          <strong className="text-xs sm:text-sm font-semibold tabular-nums text-[var(--accent)]">
            {formattedValueText}
          </strong>
        </span>
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
          onPointerDown={handlePointerDown}
          onPointerUp={() => {
            pointerDownRef.current = false;
            flushCommit();
          }}
          onPointerCancel={() => {
            pointerDownRef.current = false;
            flushCommit();
          }}
          onBlur={() => {
            pointerDownRef.current = false;
            flushCommit();
          }}
          onChange={(e) => {
            const curVal = Number(e.target.value);
            const nextInr = sliderValueToInr(curVal, toInr);
            setSliderState({
              currency,
              lastEmittedInr: nextInr,
              anchorInr,
              curVal,
            });
            onChangeInr(nextInr);
            if (onCommitRef.current) {
              dirtyInrRef.current = nextInr;
              if (debounceTimerRef.current !== null) {
                window.clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
              }
              if (!pointerDownRef.current) {
                debounceTimerRef.current = window.setTimeout(
                  flushCommit,
                  COMMIT_DEBOUNCE_MS,
                );
              }
            }
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
