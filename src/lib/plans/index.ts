import { randomUUID } from "node:crypto";
import { parseSearch, type SearchParams, type TripMode } from "../search.ts";
import { getClient } from "../store.ts";
import type { Cabin } from "../types.ts";

export const MAX_PLANS_PER_USER = 20;
export const MAX_RECENT_PER_USER = 10;
export const MIN_TARGET_PRICE = 500;
export const MAX_TARGET_PRICE = 1_000_000;

export interface Plan {
  id: string;
  origin: string;
  destination: string;
  month: string;
  trip: TripMode;
  minGap: number;
  maxGap: number;
  cabin: Cabin;
  alertEnabled: boolean;
  targetPrice: number | null;
  lastAlertPrice: number | null;
  lastSeenPrice: number | null;
  expired: boolean;
  createdAt: string;
}

let lastMonotonicMs = 0;

function monotonicIso(now?: Date): string {
  const baseMs = now ? now.getTime() : Date.now();
  const nextMs = baseMs > lastMonotonicMs ? baseMs : lastMonotonicMs + 1;
  lastMonotonicMs = nextMs;
  return new Date(nextMs).toISOString();
}

function isUniqueConstraintError(err: unknown): boolean {
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(String(err));
}

/** Checks whether a YYYY-MM month is strictly before the current UTC YYYY-MM. */
export function isMonthExpired(month: string, now = new Date()): boolean {
  return month < now.toISOString().slice(0, 7);
}

function rowToPlan(row: Record<string, unknown>, now = new Date()): Plan {
  const month = String(row.month);
  return {
    id: String(row.id),
    origin: String(row.origin),
    destination: String(row.destination),
    month,
    trip: String(row.trip) as TripMode,
    minGap: Number(row.min_gap),
    maxGap: Number(row.max_gap),
    cabin: row.cabin === "business" ? "business" : "economy",
    alertEnabled: Number(row.alert_enabled) === 1,
    targetPrice: row.target_price == null ? null : Number(row.target_price),
    lastAlertPrice: row.last_alert_price == null ? null : Number(row.last_alert_price),
    lastSeenPrice: row.last_seen_price == null ? null : Number(row.last_seen_price),
    expired: isMonthExpired(month, now),
    createdAt: String(row.created_at),
  };
}

/** Builds a URLSearchParams from a JSON object and validates with parseSearch. */
export function parseSearchBody(body: Record<string, unknown>): SearchParams | { error: string } {
  const sp = new URLSearchParams();
  if (typeof body.origin === "string") sp.set("origin", body.origin);
  if (typeof body.destination === "string") sp.set("destination", body.destination);
  if (typeof body.month === "string") sp.set("month", body.month);
  if (body.trip !== undefined) {
    sp.set("trip", typeof body.trip === "string" ? body.trip : "");
  }
  if (body.cabin !== undefined) {
    sp.set("cabin", typeof body.cabin === "string" ? body.cabin : "");
  }
  if (body.minGap !== undefined && body.minGap !== null) {
    sp.set(
      "minGap",
      typeof body.minGap === "number" || typeof body.minGap === "string" ? String(body.minGap) : "invalid",
    );
  }
  if (body.maxGap !== undefined && body.maxGap !== null) {
    sp.set(
      "maxGap",
      typeof body.maxGap === "number" || typeof body.maxGap === "string" ? String(body.maxGap) : "invalid",
    );
  }
  return parseSearch(sp);
}

export function validateTargetPrice(
  raw: unknown,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null };
  }
  if (
    typeof raw === "number" &&
    Number.isInteger(raw) &&
    raw >= MIN_TARGET_PRICE &&
    raw <= MAX_TARGET_PRICE
  ) {
    return { ok: true, value: raw };
  }
  return {
    ok: false,
    error: `targetPrice must be an integer between ${MIN_TARGET_PRICE} and ${MAX_TARGET_PRICE}`,
  };
}

export type PlanMutationResult =
  | { ok: true; plan: Plan }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

/** Lists saved plans for `userId`, newest first. */
export async function listPlans(userId: string, now = new Date()): Promise<Plan[]> {
  const client = await getClient();
  const rs = await client.execute({
    sql: `SELECT id, origin, destination, month, trip, min_gap, max_gap, cabin,
                 alert_enabled, target_price, last_alert_price, last_seen_price, created_at
          FROM plans
          WHERE user_id = ?
          ORDER BY created_at DESC, rowid DESC`,
    args: [userId],
  });
  return rs.rows.map((r) => rowToPlan(r as Record<string, unknown>, now));
}

/** Creates a saved plan for `userId`, enforcing the 20-plan cap, uniqueness, and verified-user rule for alerts. */
export async function createPlan(
  userId: string,
  userVerified: boolean,
  body: Record<string, unknown>,
  now?: Date,
): Promise<PlanMutationResult> {
  const parsed = parseSearchBody(body);
  if ("error" in parsed) {
    return { ok: false, status: 400, error: parsed.error };
  }

  let alertEnabled = false;
  if (body.alertEnabled !== undefined) {
    if (typeof body.alertEnabled !== "boolean") {
      return { ok: false, status: 400, error: "alertEnabled must be a boolean" };
    }
    alertEnabled = body.alertEnabled;
  }

  const targetRes = validateTargetPrice(body.targetPrice);
  if (!targetRes.ok) {
    return { ok: false, status: 400, error: targetRes.error };
  }

  if (alertEnabled && !userVerified) {
    return { ok: false, status: 403, error: "Verify your email to enable alerts" };
  }

  const id = randomUUID();
  const createdAt = monotonicIso(now);
  const nowDate = now ?? new Date();

  const client = await getClient();
  const tx = await client.transaction("write");
  try {
    const dupRs = await tx.execute({
      sql: `SELECT id FROM plans
            WHERE user_id = ? AND origin = ? AND destination = ?
              AND month = ? AND trip = ? AND min_gap = ? AND max_gap = ? AND cabin = ?`,
      args: [
        userId,
        parsed.origin,
        parsed.destination,
        parsed.month,
        parsed.trip,
        parsed.minGap,
        parsed.maxGap,
        parsed.cabin,
      ],
    });
    if (dupRs.rows.length > 0) {
      await tx.rollback();
      return { ok: false, status: 409, error: "Plan already saved" };
    }

    const countRs = await tx.execute({
      sql: "SELECT COUNT(*) AS c FROM plans WHERE user_id = ?",
      args: [userId],
    });
    if (Number(countRs.rows[0]?.c ?? 0) >= MAX_PLANS_PER_USER) {
      await tx.rollback();
      return { ok: false, status: 409, error: "Plan limit reached" };
    }

    await tx.execute({
      sql: `INSERT INTO plans (
              id, user_id, origin, destination, month, trip, min_gap, max_gap, cabin,
              alert_enabled, target_price, last_alert_price, last_seen_price, last_alert_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
      args: [
        id,
        userId,
        parsed.origin,
        parsed.destination,
        parsed.month,
        parsed.trip,
        parsed.minGap,
        parsed.maxGap,
        parsed.cabin,
        alertEnabled ? 1 : 0,
        targetRes.value,
        createdAt,
      ],
    });

    await tx.commit();
  } catch (err) {
    if (!tx.closed) {
      await tx.rollback().catch(() => undefined);
    }
    if (isUniqueConstraintError(err)) {
      return { ok: false, status: 409, error: "Plan already saved" };
    }
    throw err;
  } finally {
    tx.close();
  }

  return {
    ok: true,
    plan: {
      id,
      origin: parsed.origin,
      destination: parsed.destination,
      month: parsed.month,
      trip: parsed.trip,
      minGap: parsed.minGap,
      maxGap: parsed.maxGap,
      cabin: parsed.cabin,
      alertEnabled,
      targetPrice: targetRes.value,
      lastAlertPrice: null,
      lastSeenPrice: null,
      expired: isMonthExpired(parsed.month, nowDate),
      createdAt,
    },
  };
}

const PATCH_COLUMNS = {
  alertEnabled: "alert_enabled",
  targetPrice: "target_price",
} as const;

/**
 * Updates `alertEnabled` and/or `targetPrice` on a plan owned by `userId`.
 * Resets `last_alert_price = NULL`, `last_seen_price = NULL`, and `last_alert_at = NULL`, and increments `revision`.
 */
export async function updatePlan(
  userId: string,
  userVerified: boolean,
  planId: string,
  body: Record<string, unknown>,
  now = new Date(),
): Promise<PlanMutationResult> {
  const hasAlertEnabled = body.alertEnabled !== undefined;
  const hasTargetPrice = body.targetPrice !== undefined;

  if (!hasAlertEnabled && !hasTargetPrice) {
    return { ok: false, status: 400, error: "At least one of alertEnabled or targetPrice is required" };
  }

  if (hasAlertEnabled && typeof body.alertEnabled !== "boolean") {
    return { ok: false, status: 400, error: "alertEnabled must be a boolean" };
  }

  let validatedTarget: number | null = null;
  if (hasTargetPrice) {
    const targetRes = validateTargetPrice(body.targetPrice);
    if (!targetRes.ok) {
      return { ok: false, status: 400, error: targetRes.error };
    }
    validatedTarget = targetRes.value;
  }

  if (hasAlertEnabled && body.alertEnabled === true && !userVerified) {
    return { ok: false, status: 403, error: "Verify your email to enable alerts" };
  }

  const setClauses: string[] = [];
  const args: Array<string | number | null> = [];

  if (hasAlertEnabled) {
    setClauses.push(`${PATCH_COLUMNS.alertEnabled} = ?`);
    args.push(body.alertEnabled ? 1 : 0);
  }
  if (hasTargetPrice) {
    setClauses.push(`${PATCH_COLUMNS.targetPrice} = ?`);
    args.push(validatedTarget);
  }
  setClauses.push(
    "last_alert_price = NULL",
    "last_seen_price = NULL",
    "last_alert_at = NULL",
    "revision = revision + 1",
  );
  args.push(planId, userId);

  const client = await getClient();
  const updatedRs = await client.execute({
    sql: `UPDATE plans
          SET ${setClauses.join(", ")}
          WHERE id = ? AND user_id = ?
          RETURNING id, origin, destination, month, trip, min_gap, max_gap, cabin,
                    alert_enabled, target_price, last_alert_price, last_seen_price, created_at`,
    args,
  });
  const updated = updatedRs.rows[0];
  if (!updated) {
    return { ok: false, status: 404, error: "Not found" };
  }

  return {
    ok: true,
    plan: rowToPlan(updated as Record<string, unknown>, now),
  };
}

/**
 * Deletes `alert_deliveries` for the plan and then the plan itself in one write transaction,
 * scoped by `userId`. Returns `true` if deleted, `false` if not found / not owned by `userId`.
 */
export async function deletePlan(userId: string, planId: string): Promise<boolean> {
  const client = await getClient();
  const results = await client.batch(
    [
      {
        sql: `DELETE FROM alert_deliveries
              WHERE plan_id = ?
                AND EXISTS (SELECT 1 FROM plans WHERE id = ? AND user_id = ?)`,
        args: [planId, planId, userId],
      },
      {
        sql: "DELETE FROM plans WHERE id = ? AND user_id = ?",
        args: [planId, userId],
      },
    ],
    "write",
  );
  return (results[1]?.rowsAffected ?? 0) > 0;
}

/** Lists the newest 10 recent searches for `userId`. */
export async function listRecentSearches(userId: string): Promise<SearchParams[]> {
  const client = await getClient();
  const rs = await client.execute({
    sql: `SELECT origin, destination, month, trip, min_gap, max_gap, cabin
          FROM recent_searches
          WHERE user_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT ?`,
    args: [userId, MAX_RECENT_PER_USER],
  });
  return rs.rows.map((r) => ({
    origin: String(r.origin),
    destination: String(r.destination),
    month: String(r.month),
    trip: String(r.trip) as TripMode,
    minGap: Number(r.min_gap),
    maxGap: Number(r.max_gap),
    cabin: r.cabin === "business" ? "business" : "economy",
  }));
}

/**
 * Validates a search query with `parseSearch`, upserts it into `recent_searches`,
 * and prunes to the newest 10 for `userId` in one write transaction.
 */
export async function upsertRecentSearch(
  userId: string,
  body: Record<string, unknown>,
  now?: Date,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = parseSearchBody(body);
  if ("error" in parsed) {
    return { ok: false, error: parsed.error };
  }

  const createdAt = monotonicIso(now);
  const client = await getClient();
  await client.batch(
    [
      {
        sql: `INSERT INTO recent_searches (
                user_id, origin, destination, month, trip, min_gap, max_gap, cabin, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id, origin, destination, month, trip, min_gap, max_gap, cabin)
              DO UPDATE SET created_at = excluded.created_at`,
        args: [
          userId,
          parsed.origin,
          parsed.destination,
          parsed.month,
          parsed.trip,
          parsed.minGap,
          parsed.maxGap,
          parsed.cabin,
          createdAt,
        ],
      },
      {
        sql: `DELETE FROM recent_searches
              WHERE user_id = ?
                AND rowid NOT IN (
                  SELECT rowid FROM recent_searches
                  WHERE user_id = ?
                  ORDER BY created_at DESC, rowid DESC
                  LIMIT ?
                )`,
        args: [userId, userId, MAX_RECENT_PER_USER],
      },
    ],
    "write",
  );

  return { ok: true };
}

/** Clears all recent searches for `userId`. */
export async function clearRecentSearches(userId: string): Promise<void> {
  const client = await getClient();
  await client.execute({
    sql: "DELETE FROM recent_searches WHERE user_id = ?",
    args: [userId],
  });
}
