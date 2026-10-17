import { isSupportedCurrency } from "./geo/currency.ts";
import { getClient } from "./store.ts";

/** Returns the saved currency code for `userId`, or `null` if none is stored. */
export async function getUserCurrency(userId: string): Promise<string | null> {
  if (typeof userId !== "string" || !userId) return null;
  const client = await getClient();
  const rs = await client.execute({
    sql: "SELECT currency FROM user_prefs WHERE user_id = ?",
    args: [userId],
  });
  const row = rs.rows[0];
  if (!row || row.currency == null) return null;
  const code = String(row.currency).trim().toUpperCase();
  return isSupportedCurrency(code) ? code : null;
}

/** Upserts `userId`'s preferred currency into `user_prefs`. Rejects unsupported currencies. */
export async function setUserCurrency(userId: string, currency: string): Promise<void> {
  if (typeof userId !== "string" || !userId) {
    throw new Error("Invalid userId");
  }
  const normalized = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  if (!isSupportedCurrency(normalized)) {
    throw new Error(`Unsupported currency: ${String(currency)}`);
  }

  const nowIso = new Date().toISOString();
  const client = await getClient();
  await client.execute({
    sql: `INSERT INTO user_prefs (user_id, currency, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            currency = excluded.currency,
            updated_at = excluded.updated_at`,
    args: [userId, normalized, nowIso],
  });
}
