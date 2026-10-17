import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSearch } from "./search.ts";

test("parseSearch defaults trip to round and requires valid gaps", () => {
  const ok = parseSearch(new URLSearchParams("origin=blr&destination=ixz&month=2027-02&minGap=5&maxGap=7"));
  assert.deepEqual(ok, { origin: "BLR", destination: "IXZ", month: "2027-02", trip: "round", minGap: 5, maxGap: 7, cabin: "economy" });

  const missingGap = parseSearch(new URLSearchParams("origin=BLR&destination=IXZ&month=2027-02"));
  assert.ok("error" in missingGap);

  const invalidGap = parseSearch(new URLSearchParams("origin=BLR&destination=IXZ&month=2027-02&minGap=8&maxGap=5"));
  assert.ok("error" in invalidGap);
});

test("parseSearch accepts trip=oneway without minGap/maxGap and sets gaps to 0", () => {
  const res = parseSearch(new URLSearchParams("origin=BLR&destination=IXZ&month=2027-02&trip=oneway"));
  assert.deepEqual(res, { origin: "BLR", destination: "IXZ", month: "2027-02", trip: "oneway", minGap: 0, maxGap: 0, cabin: "economy" });
  const biz = parseSearch(new URLSearchParams("origin=BLR&destination=IXZ&month=2027-02&trip=oneway&cabin=business"));
  assert.equal("cabin" in biz && biz.cabin, "business");
  assert.ok("error" in parseSearch(new URLSearchParams("origin=BLR&destination=IXZ&month=2027-02&trip=oneway&cabin=first")));
});

test("parseSearch rejects invalid trip values and months beyond the 12-month horizon", () => {
  const res = parseSearch(new URLSearchParams("origin=BLR&destination=IXZ&month=2027-02&trip=foo&minGap=5&maxGap=7"));
  assert.ok("error" in res);

  const now = new Date("2026-10-17T12:00:00.000Z");
  const past = parseSearch(new URLSearchParams("origin=BLR&destination=IXZ&month=2026-09&trip=oneway"), now);
  assert.ok("error" in past);

  const atHorizon = parseSearch(new URLSearchParams("origin=BLR&destination=IXZ&month=2027-10&trip=oneway"), now);
  assert.ok(!("error" in atHorizon));

  const beyondHorizon = parseSearch(new URLSearchParams("origin=BLR&destination=IXZ&month=2027-11&trip=oneway"), now);
  assert.ok("error" in beyondHorizon);
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSearch } from "./search.ts";
import { getBestWindowStats, getClient, getFreshness, getOneWayStats, getRouteStats, saveFares } from "./store.ts";

test("getRouteStats, getOneWayStats, getBestWindowStats, getFreshness, and runSearch return accurate stats and freshness per cabin", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-search-"));
  const dbPath = join(dir, "search.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  const prevProvider = process.env.FARE_PROVIDER;
  const prevTp = process.env.TRAVELPAYOUTS_TOKEN;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
  delete process.env.FARE_PROVIDER;
  delete process.env.TRAVELPAYOUTS_TOKEN;

  try {
    const client = await getClient();

    // Empty route returns null stats and untracked freshness
    const emptyStats = await getRouteStats("CCU", "BLR", "2027-02-01", "2027-02-28", "economy");
    assert.equal(emptyStats, null);

    // Seed multi-snapshot fares for CCU<->BLR in 2027-02
    await saveFares([
      {
        day: "2026-10-15",
        origin: "CCU",
        destination: "BLR",
        date: "2027-02-10",
        cabin: "economy",
        price: 5000,
        airline: "IndiGo",
        stops: 0,
        depTime: "07:00",
        arrTime: "09:30",
        durationMin: 150,
        flightNo: "6E 101",
        aircraft: "Airbus A320neo",
        status: "ok",
        scrapedAt: "2026-10-15T06:00:00.000Z",
      },
      {
        day: "2026-10-15",
        origin: "CCU",
        destination: "BLR",
        date: "2027-02-11",
        cabin: "economy",
        price: 6000,
        airline: "IndiGo",
        stops: 0,
        status: "ok",
        scrapedAt: "2026-10-15T06:01:00.000Z",
      },
      {
        day: "2026-10-16",
        origin: "CCU",
        destination: "BLR",
        date: "2027-02-10",
        cabin: "economy",
        price: 7000,
        airline: "Air India",
        stops: 1,
        depTime: "22:40",
        arrTime: "06:50",
        arrDayOffset: 1,
        durationMin: 490,
        flightNo: "AI 501",
        aircraft: "Airbus A321",
        status: "ok",
        scrapedAt: "2026-10-16T08:00:00.000Z",
      },
      {
        day: "2026-10-16",
        origin: "CCU",
        destination: "BLR",
        date: "2027-02-12",
        cabin: "economy",
        price: 9000,
        airline: "SpiceJet",
        stops: 0,
        status: "ok",
        scrapedAt: "2026-10-16T08:02:00.000Z",
      },
      // Inbound fares for round-trip window calculation
      {
        day: "2026-10-15",
        origin: "BLR",
        destination: "CCU",
        date: "2027-02-15",
        cabin: "economy",
        price: 5500,
        airline: "IndiGo",
        stops: 0,
        status: "ok",
        scrapedAt: "2026-10-15T06:05:00.000Z",
      },
      {
        day: "2026-10-16",
        origin: "BLR",
        destination: "CCU",
        date: "2027-02-16",
        cabin: "economy",
        price: 6500,
        airline: "IndiGo",
        stops: 0,
        status: "ok",
        scrapedAt: "2026-10-16T08:05:00.000Z",
      },
      // Business fare on same route
      {
        day: "2026-10-16",
        origin: "CCU",
        destination: "BLR",
        date: "2027-02-10",
        cabin: "business",
        price: 42000,
        airline: "IndiGo",
        stops: 1,
        status: "ok",
        scrapedAt: "2026-10-16T09:00:00.000Z",
      },
    ]);

    // All-snapshot route stats (used for round-trip leg stats): [5000, 6000, 7000, 9000]
    const outStats = await getRouteStats("CCU", "BLR", "2027-02-01", "2027-02-28", "economy");
    assert.deepEqual(outStats, {
      min: 5000,
      max: 9000,
      p25: 5750,
      median: 6500,
      samples: 4,
      since: "2026-10-15",
    });

    // One-way current per-day stats (latest snapshot per travel date: 2027-02-10=7000, 2027-02-11=6000, 2027-02-12=9000)
    const oneWayStats = await getOneWayStats("CCU", "BLR", "2027-02-01", "2027-02-28", "economy");
    assert.deepEqual(oneWayStats, {
      min: 6000,
      max: 9000,
      p25: 6500,
      median: 7000,
      samples: 3,
      since: "2026-10-15",
    });

    // Best window totals by snapshot day:
    // 2026-10-15: 2027-02-10 (5000) + 2027-02-15 (5500) = 10500
    // 2026-10-16: 2027-02-10 (7000) + 2027-02-16 (6500) = 13500
    const winStats = await getBestWindowStats("CCU", "BLR", "2027-02", 4, 7, "economy");
    assert.deepEqual(winStats, {
      min: 10500,
      max: 13500,
      p25: 11250,
      median: 12000,
      samples: 2,
      since: "2026-10-15",
    });

    // Tracked route with recent dispatch (<30m) and no newer scrape => collecting: true
    await client.execute({
      sql: `INSERT INTO tracked_routes (origin, destination, month, trip, min_gap, max_gap, cabin, source, last_requested_at, last_dispatched_at, last_scraped_at)
            VALUES ('CCU', 'BLR', '2027-02', 'round', 4, 7, 'economy', 'search', '2026-10-16T10:00:00.000Z', '2026-10-16T10:00:00.000Z', '2026-10-16T08:05:00.000Z')`,
      args: [],
    });

    const freshCollecting = await getFreshness(
      { origin: "CCU", destination: "BLR", month: "2027-02", trip: "round", minGap: 4, maxGap: 7, cabin: "economy" },
      Date.parse("2026-10-16T10:10:00.000Z"),
    );
    assert.deepEqual(freshCollecting, {
      lastCheckedAt: "2026-10-16T08:05:00.000Z",
      tracked: true,
      collecting: true,
    });

    // Once last_scraped_at >= last_dispatched_at => collecting: false
    await client.execute({
      sql: `UPDATE tracked_routes SET last_scraped_at = '2026-10-16T10:05:00.000Z'
            WHERE origin = 'CCU' AND destination = 'BLR' AND month = '2027-02' AND trip = 'round' AND cabin = 'economy'`,
      args: [],
    });
    const freshDone = await getFreshness(
      { origin: "CCU", destination: "BLR", month: "2027-02", trip: "round", minGap: 4, maxGap: 7, cabin: "economy" },
      Date.parse("2026-10-16T10:10:00.000Z"),
    );
    assert.equal(freshDone.collecting, false);

    // runSearch oneway includes stats computed from per-day current cheapest fares (total === outbound === oneWayStats, inbound === null)
    const onewayRes = await runSearch({
      origin: "CCU",
      destination: "BLR",
      month: "2027-02",
      trip: "oneway",
      minGap: 0,
      maxGap: 0,
      cabin: "economy",
    });
    assert.equal(onewayRes.cabin, "economy");
    assert.deepEqual(onewayRes.stats.outbound, oneWayStats);
    assert.equal(onewayRes.stats.inbound, null);
    assert.deepEqual(onewayRes.stats.total, oneWayStats);
    assert.equal(onewayRes.days[0]?.price, oneWayStats.min);
    assert.equal(onewayRes.freshness.lastCheckedAt, "2026-10-16T08:02:00.000Z");

    const feb10 = onewayRes.outbound.find((d) => d.date === "2027-02-10")!;
    assert.equal(feb10.price, 7000);
    assert.equal(feb10.depTime, "22:40");
    assert.equal(feb10.arrTime, "06:50");
    assert.equal(feb10.arrDayOffset, 1);
    assert.equal(feb10.durationMin, 490);
    assert.equal(feb10.flightNo, "AI 501");
    assert.equal(feb10.aircraft, "Airbus A321");
    assert.equal(feb10.checkedAt, "2026-10-16T08:00:00.000Z");

    client.close();
  } finally {
    if (prevUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = prevUrl;
    if (prevProvider === undefined) delete process.env.FARE_PROVIDER;
    else process.env.FARE_PROVIDER = prevProvider;
    if (prevTp === undefined) delete process.env.TRAVELPAYOUTS_TOKEN;
    else process.env.TRAVELPAYOUTS_TOKEN = prevTp;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup race on Windows
    }
  }
});

