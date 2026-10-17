import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createUser, deleteUserAccount } from "../auth/users.ts";
import { getClient } from "../store.ts";
import {
  isValidDevicePlatform,
  isValidDeviceToken,
  listUserDeviceTokens,
  MAX_DEVICES_PER_USER,
  registerDevice,
  unregisterDevice,
} from "./devices.ts";

function makeToken(index: number): string {
  return `fcm_token_${String(index).padStart(4, "0")}_abcdefghijklmnop`;
}

test("isValidDeviceToken and isValidDevicePlatform validate format and bounds", () => {
  assert.equal(isValidDeviceToken("a".repeat(20)), true);
  assert.equal(isValidDeviceToken("A1:b_2-c.3".repeat(4)), true);
  assert.equal(isValidDeviceToken("a".repeat(19)), false);
  assert.equal(isValidDeviceToken("a".repeat(4097)), false);
  assert.equal(isValidDeviceToken("invalid space token 1234567890"), false);
  assert.equal(isValidDeviceToken("invalid/slash/token/1234567890"), false);
  assert.equal(isValidDeviceToken(null), false);
  assert.equal(isValidDevicePlatform("android"), true);
  assert.equal(isValidDevicePlatform("ios"), false);
});

test("devices: upsert, reassign across users, cap-10 pruning, scoped delete, and account-deletion removal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-devices-"));
  const dbPath = join(dir, "devices.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const userARes = await createUser("usera@example.com", "scrypt$hash", { verified: true });
    const userBRes = await createUser("userb@example.com", "scrypt$hash", { verified: true });
    assert.ok(userARes.ok && userBRes.ok);
    const userA = userARes.user;
    const userB = userBRes.user;

    const sharedToken = makeToken(1);
    const t0 = new Date("2026-10-16T01:00:00.000Z");
    const t1 = new Date("2026-10-16T02:00:00.000Z");
    const t2 = new Date("2026-10-16T03:00:00.000Z");

    // 1. Register token for user A and re-register idempotently (advancing last_seen_at)
    await registerDevice(userA.id, sharedToken, "android", t0);
    await registerDevice(userA.id, sharedToken, "android", t1);

    const rowAfterIdempotent = await client.execute({
      sql: "SELECT user_id, created_at, last_seen_at FROM devices WHERE token = ?",
      args: [sharedToken],
    });
    assert.equal(rowAfterIdempotent.rows.length, 1);
    assert.equal(String(rowAfterIdempotent.rows[0]?.user_id), userA.id);
    assert.equal(String(rowAfterIdempotent.rows[0]?.created_at), t0.toISOString());
    assert.equal(String(rowAfterIdempotent.rows[0]?.last_seen_at), t1.toISOString());

    // 2. Re-registering the same token by user B moves ownership to user B
    await registerDevice(userB.id, sharedToken, "android", t2);
    assert.deepEqual(await listUserDeviceTokens(userA.id), []);
    assert.deepEqual(await listUserDeviceTokens(userB.id), [sharedToken]);

    const rowAfterReassign = await client.execute({
      sql: "SELECT user_id, created_at, last_seen_at FROM devices WHERE token = ?",
      args: [sharedToken],
    });
    assert.equal(String(rowAfterReassign.rows[0]?.user_id), userB.id);
    assert.equal(String(rowAfterReassign.rows[0]?.last_seen_at), t2.toISOString());

    // 3. Scoped delete: user A attempting to delete user B's token does NOT delete it
    await unregisterDevice(userA.id, sharedToken);
    assert.deepEqual(await listUserDeviceTokens(userB.id), [sharedToken]);

    // User B deleting their own token removes it; deleting a non-existent token is a no-op
    await unregisterDevice(userB.id, sharedToken);
    assert.deepEqual(await listUserDeviceTokens(userB.id), []);
    await unregisterDevice(userB.id, sharedToken);

    // 4. Cap-10 pruning: registering 12 tokens for user A keeps only the 10 with newest last_seen_at
    for (let i = 1; i <= 12; i++) {
      await registerDevice(
        userA.id,
        makeToken(i),
        "android",
        new Date(Date.UTC(2026, 9, 16, 4, i, 0)),
      );
    }
    const tokensA = await listUserDeviceTokens(userA.id);
    assert.equal(tokensA.length, MAX_DEVICES_PER_USER);
    assert.deepEqual(
      tokensA,
      Array.from({ length: 10 }, (_, idx) => makeToken(12 - idx)),
    );

    // Touching token 3 bumps its last_seen_at so a 13th registration prunes token 4 instead of token 3
    await registerDevice(userA.id, makeToken(3), "android", new Date(Date.UTC(2026, 9, 16, 5, 0, 0)));
    await registerDevice(userA.id, makeToken(13), "android", new Date(Date.UTC(2026, 9, 16, 5, 1, 0)));
    const tokensAfterTouch = await listUserDeviceTokens(userA.id);
    assert.equal(tokensAfterTouch.length, MAX_DEVICES_PER_USER);
    assert.ok(tokensAfterTouch.includes(makeToken(3)));
    assert.ok(tokensAfterTouch.includes(makeToken(13)));
    assert.ok(!tokensAfterTouch.includes(makeToken(4)));

    // 5. Account deletion removes all devices of the deleted user without touching other users' devices
    await registerDevice(userB.id, makeToken(99), "android", new Date(Date.UTC(2026, 9, 16, 6, 0, 0)));
    await deleteUserAccount(userA.id);

    assert.deepEqual(await listUserDeviceTokens(userA.id), []);
    assert.deepEqual(await listUserDeviceTokens(userB.id), [makeToken(99)]);

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
