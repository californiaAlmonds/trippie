import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MIGRATIONS, runMigrations } from "./migrations.ts";
import { doneDates, getClient, getLatestFares, saveFares } from "./store.ts";

test("migrations are idempotent when run twice and preserve existing fares rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-mig-"));
  const dbPath = join(dir, "test.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();

    // Save fares using store.ts
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

    // Run migrations a second and third time directly on the same DB
    await runMigrations(client);
    await runMigrations(client);

    // Verify migrations table has exactly the expected migration IDs
    const migRows = await client.execute("SELECT id FROM migrations ORDER BY id");
    assert.deepEqual(
      migRows.rows.map((r) => Number(r.id)),
      MIGRATIONS.map((m) => m.id),
    );

    // Verify existing fares rows are untouched
    const after = await getLatestFares("BLR", "IXZ", "2027-02-01", "2027-02-28");
    assert.deepEqual(after, before);

    const done = await doneDates("2026-10-16", "BLR", "IXZ");
    assert.ok(done.has("2027-02-10"));

    // Verify auth tables exist from migration 2
    const tablesRs = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','sessions','email_tokens','rate_limits') ORDER BY name",
    );
    assert.deepEqual(
      tablesRs.rows.map((r) => String(r.name)),
      ["email_tokens", "rate_limits", "sessions", "users"],
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
