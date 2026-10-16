import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createUser } from "../auth/users.ts";
import { createPlan, listPlans } from "../plans/index.ts";
import { getClient } from "../store.ts";
import {
  AppSecretError,
  signUnsubscribeToken,
  unsubscribePlanWithToken,
  verifyUnsubscribeToken,
} from "./unsubscribe.ts";

const TEST_SECRET = "test-secret-test-secret-test-secret";

test("signUnsubscribeToken and verifyUnsubscribeToken enforce >=32 char secret and reject tampered tokens", () => {
  const planId = "00000000-0000-4000-8000-000000000042";

  // Missing or short APP_SECRET throws AppSecretError
  assert.throws(() => signUnsubscribeToken(planId, ""), AppSecretError);
  assert.throws(() => signUnsubscribeToken(planId, "too-short-secret"), AppSecretError);
  assert.throws(() => verifyUnsubscribeToken("abc.def", "too-short"), AppSecretError);

  const token = signUnsubscribeToken(planId, TEST_SECRET);
  assert.ok(token.startsWith(`${planId}.`));
  assert.equal(verifyUnsubscribeToken(token, TEST_SECRET), planId);

  // Tampered signature rejected
  const flipped = token.endsWith("A") ? `${token.slice(0, -1)}B` : `${token.slice(0, -1)}A`;
  assert.equal(verifyUnsubscribeToken(flipped, TEST_SECRET), null);

  // Tampered planId rejected
  const [, sig] = token.split(".");
  assert.equal(
    verifyUnsubscribeToken(`00000000-0000-4000-8000-000000000099.${sig}`, TEST_SECRET),
    null,
  );

  // Malformed tokens rejected
  assert.equal(verifyUnsubscribeToken("", TEST_SECRET), null);
  assert.equal(verifyUnsubscribeToken("no-dot-here", TEST_SECRET), null);
  assert.equal(verifyUnsubscribeToken("a.b.c", TEST_SECRET), null);
  assert.equal(verifyUnsubscribeToken(null, TEST_SECRET), null);
});

test("unsubscribePlanWithToken disables alert_enabled on the target plan and rejects bad tokens", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-unsub-"));
  const dbPath = join(dir, "unsub.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const userRes = await createUser("unsub@example.com", "scrypt$hash", { verified: true });
    assert.ok(userRes.ok);

    const planRes = await createPlan(userRes.user.id, true, {
      origin: "BLR",
      destination: "IXZ",
      month: "2027-02",
      trip: "round",
      minGap: 4,
      maxGap: 7,
      alertEnabled: true,
    });
    assert.ok(planRes.ok);
    assert.equal(planRes.plan.alertEnabled, true);

    const token = signUnsubscribeToken(planRes.plan.id, TEST_SECRET);
    const badToken = `${token}x`;

    assert.equal(await unsubscribePlanWithToken(badToken, TEST_SECRET), false);
    assert.equal((await listPlans(userRes.user.id))[0]?.alertEnabled, true);

    assert.equal(await unsubscribePlanWithToken(token, TEST_SECRET), true);
    assert.equal((await listPlans(userRes.user.id))[0]?.alertEnabled, false);

    // Non-existent plan with valid signature returns false
    const missingToken = signUnsubscribeToken("00000000-0000-4000-8000-ffffffffffff", TEST_SECRET);
    assert.equal(await unsubscribePlanWithToken(missingToken, TEST_SECRET), false);

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
