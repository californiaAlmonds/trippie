import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  consumeToken,
  createEmailToken,
  createUser,
  deleteUserAccount,
  getUserById,
  validateEmail,
} from "../accounts.ts";
import { escapeHtml, mailConfigured } from "../mailer.ts";
import { getClient } from "../store.ts";
import { checkOrigin, clientKey, emailRateLimitKey, rateLimit, readJson } from "./guard.ts";

test("checkOrigin enforces Origin header matching APP_ORIGIN or request origin", () => {
  const reqNoOrigin = new Request("http://localhost:3199/api/auth/login", { method: "POST" });
  const resNoOrigin = checkOrigin(reqNoOrigin, "");
  assert.equal(resNoOrigin?.status, 403);
  assert.equal(resNoOrigin?.headers.get("Cache-Control"), "no-store");

  const reqWrongOrigin = new Request("http://localhost:3199/api/auth/login", {
    method: "POST",
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(checkOrigin(reqWrongOrigin, "")?.status, 403);

  const reqGoodOrigin = new Request("http://localhost:3199/api/auth/login", {
    method: "POST",
    headers: { Origin: "http://localhost:3199" },
  });
  assert.equal(checkOrigin(reqGoodOrigin, ""), null);
  assert.equal(checkOrigin(reqGoodOrigin, "https://trippie.example.com")?.status, 403);
  assert.equal(checkOrigin(reqGoodOrigin, "http://localhost:3199"), null);
});

test("readJson validates Content-Type, size limit (413), and JSON syntax", async () => {
  const badCt = new Request("http://localhost:3199/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: '{"a":1}',
  });
  const r1 = await readJson(badCt);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.response.status, 415);

  const tooBig = new Request("http://localhost:3199/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: "x".repeat(200) }),
  });
  const r2 = await readJson(tooBig, 64);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.response.status, 413);

  const badJson = new Request("http://localhost:3199/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not-json",
  });
  const r3 = await readJson(badJson);
  assert.equal(r3.ok, false);
  if (!r3.ok) assert.equal(r3.response.status, 400);

  const goodJson = new Request("http://localhost:3199/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "a@b.co" }),
  });
  const r4 = await readJson<{ email: string }>(goodJson);
  assert.equal(r4.ok, true);
  if (r4.ok) assert.equal(r4.data.email, "a@b.co");
});

test("clientKey, emailRateLimitKey, escapeHtml, validateEmail, mailConfigured", () => {
  const req1 = new Request("http://localhost:3199/api/auth/login", {
    headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
  });
  assert.equal(clientKey(req1), "203.0.113.5");
  assert.equal(clientKey(new Request("http://localhost:3199/api/auth/login")), "local");

  const key = emailRateLimitKey("login", "User@Example.com");
  assert.ok(!key.includes("example.com"));
  assert.match(key, /^login:email:[0-9a-f]{64}$/);

  assert.equal(escapeHtml(`<a href="x&y">'test'</a>`), "&lt;a href=&quot;x&amp;y&quot;&gt;&#39;test&#39;&lt;/a&gt;");
  assert.equal(mailConfigured({ NODE_ENV: "test" }), false);
  assert.equal(
    mailConfigured({
      NODE_ENV: "test",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_USER: "u",
      SMTP_PASS: "p",
      SMTP_FROM: "noreply@example.com",
    }),
    true,
  );

  assert.deepEqual(validateEmail("  Alice@Example.COM "), { ok: true, email: "alice@example.com" });
  assert.equal(validateEmail("bad-email").ok, false);
});

test("rateLimit, single-use tokens, and transactional account deletion", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-guard-"));
  const dbPath = join(dir, "test.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const nowMs = 1_700_000_000_000;

    // Rate limit increments atomically and blocks above limit
    const rl1 = await rateLimit("test:key", 2, 60, nowMs);
    const rl2 = await rateLimit("test:key", 2, 60, nowMs);
    const rl3 = await rateLimit("test:key", 2, 60, nowMs);
    assert.equal(rl1.allowed, true);
    assert.equal(rl2.allowed, true);
    assert.equal(rl3.allowed, false);
    assert.equal(rl3.count, 3);

    // Create user and test token invalidation + single-use consumption
    const created = await createUser("traveler@example.com", "scrypt$dummy");
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error("expected user creation");

    const dup = await createUser("TRAVELER@example.com", "scrypt$dummy");
    assert.deepEqual(dup, { ok: false, duplicate: true });

    const tok1 = await createEmailToken(created.user.id, "verify", nowMs);
    const tok2 = await createEmailToken(created.user.id, "verify", nowMs);
    // tok1 was invalidated when tok2 was created
    assert.equal(await consumeToken(tok1, "verify", nowMs), null);
    // tok2 works once and only once
    assert.equal(await consumeToken(tok2, "verify", nowMs), created.user.id);
    assert.equal(await consumeToken(tok2, "verify", nowMs), null);

    // Transactional account deletion removes children and user
    await createEmailToken(created.user.id, "reset", nowMs);
    await deleteUserAccount(created.user.id);
    assert.equal(await getUserById(created.user.id), null);
    const remainingTokens = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM email_tokens WHERE user_id = ?",
      args: [created.user.id],
    });
    assert.equal(Number(remainingTokens.rows[0].c), 0);

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
