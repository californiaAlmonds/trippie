import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampAndRoundInr,
  computeCurrencyStep,
  computeDefaultTargetInr,
  computeInrRange,
  computeSliderBounds,
  formatCellPrice,
  inrToSliderValue,
  sliderValueToInr,
} from "./sliderMath.ts";

const SAMPLE_RATES: Record<string, number> = {
  INR: 1,
  USD: 0.012,
  JPY: 1.8,
  THB: 0.4,
  LKR: 3.6,
  BDT: 1.4,
  NPR: 1.6,
};

function makeConverters(currency: string) {
  const rate = SAMPLE_RATES[currency] ?? 1;
  return {
    convert: (inr: number) => (currency === "INR" ? inr : inr * rate),
    toInr: (cur: number) =>
      currency === "INR" ? Math.round(cur) : Math.round(cur / rate),
  };
}

test("slider step and position math advances by at least one INR-distinct value per step across INR, JPY, THB, LKR, BDT, NPR, USD", () => {
  const currencies = ["INR", "JPY", "THB", "LKR", "BDT", "NPR", "USD"];
  const priceAnchorsInr = [2_500, 6_000, 12_000, 45_000];

  for (const currency of currencies) {
    const { convert, toInr } = makeConverters(currency);

    for (const anchorInr of priceAnchorsInr) {
      const { minInr, maxInr } = computeInrRange(null, anchorInr, anchorInr);
      const bounds = computeSliderBounds({
        minInr,
        maxInr,
        anchorInr,
        currency,
        convert,
        toInr,
      });

      assert.ok(
        bounds.step > 0,
        `Expected positive step for ${currency} @ ${anchorInr} INR`,
      );
      assert.ok(
        toInr(bounds.step) >= 50,
        `Expected step (${bounds.step} ${currency} = ${toInr(bounds.step)} INR) >= 50 INR`,
      );
      assert.ok(
        bounds.maxCur > bounds.minCur,
        `Expected maxCur > minCur for ${currency} @ ${anchorInr} INR`,
      );

      const initialPos = inrToSliderValue(anchorInr, bounds, convert);
      assert.ok(
        initialPos >= bounds.minCur && initialPos <= bounds.maxCur,
        `Expected initial slider position ${initialPos} within [${bounds.minCur}, ${bounds.maxCur}] for ${currency}`,
      );

      let prevInr = sliderValueToInr(bounds.minCur, toInr);
      let stepsChecked = 0;
      for (
        let cur = bounds.minCur + bounds.step;
        cur <= bounds.maxCur;
        cur += bounds.step
      ) {
        const nextInr = sliderValueToInr(cur, toInr);
        assert.ok(
          nextInr > prevInr,
          `Expected ${currency} step ${cur - bounds.step} -> ${cur} to advance INR (${prevInr} -> ${nextInr})`,
        );
        prevInr = nextInr;
        stepsChecked++;
      }
      assert.ok(
        stepsChecked >= 3,
        `Expected at least 3 slider steps for ${currency} @ ${anchorInr} INR, got ${stepsChecked}`,
      );
    }
  }
});

test("computeCurrencyStep enforces >= 50 INR step even when called without toInr", () => {
  for (const currency of ["INR", "JPY", "THB", "LKR", "BDT", "NPR", "USD"]) {
    const { convert, toInr } = makeConverters(currency);
    const step = computeCurrencyStep(convert(2000), convert(6000), currency);
    assert.ok(
      toInr(step) >= 50,
      `Fallback step ${step} for ${currency} should be >= 50 INR, got ${toInr(step)}`,
    );
  }
});

test("clampAndRoundInr and computeDefaultTargetInr clamp and round to 50 INR increments", () => {
  assert.equal(clampAndRoundInr(100), 500);
  assert.equal(clampAndRoundInr(1_500_000), 1_000_000);
  assert.equal(clampAndRoundInr(4_324), 4_300);
  assert.equal(clampAndRoundInr(4_326), 4_350);
  assert.equal(computeDefaultTargetInr(null, 10_000), 9_500);
  assert.equal(
    computeDefaultTargetInr(
      { min: 4000, max: 9000, p25: 5120, median: 6000, samples: 10, since: "2026-01-01" },
      10_000,
    ),
    5_100,
  );
});

test("formatCellPrice includes currency symbol in compact labels and marks converted currencies approximate", () => {
  const inrFormat = (inr: number) => `₹${inr.toLocaleString("en-IN")}`;
  const usdFormat = (inr: number) => `≈$${Math.round(inr * 0.012)}`;

  assert.equal(formatCellPrice(4500, "INR", inrFormat, 4500, "₹"), "₹4.5k");
  assert.equal(formatCellPrice(850, "INR", inrFormat, 850, "₹"), "₹850");

  assert.equal(formatCellPrice(1200, "USD", usdFormat, 100000, "$"), "≈$1.2k");
  assert.equal(formatCellPrice(144, "USD", usdFormat, 12000, "$"), "≈$144");

  assert.equal(formatCellPrice(18500, "JPY", usdFormat, 10278, "¥"), "≈¥18.5k");
  assert.equal(formatCellPrice(4200, "THB", usdFormat, 10500, "฿"), "≈฿4.2k");
  assert.equal(formatCellPrice(36000, "LKR", usdFormat, 10000), "≈LKR36k");
});
