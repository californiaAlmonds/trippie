import assert from "node:assert/strict";
import { test } from "node:test";
import { orderedSites, SITES } from "./links.ts";

test("Google Flights link defaults to INR economy and supports custom currency and business cabin", () => {
  const google = SITES.find((s) => s.key === "google")!;
  const def = google.url("CCU", "BLR", "2026-11-15");
  assert.equal(
    def,
    "https://www.google.com/travel/flights?curr=INR&q=Flights%20to%20BLR%20from%20CCU%20on%202026-11-15%20oneway",
  );

  const bizRound = google.url("CCU", "BLR", "2026-11-15", "2026-11-20", { currency: "USD", cabin: "business" });
  assert.equal(
    bizRound,
    "https://www.google.com/travel/flights?curr=USD&q=Flights%20to%20BLR%20from%20CCU%20on%202026-11-15%20through%202026-11-20%20business%20class",
  );
});

test("Kayak link appends /business path segment for business cabin", () => {
  const kayak = SITES.find((s) => s.key === "kayak")!;
  assert.equal(kayak.url("CCU", "BLR", "2026-11-15"), "https://www.kayak.co.in/flights/CCU-BLR/2026-11-15");
  assert.equal(
    kayak.url("CCU", "BLR", "2026-11-15", undefined, { cabin: "business" }),
    "https://www.kayak.co.in/flights/CCU-BLR/2026-11-15/business",
  );
  assert.equal(
    kayak.url("CCU", "BLR", "2026-11-15", "2026-11-20", { cabin: "business" }),
    "https://www.kayak.co.in/flights/CCU-BLR/2026-11-15/2026-11-20/business",
  );
});

test("orderedSites places bestKey first and preserves remaining order", () => {
  const ordered = orderedSites("kayak");
  assert.equal(ordered[0].key, "kayak");
  assert.equal(ordered[1].key, "google");
});
