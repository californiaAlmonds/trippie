import assert from "node:assert/strict";
import { test } from "node:test";
import { parseResults } from "./parse.ts";
import { legsFor } from "./plan.ts";

const nb = "\u00a0";
const rows = [
  `10:40 PM\n${nb}–${nb}\n6:50 AM+1\nIndiGo\n8 hr 10 min\nBLR–IXZ\n1 stop\n4 hr 55 min MAA\n128 kg CO2e\n+16% emissions\n₹12,734`,
  `7:10 AM\n${nb}–${nb}\n12:25 PM\nIndiGo\n5 hr 15 min\nBLR–IXZ\nNonstop\n133 kg CO2e\n₹14,624`,
  "Select flight ₹99",
];

test("parseResults picks the cheapest visible row with airline and stops", () => {
  const out = parseResults("https://www.google.com/travel/flights?q=x", "body", rows);
  assert.deepEqual(out, { status: "ok", fare: { price: 12734, airline: "IndiGo", stops: 1 } });
});

test("parseResults lets a cheaper 'Cheapest from' tab win", () => {
  const out = parseResults("https://www.google.com/travel/flights", "Cheapest\nfrom ₹9,999", rows);
  assert.deepEqual(out, { status: "ok", fare: { price: 9999, airline: null, stops: null } });
});

test("parseResults flags blocks, empty results and unparseable pages", () => {
  assert.equal(parseResults("https://www.google.com/sorry/index", "", []).status, "blocked");
  assert.equal(parseResults("https://www.google.com/travel/flights", "No flights found", []).status, "no_flights");
  assert.equal(parseResults("https://www.google.com/travel/flights", "hello", []).status, "parse_error");
});

test("legsFor covers the month outbound and month+gap inbound, skipping past dates", () => {
  const p = { origin: "BLR", destination: "IXZ", month: "2027-02", trip: "round" as const, minGap: 5, maxGap: 7, cabin: "economy" as const };
  const [out, inn] = legsFor(p, "2027-02-20");
  assert.equal(out.dates[0], "2027-02-20");
  assert.equal(out.dates.at(-1), "2027-02-28");
  assert.equal(inn.dates[0], "2027-02-20");
  assert.equal(inn.dates.at(-1), "2027-03-07");
  assert.equal(inn.origin, "IXZ");
});

test("legsFor returns only the outbound leg for oneway", () => {
  const p = { origin: "BLR", destination: "IXZ", month: "2027-02", trip: "oneway" as const, minGap: 0, maxGap: 0, cabin: "economy" as const };
  const legs = legsFor(p, "2027-02-01");
  assert.equal(legs.length, 1);
  assert.equal(legs[0].origin, "BLR");
  assert.equal(legs[0].destination, "IXZ");
  assert.equal(legs[0].dates[0], "2027-02-01");
  assert.equal(legs[0].dates.at(-1), "2027-02-28");
});
