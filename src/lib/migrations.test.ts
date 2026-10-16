import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { MIGRATIONS, migrate } from "./migrations.ts";
import { doneDates, getClient, getLatestFares, saveFares } from "./store.ts";

test("migrations apply on empty DB, are idempotent on re-run, and preserve existing fares rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-mig-"));
  const dbPath = join(dir, "test.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();

    await saveFares(
      [
        {
          day: "2026-10-16",
          origin: "BLR",
          destination: "IXZ",
          date: "2027-02-10",
          price: 5400,
          airline: "IndiGo",
          stops: 0,
          status: "ok",
        },
      ],
      "google-flights",
    );

    const before = await getLatestFares("BLR", "IXZ", "2027-02-01", "2027-02-28");
    assert.equal(before.length, 1);
    assert.equal(before[0].price, 5400);

    // Run migrate() a second and third time directly on the same DB
    await migrate(client);
    await migrate(client);

    // Verify schema_migrations table has exactly the expected migration IDs
    const migRows = await client.execute("SELECT id, applied_at FROM schema_migrations ORDER BY id");
    assert.deepEqual(
      migRows.rows.map((r) => Number(r.id)),
      MIGRATIONS.map((m) => m.id),
    );
    for (const r of migRows.rows) {
      assert.equal(typeof r.applied_at, "string");
    }

    // Verify existing fares rows are untouched
    const after = await getLatestFares("BLR", "IXZ", "2027-02-01", "2027-02-28");
    assert.deepEqual(after, before);

    const done = await doneDates("2026-10-16", "BLR", "IXZ");
    assert.ok(done.has("2027-02-10"));

    // Verify auth tables exist from migration 2
    const tablesRs = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','sessions','email_tokens','rate_limits','schema_migrations') ORDER BY name",
    );
    assert.deepEqual(
      tablesRs.rows.map((r) => String(r.name)),
      ["email_tokens", "rate_limits", "schema_migrations", "sessions", "users"],
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

test("foreign key enforcement is active on the connection returned by getClient()", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-fk-"));
  const dbPath = join(dir, "fk.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const fkRs = await client.execute("PRAGMA foreign_keys");
    assert.equal(Number(fkRs.rows[0]?.foreign_keys), 1);

    // Inserting a session referencing a non-existent user_id must fail with FK constraint error
    await assert.rejects(
      () =>
        client.execute({
          sql: "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
          args: ["deadbeef", "non-existent-uuid", "2026-10-16T00:00:00.000Z", "2026-11-15T00:00:00.000Z"],
        }),
      /FOREIGN KEY constraint failed/i,
    );

    // Inserting a user and a child session, then trying to delete the user without deleting the session first must fail
    const userId = "00000000-0000-4000-8000-000000000001";
    await client.execute({
      sql: "INSERT INTO users (id, email, password_hash, created_at, verified_at) VALUES (?, ?, ?, ?, NULL)",
      args: [userId, "fk@example.com", "scrypt$dummy", "2026-10-16T00:00:00.000Z"],
    });
    await client.execute({
      sql: "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      args: ["tokhash1", userId, "2026-10-16T00:00:00.000Z", "2026-11-15T00:00:00.000Z"],
    });

    await assert.rejects(
      () =>
        client.execute({
          sql: "DELETE FROM users WHERE id = ?",
          args: [userId],
        }),
      /FOREIGN KEY constraint failed/i,
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

test("concurrent migrate() calls on one temp file DB succeed without duplicating schema_migrations rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-mig-concurrent-"));
  const dbPath = join(dir, "concurrent.db").replace(/\\/g, "/");
  const clientA = createClient({ url: `file:${dbPath}` });
  const clientB = createClient({ url: `file:${dbPath}` });

  try {
    await Promise.all([migrate(clientA), migrate(clientB)]);
    const migRows = await clientA.execute("SELECT id FROM schema_migrations ORDER BY id");
    assert.deepEqual(
      migRows.rows.map((r) => Number(r.id)),
      MIGRATIONS.map((m) => m.id),
    );
  } finally {
    clientA.close();
    clientB.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows SQLite file handle may release asynchronously on process exit
    }
  }
});
