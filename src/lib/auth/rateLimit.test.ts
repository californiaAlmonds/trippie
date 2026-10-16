import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getClient } from "../store.ts";
import { emailRateLimitKey, ipRateLimitKey, rateLimit, userRateLimitKey } from "./rateLimit.ts";

test("rate limiter blocks after N attempts, resets on next window, and prunes rows older than 1 day", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-rl-"));
  const dbPath = join(dir, "rl.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const baseMs = 1_700_000_000_000;
    const windowSec = 900; // 15 minutes
    const key = emailRateLimitKey("login", "Alice@Example.com");
    assert.ok(!key.includes("alice"));
    assert.equal(ipRateLimitKey("login", "1.2.3.4"), "login:ip:1.2.3.4");
    assert.equal(userRateLimitKey("resend", "u-123"), "resend:user:u-123");

    // 5 attempts allowed, 6th blocked
    for (let i = 1; i <= 5; i++) {
      const res = await rateLimit(key, 5, windowSec, baseMs);
      assert.equal(res.allowed, true);
      assert.equal(res.count, i);
    }
    const sixth = await rateLimit(key, 5, windowSec, baseMs);
    assert.equal(sixth.allowed, false);
    assert.equal(sixth.count, 6);

    // Next fixed window resets count to 1
    const nextWindowMs = baseMs + windowSec * 1000;
    const afterReset = await rateLimit(key, 5, windowSec, nextWindowMs);
    assert.equal(afterReset.allowed, true);
    assert.equal(afterReset.count, 1);

    // Advance more than 1 day: old windows are opportunistically pruned
    const twoDaysLaterMs = baseMs + 2 * 86400 * 1000;
    await rateLimit("other:key", 5, windowSec, twoDaysLaterMs);
    const remainingOld = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM rate_limits WHERE key = ?",
      args: [key],
    });
    assert.equal(Number(remainingOld.rows[0]?.c), 0);

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
