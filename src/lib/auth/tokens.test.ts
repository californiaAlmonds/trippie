import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildVerifyEmail, type SendMailInput, sendMail } from "../mailer.ts";
import { getClient } from "../store.ts";
import {
  buildResetLink,
  buildVerifyLink,
  consumeEmailToken,
  createEmailToken,
  generateEmailToken,
  hashEmailToken,
  peekEmailToken,
  resetPasswordWithToken,
  runForgotPasswordTask,
  runVerificationEmailTask,
  verifyEmailWithToken,
} from "./tokens.ts";
import {
  createUser,
  deleteUserAccount,
  getUserById,
  insertSessionIfPasswordMatches,
  markUserVerified,
  resetUserPassword,
} from "./users.ts";

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

test("login-vs-reset race: insertSessionIfPasswordMatches refuses to create a session if password_hash changed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-race-"));
  const dbPath = join(dir, "race.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const created = await createUser("race@example.com", "scrypt$old_hash");
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error("expected user creation");

    // When password_hash still matches, session is inserted
    const firstSession = await insertSessionIfPasswordMatches(created.user.id, "scrypt$old_hash");
    assert.ok(firstSession);

    // Simulate concurrent password reset completing between login's verifyPassword and session insert
    await resetUserPassword(created.user.id, "scrypt$new_hash");

    // In-flight login attempts to insert a session for the old verified hash -> must NOT insert
    const racedSession = await insertSessionIfPasswordMatches(created.user.id, "scrypt$old_hash");
    assert.equal(racedSession, null);

    const countRs = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?",
      args: [created.user.id],
    });
    assert.equal(Number(countRs.rows[0]?.c), 0);

    // Subsequent login with the new password hash succeeds
    const validSession = await insertSessionIfPasswordMatches(created.user.id, "scrypt$new_hash");
    assert.ok(validSession);
    const countAfterRs = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?",
      args: [created.user.id],
    });
    assert.equal(Number(countAfterRs.rows[0]?.c), 1);

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

test("resetPasswordWithToken and verifyEmailWithToken are atomic on failure and complete on success", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-atomic-"));
  const dbPath = join(dir, "atomic.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const nowMs = 1_700_000_000_000;

    // --- 1. Verify email atomicity ---
    const u1 = await createUser("verify-atomic@example.com", "scrypt$initial");
    assert.equal(u1.ok, true);
    if (!u1.ok) throw new Error("expected user creation");

    const verifyTok = await createEmailToken(u1.user.id, "verify", nowMs);
    assert.equal(await peekEmailToken(verifyTok, "verify", nowMs), u1.user.id);

    // Force user update step inside the transaction to throw after token UPDATE
    await assert.rejects(
      verifyEmailWithToken(verifyTok, {
        nowMs,
        beforeUserUpdate: () => {
          throw new Error("Simulated verify update failure");
        },
      }),
      /Simulated verify update failure/,
    );

    // Token must still be unused and user must still be unverified
    assert.equal(await peekEmailToken(verifyTok, "verify", nowMs), u1.user.id);
    assert.equal((await getUserById(u1.user.id))?.verified_at, null);

    // Now succeed with the same token
    assert.equal(await verifyEmailWithToken(verifyTok, nowMs), true);
    assert.equal(await peekEmailToken(verifyTok, "verify", nowMs), null);
    assert.ok((await getUserById(u1.user.id))?.verified_at);
    assert.equal(await verifyEmailWithToken(verifyTok, nowMs), false);

    // --- 2. Reset password atomicity ---
    const u2 = await createUser("reset-atomic@example.com", "scrypt$initial_pw");
    assert.equal(u2.ok, true);
    if (!u2.ok) throw new Error("expected user creation");

    // Create 2 fixture sessions for u2
    const s1 = await insertSessionIfPasswordMatches(u2.user.id, "scrypt$initial_pw", { nowMs });
    const s2 = await insertSessionIfPasswordMatches(u2.user.id, "scrypt$initial_pw", { nowMs });
    assert.ok(s1 && s2);

    const sessionsBefore = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?",
      args: [u2.user.id],
    });
    assert.equal(Number(sessionsBefore.rows[0]?.c), 2);

    const resetTok = await createEmailToken(u2.user.id, "reset", nowMs);
    assert.equal(await peekEmailToken(resetTok, "reset", nowMs), u2.user.id);

    // Inject failure during the password update step inside the transaction
    await assert.rejects(
      resetPasswordWithToken(resetTok, "scrypt$should_not_persist", {
        nowMs,
        beforeUserUpdate: () => {
          throw new Error("Simulated reset update failure");
        },
      }),
      /Simulated reset update failure/,
    );

    // Token stays unused, password_hash is unchanged, and both sessions remain intact
    assert.equal(await peekEmailToken(resetTok, "reset", nowMs), u2.user.id);
    assert.equal((await getUserById(u2.user.id))?.password_hash, "scrypt$initial_pw");
    const sessionsAfterFailure = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?",
      args: [u2.user.id],
    });
    assert.equal(Number(sessionsAfterFailure.rows[0]?.c), 2);

    // Now succeed with the same reset token
    assert.equal(await resetPasswordWithToken(resetTok, "scrypt$new_pw_hash", nowMs), true);
    assert.equal(await peekEmailToken(resetTok, "reset", nowMs), null);
    const updatedUser = await getUserById(u2.user.id);
    assert.equal(updatedUser?.password_hash, "scrypt$new_pw_hash");
    assert.ok(updatedUser?.verified_at);

    // All sessions for that user were deleted
    const sessionsAfterSuccess = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?",
      args: [u2.user.id],
    });
    assert.equal(Number(sessionsAfterSuccess.rows[0]?.c), 0);

    // Token cannot be reused
    assert.equal(await resetPasswordWithToken(resetTok, "scrypt$another", nowMs), false);

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

test("runForgotPasswordTask and runVerificationEmailTask execute mail work and swallow errors without logging PII", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-after-"));
  const dbPath = join(dir, "after.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const created = await createUser("after-user@example.com", "scrypt$hash");
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error("expected user creation");

    const sent: SendMailInput[] = [];
    await runForgotPasswordTask("after-user@example.com", async (msg) => {
      sent.push(msg);
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.to, "after-user@example.com");
    assert.match(sent[0]?.devLink ?? "", /\/reset\?token=/);

    // Unknown or invalid email does not send mail or throw
    await runForgotPasswordTask("unknown-user@example.com", async (msg) => {
      sent.push(msg);
    });
    await runForgotPasswordTask("not-an-email", async (msg) => {
      sent.push(msg);
    });
    assert.equal(sent.length, 1);

    // Verification email helper issues verify token and invokes sender
    await runVerificationEmailTask(created.user.id, created.user.email, async (msg) => {
      sent.push(msg);
    });
    assert.equal(sent.length, 2);
    assert.match(sent[1]?.devLink ?? "", /\/verify\?token=/);

    // Errors in background tasks are swallowed and log only a fixed generic string with no PII
    const errorLogs: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errorLogs.push(args.map(String).join(" "));
    };
    try {
      await runForgotPasswordTask("after-user@example.com", async () => {
        throw new Error("SMTP exploded for after-user@example.com secret-token-123");
      });
      await runVerificationEmailTask(created.user.id, created.user.email, async () => {
        throw new Error("SMTP exploded for after-user@example.com secret-token-456");
      });
    } finally {
      console.error = origError;
    }

    assert.deepEqual(errorLogs, ["forgot-password failed", "verification email failed"]);

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

test("sendMail prints devLink only when NODE_ENV === 'development' and never in test or unset environments", async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevHost = process.env.SMTP_HOST;
  delete process.env.SMTP_HOST;

  const infoLogs: string[] = [];
  const origInfo = console.info;
  console.info = (...args: unknown[]) => {
    infoLogs.push(args.map(String).join(" "));
  };

  try {
    const payload = buildVerifyEmail("secret-user@example.com", "http://localhost:3111/verify?token=super-secret-token");

    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    await sendMail(payload);
    assert.equal(infoLogs.at(-1), "mail not configured; message skipped");
    assert.ok(!infoLogs.at(-1)?.includes("super-secret-token"));
    assert.ok(!infoLogs.at(-1)?.includes("secret-user@example.com"));

    delete (process.env as Record<string, string | undefined>).NODE_ENV;
    await sendMail(payload);
    assert.equal(infoLogs.at(-1), "mail not configured; message skipped");

    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    await sendMail(payload);
    assert.ok(infoLogs.at(-1)?.includes("http://localhost:3111/verify?token=super-secret-token"));

    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    await assert.rejects(sendMail(payload), /SMTP is not configured/);
  } finally {
    console.info = origInfo;
    if (prevNodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
    if (prevHost !== undefined) process.env.SMTP_HOST = prevHost;
  }
});
