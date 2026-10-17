import assert from "node:assert/strict";
import { test } from "node:test";
import {
  convertFromInr,
  countryToCurrency,
  formatMoney,
  isSupportedCurrency,
  pickCurrency,
  SUPPORTED_CURRENCIES,
} from "./currency.ts";

test("SUPPORTED_CURRENCIES and isSupportedCurrency cover required currencies", () => {
  const required = [
    "INR", "USD", "EUR", "GBP", "AED", "SAR", "QAR", "KWD", "OMR", "BHD",
    "SGD", "MYR", "THB", "AUD", "NZD", "CAD", "JPY", "CNY", "HKD", "CHF",
    "LKR", "NPR", "BDT", "ZAR",
  ];
  const codes = new Set(SUPPORTED_CURRENCIES.map((c) => c.code));
  for (const code of required) {
    assert.ok(codes.has(code), `Missing currency ${code}`);
    assert.equal(isSupportedCurrency(code), true);
    assert.equal(isSupportedCurrency(code.toLowerCase()), true);
  }
  assert.equal(isSupportedCurrency("XXX"), false);
  assert.equal(isSupportedCurrency(""), false);
  assert.equal(isSupportedCurrency(null), false);
});

test("countryToCurrency and pickCurrency map countries and Accept-Language with USD fallback", () => {
  assert.equal(countryToCurrency("IN"), "INR");
  assert.equal(countryToCurrency("in"), "INR");
  assert.equal(countryToCurrency("US"), "USD");
  assert.equal(countryToCurrency("AE"), "AED");
  assert.equal(countryToCurrency("GB"), "GBP");
  assert.equal(countryToCurrency("DE"), "EUR");
  assert.equal(countryToCurrency("FR"), "EUR");
  assert.equal(countryToCurrency("JP"), "JPY");
  assert.equal(countryToCurrency("SG"), "SGD");
  assert.equal(countryToCurrency("ZZ"), null);
  assert.equal(countryToCurrency(""), null);
  assert.equal(countryToCurrency(null), null);

  assert.equal(pickCurrency({ country: "IN", acceptLanguage: "en-US" }), "INR");
  assert.equal(pickCurrency({ country: "AE" }), "AED");
  assert.equal(pickCurrency({ country: "GB" }), "GBP");
  assert.equal(pickCurrency({ country: "DE" }), "EUR");
  assert.equal(pickCurrency({ country: "ZZ" }), "USD");
  assert.equal(pickCurrency({ country: null, acceptLanguage: "en-IN,en-US;q=0.8" }), "INR");
  assert.equal(pickCurrency({ country: "ZZ", acceptLanguage: "de-DE,en;q=0.9" }), "EUR");
  assert.equal(pickCurrency({ country: null, acceptLanguage: "fr;q=0.9,en-GB;q=0.8" }), "GBP");
  assert.equal(pickCurrency({ country: null, acceptLanguage: "es-AR" }), "USD");
  assert.equal(pickCurrency({}), "USD");
});

test("formatMoney formats INR with en-IN grouping and 0 decimals, USD with 2 decimals, JPY with 0 decimals", () => {
  const inrOut = formatMoney(123456, "INR");
  assert.ok(inrOut.includes("1,23,456"), `Expected en-IN grouping in ${inrOut}`);
  assert.ok(!inrOut.includes("."), `Expected no decimals in ${inrOut}`);

  const usdOut = formatMoney(123.4, "USD");
  assert.ok(usdOut.includes("123.40"), `Expected 2 decimals in ${usdOut}`);
  assert.ok(usdOut.includes("$"), `Expected $ symbol in ${usdOut}`);

  const jpyOut = formatMoney(15800, "JPY");
  assert.ok(jpyOut.includes("15,800"), `Expected 15,800 in ${jpyOut}`);
  assert.ok(!jpyOut.includes("."), `Expected 0 decimals in ${jpyOut}`);
});

test("convertFromInr converts amounts accurately, preserves INR, and returns null when rate is missing", () => {
  const rates: Record<string, number> = {
    INR: 1,
    USD: 0.012,
    AED: 0.044,
    JPY: 1.8,
  };
  assert.equal(convertFromInr(10000, "INR", rates), 10000);
  assert.equal(convertFromInr(10000, "INR", {}), 10000);

  const usd = convertFromInr(10000, "USD", rates);
  assert.notEqual(usd, null);
  assert.ok(Math.abs(usd! - 120) < 1e-9);

  const aed = convertFromInr(5000, "AED", rates);
  assert.notEqual(aed, null);
  assert.ok(Math.abs(aed! - 220) < 1e-9);

  const jpy = convertFromInr(2000, "JPY", rates);
  assert.notEqual(jpy, null);
  assert.ok(Math.abs(jpy! - 3600) < 1e-9);

  // Missing or non-positive rate returns null instead of raw INR amount so callers never label INR as another currency
  assert.equal(convertFromInr(10000, "EUR", rates), null);
  assert.equal(convertFromInr(10000, "SAR", {}), null);
  assert.equal(convertFromInr(10000, "KWD", { KWD: 0 }), null);
  assert.equal(convertFromInr(10000, "OMR", { OMR: -0.5 }), null);

  // Caller pattern: fall back to INR formatting with INR symbol when rate is missing
  const formatConvertedOrInr = (amountInr: number, targetCurrency: string) => {
    const converted = convertFromInr(amountInr, targetCurrency, rates);
    if (converted === null || targetCurrency === "INR") {
      return formatMoney(amountInr, "INR");
    }
    return `≈ ${formatMoney(converted, targetCurrency)}`;
  };

  const missingOut = formatConvertedOrInr(10000, "SAR");
  assert.ok(missingOut.includes("₹"), `Expected INR symbol in fallback output: ${missingOut}`);
  assert.ok(!missingOut.includes("SAR"), `Must not label INR amount as SAR: ${missingOut}`);
});

