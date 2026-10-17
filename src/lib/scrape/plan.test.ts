import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createUser } from "../auth/users.ts";
import { createPlan } from "../plans/index.ts";
import { getClient } from "../store.ts";
import { dedupeLegs, selectRoutesToScrape } from "./plan.ts";

test("selectRoutesToScrape enforces 14-day recency, keeps plan routes, drops expired months, caps at 25, and supports alertsOnly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-plan-sel-"));
  const dbPath = join(dir, "sel.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const now = new Date("2026-10-17T12:00:00.000Z");

    const uRes = await createUser("planner@example.com", "scrypt$hash", { verified: true });
    assert.ok(uRes.ok);

    // 1. Saved plan with alertEnabled: true (created 30 days ago, older than 14 days, must STILL be kept)
    const oldPlanTime = new Date("2026-09-01T00:00:00.000Z");
    const pAlert = await createPlan(
      uRes.user.id,
      true,
      {
        origin: "DEL",
        destination: "BOM",
        month: "2026-12",
        trip: "oneway",
        alertEnabled: true,
      },
      oldPlanTime,
    );
    assert.ok(pAlert.ok);

    // 2. Saved plan with alertEnabled: false (also older than 14 days, must be kept in normal run, skipped in alertsOnly)
    const pNoAlert = await createPlan(
      uRes.user.id,
      true,
      {
        origin: "MAA",
        destination: "HYD",
        month: "2026-12",
        trip: "oneway",
        alertEnabled: false,
      },
      oldPlanTime,
    );
    assert.ok(pNoAlert.ok);

    // 3. Stale search route (>14 days old, source='search') => must be dropped
    await client.execute({
      sql: `INSERT INTO tracked_routes (origin, destination, month, trip, min_gap, max_gap, cabin, source, last_requested_at)
            VALUES ('CCU', 'DEL', '2026-12', 'oneway', 0, 0, 'economy', 'search', '2026-09-25T00:00:00.000Z')`,
      args: [],
    });

    // 4. Expired month route (2026-09 < 2026-10, even with recent timestamp) => must be dropped
    await client.execute({
      sql: `INSERT INTO tracked_routes (origin, destination, month, trip, min_gap, max_gap, cabin, source, last_requested_at)
            VALUES ('BLR', 'GOI', '2026-09', 'oneway', 0, 0, 'economy', 'search', '2026-10-17T11:00:00.000Z')`,
      args: [],
    });

    // 5. Recent search route (<14 days old) => must be kept
    await client.execute({
      sql: `INSERT INTO tracked_routes (origin, destination, month, trip, min_gap, max_gap, cabin, source, last_requested_at)
            VALUES ('CCU', 'BLR', '2026-11', 'oneway', 0, 0, 'business', 'search', '2026-10-15T00:00:00.000Z')`,
      args: [],
    });

    const selected = await selectRoutesToScrape({
      configRoutes: [
        { origin: "BLR", destination: "IXZ", month: "2027-02", minGap: 5, maxGap: 7 },
        { origin: "BLR", destination: "IXZ", month: "2026-08", minGap: 5, maxGap: 7 }, // expired config route dropped
      ],
      now,
    });

    const keys = selected.map((r) => `${r.origin}-${r.destination}-${r.month}-${r.cabin}`);
    assert.ok(keys.includes("BLR-IXZ-2027-02-economy"), "config route kept");
    assert.ok(keys.includes("CCU-BLR-2026-11-business"), "recent search route kept");
    assert.ok(keys.includes("DEL-BOM-2026-12-economy"), "old plan route (alert) kept");
    assert.ok(keys.includes("MAA-HYD-2026-12-economy"), "old plan route (non-alert) kept");
    assert.ok(!keys.includes("CCU-DEL-2026-12-economy"), "stale search route (>14d) dropped");
    assert.ok(!keys.includes("BLR-GOI-2026-09-economy"), "expired month dropped");
    assert.ok(!keys.includes("BLR-IXZ-2026-08-economy"), "expired config route dropped");

    // Verify alertsOnly selects only DEL-BOM (alert_enabled = 1)
    const alertsOnly = await selectRoutesToScrape({ alertsOnly: true, now });
    assert.equal(alertsOnly.length, 1);
    assert.equal(alertsOnly[0].origin, "DEL");
    assert.equal(alertsOnly[0].destination, "BOM");

    // Verify 25 route-month cap (most recently requested first)
    const airports = [
      "AMD", "ATQ", "BBI", "BDQ", "BHO", "BHU", "BLR", "BOM", "CCJ", "CCU",
      "CJB", "COK", "DED", "DEL", "GAU", "GOI", "HYD", "IDR", "IMF", "IXB",
      "IXC", "IXE", "IXJ", "IXM", "IXR", "IXZ", "JAI", "JDH", "JLR", "LKO",
    ];
    for (let i = 0; i < 28; i++) {
      const ts = new Date(now.getTime() - i * 60_000).toISOString();
      await client.execute({
        sql: `INSERT OR REPLACE INTO tracked_routes (origin, destination, month, trip, min_gap, max_gap, cabin, source, last_requested_at)
              VALUES (?, 'PNQ', '2027-01', 'oneway', 0, 0, 'economy', 'search', ?)`,
        args: [airports[i], ts],
      });
    }

    const capped = await selectRoutesToScrape({ now });
    assert.equal(capped.length, 25);
    assert.equal(capped[0].origin, "AMD"); // most recently requested is first

    client.close();
  } finally {
    if (prevUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = prevUrl;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup race on Windows
    }
  }
});

test("dedupeLegs merges identical (origin, destination, cabin) legs and deduplicates overlapping dates across routes", () => {
  const routes = [
    { origin: "BLR", destination: "IXZ", month: "2027-02", trip: "round" as const, minGap: 5, maxGap: 7, cabin: "economy" as const },
    { origin: "BLR", destination: "IXZ", month: "2027-02", trip: "oneway" as const, minGap: 0, maxGap: 0, cabin: "economy" as const },
    { origin: "IXZ", destination: "BLR", month: "2027-02", trip: "oneway" as const, minGap: 0, maxGap: 0, cabin: "economy" as const },
    { origin: "BLR", destination: "IXZ", month: "2027-02", trip: "oneway" as const, minGap: 0, maxGap: 0, cabin: "business" as const },
  ];

  const legs = dedupeLegs(routes, "2027-02-01");
  // Should produce 3 distinct legs: BLR->IXZ (economy), IXZ->BLR (economy), BLR->IXZ (business)
  assert.equal(legs.length, 3);

  const blrIxzEcon = legs.find((l) => l.origin === "BLR" && l.destination === "IXZ" && l.cabin === "economy")!;
  assert.equal(blrIxzEcon.dates.length, 28); // 2027-02-01 .. 2027-02-28 without duplicates

  const ixzBlrEcon = legs.find((l) => l.origin === "IXZ" && l.destination === "BLR" && l.cabin === "economy")!;
  // Union of 2027-02-06..2027-03-07 (from round trip return) and 2027-02-01..2027-02-28 (from IXZ->BLR oneway) = 2027-02-01..2027-03-07 (35 dates)
  assert.equal(ixzBlrEcon.dates[0], "2027-02-01");
  assert.equal(ixzBlrEcon.dates.at(-1), "2027-03-07");
  assert.equal(ixzBlrEcon.dates.length, 35);

  const blrIxzBiz = legs.find((l) => l.origin === "BLR" && l.destination === "IXZ" && l.cabin === "business")!;
  assert.equal(blrIxzBiz.dates.length, 28);
});
