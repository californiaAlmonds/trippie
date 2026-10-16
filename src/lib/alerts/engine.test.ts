import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createUser } from "../auth/users.ts";
import type { SendMailInput } from "../mailer.ts";
import { createPlan, listPlans, updatePlan } from "../plans/index.ts";
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

test("alerts engine deterministic interleaving: beforeClaim guards against disable/target drop, beforeComplete preserves concurrent PATCH baseline reset", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-alerts-interleave-"));
  const dbPath = join(dir, "interleave.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const userRes = await createUser("interleave@example.com", "scrypt$hash", { verified: true });
    assert.ok(userRes.ok);
    const user = userRes.user;

    const planRes = await createPlan(
      user.id,
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

    // Best price B = 5000 + 5500 = 10500
    const { first, last } = monthBounds("2027-02");
    await saveFares([
      ...buildMonthFares("BLR", "IXZ", first, last, TODAY, 5000),
      ...buildMonthFares("IXZ", "BLR", addDays(first, 4), addDays(last, 7), TODAY, 5500),
    ]);

    // (3a) Disable between evaluation and claim => no email, no ledger row
    const sent1: SendMailInput[] = [];
    const summary1 = await runAlerts({
      now: NOW,
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      hooks: {
        beforeClaim: async (p) => {
          const r = await updatePlan(user.id, true, p.id, { alertEnabled: false }, NOW);
          assert.ok(r.ok);
        },
      },
      sendMail: async (msg) => {
        sent1.push(msg);
      },
    });
    assert.equal(summary1.sent, 0);
    assert.equal(sent1.length, 0);
    const deliv1 = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM alert_deliveries WHERE plan_id = ?",
      args: [planId],
    });
    assert.equal(Number(deliv1.rows[0]?.c), 0);

    // Re-enable alerts with targetPrice = 12000 for next sub-test
    const reenable = await updatePlan(user.id, true, planId, {
      alertEnabled: true,
      targetPrice: 12000,
    }, NOW);
    assert.ok(reenable.ok);

    // (3b) Lowering target below B (10500) between evaluation and claim => no email, no ledger row
    const sent2: SendMailInput[] = [];
    const summary2 = await runAlerts({
      now: NOW,
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      hooks: {
        beforeClaim: async (p) => {
          const r = await updatePlan(user.id, true, p.id, { targetPrice: 9000 }, NOW);
          assert.ok(r.ok);
        },
      },
      sendMail: async (msg) => {
        sent2.push(msg);
      },
    });
    assert.equal(summary2.sent, 0);
    assert.equal(sent2.length, 0);
    const deliv2 = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM alert_deliveries WHERE plan_id = ?",
      args: [planId],
    });
    assert.equal(Number(deliv2.rows[0]?.c), 0);

    // Raise target back to 12000 so plan is eligible for in-flight send test
    const raiseTarget = await updatePlan(user.id, true, planId, { targetPrice: 12000 }, NOW);
    assert.ok(raiseTarget.ok);

    // (4) PATCH (target change) while a send is in flight => ledger row is 'sent' but last_alert_price stays NULL
    const sent3: SendMailInput[] = [];
    const summary3 = await runAlerts({
      now: NOW,
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      hooks: {
        beforeComplete: async (p) => {
          // Simulate a pre-existing baseline that the concurrent PATCH resets to NULL while bumping revision
          await client.execute({
            sql: "UPDATE plans SET last_alert_price = 11500, last_alert_at = '2026-10-15T00:00:00.000Z' WHERE id = ?",
            args: [p.id],
          });
          const r = await updatePlan(user.id, true, p.id, { targetPrice: 11000 }, NOW);
          assert.ok(r.ok);
        },
      },
      sendMail: async (msg) => {
        sent3.push(msg);
      },
    });
    assert.equal(summary3.sent, 1);
    assert.equal(sent3.length, 1);

    const deliv3 = await client.execute({
      sql: "SELECT status FROM alert_deliveries WHERE plan_id = ? AND day = ?",
      args: [planId, TODAY],
    });
    assert.equal(String(deliv3.rows[0]?.status), "sent");

    const planRowAfter = await client.execute({
      sql: "SELECT target_price, last_alert_price, last_alert_at FROM plans WHERE id = ?",
      args: [planId],
    });
    assert.equal(Number(planRowAfter.rows[0]?.target_price), 11000);
    assert.equal(planRowAfter.rows[0]?.last_alert_price, null);
    assert.equal(planRowAfter.rows[0]?.last_alert_at, null);

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

test("alerts engine current-month evaluation: ignores past departure dates and measures coverage over remaining dates for one-way and round-trip", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-alerts-curmonth-"));
  const dbPath = join(dir, "curmonth.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const userRes = await createUser("curmonth@example.com", "scrypt$hash", { verified: true });
    assert.ok(userRes.ok);
    const user = userRes.user;

    // Part A: With now = 2026-10-16, an October-15 fare is ignored even if its snapshot_day is 2026-10-16
    const oct16Now = new Date("2026-10-16T08:00:00.000Z");
    const planOneway16 = await createPlan(
      user.id,
      true,
      {
        origin: "BLR",
        destination: "GOI",
        month: "2026-10",
        trip: "oneway",
        alertEnabled: true,
        targetPrice: 4000,
      },
      oct16Now,
    );
    assert.ok(planOneway16.ok);

    await saveFares([
      // Past departure date (Oct 15 < Oct 16) with very cheap fare 1500
      {
        day: "2026-10-16",
        origin: "BLR",
        destination: "GOI",
        date: "2026-10-15",
        price: 1500,
        airline: "IndiGo",
        stops: 0,
        status: "ok",
      },
      // Remaining dates Oct 16..31 (16 dates) at 3200
      ...buildMonthFares("BLR", "GOI", "2026-10-16", "2026-10-31", "2026-10-16", 3200),
    ]);

    const sentOct16: SendMailInput[] = [];
    const summaryOct16 = await runAlerts({
      now: oct16Now,
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      sendMail: async (msg) => {
        sentOct16.push(msg);
      },
    });
    assert.equal(summaryOct16.sent, 1);
    assert.equal(sentOct16.length, 1);
    assert.match(sentOct16[0]!.subject, /from ₹3,200/);
    assert.ok(!sentOct16[0]!.text.includes("2026-10-15"));
    assert.ok(!sentOct16[0]!.html.includes("2026-10-15"));

    // Disable first plan so Part B evaluates only the Oct 20 plans cleanly
    await updatePlan(user.id, true, planOneway16.plan.id, { alertEnabled: false }, oct16Now);

    // Part B: With now = 2026-10-20, 100% fresh coverage for Oct 20..31 (12 dates, <50% of 31-day month)
    // passes the 50% rule for both one-way and round-trip (inbound Oct 24..Nov 07, 15 dates, <50% of 34-day full inbound range)
    const oct20Now = new Date("2026-10-20T08:00:00.000Z");
    const planOneway20 = await createPlan(
      user.id,
      true,
      {
        origin: "DEL",
        destination: "BOM",
        month: "2026-10",
        trip: "oneway",
        alertEnabled: true,
        targetPrice: 5000,
      },
      oct20Now,
    );
    const planRound20 = await createPlan(
      user.id,
      true,
      {
        origin: "DEL",
        destination: "BOM",
        month: "2026-10",
        trip: "round",
        minGap: 4,
        maxGap: 7,
        alertEnabled: true,
        targetPrice: 9500,
      },
      oct20Now,
    );
    assert.ok(planOneway20.ok && planRound20.ok);

    await saveFares([
      // Past outbound and pre-gap inbound fares with ultra-low prices that must be ignored
      {
        day: "2026-10-20",
        origin: "DEL",
        destination: "BOM",
        date: "2026-10-15",
        price: 999,
        airline: "IndiGo",
        stops: 0,
        status: "ok",
      },
      {
        day: "2026-10-20",
        origin: "BOM",
        destination: "DEL",
        date: "2026-10-22",
        price: 999,
        airline: "IndiGo",
        stops: 0,
        status: "ok",
      },
      // Remaining outbound Oct 20..31 (12 dates) at 4100
      ...buildMonthFares("DEL", "BOM", "2026-10-20", "2026-10-31", "2026-10-20", 4100),
      // Clamped inbound Oct 24..Nov 07 (15 dates) at 4400 => round-trip total 8500
      ...buildMonthFares("BOM", "DEL", "2026-10-24", "2026-11-07", "2026-10-20", 4400),
    ]);

    const sentOct20: SendMailInput[] = [];
    const summaryOct20 = await runAlerts({
      now: oct20Now,
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      sendMail: async (msg) => {
        sentOct20.push(msg);
      },
    });
    assert.equal(summaryOct20.considered, 2);
    assert.equal(summaryOct20.sent, 2);
    assert.equal(sentOct20.length, 2);
    assert.match(sentOct20[0]!.subject, /from ₹4,100/);
    assert.ok(!sentOct20[0]!.text.includes("2026-10-15"));
    assert.match(sentOct20[1]!.subject, /from ₹8,500/);
    assert.ok(!sentOct20[1]!.text.includes("2026-10-15"));
    assert.ok(!sentOct20[1]!.text.includes("to 2026-10-22"));

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
