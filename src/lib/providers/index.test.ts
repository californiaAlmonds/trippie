import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getClient, saveFares } from "../store.ts";
import type { FareProvider } from "../types.ts";
import { dbProvider } from "./db.ts";
import { merged } from "./index.ts";
import { travelpayoutsProvider } from "./travelpayouts.ts";

test("provider precedence: db wins over cheaper travelpayouts for the same date; travelpayouts fills gaps with estimate:true; business skips travelpayouts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-prov-"));
  const dbPath = join(dir, "prov.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();

    await saveFares([
      {
        day: "2026-10-17",
        origin: "CCU",
        destination: "BLR",
        date: "2026-11-10",
        cabin: "economy",
        price: 7500,
        airline: "IndiGo",
        stops: 0,
        depTime: "06:15",
        arrTime: "08:50",
        durationMin: 155,
        flightNo: "6E 512",
        aircraft: "Airbus A320neo",
        status: "ok",
        scrapedAt: "2026-10-17T08:00:00.000Z",
      },
      {
        day: "2026-10-17",
        origin: "CCU",
        destination: "BLR",
        date: "2026-11-10",
        cabin: "business",
        price: 38500,
        airline: "Air India",
        stops: 0,
        depTime: "09:00",
        arrTime: "11:35",
        durationMin: 155,
        flightNo: "AI 772",
        aircraft: "Airbus A321neo",
        status: "ok",
        scrapedAt: "2026-10-17T08:05:00.000Z",
      },
    ]);

    let tpCalls = 0;
    const mockFetch: typeof fetch = async () => {
      tpCalls++;
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            "2026-11-10": { price: 4200, airline: "IX", transfers: 1, departure_at: "2026-11-10" },
            "2026-11-11": { price: 5100, airline: "6E", transfers: 0, departure_at: "2026-11-11" },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const tp = travelpayoutsProvider("fake-tp-token", mockFetch);
    const combined: FareProvider = merged([dbProvider, tp]);

    // Economy: 2026-11-10 must come from DB (7500, not cheaper 4200 from TP), and 2026-11-11 from TP with estimate: true
    const econFares = await combined.getOneWayFares("CCU", "BLR", "2026-11-01", "2026-11-30", "economy");
    assert.equal(econFares.length, 2);
    assert.equal(econFares[0].date, "2026-11-10");
    assert.equal(econFares[0].price, 7500);
    assert.equal(econFares[0].source, "google");
    assert.equal(econFares[0].estimate, undefined);
    assert.equal(econFares[0].flightNo, "6E 512");
    assert.equal(econFares[0].aircraft, "Airbus A320neo");
    assert.equal(econFares[0].checkedAt, "2026-10-17T08:00:00.000Z");

    assert.equal(econFares[1].date, "2026-11-11");
    assert.equal(econFares[1].price, 5100);
    assert.equal(econFares[1].source, "aviasales");
    assert.equal(econFares[1].estimate, true);
    assert.equal(tpCalls, 1);

    // Business: Travelpayouts is never called and only business DB fares are returned
    const bizFares = await combined.getOneWayFares("CCU", "BLR", "2026-11-01", "2026-11-30", "business");
    assert.equal(bizFares.length, 1);
    assert.equal(bizFares[0].date, "2026-11-10");
    assert.equal(bizFares[0].price, 38500);
    assert.equal(bizFares[0].estimate, undefined);
    assert.equal(tpCalls, 1); // TP fetch was not invoked for business

    // Direct call to travelpayoutsProvider with cabin="business" also skips fetch
    const directBizTp = await tp.getOneWayFares("CCU", "BLR", "2026-11-01", "2026-11-30", "business");
    assert.deepEqual(directBizTp, []);
    assert.equal(tpCalls, 1);

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
