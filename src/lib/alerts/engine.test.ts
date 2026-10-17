import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createUser } from "../auth/users.ts";
import type { SendMailInput } from "../mailer.ts";
import { createPlan, listPlans, updatePlan } from "../plans/index.ts";
import { listUserDeviceTokens, registerDevice } from "../push/devices.ts";
import type { PushMessageInput } from "../push/fcm.ts";
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
    assert.match(email.subject, /Trippie: Below your limit: BLR → IXZ from ₹10,500 \(limit ₹12,000\) in February 2027/);
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

    // (4) PATCH (target change) while a send is in flight => ledger row is 'sent' but last_alert_price and last_seen_price stay NULL
    const sent3: SendMailInput[] = [];
    const summary3 = await runAlerts({
      now: NOW,
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      hooks: {
        beforeComplete: async (p) => {
          // Simulate a pre-existing baseline that the concurrent PATCH resets to NULL while bumping revision
          await client.execute({
            sql: "UPDATE plans SET last_alert_price = 11500, last_seen_price = 11500, last_alert_at = '2026-10-15T00:00:00.000Z' WHERE id = ?",
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
      sql: "SELECT target_price, last_alert_price, last_seen_price, last_alert_at FROM plans WHERE id = ?",
      args: [planId],
    });
    assert.equal(Number(planRowAfter.rows[0]?.target_price), 11000);
    assert.equal(planRowAfter.rows[0]?.last_alert_price, null);
    assert.equal(planRowAfter.rows[0]?.last_seen_price, null);
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

test("alerts engine multi-channel: push-only delivery, no-channel skip before claim, partial/full failure, invalid token pruning, and relative URL fallback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-alerts-push-"));
  const dbPath = join(dir, "push-alerts.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  const prevHost = process.env.SMTP_HOST;
  const prevSecret = process.env.APP_SECRET;
  const prevOrigin = process.env.APP_ORIGIN;
  const prevFcm = process.env.FCM_SERVICE_ACCOUNT;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
  delete process.env.SMTP_HOST;
  delete process.env.APP_SECRET;
  delete process.env.APP_ORIGIN;
  delete process.env.FCM_SERVICE_ACCOUNT;

  try {
    const client = await getClient();
    const userWithDevicesRes = await createUser("pushuser@example.com", "scrypt$hash", { verified: true });
    const userNoDevicesRes = await createUser("nodevice@example.com", "scrypt$hash", { verified: true });
    assert.ok(userWithDevicesRes.ok && userNoDevicesRes.ok);
    const userWithDevices = userWithDevicesRes.user;
    const userNoDevices = userNoDevicesRes.user;

    const validToken = "fcm_valid_token_123456789012345";
    const staleToken = "fcm_stale_token_123456789012345";
    await registerDevice(userWithDevices.id, validToken, "android", NOW);
    await registerDevice(userWithDevices.id, staleToken, "android", NOW);

    const planPushRes = await createPlan(
      userWithDevices.id,
      true,
      {
        origin: "BLR",
        destination: "IXZ",
        month: "2027-02",
        trip: "round",
        minGap: 5,
        maxGap: 7,
        alertEnabled: true,
        targetPrice: 25000,
      },
      NOW,
    );
    const planNoChannelRes = await createPlan(
      userNoDevices.id,
      true,
      {
        origin: "BLR",
        destination: "IXZ",
        month: "2027-02",
        trip: "oneway",
        alertEnabled: true,
        targetPrice: 15000,
      },
      NOW,
    );
    assert.ok(planPushRes.ok && planNoChannelRes.ok);
    const planPushId = planPushRes.plan.id;
    const planNoChannelId = planNoChannelRes.plan.id;

    // Seed fares: outbound 11159, inbound 12000 => round-trip best = 23159
    const { first, last } = monthBounds("2027-02");
    await saveFares([
      ...buildMonthFares("BLR", "IXZ", first, last, TODAY, 11159),
      ...buildMonthFares("IXZ", "BLR", addDays(first, 5), addDays(last, 7), TODAY, 12000),
    ]);

    // (d) Dry-run when neither channel is configured changes no state
    const dryRes = await runAlerts({ now: NOW });
    assert.equal(dryRes.dryRun, true);
    assert.equal(dryRes.considered, 2);
    assert.equal(dryRes.wouldAlert, 2);
    assert.equal(dryRes.sent, 0);
    assert.equal(dryRes.email_sent, 0);
    assert.equal(dryRes.push_sent, 0);

    // (a) Push-only (mail unconfigured, push configured, user1 has devices, user2 has 0 devices)
    // and (b) user2 has no deliverable channel => skipped with 'no channel' BEFORE claiming (no ledger row)
    const pushesSent: Array<{ token: string; payload: PushMessageInput }> = [];
    const claimedPlans: string[] = [];

    const pushOnlySummary = await runAlerts({
      now: NOW,
      hooks: {
        beforeClaim: (p) => {
          claimedPlans.push(p.id);
        },
      },
      sendPush: async (token, payload) => {
        if (token === staleToken) {
          return "invalid_token";
        }
        pushesSent.push({ token, payload });
        return "ok";
      },
    });

    assert.equal(pushOnlySummary.dryRun, false);
    assert.equal(pushOnlySummary.considered, 2);
    assert.equal(pushOnlySummary.sent, 1);
    assert.equal(pushOnlySummary.email_sent, 0);
    assert.equal(pushOnlySummary.push_sent, 1);
    assert.equal(pushOnlySummary.invalid_tokens_removed, 1);
    assert.equal(pushOnlySummary.skipped["no channel"], 1);

    // User without devices was skipped BEFORE beforeClaim and has no ledger row
    assert.deepEqual(claimedPlans, [planPushId]);
    const noChanLedger = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM alert_deliveries WHERE plan_id = ?",
      args: [planNoChannelId],
    });
    assert.equal(Number(noChanLedger.rows[0]?.c), 0);

    // Stale token was removed from devices, valid token remains
    assert.deepEqual(await listUserDeviceTokens(userWithDevices.id), [validToken]);

    // Verify push payload formatting and relative URL fallback when APP_ORIGIN is unset
    assert.equal(pushesSent.length, 1);
    assert.equal(pushesSent[0]!.token, validToken);
    assert.equal(
      pushesSent[0]!.payload.title,
      "Below your limit: BLR → IXZ from ₹23,159 (limit ₹25,000)",
    );
    assert.equal(
      pushesSent[0]!.payload.body,
      "February 2027 · best 2027-02-01 – 2027-02-06 (₹23,159)",
    );
    assert.equal(
      pushesSent[0]!.payload.url,
      "/?origin=BLR&destination=IXZ&month=2027-02&trip=round&minGap=5&maxGap=7",
    );
    assert.equal(pushesSent[0]!.payload.tag, planPushId);

    // Verify ledger marked 'sent' and baseline advanced to 23159
    const pushLedger = await client.execute({
      sql: "SELECT status FROM alert_deliveries WHERE plan_id = ? AND day = ?",
      args: [planPushId, TODAY],
    });
    assert.equal(String(pushLedger.rows[0]?.status), "sent");
    assert.equal((await listPlans(userWithDevices.id, NOW))[0]?.lastAlertPrice, 23159);
    assert.equal((await listPlans(userWithDevices.id, NOW))[0]?.lastSeenPrice, 23159);

    // Disable second plan now that (b) no-channel skip is verified
    await updatePlan(userNoDevices.id, true, planNoChannelId, { alertEnabled: false }, NOW);

    // (c1) Next UTC day, price drops to 21000 (10000 + 11000); email fails but push succeeds => 'sent' and baseline advances
    const day2Now = new Date("2026-10-17T08:00:00.000Z");
    await saveFares([
      ...buildMonthFares("BLR", "IXZ", first, last, "2026-10-17", 10000),
      ...buildMonthFares("IXZ", "BLR", addDays(first, 5), addDays(last, 7), "2026-10-17", 11000),
    ]);

    const partialSummary = await runAlerts({
      now: day2Now,
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie-mu.vercel.app",
      sendMail: async () => {
        throw new Error("SMTP down");
      },
      sendPush: async (token, payload) => {
        pushesSent.push({ token, payload });
        return "ok";
      },
    });
    assert.equal(partialSummary.sent, 1);
    assert.equal(partialSummary.failed, 0);
    assert.equal(partialSummary.email_sent, 0);
    assert.equal(partialSummary.push_sent, 1);
    assert.equal(
      pushesSent[1]!.payload.url,
      "https://trippie-mu.vercel.app/?origin=BLR&destination=IXZ&month=2027-02&trip=round&minGap=5&maxGap=7",
    );
    assert.equal((await listPlans(userWithDevices.id, day2Now))[0]?.lastAlertPrice, 21000);
    assert.equal((await listPlans(userWithDevices.id, day2Now))[0]?.lastSeenPrice, 21000);

    // (c2) Day 3, price drops to 19000 (9000 + 10000); both email and push fail ('error') => 'failed', baseline stays 21000, device NOT deleted
    const day3Now = new Date("2026-10-18T08:00:00.000Z");
    await saveFares([
      ...buildMonthFares("BLR", "IXZ", first, last, "2026-10-18", 9000),
      ...buildMonthFares("IXZ", "BLR", addDays(first, 5), addDays(last, 7), "2026-10-18", 10000),
    ]);

    const bothFailSummary = await runAlerts({
      now: day3Now,
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie-mu.vercel.app",
      sendMail: async () => {
        throw new Error("SMTP still down");
      },
      sendPush: async () => "error",
    });
    assert.equal(bothFailSummary.sent, 0);
    assert.equal(bothFailSummary.failed, 1);
    assert.equal(bothFailSummary.email_sent, 0);
    assert.equal(bothFailSummary.push_sent, 0);
    assert.equal(bothFailSummary.invalid_tokens_removed, 0);
    assert.equal((await listPlans(userWithDevices.id, day3Now))[0]?.lastAlertPrice, 21000);
    assert.equal((await listPlans(userWithDevices.id, day3Now))[0]?.lastSeenPrice, 19000);
    assert.deepEqual(await listUserDeviceTokens(userWithDevices.id), [validToken]);

    const day3Ledger = await client.execute({
      sql: "SELECT status FROM alert_deliveries WHERE plan_id = ? AND day = '2026-10-18'",
      args: [planPushId],
    });
    assert.equal(String(day3Ledger.rows[0]?.status), "failed");

    client.close();
  } finally {
    if (prevUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = prevUrl;
    if (prevHost !== undefined) process.env.SMTP_HOST = prevHost;
    if (prevSecret !== undefined) process.env.APP_SECRET = prevSecret;
    if (prevOrigin !== undefined) process.env.APP_ORIGIN = prevOrigin;
    if (prevFcm !== undefined) process.env.FCM_SERVICE_ACCOUNT = prevFcm;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows SQLite file handle may release asynchronously on process exit
    }
  }
});

test("alerts engine no-limit mode: first run sets baseline silently, drop >= max(300, 3%) sends once, small drop doesn't, rise updates baseline silently, and daily cap holds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-alerts-nolimit-"));
  const dbPath = join(dir, "nolimit.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const userRes = await createUser("nolimit@example.com", "scrypt$hash", { verified: true });
    assert.ok(userRes.ok);
    const user = userRes.user;

    const planRes = await createPlan(
      user.id,
      true,
      {
        origin: "BLR",
        destination: "IXZ",
        month: "2027-02",
        trip: "oneway",
        alertEnabled: true,
        targetPrice: null,
      },
      NOW,
    );
    assert.ok(planRes.ok);
    assert.equal(planRes.plan.targetPrice, null);
    assert.equal(planRes.plan.lastSeenPrice, null);

    const { first, last } = monthBounds("2027-02");
    const sentEmails: SendMailInput[] = [];
    const sendMail = async (msg: SendMailInput) => {
      sentEmails.push(msg);
    };

    // Day 1, run 1: B = 20000, last_seen_price IS NULL -> stores B as last_seen_price, sends nothing
    await saveFares(buildMonthFares("BLR", "IXZ", first, last, "2026-10-16", 20000));
    const r1 = await runAlerts({
      now: new Date("2026-10-16T08:00:00.000Z"),
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      sendMail,
    });
    assert.equal(r1.sent, 0);
    assert.equal(r1.skipped["baseline set"], 1);
    assert.equal(sentEmails.length, 0);
    let p = (await listPlans(user.id, NOW))[0]!;
    assert.equal(p.lastSeenPrice, 20000);
    assert.equal(p.lastAlertPrice, null);

    // Day 1, run 2: small drop from 20000 to 19500 (drop = 500 < max(300, round(20000*0.03)) = 600) -> does NOT send, updates baseline to 19500
    await saveFares(buildMonthFares("BLR", "IXZ", first, last, "2026-10-16", 19500));
    const r2 = await runAlerts({
      now: new Date("2026-10-16T12:00:00.000Z"),
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      sendMail,
    });
    assert.equal(r2.sent, 0);
    assert.equal(r2.skipped["no price drop"], 1);
    assert.equal(sentEmails.length, 0);
    p = (await listPlans(user.id, NOW))[0]!;
    assert.equal(p.lastSeenPrice, 19500);
    assert.equal(p.lastAlertPrice, null);

    // Day 1, run 3: drop from 19500 to 18915 (drop = 585 == round(19500 * 0.03) = 585 >= 300) -> sends once!
    await saveFares(buildMonthFares("BLR", "IXZ", first, last, "2026-10-16", 18915));
    const r3 = await runAlerts({
      now: new Date("2026-10-16T16:00:00.000Z"),
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      sendMail,
    });
    assert.equal(r3.sent, 1);
    assert.equal(sentEmails.length, 1);
    assert.match(
      sentEmails[0]!.subject,
      /Trippie: Price dropped: BLR → IXZ now from ₹18,915 \(was ₹19,500\) in February 2027/,
    );
    p = (await listPlans(user.id, NOW))[0]!;
    assert.equal(p.lastSeenPrice, 18915);
    assert.equal(p.lastAlertPrice, 18915);

    // Day 1, run 4: another big drop same UTC day to 15000 -> blocked by daily claim (max one alert per plan per UTC day), still updates last_seen_price to 15000
    await saveFares(buildMonthFares("BLR", "IXZ", first, last, "2026-10-16", 15000));
    const r4 = await runAlerts({
      now: new Date("2026-10-16T20:00:00.000Z"),
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      sendMail,
    });
    assert.equal(r4.sent, 0);
    assert.equal(r4.skipped["already claimed"], 1);
    assert.equal(sentEmails.length, 1);
    p = (await listPlans(user.id, NOW))[0]!;
    assert.equal(p.lastSeenPrice, 15000);
    assert.equal(p.lastAlertPrice, 18915);

    // Day 2, run 1: price rises to 22000 -> updates baseline silently to 22000, sends nothing
    await saveFares(buildMonthFares("BLR", "IXZ", first, last, "2026-10-17", 22000));
    const r5 = await runAlerts({
      now: new Date("2026-10-17T08:00:00.000Z"),
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      sendMail,
    });
    assert.equal(r5.sent, 0);
    assert.equal(r5.skipped["no price drop"], 1);
    assert.equal(sentEmails.length, 1);
    p = (await listPlans(user.id, NOW))[0]!;
    assert.equal(p.lastSeenPrice, 22000);
    assert.equal(p.lastAlertPrice, 18915);

    // Day 2, run 2: drops from 22000 to 21000 (drop = 1000 >= 660, even though 21000 > previous lastAlertPrice 18915!) -> sends because drop is measured from most recent last_seen_price
    await saveFares(buildMonthFares("BLR", "IXZ", first, last, "2026-10-17", 21000));
    const r6 = await runAlerts({
      now: new Date("2026-10-17T12:00:00.000Z"),
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      sendMail,
    });
    assert.equal(r6.sent, 1);
    assert.equal(sentEmails.length, 2);
    assert.match(
      sentEmails[1]!.subject,
      /Trippie: Price dropped: BLR → IXZ now from ₹21,000 \(was ₹22,000\) in February 2027/,
    );
    p = (await listPlans(user.id, NOW))[0]!;
    assert.equal(p.lastSeenPrice, 21000);
    assert.equal(p.lastAlertPrice, 21000);

    // Day 3: test 300 INR floor when 3% < 300 (e.g. baseline 5000, 3% = 150, max(300, 150) = 300)
    await saveFares(buildMonthFares("BLR", "IXZ", first, last, "2026-10-18", 5000));
    // Force last_seen_price to 5000 via DB for clean floor test
    await client.execute({
      sql: "UPDATE plans SET last_seen_price = 5000 WHERE id = ?",
      args: [planRes.plan.id],
    });
    // Drop of 250 (to 4750) -> does NOT send (250 < 300)
    await saveFares(buildMonthFares("BLR", "IXZ", first, last, "2026-10-18", 4750));
    const r7 = await runAlerts({
      now: new Date("2026-10-18T08:00:00.000Z"),
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      sendMail,
    });
    assert.equal(r7.sent, 0);
    assert.equal(r7.skipped["no price drop"], 1);
    p = (await listPlans(user.id, NOW))[0]!;
    assert.equal(p.lastSeenPrice, 4750);

    // Drop of 300 (from 4750 to 4450) -> sends!
    await saveFares(buildMonthFares("BLR", "IXZ", first, last, "2026-10-18", 4450));
    const r8 = await runAlerts({
      now: new Date("2026-10-18T12:00:00.000Z"),
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      sendMail,
    });
    assert.equal(r8.sent, 1);
    assert.equal(sentEmails.length, 3);
    assert.match(
      sentEmails[2]!.subject,
      /Trippie: Price dropped: BLR → IXZ now from ₹4,450 \(was ₹4,750\) in February 2027/,
    );

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

test("alerts engine limit mode: below limit sends once, staying below at same/higher price doesn't resend, dropping further sends next day, rising above limit re-arms, and next dip below sends", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-alerts-limit-rearm-"));
  const dbPath = join(dir, "limit-rearm.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const userRes = await createUser("limituser@example.com", "scrypt$hash", { verified: true });
    assert.ok(userRes.ok);
    const user = userRes.user;

    const planRes = await createPlan(
      user.id,
      true,
      {
        origin: "BLR",
        destination: "IXZ",
        month: "2027-02",
        trip: "oneway",
        alertEnabled: true,
        targetPrice: 10000,
      },
      NOW,
    );
    assert.ok(planRes.ok);

    const { first, last } = monthBounds("2027-02");
    const sentEmails: SendMailInput[] = [];
    const sendMail = async (msg: SendMailInput) => {
      sentEmails.push(msg);
    };

    // Day 1: B = 9500 <= 10000 -> sends once, sets lastAlertPrice = 9500, lastSeenPrice = 9500
    await saveFares(buildMonthFares("BLR", "IXZ", first, last, "2026-10-16", 9500));
    const d1 = await runAlerts({
      now: new Date("2026-10-16T08:00:00.000Z"),
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      sendMail,
    });
    assert.equal(d1.sent, 1);
    assert.equal(sentEmails.length, 1);
    assert.match(
      sentEmails[0]!.subject,
      /Trippie: Below your limit: BLR → IXZ from ₹9,500 \(limit ₹10,000\) in February 2027/,
    );
    let p = (await listPlans(user.id, NOW))[0]!;
    assert.equal(p.lastAlertPrice, 9500);
    assert.equal(p.lastSeenPrice, 9500);

    // Day 2: staying below limit at same price (9500) or slightly higher (9800 <= 10000) -> does NOT resend, updates lastSeenPrice
    await saveFares(buildMonthFares("BLR", "IXZ", first, last, "2026-10-17", 9800));
    const d2 = await runAlerts({
      now: new Date("2026-10-17T08:00:00.000Z"),
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      sendMail,
    });
    assert.equal(d2.sent, 0);
    assert.equal(d2.skipped["no price drop"], 1);
    p = (await listPlans(user.id, NOW))[0]!;
    assert.equal(p.lastAlertPrice, 9500);
    assert.equal(p.lastSeenPrice, 9800);

    // Day 3: dropping further below lastAlertPrice (9200 < 9500) -> sends again!
    await saveFares(buildMonthFares("BLR", "IXZ", first, last, "2026-10-18", 9200));
    const d3 = await runAlerts({
      now: new Date("2026-10-18T08:00:00.000Z"),
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      sendMail,
    });
    assert.equal(d3.sent, 1);
    assert.equal(sentEmails.length, 2);
    p = (await listPlans(user.id, NOW))[0]!;
    assert.equal(p.lastAlertPrice, 9200);
    assert.equal(p.lastSeenPrice, 9200);

    // Day 4: rising above the limit (11500 > 10000) -> re-arms by setting lastAlertPrice = NULL and lastSeenPrice = 11500
    await saveFares(buildMonthFares("BLR", "IXZ", first, last, "2026-10-19", 11500));
    const d4 = await runAlerts({
      now: new Date("2026-10-19T08:00:00.000Z"),
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      sendMail,
    });
    assert.equal(d4.sent, 0);
    assert.equal(d4.skipped["above target"], 1);
    p = (await listPlans(user.id, NOW))[0]!;
    assert.equal(p.lastAlertPrice, null);
    assert.equal(p.lastSeenPrice, 11500);

    // Day 5: next dip below the limit (9900 <= 10000, even though 9900 > previous 9200) -> sends because re-armed!
    await saveFares(buildMonthFares("BLR", "IXZ", first, last, "2026-10-20", 9900));
    const d5 = await runAlerts({
      now: new Date("2026-10-20T08:00:00.000Z"),
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      sendMail,
    });
    assert.equal(d5.sent, 1);
    assert.equal(sentEmails.length, 3);
    assert.match(
      sentEmails[2]!.subject,
      /Trippie: Below your limit: BLR → IXZ from ₹9,900 \(limit ₹10,000\) in February 2027/,
    );
    p = (await listPlans(user.id, NOW))[0]!;
    assert.equal(p.lastAlertPrice, 9900);
    assert.equal(p.lastSeenPrice, 9900);

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

test("alerts engine cabin isolation and per-user currency formatter hook in email and push", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-alerts-cabin-fmt-"));
  const dbPath = join(dir, "cabin-fmt.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const userRes = await createUser("biz@example.com", "scrypt$hash", { verified: true });
    assert.ok(userRes.ok);
    const user = userRes.user;

    const deviceToken = "fcm_biz_device_token_123456789012345";
    await registerDevice(user.id, deviceToken, "android", NOW);

    // Create a business cabin plan with targetPrice = 45000
    const bizPlanRes = await createPlan(
      user.id,
      true,
      {
        origin: "BLR",
        destination: "IXZ",
        month: "2027-02",
        trip: "round",
        minGap: 4,
        maxGap: 7,
        cabin: "business",
        alertEnabled: true,
        targetPrice: 45000,
      },
      NOW,
    );
    assert.ok(bizPlanRes.ok);
    assert.equal(bizPlanRes.plan.cabin, "business");

    const { first, last } = monthBounds("2027-02");
    // Seed cheap economy fares (5000 + 5000 = 10000) ONLY -> business plan must NOT see economy fares
    await saveFares([
      ...buildMonthFares("BLR", "IXZ", first, last, TODAY, 5000),
      ...buildMonthFares("IXZ", "BLR", addDays(first, 4), addDays(last, 7), TODAY, 5000),
    ]);

    const rEconOnly = await runAlerts({
      now: NOW,
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      sendMail: async () => {},
    });
    assert.equal(rEconOnly.considered, 1);
    assert.equal(rEconOnly.sent, 0);
    assert.equal(rEconOnly.skipped["insufficient data"], 1);

    // Now seed business fares (20000 outbound + 22000 inbound = 42000 <= 45000)
    const nowIso = NOW.toISOString();
    const bizStmts = [
      ...buildMonthFares("BLR", "IXZ", first, last, TODAY, 20000, "Air India").map((r) => ({
        sql: `INSERT INTO fares (snapshot_day, origin, destination, travel_date, cabin, price, airline, stops, status, provider, scraped_at)
              VALUES (?, ?, ?, ?, 'business', ?, ?, ?, 'ok', 'google-flights', ?)`,
        args: [r.day, r.origin, r.destination, r.date, r.price, r.airline ?? null, r.stops ?? 0, nowIso],
      })),
      ...buildMonthFares("IXZ", "BLR", addDays(first, 4), addDays(last, 7), TODAY, 22000, "Air India").map((r) => ({
        sql: `INSERT INTO fares (snapshot_day, origin, destination, travel_date, cabin, price, airline, stops, status, provider, scraped_at)
              VALUES (?, ?, ?, ?, 'business', ?, ?, ?, 'ok', 'google-flights', ?)`,
        args: [r.day, r.origin, r.destination, r.date, r.price, r.airline ?? null, r.stops ?? 0, nowIso],
      })),
    ];
    await client.batch(bizStmts, "write");

    const sentEmails: SendMailInput[] = [];
    const sentPushes: PushMessageInput[] = [];
    const requestedUserIds: string[] = [];

    const rBiz = await runAlerts({
      now: NOW,
      appSecret: TEST_SECRET,
      appOrigin: "https://trippie.example.com",
      getFormatter: async (uid) => {
        requestedUserIds.push(uid);
        return (amountInr: number) => `USD ${Math.round(amountInr / 100)}`;
      },
      sendMail: async (msg) => {
        sentEmails.push(msg);
      },
      sendPush: async (_token, payload) => {
        sentPushes.push(payload);
        return "ok";
      },
    });

    assert.equal(rBiz.sent, 1);
    assert.equal(rBiz.email_sent, 1);
    assert.equal(rBiz.push_sent, 1);
    assert.deepEqual(requestedUserIds, [user.id]);

    // Verify email subject, text, and html use the custom formatter ("USD 420", "USD 450", "USD 200", "USD 220") and include "Business"
    const email = sentEmails[0]!;
    assert.equal(
      email.subject,
      "Trippie: Below your limit: BLR → IXZ (Business) from USD 420 (limit USD 450) in February 2027",
    );
    assert.ok(email.text.includes("Below your limit: BLR → IXZ (Business) from USD 420 (limit USD 450)"));
    assert.ok(email.text.includes("Best price found: USD 420"));
    assert.ok(email.text.includes("USD 420 (out USD 200, back USD 220)"));
    assert.ok(email.html.includes("Below your limit: BLR → IXZ (Business) from USD 420 (limit USD 450)"));
    assert.ok(email.html.includes("<strong>USD 420</strong> (USD 200 + USD 220)"));

    // Verify push title, body, and URL use the custom formatter and include Business
    const push = sentPushes[0]!;
    assert.equal(
      push.title,
      "Below your limit: BLR → IXZ (Business) from USD 420 (limit USD 450)",
    );
    assert.equal(
      push.body,
      "Business · February 2027 · best 2027-02-01 – 2027-02-05 (USD 420)",
    );
    assert.equal(
      push.url,
      "https://trippie.example.com/?origin=BLR&destination=IXZ&month=2027-02&trip=round&minGap=4&maxGap=7&cabin=business",
    );

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
