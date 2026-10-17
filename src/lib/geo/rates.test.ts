import assert from "node:assert/strict";
import { test } from "node:test";
import { isSupportedCurrency } from "./currency.ts";
import {
  FALLBACK_RATES_URL,
  getRates,
  PRIMARY_RATES_URL,
  resetRatesCache,
} from "./rates.ts";

test("getRates parses primary open.er-api.com format, filters to SUPPORTED_CURRENCIES, and caches for 12h", async () => {
  resetRatesCache();

  let callCount = 0;
  const mockFetch: typeof fetch = async (input) => {
    callCount++;
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    assert.equal(url, PRIMARY_RATES_URL);
    return Response.json({
      result: "success",
      base_code: "INR",
      time_last_update_unix: 1792195352, // 2026-10-17
      rates: {
        INR: 1,
        USD: 0.012,
        AED: 0.044,
        EUR: 0.011,
        GBP: 0.0095,
        JPY: 1.82,
        UNSUPPORTED_XYZ: 999,
      },
    });
  };

  const first = await getRates(mockFetch);
  assert.equal(first.base, "INR");
  assert.equal(first.date, "2026-10-17");
  assert.equal(first.rates.INR, 1);
  assert.equal(first.rates.USD, 0.012);
  assert.equal(first.rates.AED, 0.044);
  assert.equal(first.rates.UNSUPPORTED_XYZ, undefined);
  assert.equal(first.attribution.text, "Rates By Exchange Rate API");
  assert.equal(first.attribution.url, "https://www.exchangerate-api.com");
  for (const key of Object.keys(first.rates)) {
    assert.equal(isSupportedCurrency(key), true);
  }
  assert.equal(callCount, 1);

  // Second call with the same fetchImpl hits the 12h cache
  const second = await getRates(mockFetch);
  assert.equal(callCount, 1);
  assert.deepEqual(second, first);
});

test("getRates falls back to Frankfurter on primary failure, fills missing currencies from last-good, and falls back to last-good when both fail", async () => {
  resetRatesCache();

  // 1. Seed lastGood via primary
  const seedFetch: typeof fetch = async () =>
    Response.json({
      result: "success",
      time_last_update_utc: "Fri, 16 Oct 2026 00:00:00 +0000",
      rates: {
        INR: 1,
        USD: 0.0119,
        AED: 0.0437,
        LKR: 3.55,
      },
    });

  const seeded = await getRates(seedFetch);
  assert.equal(seeded.rates.AED, 0.0437);
  assert.equal(seeded.rates.LKR, 3.55);

  // 2. Primary fails, fallback (Frankfurter) succeeds with ECB currencies (missing AED and LKR)
  const urlsCalled: string[] = [];
  const fallbackFetch: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    urlsCalled.push(url);
    if (url === PRIMARY_RATES_URL) {
      return new Response("Upstream error", { status: 503 });
    }
    assert.equal(url, FALLBACK_RATES_URL);
    return Response.json({
      amount: 1,
      base: "INR",
      date: "2026-10-17",
      rates: {
        USD: 0.0121,
        EUR: 0.0112,
        GBP: 0.0096,
        JPY: 1.85,
        BRL: 0.06, // unsupported, must be filtered out
      },
    });
  };

  const fromFallback = await getRates(fallbackFetch);
  assert.deepEqual(urlsCalled, [PRIMARY_RATES_URL, FALLBACK_RATES_URL]);
  assert.equal(fromFallback.base, "INR");
  assert.equal(fromFallback.date, "2026-10-17");
  assert.equal(fromFallback.rates.INR, 1);
  assert.equal(fromFallback.rates.USD, 0.0121);
  assert.equal(fromFallback.rates.EUR, 0.0112);
  // Missing currencies in Frankfurter are filled from lastGood
  assert.equal(fromFallback.rates.AED, 0.0437);
  assert.equal(fromFallback.rates.LKR, 3.55);
  assert.equal(fromFallback.rates.BRL, undefined);

  // 3. Both primary and fallback fail -> never throws when lastGood exists
  const bothFailFetch: typeof fetch = async () => {
    throw new Error("Network down");
  };

  const recovered = await getRates(bothFailFetch);
  assert.deepEqual(recovered, fromFallback);
});
