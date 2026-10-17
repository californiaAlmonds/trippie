import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createUser, deleteUserAccount } from "./auth/users.ts";
import { getUserCurrency, setUserCurrency } from "./prefs.ts";
import { getClient } from "./store.ts";

test("prefs: getUserCurrency, setUserCurrency upsert scoping, unsupported currency rejection, and deleteUserAccount cleanup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-prefs-"));
  const dbPath = join(dir, "prefs.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();

    const userARes = await createUser("prefsa@example.com", "scrypt$hash", { verified: true });
    const userBRes = await createUser("prefsb@example.com", "scrypt$hash", { verified: true });
    assert.ok(userARes.ok && userBRes.ok);
    const userA = userARes.user;
    const userB = userBRes.user;

    // Initially null for both users
    assert.equal(await getUserCurrency(userA.id), null);
    assert.equal(await getUserCurrency(userB.id), null);

    // Set and update currency for user A (upsert ON CONFLICT DO UPDATE)
    await setUserCurrency(userA.id, "usd");
    assert.equal(await getUserCurrency(userA.id), "USD");
    assert.equal(await getUserCurrency(userB.id), null);

    await setUserCurrency(userA.id, "AED");
    assert.equal(await getUserCurrency(userA.id), "AED");

    // Set currency for user B independently
    await setUserCurrency(userB.id, "EUR");
    assert.equal(await getUserCurrency(userB.id), "EUR");
    assert.equal(await getUserCurrency(userA.id), "AED");

    // Unsupported currency is rejected
    await assert.rejects(() => setUserCurrency(userA.id, "XYZ"), /Unsupported currency/);
    await assert.rejects(() => setUserCurrency(userA.id, ""), /Unsupported currency/);
    assert.equal(await getUserCurrency(userA.id), "AED");

    // Account deletion removes user_prefs for deleted user without affecting other users
    await deleteUserAccount(userA.id);
    assert.equal(await getUserCurrency(userA.id), null);
    assert.equal(await getUserCurrency(userB.id), "EUR");

    const countA = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM user_prefs WHERE user_id = ?",
      args: [userA.id],
    });
    assert.equal(Number(countA.rows[0]?.c), 0);

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
