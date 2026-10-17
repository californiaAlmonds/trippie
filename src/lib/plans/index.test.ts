import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createUser, deleteUserAccount, getUserById } from "../auth/users.ts";
import { getClient } from "../store.ts";
import {
  clearRecentSearches,
  createPlan,
  deletePlan,
  listPlans,
  listRecentSearches,
  updatePlan,
  upsertRecentSearch,
} from "./index.ts";

test("plans CRUD scoping, 20-plan cap, duplicate rejection, unverified alertEnabled check, and PATCH resetting last_alert_price", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-plans-"));
  const dbPath = join(dir, "plans.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();

    const userARes = await createUser("alice@example.com", "scrypt$hash", { verified: true });
    const userBRes = await createUser("bob@example.com", "scrypt$hash", { verified: true });
    const unverifiedRes = await createUser("unverified@example.com", "scrypt$hash", { verified: false });
    assert.ok(userARes.ok && userBRes.ok && unverifiedRes.ok);
    const userA = userARes.user;
    const userB = userBRes.user;
    const unverified = unverifiedRes.user;

    // Unverified user cannot create a plan with alertEnabled: true
    const unvCreate = await createPlan(unverified.id, unverified.verified, {
      origin: "BLR",
      destination: "IXZ",
      month: "2027-02",
      trip: "round",
      minGap: 4,
      maxGap: 7,
      alertEnabled: true,
    });
    assert.deepEqual(unvCreate, {
      ok: false,
      status: 403,
      error: "Verify your email to enable alerts",
    });

    // Unverified user CAN create a plan with alertEnabled: false, but cannot PATCH alertEnabled: true
    const unvPlan = await createPlan(unverified.id, unverified.verified, {
      origin: "BLR",
      destination: "IXZ",
      month: "2027-02",
      trip: "oneway",
      minGap: 5,
      maxGap: 8,
    });
    assert.equal(unvPlan.ok, true);
    if (!unvPlan.ok) throw new Error("expected plan creation");
    assert.equal(unvPlan.plan.minGap, 0);
    assert.equal(unvPlan.plan.maxGap, 0);

    const unvPatch = await updatePlan(unverified.id, unverified.verified, unvPlan.plan.id, {
      alertEnabled: true,
    });
    assert.deepEqual(unvPatch, {
      ok: false,
      status: 403,
      error: "Verify your email to enable alerts",
    });

    // Target price validation
    const badTargetLow = await createPlan(userA.id, userA.verified, {
      origin: "BLR",
      destination: "IXZ",
      month: "2027-02",
      trip: "round",
      minGap: 4,
      maxGap: 7,
      targetPrice: 499,
    });
    assert.equal(badTargetLow.ok, false);
    if (!badTargetLow.ok) assert.equal(badTargetLow.status, 400);

    // Verified user A creates a plan with alertEnabled and targetPrice
    const planA1 = await createPlan(userA.id, userA.verified, {
      origin: "BLR",
      destination: "IXZ",
      month: "2027-02",
      trip: "round",
      minGap: 4,
      maxGap: 7,
      cabin: "business",
      alertEnabled: true,
      targetPrice: 15000,
    });
    assert.equal(planA1.ok, true);
    if (!planA1.ok) throw new Error("expected planA1 creation");
    assert.equal(planA1.plan.cabin, "business");
    assert.equal(planA1.plan.alertEnabled, true);
    assert.equal(planA1.plan.targetPrice, 15000);
    assert.equal(planA1.plan.lastAlertPrice, null);
    assert.equal(planA1.plan.lastSeenPrice, null);
    assert.equal(planA1.plan.expired, false);

    // Duplicate plan is rejected with 409 (even with a different cabin, since UNIQUE excludes cabin)
    const dupA1 = await createPlan(userA.id, userA.verified, {
      origin: "blr",
      destination: "ixz",
      month: "2027-02",
      trip: "round",
      minGap: 4,
      maxGap: 7,
      cabin: "economy",
    });
    assert.deepEqual(dupA1, {
      ok: false,
      status: 409,
      error: "Plan already saved",
    });

    // User B cannot read, patch, or delete User A's plan
    assert.deepEqual(await listPlans(userB.id), []);
    const patchByB = await updatePlan(userB.id, userB.verified, planA1.plan.id, {
      alertEnabled: false,
    });
    assert.deepEqual(patchByB, {
      ok: false,
      status: 404,
      error: "Not found",
    });
    assert.equal(await deletePlan(userB.id, planA1.plan.id), false);

    // Seed last_alert_price, last_seen_price, and last_alert_at on planA1, then verify PATCH resets all to NULL
    await client.execute({
      sql: "UPDATE plans SET last_alert_price = 12345, last_seen_price = 12800, last_alert_at = '2026-10-16T00:00:00.000Z' WHERE id = ?",
      args: [planA1.plan.id],
    });
    const beforePatch = await listPlans(userA.id);
    assert.equal(beforePatch[0]?.cabin, "business");
    assert.equal(beforePatch[0]?.lastAlertPrice, 12345);
    assert.equal(beforePatch[0]?.lastSeenPrice, 12800);

    const patched = await updatePlan(userA.id, userA.verified, planA1.plan.id, {
      targetPrice: 14000,
    });
    assert.equal(patched.ok, true);
    if (!patched.ok) throw new Error("expected patch success");
    assert.equal(patched.plan.cabin, "business");
    assert.equal(patched.plan.targetPrice, 14000);
    assert.equal(patched.plan.lastAlertPrice, null);
    assert.equal(patched.plan.lastSeenPrice, null);

    const dbRowAfterPatch = await client.execute({
      sql: "SELECT last_alert_price, last_seen_price, last_alert_at FROM plans WHERE id = ?",
      args: [planA1.plan.id],
    });
    assert.equal(dbRowAfterPatch.rows[0]?.last_alert_price, null);
    assert.equal(dbRowAfterPatch.rows[0]?.last_seen_price, null);
    assert.equal(dbRowAfterPatch.rows[0]?.last_alert_at, null);

    // Cap of 20 plans per user: userA already has 1 plan, create 19 more -> 20 total
    for (let gap = 1; gap <= 19; gap++) {
      const res = await createPlan(userA.id, userA.verified, {
        origin: "DEL",
        destination: "BOM",
        month: "2027-03",
        trip: "round",
        minGap: gap,
        maxGap: gap + 1,
      });
      assert.equal(res.ok, true);
      if (res.ok) assert.equal(res.plan.cabin, "economy");
    }
    const allA = await listPlans(userA.id);
    assert.equal(allA.length, 20);
    // Newest first
    assert.equal(allA[0]?.minGap, 19);

    // 21st plan is rejected with 409 "Plan limit reached"
    const overCap = await createPlan(userA.id, userA.verified, {
      origin: "DEL",
      destination: "BOM",
      month: "2027-03",
      trip: "round",
      minGap: 20,
      maxGap: 21,
    });
    assert.deepEqual(overCap, {
      ok: false,
      status: 409,
      error: "Plan limit reached",
    });

    // Deleting a plan also deletes its alert_deliveries in the same transaction
    await client.execute({
      sql: "INSERT INTO alert_deliveries (plan_id, day, status, created_at) VALUES (?, '2026-10-16', 'sent', '2026-10-16T01:00:00.000Z')",
      args: [planA1.plan.id],
    });
    assert.equal(await deletePlan(userA.id, planA1.plan.id), true);
    assert.equal(await deletePlan(userA.id, planA1.plan.id), false);

    const delivRs = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM alert_deliveries WHERE plan_id = ?",
      args: [planA1.plan.id],
    });
    assert.equal(Number(delivRs.rows[0]?.c), 0);

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

test("recent searches upsert, cap-10 pruning, and clear; account deletion removes plans, recents, and deliveries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-recent-"));
  const dbPath = join(dir, "recent.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const userRes = await createUser("recents@example.com", "scrypt$hash", { verified: true });
    assert.ok(userRes.ok);
    const user = userRes.user;

    // Insert 12 distinct recent searches; only the newest 10 should remain
    for (let gap = 1; gap <= 12; gap++) {
      const r = await upsertRecentSearch(user.id, {
        origin: "BLR",
        destination: "IXZ",
        month: "2027-02",
        trip: "round",
        minGap: gap,
        maxGap: gap,
      });
      assert.deepEqual(r, { ok: true });
    }

    const recents1 = await listRecentSearches(user.id);
    assert.equal(recents1.length, 10);
    assert.equal(recents1[0]?.minGap, 12);
    assert.equal(recents1[9]?.minGap, 3);

    // Re-upserting an existing search (minGap = 5) moves it to the top without increasing count
    await upsertRecentSearch(user.id, {
      origin: "BLR",
      destination: "IXZ",
      month: "2027-02",
      trip: "round",
      minGap: 5,
      maxGap: 5,
    });
    const recents2 = await listRecentSearches(user.id);
    assert.equal(recents2.length, 10);
    assert.equal(recents2[0]?.minGap, 5);

    // Clear recent searches
    await clearRecentSearches(user.id);
    assert.deepEqual(await listRecentSearches(user.id), []);

    // Add a plan, an alert delivery, and a recent search, then deleteUserAccount
    await upsertRecentSearch(user.id, {
      origin: "BLR",
      destination: "GOI",
      month: "2027-04",
      trip: "oneway",
    });
    const planRes = await createPlan(user.id, user.verified, {
      origin: "BLR",
      destination: "GOI",
      month: "2027-04",
      trip: "oneway",
      alertEnabled: true,
    });
    assert.ok(planRes.ok);
    await client.execute({
      sql: "INSERT INTO alert_deliveries (plan_id, day, status, created_at) VALUES (?, '2026-10-16', 'sent', '2026-10-16T01:00:00.000Z')",
      args: [planRes.plan.id],
    });

    await deleteUserAccount(user.id);

    assert.equal(await getUserById(user.id), null);
    const plansCount = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM plans WHERE user_id = ?",
      args: [user.id],
    });
    const recentsCount = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM recent_searches WHERE user_id = ?",
      args: [user.id],
    });
    const delivCount = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM alert_deliveries WHERE plan_id = ?",
      args: [planRes.plan.id],
    });
    assert.equal(Number(plansCount.rows[0]?.c), 0);
    assert.equal(Number(recentsCount.rows[0]?.c), 0);
    assert.equal(Number(delivCount.rows[0]?.c), 0);

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

test("partial PATCH never clobbers unspecified fields, increments revision on every PATCH, and resets last_alert_price/last_seen_price/last_alert_at", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-plans-patch-"));
  const dbPath = join(dir, "patch.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const userRes = await createUser("patcher@example.com", "scrypt$hash", { verified: true });
    assert.ok(userRes.ok);
    const user = userRes.user;

    const created = await createPlan(user.id, user.verified, {
      origin: "BLR",
      destination: "IXZ",
      month: "2027-02",
      trip: "round",
      minGap: 4,
      maxGap: 7,
      alertEnabled: true,
      targetPrice: 15000,
    });
    assert.ok(created.ok);
    const planId = created.plan.id;

    // Initial revision is 0
    const rev0 = await client.execute({
      sql: "SELECT revision, alert_enabled, target_price FROM plans WHERE id = ?",
      args: [planId],
    });
    assert.equal(Number(rev0.rows[0]?.revision), 0);
    assert.equal(Number(rev0.rows[0]?.alert_enabled), 1);
    assert.equal(Number(rev0.rows[0]?.target_price), 15000);

    // Caller reads plan earlier when alertEnabled is true
    const earlierSnapshot = (await listPlans(user.id))[0];
    assert.equal(earlierSnapshot?.alertEnabled, true);
    assert.equal(earlierSnapshot?.targetPrice, 15000);

    // Seed baseline before first PATCH
    await client.execute({
      sql: "UPDATE plans SET last_alert_price = 11000, last_seen_price = 11200, last_alert_at = '2026-10-16T01:00:00.000Z' WHERE id = ?",
      args: [planId],
    });

    // PATCH 1: disable alerts only -> target_price must remain 15000, revision -> 1, baseline reset
    const patchDisable = await updatePlan(user.id, user.verified, planId, {
      alertEnabled: false,
    });
    assert.ok(patchDisable.ok);
    assert.equal(patchDisable.plan.alertEnabled, false);
    assert.equal(patchDisable.plan.targetPrice, 15000);
    assert.equal(patchDisable.plan.lastAlertPrice, null);
    assert.equal(patchDisable.plan.lastSeenPrice, null);

    const rowAfter1 = await client.execute({
      sql: "SELECT revision, alert_enabled, target_price, last_alert_price, last_seen_price, last_alert_at FROM plans WHERE id = ?",
      args: [planId],
    });
    assert.equal(Number(rowAfter1.rows[0]?.revision), 1);
    assert.equal(Number(rowAfter1.rows[0]?.alert_enabled), 0);
    assert.equal(Number(rowAfter1.rows[0]?.target_price), 15000);
    assert.equal(rowAfter1.rows[0]?.last_alert_price, null);
    assert.equal(rowAfter1.rows[0]?.last_seen_price, null);
    assert.equal(rowAfter1.rows[0]?.last_alert_at, null);

    // Seed baseline again before second PATCH
    await client.execute({
      sql: "UPDATE plans SET last_alert_price = 10500, last_seen_price = 10600, last_alert_at = '2026-10-16T02:00:00.000Z' WHERE id = ?",
      args: [planId],
    });

    // PATCH 2: target-only PATCH running after the disable -> alert_enabled must stay 0, revision -> 2, baseline reset
    const patchTargetOnly = await updatePlan(user.id, user.verified, planId, {
      targetPrice: 13500,
    });
    assert.ok(patchTargetOnly.ok);
    assert.equal(patchTargetOnly.plan.alertEnabled, false);
    assert.equal(patchTargetOnly.plan.targetPrice, 13500);
    assert.equal(patchTargetOnly.plan.lastAlertPrice, null);
    assert.equal(patchTargetOnly.plan.lastSeenPrice, null);

    const rowAfter2 = await client.execute({
      sql: "SELECT revision, alert_enabled, target_price, last_alert_price, last_seen_price, last_alert_at FROM plans WHERE id = ?",
      args: [planId],
    });
    assert.equal(Number(rowAfter2.rows[0]?.revision), 2);
    assert.equal(Number(rowAfter2.rows[0]?.alert_enabled), 0);
    assert.equal(Number(rowAfter2.rows[0]?.target_price), 13500);
    assert.equal(rowAfter2.rows[0]?.last_alert_price, null);
    assert.equal(rowAfter2.rows[0]?.last_seen_price, null);
    assert.equal(rowAfter2.rows[0]?.last_alert_at, null);

    // PATCH 3: alertEnabled-only PATCH -> target_price must stay 13500, revision -> 3
    const patchEnableOnly = await updatePlan(user.id, user.verified, planId, {
      alertEnabled: true,
    });
    assert.ok(patchEnableOnly.ok);
    assert.equal(patchEnableOnly.plan.alertEnabled, true);
    assert.equal(patchEnableOnly.plan.targetPrice, 13500);

    // Back-to-back concurrent PATCHes (one target-only, one disabling alerts) never overwrite each other's field
    const [concurrentTarget, concurrentDisable] = await Promise.all([
      updatePlan(user.id, user.verified, planId, { targetPrice: 12000 }),
      updatePlan(user.id, user.verified, planId, { alertEnabled: false }),
    ]);
    assert.ok(concurrentTarget.ok && concurrentDisable.ok);

    const finalRow = await client.execute({
      sql: "SELECT revision, alert_enabled, target_price, last_alert_price, last_seen_price, last_alert_at FROM plans WHERE id = ?",
      args: [planId],
    });
    assert.equal(Number(finalRow.rows[0]?.revision), 5);
    assert.equal(Number(finalRow.rows[0]?.alert_enabled), 0);
    assert.equal(Number(finalRow.rows[0]?.target_price), 12000);
    assert.equal(finalRow.rows[0]?.last_alert_price, null);
    assert.equal(finalRow.rows[0]?.last_seen_price, null);
    assert.equal(finalRow.rows[0]?.last_alert_at, null);

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
