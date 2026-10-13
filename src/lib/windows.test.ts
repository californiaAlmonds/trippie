import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, computeWindows, diffDays, monthBounds } from "./windows.ts";

const fare = (date: string, price: number) => ({ date, price, source: "demo" });

test("date helpers handle month ends and leap years", () => {
  assert.equal(addDays("2027-02-28", 1), "2027-03-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(diffDays("2027-02-10", "2027-02-15"), 5);
  assert.deepEqual(monthBounds("2027-02"), { first: "2027-02-01", last: "2027-02-28" });
});

test("computeWindows pairs outbound with inbound inside the gap range, cheapest first", () => {
  const out = [fare("2027-02-10", 4000), fare("2027-02-11", 3000)];
  const inn = [fare("2027-02-15", 5000), fare("2027-02-16", 3500), fare("2027-02-17", 9000)];
  const result = computeWindows(out, inn, 5, 6);
  assert.deepEqual(
    result.map((w) => [w.depart.date, w.ret.date, w.gap, w.total]),
    [
      ["2027-02-11", "2027-02-16", 5, 6500],
      ["2027-02-10", "2027-02-16", 6, 7500],
      ["2027-02-10", "2027-02-15", 5, 9000],
      ["2027-02-11", "2027-02-17", 6, 12000],
    ],
  );
});

test("computeWindows skips days with no return fare", () => {
  assert.equal(computeWindows([fare("2027-02-10", 1)], [], 1, 7).length, 0);
});
