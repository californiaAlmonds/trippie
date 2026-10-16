import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getClient } from "../store.ts";
import {
  buildResetLink,
  buildVerifyLink,
  consumeEmailToken,
  createEmailToken,
  generateEmailToken,
  hashEmailToken,
} from "./tokens.ts";
import { createUser, deleteUserAccount, getUserById, markUserVerified, resetUserPassword } from "./users.ts";

test("generateEmailToken, hashEmailToken, and link builders work as expected", () => {
  const t1 = generateEmailToken();
  const t2 = generateEmailToken();
  assert.notEqual(t1, t2);
  assert.equal(Buffer.from(t1, "base64url").length, 32);
  assert.match(hashEmailToken(t1), /^[0-9a-f]{64}$/);

  assert.equal(buildVerifyLink("abc", ""), "http://localhost:3111/verify?token=abc");
  assert.equal(buildResetLink("abc", "https://trippie.app/"), "https://trippie.app/reset?token=abc");
});

test("createEmailToken invalidates prior unused tokens, consumeEmailToken is single-use, and deleteUserAccount removes all rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-tok-"));
  const dbPath = join(dir, "tok.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const nowMs = 1_700_000_000_000;

    const created = await createUser("traveler@example.com", "scrypt$dummy");
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error("expected user creation");
    assert.equal(created.user.verified, false);

    // Duplicate email rejected
    const dup = await createUser("TRAVELER@example.com", "scrypt$dummy");
    assert.deepEqual(dup, { ok: false, duplicate: true });

    // Creating a second verify token invalidates the first
    const tok1 = await createEmailToken(created.user.id, "verify", nowMs);
    const tok2 = await createEmailToken(created.user.id, "verify", nowMs);
    assert.equal(await consumeEmailToken(tok1, "verify", nowMs), null);
    assert.equal(await consumeEmailToken(tok2, "verify", nowMs), created.user.id);
    // Single-use: second consume returns null
    assert.equal(await consumeEmailToken(tok2, "verify", nowMs), null);

    // Expired token cannot be consumed
    const resetTok = await createEmailToken(created.user.id, "reset", nowMs);
    const twoHoursLater = nowMs + 2 * 3600 * 1000;
    assert.equal(await consumeEmailToken(resetTok, "reset", twoHoursLater), null);

    await markUserVerified(created.user.id);
    const afterVerify = await getUserById(created.user.id);
    assert.ok(afterVerify?.verified_at);

    await resetUserPassword(created.user.id, "scrypt$new");
    const afterReset = await getUserById(created.user.id);
    assert.equal(afterReset?.password_hash, "scrypt$new");

    await deleteUserAccount(created.user.id);
    assert.equal(await getUserById(created.user.id), null);

    const remainingTokens = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM email_tokens WHERE user_id = ?",
      args: [created.user.id],
    });
    assert.equal(Number(remainingTokens.rows[0]?.c), 0);

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
