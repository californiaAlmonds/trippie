import { ipRateLimitKey, rateLimit } from "../auth/rateLimit.ts";
import { maxAllowedMonth, parseSearch, type SearchParams } from "../search.ts";
import { getClient } from "../store.ts";
import { addDays, diffDays, monthBounds } from "../windows.ts";

export type TrackStatus = "queued" | "fresh" | "throttled" | "disabled";

export interface TrackResult {
  status: TrackStatus;
  etaMinutes: number | null;
}

export type RouteSource = "search" | "plan" | "config";

export const FRESH_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const FRESH_COVERAGE_THRESHOLD = 0.6; // 60% per-leg fresh date coverage
export const DISPATCH_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
export const GLOBAL_DISPATCH_LIMIT = 20;
export const CLIENT_DISPATCH_LIMIT = 6;
export const DISPATCH_WINDOW_SECONDS = 60 * 60; // 1 hour
export const ETA_MINUTES = 6;
export const ANON_PRUNE_DAYS = 30;
export const ANON_PRUNE_BATCH = 50;

export interface TrackDecisionInput {
  nowMs?: number;
  lastScrapedAt?: string | null;
  lastDispatchedAt?: string | null;
  hasCredentials?: boolean;
  githubToken?: string | null;
  githubRepo?: string | null;
  globalAllowed?: boolean;
  clientAllowed?: boolean;
  globalCount?: number;
  clientCount?: number;
}

/**
 * Pure decision function for POST /api/routes/track.
 * Evaluates freshness (<12h), recent dispatch (<30m), credentials, and global/per-client caps.
 */
export function decideTrackDispatch(input: TrackDecisionInput): TrackResult {
  const nowMs = input.nowMs ?? Date.now();

  if (input.lastScrapedAt) {
    const scrapedMs = Date.parse(input.lastScrapedAt);
    if (Number.isFinite(scrapedMs) && nowMs - scrapedMs < FRESH_TTL_MS) {
      return { status: "fresh", etaMinutes: null };
    }
  }

  if (input.lastDispatchedAt) {
    const dispatchedMs = Date.parse(input.lastDispatchedAt);
    if (Number.isFinite(dispatchedMs) && nowMs - dispatchedMs < DISPATCH_COOLDOWN_MS) {
      return { status: "throttled", etaMinutes: null };
    }
  }

  const credsOk =
    input.hasCredentials !== undefined
      ? input.hasCredentials
      : Boolean(input.githubToken?.trim() && input.githubRepo?.trim());
  if (!credsOk) {
    return { status: "disabled", etaMinutes: null };
  }

  const globalOk =
    input.globalAllowed !== undefined ? input.globalAllowed : (input.globalCount ?? 0) < GLOBAL_DISPATCH_LIMIT;
  if (!globalOk) {
    return { status: "throttled", etaMinutes: null };
  }

  const clientOk =
    input.clientAllowed !== undefined ? input.clientAllowed : (input.clientCount ?? 0) < CLIENT_DISPATCH_LIMIT;
  if (!clientOk) {
    return { status: "throttled", etaMinutes: null };
  }

  return { status: "queued", etaMinutes: ETA_MINUTES };
}

export interface DispatchOptions {
  fetch?: typeof fetch;
  githubToken?: string;
  githubRepo?: string;
  ref?: string;
}

function redactSecret(message: string, secret?: string): string {
  if (!secret) return message;
  return message.replaceAll(secret, "[REDACTED]");
}

/**
 * Dispatches the GitHub Actions `scrape.yml` workflow for a single route.
 * Never leaks the dispatch token in thrown errors.
 */
export async function dispatchGitHubScrape(route: SearchParams, options?: DispatchOptions): Promise<void> {
  const fetchFn = options?.fetch ?? fetch;
  const token = (options?.githubToken ?? process.env.GITHUB_DISPATCH_TOKEN ?? "").trim();
  const repo = (options?.githubRepo ?? process.env.GITHUB_REPO ?? "").trim();
  if (!token || !repo) {
    throw new Error("GitHub dispatch credentials are not configured");
  }

  const url = `https://api.github.com/repos/${repo}/actions/workflows/scrape.yml/dispatches`;
  const payload = {
    ref: options?.ref ?? "master",
    inputs: {
      route: JSON.stringify({
        origin: route.origin,
        destination: route.destination,
        month: route.month,
        trip: route.trip,
        minGap: route.minGap,
        maxGap: route.maxGap,
        cabin: route.cabin,
      }),
    },
  };

  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`GitHub workflow dispatch request failed: ${redactSecret(rawMsg, token)}`);
  }

  if (!res.ok) {
    throw new Error(`GitHub workflow dispatch failed with status ${res.status}`);
  }
}

/** Builds URLSearchParams from a JSON object and validates with parseSearch. */
export function parseTrackBody(body: Record<string, unknown>, now = new Date()): SearchParams | { error: string } {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null) {
      sp.set(k, typeof v === "string" || typeof v === "number" ? String(v) : "invalid");
    }
  }
  return parseSearch(sp, now);
}

/** Upserts a route into tracked_routes, preserving source='plan' (and 'config' over 'search') if already set. */
export async function upsertTrackedRoute(
  route: SearchParams,
  source: RouteSource = "search",
  nowIso = new Date().toISOString(),
): Promise<{ lastDispatchedAt: string | null; lastScrapedAt: string | null }> {
  const client = await getClient();
  const rs = await client.execute({
    sql: `INSERT INTO tracked_routes (
            origin, destination, month, trip, min_gap, max_gap, cabin, source, last_requested_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(origin, destination, month, trip, min_gap, max_gap, cabin)
          DO UPDATE SET
            source = CASE
              WHEN tracked_routes.source = 'plan' THEN 'plan'
              WHEN tracked_routes.source = 'config' AND excluded.source = 'search' THEN 'config'
              ELSE excluded.source
            END,
            last_requested_at = excluded.last_requested_at
          RETURNING last_dispatched_at, last_scraped_at`,
    args: [route.origin, route.destination, route.month, route.trip, route.minGap, route.maxGap, route.cabin, source, nowIso],
  });
  const row = rs.rows[0];
  return {
    lastDispatchedAt: row?.last_dispatched_at != null ? String(row.last_dispatched_at) : null,
    lastScrapedAt: row?.last_scraped_at != null ? String(row.last_scraped_at) : null,
  };
}

/**
 * Opportunistically prunes up to `limit` anonymous (non-config, non-plan) tracked_routes rows
 * not requested in the last 30 days.
 */
export async function pruneTrackedRoutes(nowMs = Date.now(), limit = ANON_PRUNE_BATCH): Promise<number> {
  const cutoffIso = new Date(nowMs - ANON_PRUNE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const client = await getClient();
  const rs = await client.execute({
    sql: `DELETE FROM tracked_routes
          WHERE rowid IN (
            SELECT tr.rowid FROM tracked_routes tr
            WHERE tr.source = 'search'
              AND tr.last_requested_at < ?
              AND NOT EXISTS (
                SELECT 1 FROM plans p
                WHERE p.origin = tr.origin AND p.destination = tr.destination
                  AND p.month = tr.month AND p.trip = tr.trip
                  AND p.min_gap = tr.min_gap AND p.max_gap = tr.max_gap
                  AND p.cabin = tr.cabin
              )
            LIMIT ?
          )`,
    args: [cutoffIso, limit],
  });
  return rs.rowsAffected ?? 0;
}

/** Marks a tracked route as scraped at `scrapedAtIso`. */
export async function markRouteScraped(route: SearchParams, scrapedAtIso = new Date().toISOString()): Promise<void> {
  const client = await getClient();
  await client.execute({
    sql: `UPDATE tracked_routes SET last_scraped_at = ?
          WHERE origin = ? AND destination = ? AND month = ? AND trip = ?
            AND min_gap = ? AND max_gap = ? AND cabin = ?`,
    args: [scrapedAtIso, route.origin, route.destination, route.month, route.trip, route.minGap, route.maxGap, route.cabin],
  });
}

export interface TrackRouteOptions {
  clientKey?: string;
  now?: Date | number;
  fetch?: typeof fetch;
  githubToken?: string;
  githubRepo?: string;
}

async function computeLegFreshness(
  origin: string,
  destination: string,
  cabin: string,
  from: string,
  to: string,
  freshCutoffIso: string,
): Promise<{ covered: boolean; newestScrapedAt: string | null }> {
  const expectedDates = diffDays(from, to) + 1;
  if (expectedDates <= 0) {
    return { covered: false, newestScrapedAt: null };
  }
  const client = await getClient();
  const rs = await client.execute({
    sql: `SELECT COUNT(DISTINCT travel_date) AS fresh_days, MAX(scraped_at) AS newest
          FROM fares
          WHERE origin = ? AND destination = ? AND cabin = ?
            AND travel_date BETWEEN ? AND ?
            AND status = 'ok' AND price IS NOT NULL
            AND scraped_at > ?`,
    args: [origin, destination, cabin, from, to, freshCutoffIso],
  });
  const freshDays = Number(rs.rows[0]?.fresh_days ?? 0);
  const newest = rs.rows[0]?.newest != null ? String(rs.rows[0].newest) : null;
  return {
    covered: freshDays / expectedDates >= FRESH_COVERAGE_THRESHOLD,
    newestScrapedAt: newest,
  };
}

/**
 * Checks horizon, prunes stale anonymous routes, evaluates per-leg freshness/cooldown/rate-limits/credentials,
 * and only persists + atomically claims cooldown + dispatches GitHub Actions when admitted.
 */
export async function trackRoute(route: SearchParams, options?: TrackRouteOptions): Promise<TrackResult> {
  const nowMs =
    options?.now instanceof Date
      ? options.now.getTime()
      : typeof options?.now === "number"
        ? options.now
        : Date.now();
  const nowDate = new Date(nowMs);
  const nowIso = nowDate.toISOString();
  const currentMonth = nowIso.slice(0, 7);
  const maxMonth = maxAllowedMonth(nowDate);

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(route.month) || route.month < currentMonth || route.month > maxMonth) {
    throw new Error("Route month must be between the current month and 12 months ahead");
  }

  await pruneTrackedRoutes(nowMs);

  const client = await getClient();
  const existingRs = await client.execute({
    sql: `SELECT last_dispatched_at, last_scraped_at FROM tracked_routes
          WHERE origin = ? AND destination = ? AND month = ? AND trip = ?
            AND min_gap = ? AND max_gap = ? AND cabin = ?`,
    args: [route.origin, route.destination, route.month, route.trip, route.minGap, route.maxGap, route.cabin],
  });
  const existingRow = existingRs.rows[0];
  const prevDispatchedAt = existingRow?.last_dispatched_at != null ? String(existingRow.last_dispatched_at) : null;
  const routeScrapedAt = existingRow?.last_scraped_at != null ? String(existingRow.last_scraped_at) : null;

  const { first, last } = monthBounds(route.month);
  const freshCutoffIso = new Date(nowMs - FRESH_TTL_MS).toISOString();

  const outFresh = await computeLegFreshness(route.origin, route.destination, route.cabin, first, last, freshCutoffIso);
  let faresFreshAt: string | null = null;
  if (route.trip === "oneway") {
    if (outFresh.covered) {
      faresFreshAt = outFresh.newestScrapedAt;
    }
  } else {
    const inFrom = addDays(first, route.minGap);
    const inTo = addDays(last, route.maxGap);
    const inFresh = await computeLegFreshness(route.destination, route.origin, route.cabin, inFrom, inTo, freshCutoffIso);
    if (outFresh.covered && inFresh.covered && outFresh.newestScrapedAt && inFresh.newestScrapedAt) {
      faresFreshAt =
        outFresh.newestScrapedAt < inFresh.newestScrapedAt ? outFresh.newestScrapedAt : inFresh.newestScrapedAt;
    }
  }

  const newestScrapedAt =
    faresFreshAt && routeScrapedAt
      ? faresFreshAt > routeScrapedAt
        ? faresFreshAt
        : routeScrapedAt
      : (faresFreshAt ?? routeScrapedAt);

  const token = (options?.githubToken ?? process.env.GITHUB_DISPATCH_TOKEN ?? "").trim();
  const repo = (options?.githubRepo ?? process.env.GITHUB_REPO ?? "").trim();
  const hasCredentials = Boolean(token && repo);

  // Pre-check freshness, 30m cooldown, and credentials before consuming rate-limit tokens or writing tracked_routes
  const preDecision = decideTrackDispatch({
    nowMs,
    lastScrapedAt: newestScrapedAt,
    lastDispatchedAt: prevDispatchedAt,
    hasCredentials,
    globalAllowed: true,
    clientAllowed: true,
  });
  if (preDecision.status !== "queued") {
    return preDecision;
  }

  // Without TRUSTED_PROXY=1 all visitors share one client bucket (intentional conservative policy).
  const clientIp = options?.clientKey ?? "shared";
  const clientRl = await rateLimit(ipRateLimitKey("dispatch", clientIp), CLIENT_DISPATCH_LIMIT, DISPATCH_WINDOW_SECONDS, nowMs);
  const globalRl = clientRl.allowed
    ? await rateLimit("dispatch:global", GLOBAL_DISPATCH_LIMIT, DISPATCH_WINDOW_SECONDS, nowMs)
    : { allowed: true, count: 0, windowStart: 0 };

  const decision = decideTrackDispatch({
    nowMs,
    lastScrapedAt: newestScrapedAt,
    lastDispatchedAt: prevDispatchedAt,
    hasCredentials,
    globalAllowed: globalRl.allowed,
    clientAllowed: clientRl.allowed,
  });

  if (decision.status !== "queued") {
    return decision;
  }

  // Admitted: persist/refresh tracked_routes and atomically claim the 30m dispatch cooldown
  await upsertTrackedRoute(route, "search", nowIso);

  const cooldownCutoffIso = new Date(nowMs - DISPATCH_COOLDOWN_MS).toISOString();
  const claimRs = await client.execute({
    sql: `UPDATE tracked_routes
          SET last_dispatched_at = ?
          WHERE origin = ? AND destination = ? AND month = ? AND trip = ?
            AND min_gap = ? AND max_gap = ? AND cabin = ?
            AND (last_dispatched_at IS NULL OR last_dispatched_at <= ?)`,
    args: [
      nowIso,
      route.origin,
      route.destination,
      route.month,
      route.trip,
      route.minGap,
      route.maxGap,
      route.cabin,
      cooldownCutoffIso,
    ],
  });

  if ((claimRs.rowsAffected ?? 0) === 0) {
    return { status: "throttled", etaMinutes: null };
  }

  try {
    await dispatchGitHubScrape(route, {
      fetch: options?.fetch,
      githubToken: token,
      githubRepo: repo,
    });
  } catch (err) {
    await client.execute({
      sql: `UPDATE tracked_routes
            SET last_dispatched_at = ?
            WHERE origin = ? AND destination = ? AND month = ? AND trip = ?
              AND min_gap = ? AND max_gap = ? AND cabin = ?
              AND last_dispatched_at = ?`,
      args: [
        prevDispatchedAt,
        route.origin,
        route.destination,
        route.month,
        route.trip,
        route.minGap,
        route.maxGap,
        route.cabin,
        nowIso,
      ],
    });
    throw err;
  }

  return decision;
}
