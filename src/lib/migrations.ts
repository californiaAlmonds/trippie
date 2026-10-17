import type { Client } from "@libsql/client";

export interface Migration {
  id: number;
  statements: string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS fares (
        snapshot_day TEXT NOT NULL,
        origin TEXT NOT NULL,
        destination TEXT NOT NULL,
        travel_date TEXT NOT NULL,
        price INTEGER,
        airline TEXT,
        stops INTEGER,
        status TEXT NOT NULL CHECK (status IN ('ok','no_flights','blocked','parse_error')),
        provider TEXT NOT NULL,
        scraped_at TEXT NOT NULL,
        PRIMARY KEY (snapshot_day, origin, destination, travel_date)
      )`,
      `CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        ok INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        note TEXT
      )`,
    ],
  },
  {
    id: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        verified_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
      `CREATE TABLE IF NOT EXISTS email_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset')),
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_email_tokens_user_id ON email_tokens(user_id)`,
      `CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (key, window_start)
      )`,
    ],
  },
  {
    id: 3,
    statements: [
      `CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        origin TEXT NOT NULL,
        destination TEXT NOT NULL,
        month TEXT NOT NULL,
        trip TEXT NOT NULL CHECK (trip IN ('round','oneway')),
        min_gap INTEGER NOT NULL,
        max_gap INTEGER NOT NULL,
        alert_enabled INTEGER NOT NULL DEFAULT 0,
        target_price INTEGER,
        last_alert_price INTEGER,
        last_alert_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, origin, destination, month, trip, min_gap, max_gap)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_plans_user_id ON plans(user_id)`,
      `CREATE TABLE IF NOT EXISTS recent_searches (
        user_id TEXT NOT NULL REFERENCES users(id),
        origin TEXT NOT NULL,
        destination TEXT NOT NULL,
        month TEXT NOT NULL,
        trip TEXT NOT NULL CHECK (trip IN ('round','oneway')),
        min_gap INTEGER NOT NULL,
        max_gap INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(user_id, origin, destination, month, trip, min_gap, max_gap)
      )`,
      `CREATE TABLE IF NOT EXISTS alert_deliveries (
        plan_id TEXT NOT NULL REFERENCES plans(id),
        day TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('claimed','sent','failed')),
        created_at TEXT NOT NULL,
        PRIMARY KEY(plan_id, day)
      )`,
    ],
  },
  {
    id: 4,
    statements: [
      `ALTER TABLE plans ADD COLUMN revision INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    id: 5,
    statements: [
      `CREATE TABLE IF NOT EXISTS devices (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        platform TEXT NOT NULL CHECK (platform IN ('android')),
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id)`,
    ],
  },
];

const SQLITE_BUSY_RE = /SQLITE_BUSY|database is locked/i;

/** Applies all pending migrations in order (each migration in a write batch/transaction, idempotent). */
export async function migrate(client: Client): Promise<void> {
  await client.execute("PRAGMA foreign_keys = ON");

  for (let attempt = 0; ; attempt++) {
    try {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id INTEGER PRIMARY KEY,
          applied_at TEXT
        )
      `);
      const rs = await client.execute("SELECT id FROM schema_migrations");
      const applied = new Set(rs.rows.map((r) => Number(r.id)));
      const ordered = [...MIGRATIONS].sort((a, b) => a.id - b.id);

      for (const m of ordered) {
        if (applied.has(m.id)) continue;
        const now = new Date().toISOString();
        const tx = await client.transaction("write");
        try {
          const check = await tx.execute({
            sql: "SELECT 1 FROM schema_migrations WHERE id = ?",
            args: [m.id],
          });
          if (check.rows.length === 0) {
            for (const sql of m.statements) {
              await tx.execute(sql);
            }
            await tx.execute({
              sql: "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING",
              args: [m.id, now],
            });
          }
          await tx.commit();
        } catch (err) {
          if (!tx.closed) {
            await tx.rollback().catch(() => undefined);
          }
          throw err;
        } finally {
          tx.close();
        }
      }
      return;
    } catch (err) {
      if (attempt < 20 && SQLITE_BUSY_RE.test(String(err))) {
        if (client.protocol === "file") {
          client.reconnect();
          await client.execute("PRAGMA foreign_keys = ON");
        }
        await new Promise((r) => setTimeout(r, 15 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}
