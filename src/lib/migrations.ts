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
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        verified_at TEXT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
      `CREATE TABLE IF NOT EXISTS email_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset')),
        expires_at TEXT NOT NULL,
        used_at TEXT NULL
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
];

/** Applies all pending migrations in order, each within its own write transaction. */
export async function runMigrations(client: Client): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const rs = await client.execute("SELECT id FROM migrations");
  const applied = new Set(rs.rows.map((r) => Number(r.id)));
  const ordered = [...MIGRATIONS].sort((a, b) => a.id - b.id);
  for (const m of ordered) {
    if (applied.has(m.id)) continue;
    const now = new Date().toISOString();
    await client.batch(
      [
        ...m.statements.map((sql) => ({ sql, args: [] })),
        {
          sql: "INSERT INTO migrations (id, applied_at) VALUES (?, ?)",
          args: [m.id, now],
        },
      ],
      "write",
    );
  }
}
