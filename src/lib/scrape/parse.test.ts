import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findCheapestRowIndex, parseExpandedDetails, parseResults } from "./parse.ts";
import { legsFor } from "./plan.ts";

interface FixtureEntry {
  route: string;
  date: string;
  cabin: string;
  collapsed: string;
  expanded: string;
}

const fixturesPath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "google-flights-rows.json");
const fixtures = JSON.parse(readFileSync(fixturesPath, "utf8")) as Record<string, FixtureEntry>;

const nb = "\u00a0";
const rows = [
  `10:40 PM\n${nb}–${nb}\n6:50 AM+1\nIndiGo\n8 hr 10 min\nBLR–IXZ\n1 stop\n4 hr 55 min MAA\n128 kg CO2e\n+16% emissions\n₹12,734`,
  `7:10 AM\n${nb}–${nb}\n12:25 PM\nIndiGo\n5 hr 15 min\nBLR–IXZ\nNonstop\n133 kg CO2e\n₹14,624`,
  "Select flight ₹99",
];

test("parseResults picks the cheapest visible row with times, day offset, duration, airline, and stops", () => {
  const out = parseResults("https://www.google.com/travel/flights?q=x", "body", rows);
  assert.deepEqual(out, {
    status: "ok",
    fare: {
      price: 12734,
      airline: "IndiGo",
      stops: 1,
      depTime: "22:40",
      arrTime: "06:50",
      arrDayOffset: 1,
      durationMin: 490,
      flightNo: null,
      aircraft: null,
    },
  });
});

test("parseResults parses real captured Google Flights fixtures (economy nonstop, economy 1-stop, +1 day arrival, business 1-stop)", () => {
  // 1. Economy 1-stop (multi-leg stores first leg's flight_no + aircraft)
  const econ1Stop = parseResults(
    "https://www.google.com/travel/flights?q=x",
    "body",
    [fixtures.economy_one_stop.collapsed, fixtures.economy_nonstop.collapsed],
    fixtures.economy_one_stop.expanded,
  );
  assert.deepEqual(econ1Stop, {
    status: "ok",
    fare: {
      price: 13350,
      airline: "IndiGo",
      stops: 1,
      depTime: "17:50",
      arrTime: "23:15",
      arrDayOffset: null,
      durationMin: 325,
      flightNo: "6E 895",
      aircraft: "Airbus A320neo",
    },
  });

  // 2. Economy nonstop
  const econNonstop = parseResults(
    "https://www.google.com/travel/flights?q=x",
    "body",
    [fixtures.economy_nonstop.collapsed],
    fixtures.economy_nonstop.expanded,
  );
  assert.deepEqual(econNonstop, {
    status: "ok",
    fare: {
      price: 14377,
      airline: "Akasa Air",
      stops: 0,
      depTime: "18:25",
      arrTime: "21:15",
      arrDayOffset: null,
      durationMin: 170,
      flightNo: "QP 1265",
      aircraft: "Boeing 737MAX 8 Passenger",
    },
  });

  // 3. Economy +1 day arrival
  const nextDay = parseResults(
    "https://www.google.com/travel/flights?q=x",
    "body",
    [fixtures.economy_next_day_arrival.collapsed],
    fixtures.economy_next_day_arrival.expanded,
  );
  assert.deepEqual(nextDay, {
    status: "ok",
    fare: {
      price: 13766,
      airline: "IndiGo",
      stops: 1,
      depTime: "22:40",
      arrTime: "06:50",
      arrDayOffset: 1,
      durationMin: 490,
      flightNo: "6E 6174",
      aircraft: "Airbus A321neo",
    },
  });

  // 4. Business class 1-stop
  const biz = parseResults(
    "https://www.google.com/travel/flights?q=x",
    "body",
    [fixtures.business_one_stop.collapsed],
    fixtures.business_one_stop.expanded,
    "business",
  );
  assert.deepEqual(biz, {
    status: "ok",
    fare: {
      price: 45449,
      airline: "IndiGo",
      stops: 1,
      depTime: "01:45",
      arrTime: "07:50",
      arrDayOffset: null,
      durationMin: 365,
      flightNo: "6E 5243",
      aircraft: "Airbus A321neo",
    },
  });

  // Business-cabin sanity check: economy-only rows with cabin='business' return parse_error instead of storing economy price
  const bizMissingIndication = parseResults(
    "https://www.google.com/travel/flights?q=x",
    "body",
    [fixtures.economy_nonstop.collapsed],
    fixtures.economy_nonstop.expanded,
    "business",
  );
  assert.deepEqual(bizMissingIndication, { status: "parse_error" });

  // 5. ATR 72 aircraft where digits abut airline code ("ATR 726E\u00a07435")
  assert.deepEqual(parseExpandedDetails("IndiGoEconomyATR 726E\u00a07435"), {
    flightNo: "6E 7435",
    aircraft: "ATR 72",
  });

  assert.equal(findCheapestRowIndex(["Select flight ₹99", fixtures.economy_nonstop.collapsed, fixtures.economy_one_stop.collapsed]), 2);
});

test("business cabin requires 'Business Class' in the expanded cheapest row and ignores the 'Cheapest from' tab", () => {
  const url = "https://www.google.com/travel/flights?q=x";
  const biz = fixtures.business_one_stop;

  // Real captures: collapsed rows never name the cabin, the expanded details do.
  const ok = parseResults(url, "Cheapest\nfrom ₹9,999", [biz.collapsed], biz.expanded, "business");
  assert.equal(ok.status, "ok");
  assert.equal(ok.status === "ok" && ok.fare.price, 45449);

  // Cheapest row expands to economy details: not a business price.
  const econ = fixtures.economy_one_stop;
  assert.deepEqual(parseResults(url, "body", [econ.collapsed], econ.expanded, "business"), { status: "parse_error" });

  // No expanded details captured: cabin can't be verified.
  assert.deepEqual(parseResults(url, "body", [biz.collapsed], undefined, "business"), { status: "parse_error" });

  // A cheaper 'Cheapest from' tab alone never yields a business fare.
  assert.deepEqual(parseResults(url, "Cheapest\nfrom ₹9,999", [], undefined, "business"), { status: "parse_error" });
});

test("parseResults lets a cheaper 'Cheapest from' tab win", () => {
  const out = parseResults("https://www.google.com/travel/flights", "Cheapest\nfrom ₹9,999", rows);
  assert.deepEqual(out, {
    status: "ok",
    fare: {
      price: 9999,
      airline: null,
      stops: null,
      depTime: null,
      arrTime: null,
      arrDayOffset: null,
      durationMin: null,
      flightNo: null,
      aircraft: null,
    },
  });
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

