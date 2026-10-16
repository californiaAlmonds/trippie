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

    // Verify auth and plan tables exist from migrations 2 and 3
    const tablesRs = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','sessions','email_tokens','rate_limits','plans','recent_searches','alert_deliveries','schema_migrations') ORDER BY name",
    );
    assert.deepEqual(
      tablesRs.rows.map((r) => String(r.name)),
      [
        "alert_deliveries",
        "email_tokens",
        "plans",
        "rate_limits",
        "recent_searches",
        "schema_migrations",
        "sessions",
        "users",
      ],
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

test("migration 3 applies cleanly on top of existing migration 1 and 2 data", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-mig3-"));
  const dbPath = join(dir, "mig3.db").replace(/\\/g, "/");
  const client = createClient({ url: `file:${dbPath}` });

  try {
    await client.execute("PRAGMA foreign_keys = ON");
    await client.execute(`
      CREATE TABLE schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT
      )
    `);
    for (const m of MIGRATIONS.filter((x) => x.id <= 2)) {
      await client.batch(
        [
          ...m.statements.map((sql) => ({ sql, args: [] })),
          {
            sql: "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
            args: [m.id, "2026-10-16T00:00:00.000Z"],
          },
        ],
        "write",
      );
    }

    // Seed pre-existing fares and user data before running migration 3
    await client.execute({
      sql: `INSERT INTO fares (snapshot_day, origin, destination, travel_date, price, airline, stops, status, provider, scraped_at)
            VALUES ('2026-10-16', 'BLR', 'IXZ', '2027-02-15', 4999, 'Air India', 0, 'ok', 'google-flights', '2026-10-16T01:00:00.000Z')`,
      args: [],
    });
    const userId = "00000000-0000-4000-8000-000000000099";
    await client.execute({
      sql: `INSERT INTO users (id, email, password_hash, created_at, verified_at)
            VALUES (?, 'existing@example.com', 'scrypt$hash', '2026-10-16T00:00:00.000Z', '2026-10-16T00:05:00.000Z')`,
      args: [userId],
    });

    // Apply migrate() which should apply remaining migrations (3 and 4)
    await migrate(client);

    const migRows = await client.execute("SELECT id FROM schema_migrations ORDER BY id");
    assert.deepEqual(
      migRows.rows.map((r) => Number(r.id)),
      [1, 2, 3, 4],
    );

    // Pre-existing rows remain intact and can be referenced by new migration 3 tables
    const planId = "00000000-0000-4000-8000-000000000100";
    await client.execute({
      sql: `INSERT INTO plans (id, user_id, origin, destination, month, trip, min_gap, max_gap, alert_enabled, target_price, created_at)
            VALUES (?, ?, 'BLR', 'IXZ', '2027-02', 'round', 4, 7, 1, 12000, '2026-10-16T02:00:00.000Z')`,
      args: [planId, userId],
    });
    await client.execute({
      sql: `INSERT INTO recent_searches (user_id, origin, destination, month, trip, min_gap, max_gap, created_at)
            VALUES (?, 'BLR', 'IXZ', '2027-02', 'round', 4, 7, '2026-10-16T02:00:00.000Z')`,
      args: [userId],
    });
    await client.execute({
      sql: `INSERT INTO alert_deliveries (plan_id, day, status, created_at)
            VALUES (?, '2026-10-16', 'claimed', '2026-10-16T02:00:00.000Z')`,
      args: [planId],
    });

    const idxRs = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_plans_user_id'",
    );
    assert.equal(idxRs.rows.length, 1);
  } finally {
    client.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows SQLite file handle may release asynchronously on process exit
    }
  }
});

test("migration 4 applies cleanly on top of existing migration 1..3 data and is safe on re-run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-mig4-"));
  const dbPath = join(dir, "mig4.db").replace(/\\/g, "/");
  const client = createClient({ url: `file:${dbPath}` });

  try {
    await client.execute("PRAGMA foreign_keys = ON");
    await client.execute(`
      CREATE TABLE schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT
      )
    `);
    for (const m of MIGRATIONS.filter((x) => x.id <= 3)) {
      await client.batch(
        [
          ...m.statements.map((sql) => ({ sql, args: [] })),
          {
            sql: "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
            args: [m.id, "2026-10-16T00:00:00.000Z"],
          },
        ],
        "write",
      );
    }

    const userId = "00000000-0000-4000-8000-000000000099";
    const planId = "00000000-0000-4000-8000-000000000100";
    await client.execute({
      sql: `INSERT INTO users (id, email, password_hash, created_at, verified_at)
            VALUES (?, 'mig4@example.com', 'scrypt$hash', '2026-10-16T00:00:00.000Z', '2026-10-16T00:05:00.000Z')`,
      args: [userId],
    });
    await client.execute({
      sql: `INSERT INTO plans (id, user_id, origin, destination, month, trip, min_gap, max_gap, alert_enabled, target_price, created_at)
            VALUES (?, ?, 'BLR', 'IXZ', '2027-02', 'round', 4, 7, 1, 12000, '2026-10-16T02:00:00.000Z')`,
      args: [planId, userId],
    });

    // Apply migrate() twice to verify migration 4 applies and re-running is safe via schema_migrations
    await migrate(client);
    await migrate(client);

    const migRows = await client.execute("SELECT id FROM schema_migrations ORDER BY id");
    assert.deepEqual(
      migRows.rows.map((r) => Number(r.id)),
      [1, 2, 3, 4],
    );

    const planRs = await client.execute({
      sql: "SELECT revision, alert_enabled, target_price FROM plans WHERE id = ?",
      args: [planId],
    });
    assert.equal(Number(planRs.rows[0]?.revision), 0);
    assert.equal(Number(planRs.rows[0]?.alert_enabled), 1);
    assert.equal(Number(planRs.rows[0]?.target_price), 12000);
  } finally {
    client.close();
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
