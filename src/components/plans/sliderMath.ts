import type { PriceStats } from "@/lib/types";

export const MIN_INR = 500;
export const MAX_INR = 1_000_000;
export const INR_STEP = 50;

const NICE_STEPS = [
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000,
  25000, 50000, 100000,
] as const;

/**
 * Fallback minimum step per currency when `toInr` is not supplied, chosen so
 * one step is always worth >= 50 INR at typical exchange rates.
 */
const MIN_STEP_BY_CURRENCY: Readonly<Record<string, number>> = {
  INR: 50,
  JPY: 100,
  THB: 25,
  LKR: 200,
  BDT: 100,
  NPR: 100,
  KRW: 1000,
  IDR: 10000,
  VND: 20000,
};

const COMPACT_CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  AED: "AED",
  SAR: "SAR",
  QAR: "QAR",
  KWD: "KWD",
  OMR: "OMR",
  BHD: "BHD",
  SGD: "S$",
  MYR: "RM",
  THB: "฿",
  AUD: "A$",
  NZD: "NZ$",
  CAD: "CA$",
  JPY: "¥",
  CNY: "CN¥",
  HKD: "HK$",
  CHF: "CHF",
  LKR: "LKR",
  NPR: "NPR",
  BDT: "৳",
  ZAR: "R",
};

export function clampAndRoundInr(rawInr: number): number {
  if (!Number.isFinite(rawInr)) return MIN_INR;
  const rounded = Math.round(rawInr / INR_STEP) * INR_STEP;
  return Math.min(MAX_INR, Math.max(MIN_INR, rounded));
}

export function computeCurrencyStep(
  minCur: number,
  maxCur: number,
  currency: string,
  toInr?: (amountInCurrency: number) => number,
): number {
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "INR";
  if (code === "INR") return INR_STEP;

  const span = Math.max(1, maxCur - minCur);
  let baseStep = 500;
  if (span <= 150) baseStep = 1;
  else if (span <= 600) baseStep = 5;
  else if (span <= 2500) baseStep = 10;
  else if (span <= 10000) baseStep = 50;
  else if (span <= 50000) baseStep = 100;

  const floorStep = Math.max(baseStep, MIN_STEP_BY_CURRENCY[code] ?? 1);

  if (!toInr) {
    for (const s of NICE_STEPS) {
      if (s >= floorStep) return s;
    }
    return floorStep;
  }

  for (const s of NICE_STEPS) {
    if (s < floorStep) continue;
    // Require each step to be worth at least 55 INR so consecutive steps
    // never round to the same 50-INR bucket in clampAndRoundInr.
    if (toInr(s) >= 55) {
      return s;
    }
  }

  return NICE_STEPS[NICE_STEPS.length - 1];
}

export function computeDefaultTargetInr(
  stats?: PriceStats | Pick<PriceStats, "samples" | "p25"> | null,
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

export function computeInrRange(
  stats?: PriceStats | Pick<PriceStats, "samples" | "min" | "max"> | null,
  currentBest?: number | null,
  anchorTargetInr = 12_000,
): { minInr: number; maxInr: number } {
  if (stats && stats.samples > 0 && stats.min > 0 && stats.max >= stats.min) {
    const lo = clampAndRoundInr(stats.min * 0.8);
    const hi = Math.max(lo + 500, clampAndRoundInr(stats.max * 1.1));
    return { minInr: lo, maxInr: hi };
  }
  const base =
    typeof currentBest === "number" && currentBest > 0
      ? currentBest
      : anchorTargetInr > 0
        ? anchorTargetInr
        : 12_000;
  const lo = clampAndRoundInr(base * 0.5);
  const hi = Math.max(lo + 500, clampAndRoundInr(base * 1.5));
  return { minInr: lo, maxInr: hi };
}

export interface SliderBounds {
  effectiveMinInr: number;
  effectiveMaxInr: number;
  minCur: number;
  maxCur: number;
  step: number;
}

export function computeSliderBounds(params: {
  minInr: number;
  maxInr: number;
  anchorInr: number;
  currency: string;
  convert: (inrAmount: number) => number;
  toInr: (amountInCurrency: number) => number;
}): SliderBounds {
  const { minInr, maxInr, anchorInr, currency, convert, toInr } = params;
  const clampedAnchor = clampAndRoundInr(anchorInr);
  const effectiveMinInr = Math.max(MIN_INR, Math.min(minInr, clampedAnchor));
  const effectiveMaxInr = Math.min(
    MAX_INR,
    Math.max(effectiveMinInr + 500, maxInr, clampedAnchor),
  );

  const minCurRaw = Math.max(0, convert(effectiveMinInr));
  const maxCurRaw = Math.max(minCurRaw, convert(effectiveMaxInr));
  const step = computeCurrencyStep(minCurRaw, maxCurRaw, currency, toInr);

  let minCur = Math.max(step, Math.floor(minCurRaw / step) * step);
  while (toInr(minCur) < MIN_INR) {
    minCur += step;
  }

  let maxCur = Math.max(minCur + step, Math.ceil(maxCurRaw / step) * step);
  while (maxCur > minCur + step && toInr(maxCur) > MAX_INR) {
    maxCur -= step;
  }

  return {
    effectiveMinInr,
    effectiveMaxInr,
    minCur,
    maxCur,
    step,
  };
}

export function inrToSliderValue(
  targetPriceInr: number,
  bounds: Pick<SliderBounds, "minCur" | "maxCur" | "step">,
  convert: (inrAmount: number) => number,
): number {
  const snapped = Math.round(convert(targetPriceInr) / bounds.step) * bounds.step;
  return Math.min(bounds.maxCur, Math.max(bounds.minCur, snapped));
}

export function sliderValueToInr(
  curVal: number,
  toInr: (amountInCurrency: number) => number,
): number {
  return clampAndRoundInr(toInr(curVal));
}

export function pctInRange(val: number, lo: number, hi: number): number {
  if (hi <= lo) return 50;
  return Math.min(100, Math.max(0, ((val - lo) / (hi - lo)) * 100));
}

export function resolveCompactCurrencySymbol(
  currency: string,
  symbolOverride?: string,
): string {
  if (symbolOverride && symbolOverride.trim()) {
    return symbolOverride.trim();
  }
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "INR";
  const known = COMPACT_CURRENCY_SYMBOLS[code];
  if (known) return known;
  try {
    const parts = new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}

export function formatCellPrice(
  converted: number,
  currency: string,
  format: (inr: number) => string,
  inrAmount: number,
  symbol?: string,
): string {
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "INR";
  if (converted >= 1000) {
    const k = Math.round(converted / 100) / 10;
    const sym = resolveCompactCurrencySymbol(code, symbol);
    const prefix = code === "INR" ? "" : "≈";
    return `${prefix}${sym}${k}k`;
  }
  return format(inrAmount);
}
