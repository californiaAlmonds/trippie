import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createUser } from "../auth/users.ts";
import type { SendMailInput } from "../mailer.ts";
import { createPlan, listPlans } from "../plans/index.ts";
import { type FareRecord, getClient, saveFares } from "../store.ts";
import { addDays, monthBounds } from "../windows.ts";
import { runAlerts } from "./engine.ts";

const TEST_SECRET = "test-secret-test-secret-test-secret";
const NOW = new Date("2026-10-16T08:00:00.000Z");
const TODAY = "2026-10-16";

function buildMonthFares(
  origin: string,
  destination: string,
  from: string,
  to: string,
  day: string,
  price: number,
  airline = "IndiGo",
  ratio = 1,
): FareRecord[] {
  const allDates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    allDates.push(d);
  }
  const count = Math.floor(allDates.length * ratio);
  return allDates.slice(0, count).map((date) => ({
    day,
    origin,
    destination,
    date,
    price,
    airline,
    stops: 0,
    status: "ok" as const,
  }));
}

test("alerts engine: dry run changes no state, live run claims/sends/updates only after sendMail, idempotency, failure handling, and concurrency", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-alerts-"));
  const dbPath = join(dir, "alerts.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  const prevHost = process.env.SMTP_HOST;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
  delete process.env.SMTP_HOST;

  try {
    const client = await getClient();
    const userRes = await createUser("alertuser@example.com", "scrypt$hash", { verified: true });
    assert.ok(userRes.ok);

    const planRes = await createPlan(
      userRes.user.id,
      true,
      {
        origin: "BLR",
        destination: "IXZ",
        month: "2027-02",
        trip: "round",
        minGap: 4,
        maxGap: 7,
        alertEnabled: true,
        targetPrice: 12000,
      },
      NOW,
    );
    assert.ok(planRes.ok);
    const planId = planRes.plan.id;

    // Seed fresh fares across 2027-02 (outbound 5000, inbound 5500 => total 10500 <= 12000)
    const { first, last } = monthBounds("2027-02");
    await saveFares([
      ...buildMonthFares("BLR", "IXZ", first, last, TODAY, 5000, "Air <script>alert(1)</script>"),
      ...buildMonthFares("IXZ", "BLR", addDays(first, 4), addDays(last, 7), TODAY, 5500, "IndiGo"),
    ]);

    // (a) Dry run when mail not configured changes NO state
    const drySummary = await runAlerts({ now: NOW });
    assert.equal(drySummary.dryRun, true);
    assert.equal(drySummary.considered, 1);
    assert.equal(drySummary.wouldAlert, 1);
    assert.equal(drySummary.sent, 0);

    const delivAfterDry = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM alert_deliveries WHERE plan_id = ?",
      args: [planId],
    });
    assert.equal(Number(delivAfterDry.rows[0]?.c), 0);
    assert.equal((await listPlans(userRes.user.id, NOW))[0]?.lastAlertPrice, null);

    // (b) Live run sends once, records delivery as 'sent', and advances last_alert_price ONLY after sendMail resolves
    const sentEmails: SendMailInput[] = [];
    let priceDuringSend: number | null | undefined;
    let statusDuringSend: string | undefined;

    const liveSummary = await runAlerts({
      now: NOW,
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      sendMail: async (msg) => {
        const planCheck = await client.execute({
          sql: "SELECT last_alert_price FROM plans WHERE id = ?",
          args: [planId],
        });
        const delivCheck = await client.execute({
          sql: "SELECT status FROM alert_deliveries WHERE plan_id = ? AND day = ?",
          args: [planId, TODAY],
        });
        priceDuringSend =
          planCheck.rows[0]?.last_alert_price == null
            ? null
            : Number(planCheck.rows[0]?.last_alert_price);
        statusDuringSend = String(delivCheck.rows[0]?.status);
        sentEmails.push(msg);
      },
    });

    assert.equal(liveSummary.dryRun, false);
    assert.equal(liveSummary.sent, 1);
    assert.equal(priceDuringSend, null);
    assert.equal(statusDuringSend, "claimed");

    const afterSendPlan = (await listPlans(userRes.user.id, NOW))[0];
    assert.equal(afterSendPlan?.lastAlertPrice, 10500);

    const delivAfterSend = await client.execute({
      sql: "SELECT status FROM alert_deliveries WHERE plan_id = ? AND day = ?",
      args: [planId, TODAY],
    });
    assert.equal(String(delivAfterSend.rows[0]?.status), "sent");

    // (h) Verify email HTML escapes dynamic values (<script> in airline name) and includes List-Unsubscribe on https
    assert.equal(sentEmails.length, 1);
    const email = sentEmails[0]!;
    assert.match(email.subject, /Trippie: BLR → IXZ from ₹10,500 in February 2027/);
    assert.ok(!email.html.includes("<script>"));
    assert.ok(email.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(email.headers?.["List-Unsubscribe"]?.startsWith("<https://trippie.example.com/unsubscribe?token="));

    // (c) Second run the same UTC day sends nothing (even if price dropped further)
    await saveFares(buildMonthFares("BLR", "IXZ", first, last, TODAY, 4000));
    const secondSameDay = await runAlerts({
      now: NOW,
      appSecret: TEST_SECRET,
      sendMail: async (msg) => {
        sentEmails.push(msg);
      },
    });
    assert.equal(secondSameDay.sent, 0);
    assert.equal(secondSameDay.skipped["already claimed"], 1);
    assert.equal(sentEmails.length, 1);

    // (d) Next UTC day with a failing mailer leaves claim as 'failed' and does NOT advance last_alert_price
    const nextDayNow = new Date("2026-10-17T08:00:00.000Z");
    const failSummary = await runAlerts({
      now: nextDayNow,
      appSecret: TEST_SECRET,
      sendMail: async () => {
        throw new Error("Simulated SMTP failure");
      },
    });
    assert.equal(failSummary.sent, 0);
    assert.equal(failSummary.failed, 1);
    assert.equal((await listPlans(userRes.user.id, nextDayNow))[0]?.lastAlertPrice, 10500);

    const failDeliv = await client.execute({
      sql: "SELECT status FROM alert_deliveries WHERE plan_id = ? AND day = '2026-10-17'",
      args: [planId],
    });
    assert.equal(String(failDeliv.rows[0]?.status), "failed");

    // (g) Concurrent double run on day 3 produces exactly one send
    const thirdDayNow = new Date("2026-10-18T08:00:00.000Z");
    await saveFares([
      ...buildMonthFares("BLR", "IXZ", first, last, "2026-10-18", 3800),
      ...buildMonthFares("IXZ", "BLR", addDays(first, 4), addDays(last, 7), "2026-10-18", 5000),
    ]);

    let concurrentSends = 0;
    const [r1, r2] = await Promise.all([
      runAlerts({
        now: thirdDayNow,
        appSecret: TEST_SECRET,
        sendMail: async () => {
          await new Promise((r) => setTimeout(r, 25));
          concurrentSends++;
        },
      }),
      runAlerts({
        now: thirdDayNow,
        appSecret: TEST_SECRET,
        sendMail: async () => {
          await new Promise((r) => setTimeout(r, 25));
          concurrentSends++;
        },
      }),
    ]);

    assert.equal(concurrentSends, 1);
    assert.equal(r1.sent + r2.sent, 1);
    assert.equal((await listPlans(userRes.user.id, thirdDayNow))[0]?.lastAlertPrice, 8800);

    client.close();
  } finally {
    if (prevUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = prevUrl;
    if (prevHost !== undefined) process.env.SMTP_HOST = prevHost;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows SQLite file handle may release asynchronously on process exit
    }
  }
});

test("alerts engine: respects target_price and skips unverified users, expired months, and stale or insufficient fares", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-alerts-rules-"));
  const dbPath = join(dir, "rules.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const verifiedRes = await createUser("verified@example.com", "scrypt$hash", { verified: true });
    const unverifiedRes = await createUser("unv@example.com", "scrypt$hash", { verified: false });
    assert.ok(verifiedRes.ok && unverifiedRes.ok);
    const verified = verifiedRes.user;
    const unverified = unverifiedRes.user;

    // 1. Unverified user plan with alert_enabled = 1 in DB -> skipped ('unverified')
    await client.execute({
      sql: `INSERT INTO plans (id, user_id, origin, destination, month, trip, min_gap, max_gap, alert_enabled, target_price, created_at)
            VALUES ('plan-unv', ?, 'BLR', 'IXZ', '2027-02', 'oneway', 0, 0, 1, NULL, '2026-10-16T00:00:00.000Z')`,
      args: [unverified.id],
    });

    // 2. Expired month plan -> skipped ('expired')
    await client.execute({
      sql: `INSERT INTO plans (id, user_id, origin, destination, month, trip, min_gap, max_gap, alert_enabled, target_price, created_at)
            VALUES ('plan-exp', ?, 'BLR', 'IXZ', '2026-09', 'oneway', 0, 0, 1, NULL, '2026-08-01T00:00:00.000Z')`,
      args: [verified.id],
    });

    // 3. Stale fares only (snapshot_day = 2026-10-14 < 2026-10-15) -> skipped ('insufficient data')
    await createPlan(
      verified.id,
      true,
      {
        origin: "DEL",
        destination: "GOI",
        month: "2027-03",
        trip: "oneway",
        alertEnabled: true,
      },
      NOW,
    );
    const marBounds = monthBounds("2027-03");
    await saveFares(buildMonthFares("DEL", "GOI", marBounds.first, marBounds.last, "2026-10-14", 3500));

    // 4. Insufficient fresh fares (<50% of dates in month) -> skipped ('insufficient data')
    await createPlan(
      verified.id,
      true,
      {
        origin: "BOM",
        destination: "CCU",
        month: "2027-04",
        trip: "oneway",
        alertEnabled: true,
      },
      NOW,
    );
    const aprBounds = monthBounds("2027-04");
    await saveFares(buildMonthFares("BOM", "CCU", aprBounds.first, aprBounds.last, TODAY, 4200, "IndiGo", 0.4));

    // 5. Target price not met (best fare 6000 > target_price 5000) -> skipped ('above target')
    await createPlan(
      verified.id,
      true,
      {
        origin: "BLR",
        destination: "COK",
        month: "2027-05",
        trip: "oneway",
        alertEnabled: true,
        targetPrice: 5000,
      },
      NOW,
    );
    const mayBounds = monthBounds("2027-05");
    await saveFares(buildMonthFares("BLR", "COK", mayBounds.first, mayBounds.last, TODAY, 6000));

    const sent: SendMailInput[] = [];
    const summary = await runAlerts({
      now: NOW,
      appSecret: TEST_SECRET,
      appOrigin: "http://localhost:3111",
      sendMail: async (msg) => {
        sent.push(msg);
      },
    });

    assert.equal(summary.considered, 5);
    assert.equal(summary.sent, 0);
    assert.equal(summary.skipped["unverified"], 1);
    assert.equal(summary.skipped["expired"], 1);
    assert.equal(summary.skipped["insufficient data"], 2);
    assert.equal(summary.skipped["above target"], 1);
    assert.equal(sent.length, 0);

    client.close();
  } finally {
    if (prevUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = prevUrl;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows SQLite file handle may release asynchronously on process exit
    }
  }
});
