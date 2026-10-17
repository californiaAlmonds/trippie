import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getClient, saveFares } from "../store.ts";
import { addDays, monthBounds } from "../windows.ts";
import {
  CLIENT_DISPATCH_LIMIT,
  decideTrackDispatch,
  dispatchGitHubScrape,
  parseTrackBody,
  trackRoute,
  upsertTrackedRoute,
} from "./track.ts";

test("decideTrackDispatch pure function covers fresh, recently dispatched, missing credentials, global cap, and per-IP cap", () => {
  const nowMs = Date.parse("2026-10-17T12:00:00.000Z");

  // 1. Fresh (<12h) => 'fresh'
  assert.deepEqual(
    decideTrackDispatch({
      nowMs,
      lastScrapedAt: "2026-10-17T02:00:00.000Z", // 10h ago
      hasCredentials: true,
    }),
    { status: "fresh", etaMinutes: null },
  );

  // 2. Recently dispatched (<30m) => 'throttled'
  assert.deepEqual(
    decideTrackDispatch({
      nowMs,
      lastScrapedAt: "2026-10-16T12:00:00.000Z", // 24h ago (stale)
      lastDispatchedAt: "2026-10-17T11:40:00.000Z", // 20m ago
      hasCredentials: true,
    }),
    { status: "throttled", etaMinutes: null },
  );

  // 3. Token/repo missing => 'disabled'
  assert.deepEqual(
    decideTrackDispatch({
      nowMs,
      lastScrapedAt: null,
      lastDispatchedAt: null,
      hasCredentials: false,
    }),
    { status: "disabled", etaMinutes: null },
  );

  // 4. Global cap (20/hr) exceeded => 'throttled'
  assert.deepEqual(
    decideTrackDispatch({
      nowMs,
      hasCredentials: true,
      globalCount: 20,
      clientCount: 1,
    }),
    { status: "throttled", etaMinutes: null },
  );
  assert.deepEqual(
    decideTrackDispatch({
      nowMs,
      hasCredentials: true,
      globalAllowed: false,
      clientAllowed: true,
    }),
    { status: "throttled", etaMinutes: null },
  );

  // 5. Per-client cap (6/hr) exceeded => 'throttled'
  assert.deepEqual(
    decideTrackDispatch({
      nowMs,
      hasCredentials: true,
      globalCount: 5,
      clientCount: 6,
    }),
    { status: "throttled", etaMinutes: null },
  );
  assert.deepEqual(
    decideTrackDispatch({
      nowMs,
      hasCredentials: true,
      globalAllowed: true,
      clientAllowed: false,
    }),
    { status: "throttled", etaMinutes: null },
  );

  // 6. Eligible => 'queued' with etaMinutes: 6
  assert.deepEqual(
    decideTrackDispatch({
      nowMs,
      lastScrapedAt: "2026-10-16T10:00:00.000Z", // >12h ago
      lastDispatchedAt: "2026-10-17T11:00:00.000Z", // >30m ago
      hasCredentials: true,
      globalCount: 19,
      clientCount: 5,
    }),
    { status: "queued", etaMinutes: 6 },
  );
});

test("dispatchGitHubScrape sends expected GitHub Actions dispatch request shape and never leaks token in errors", async () => {
  const route = {
    origin: "CCU",
    destination: "BLR",
    month: "2026-11",
    trip: "oneway" as const,
    minGap: 0,
    maxGap: 0,
    cabin: "economy" as const,
  };
  const secretToken = "ghp_super_secret_dispatch_token_123456";

  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  await dispatchGitHubScrape(route, {
    githubToken: secretToken,
    githubRepo: "acme/trippie",
    fetch: async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(capturedUrl, "https://api.github.com/repos/acme/trippie/actions/workflows/scrape.yml/dispatches");
  assert.equal(capturedInit?.method, "POST");
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${secretToken}`);
  assert.equal(headers.Accept, "application/vnd.github+json");
  assert.equal(headers["X-GitHub-Api-Version"], "2022-11-28");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    ref: "master",
    inputs: {
      route: JSON.stringify(route),
    },
  });

  // Non-2xx response throws without leaking secretToken
  await assert.rejects(
    async () => {
      await dispatchGitHubScrape(route, {
        githubToken: secretToken,
        githubRepo: "acme/trippie",
        fetch: async () => new Response(`Bad credentials: ${secretToken}`, { status: 401 }),
      });
    },
    (err: Error) => {
      assert.ok(!err.message.includes(secretToken), "Error message must not contain token");
      assert.match(err.message, /401/);
      return true;
    },
  );

  // Network error whose message contains the token is redacted
  await assert.rejects(
    async () => {
      await dispatchGitHubScrape(route, {
        githubToken: secretToken,
        githubRepo: "acme/trippie",
        fetch: async () => {
          throw new Error(`Socket error with header Bearer ${secretToken}`);
        },
      });
    },
    (err: Error) => {
      assert.ok(!err.message.includes(secretToken), "Thrown error must redact token");
      return true;
    },
  );
});

test("trackRoute integration: upserts tracked_routes (preserving plan source), enforces caps, and sets last_dispatched_at on success", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-track-"));
  const dbPath = join(dir, "track.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const nowMs = Date.parse("2026-10-17T12:00:00.000Z");

    const route = {
      origin: "CCU",
      destination: "BLR",
      month: "2026-11",
      trip: "oneway" as const,
      minGap: 0,
      maxGap: 0,
      cabin: "economy" as const,
    };

    // Seed as 'plan' source first; upsertTrackedRoute with 'search' must preserve 'plan'
    await upsertTrackedRoute(route, "plan", "2026-10-10T00:00:00.000Z");
    await upsertTrackedRoute(route, "search", "2026-10-17T11:00:00.000Z");
    const checkSource = await client.execute({
      sql: "SELECT source, last_requested_at FROM tracked_routes WHERE origin = 'CCU' AND destination = 'BLR'",
      args: [],
    });
    assert.equal(checkSource.rows[0]?.source, "plan");
    assert.equal(checkSource.rows[0]?.last_requested_at, "2026-10-17T11:00:00.000Z");

    // Missing token => 'disabled'
    const disabledRes = await trackRoute(route, {
      now: nowMs,
      githubToken: "",
      githubRepo: "",
    });
    assert.deepEqual(disabledRes, { status: "disabled", etaMinutes: null });

    // Eligible dispatch => 'queued', sets last_dispatched_at
    let dispatchCount = 0;
    const queuedRes = await trackRoute(route, {
      now: nowMs,
      clientKey: "1.2.3.4",
      githubToken: "ghp_test_token",
      githubRepo: "acme/trippie",
      fetch: async () => {
        dispatchCount++;
        return new Response(null, { status: 204 });
      },
    });
    assert.deepEqual(queuedRes, { status: "queued", etaMinutes: 6 });
    assert.equal(dispatchCount, 1);

    // Immediate re-request within 30m => 'throttled' without calling GitHub again
    const cooldownRes = await trackRoute(route, {
      now: nowMs + 5 * 60_000,
      clientKey: "1.2.3.4",
      githubToken: "ghp_test_token",
      githubRepo: "acme/trippie",
      fetch: async () => {
        dispatchCount++;
        return new Response(null, { status: 204 });
      },
    });
    assert.deepEqual(cooldownRes, { status: "throttled", etaMinutes: null });
    assert.equal(dispatchCount, 1);

    // Route with >= 60% fresh fares (<12h) => 'fresh'
    const { first } = monthBounds("2026-11");
    const freshBusinessFares = Array.from({ length: 18 }, (_, i) => ({
      day: "2026-10-17",
      origin: "CCU",
      destination: "BLR",
      date: addDays(first, i),
      cabin: "business" as const,
      price: 45000,
      status: "ok" as const,
      scrapedAt: "2026-10-17T10:00:00.000Z",
    }));
    await saveFares(freshBusinessFares);
    const freshRes = await trackRoute(
      { ...route, cabin: "business" },
      {
        now: nowMs,
        clientKey: "1.2.3.4",
        githubToken: "ghp_test_token",
        githubRepo: "acme/trippie",
      },
    );
    assert.deepEqual(freshRes, { status: "fresh", etaMinutes: null });

    client.close();
  } finally {
    if (prevUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = prevUrl;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup race on Windows
    }
  }
});

test("track admission: throttled/rate-limited/disabled requests do not insert or refresh tracked_routes; horizon is enforced; inactive anonymous rows (>30d) are pruned", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-track-adm-"));
  const dbPath = join(dir, "adm.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const nowDate = new Date("2026-10-17T12:00:00.000Z");
    const nowMs = nowDate.getTime();

    // 1. Horizon rejection in parseTrackBody and trackRoute
    const pastBody = parseTrackBody({ origin: "BLR", destination: "IXZ", month: "2026-09", trip: "oneway" }, nowDate);
    assert.ok("error" in pastBody);
    const farFutureBody = parseTrackBody({ origin: "BLR", destination: "IXZ", month: "2027-11", trip: "oneway" }, nowDate);
    assert.ok("error" in farFutureBody);
    const validHorizonBody = parseTrackBody({ origin: "BLR", destination: "IXZ", month: "2027-10", trip: "oneway" }, nowDate);
    assert.ok(!("error" in validHorizonBody));

    await assert.rejects(() =>
      trackRoute(
        { origin: "BLR", destination: "IXZ", month: "2027-12", trip: "oneway", minGap: 0, maxGap: 0, cabin: "economy" },
        { now: nowMs, githubToken: "ghp_tok", githubRepo: "acme/trippie" },
      ),
    );

    // 2. Seed an inactive anonymous route (>30 days old), a recent anonymous route (5 days old), and an old config route
    await client.execute({
      sql: `INSERT INTO tracked_routes (origin, destination, month, trip, min_gap, max_gap, cabin, source, last_requested_at)
            VALUES ('PNQ', 'DEL', '2026-12', 'oneway', 0, 0, 'economy', 'search', '2026-09-10T00:00:00.000Z'),
                   ('GAU', 'DEL', '2026-12', 'oneway', 0, 0, 'economy', 'search', '2026-10-12T00:00:00.000Z'),
                   ('COK', 'DEL', '2026-12', 'oneway', 0, 0, 'economy', 'config', '2026-08-01T00:00:00.000Z')`,
      args: [],
    });

    // 3. Disabled request (no credentials) does NOT insert a tracked_routes row, while opportunistic pruning removes PNQ->DEL
    const unseededRoute = {
      origin: "HYD",
      destination: "BOM",
      month: "2026-12",
      trip: "oneway" as const,
      minGap: 0,
      maxGap: 0,
      cabin: "economy" as const,
    };
    const disabledRes = await trackRoute(unseededRoute, { now: nowMs, githubToken: "", githubRepo: "" });
    assert.equal(disabledRes.status, "disabled");

    const hydRows = await client.execute("SELECT COUNT(*) AS c FROM tracked_routes WHERE origin = 'HYD'");
    assert.equal(Number(hydRows.rows[0]?.c), 0, "disabled request must not insert tracked_routes row");

    const prunedCheck = await client.execute("SELECT origin FROM tracked_routes ORDER BY origin ASC");
    assert.deepEqual(
      prunedCheck.rows.map((r) => String(r.origin)),
      ["COK", "GAU"],
      "inactive anonymous route (>30d) pruned; recent search and config routes kept",
    );

    // 4. Exhaust per-client rate limit (6 dispatches/hr) using 6 distinct routes
    const origins = ["AMD", "ATQ", "BBI", "BDQ", "BHO", "BHU"];
    for (const orig of origins) {
      const r = await trackRoute(
        { origin: orig, destination: "BLR", month: "2026-12", trip: "oneway", minGap: 0, maxGap: 0, cabin: "economy" },
        {
          now: nowMs,
          clientKey: "9.9.9.9",
          githubToken: "ghp_tok",
          githubRepo: "acme/trippie",
          fetch: async () => new Response(null, { status: 204 }),
        },
      );
      assert.equal(r.status, "queued");
    }
    assert.equal(origins.length, CLIENT_DISPATCH_LIMIT);

    // 5. 7th request from the same client is rate-limited ('throttled'):
    //    - for a brand-new route (HYD->BOM), it inserts NO row;
    //    - for an existing route (GAU->DEL, last_requested_at = 2026-10-12), it does NOT bump last_requested_at.
    const throttledNew = await trackRoute(unseededRoute, {
      now: nowMs,
      clientKey: "9.9.9.9",
      githubToken: "ghp_tok",
      githubRepo: "acme/trippie",
      fetch: async () => new Response(null, { status: 204 }),
    });
    assert.equal(throttledNew.status, "throttled");
    const hydAfterThrottle = await client.execute("SELECT COUNT(*) AS c FROM tracked_routes WHERE origin = 'HYD'");
    assert.equal(Number(hydAfterThrottle.rows[0]?.c), 0, "throttled request must not insert tracked_routes row");

    const throttledExisting = await trackRoute(
      { origin: "GAU", destination: "DEL", month: "2026-12", trip: "oneway", minGap: 0, maxGap: 0, cabin: "economy" },
      {
        now: nowMs,
        clientKey: "9.9.9.9",
        githubToken: "ghp_tok",
        githubRepo: "acme/trippie",
        fetch: async () => new Response(null, { status: 204 }),
      },
    );
    assert.equal(throttledExisting.status, "throttled");
    const gauRow = await client.execute("SELECT last_requested_at FROM tracked_routes WHERE origin = 'GAU' AND destination = 'DEL'");
    assert.equal(
      String(gauRow.rows[0]?.last_requested_at),
      "2026-10-12T00:00:00.000Z",
      "throttled request must not bump last_requested_at",
    );

    client.close();
  } finally {
    if (prevUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = prevUrl;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup race on Windows
    }
  }
});

test("cooldown claim is atomic under concurrency and rolls back on dispatch failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-track-atomic-"));
  const dbPath = join(dir, "atomic.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const nowMs = Date.parse("2026-10-17T12:00:00.000Z");
    const route = {
      origin: "BLR",
      destination: "IXZ",
      month: "2027-02",
      trip: "round" as const,
      minGap: 5,
      maxGap: 7,
      cabin: "economy" as const,
    };

    // 1. Failed dispatch rolls back the cooldown claim so a retry can immediately claim and dispatch
    await assert.rejects(() =>
      trackRoute(route, {
        now: nowMs,
        clientKey: "10.0.0.1",
        githubToken: "ghp_tok",
        githubRepo: "acme/trippie",
        fetch: async () => new Response("Server error", { status: 500 }),
      }),
    );

    const afterFail = await client.execute(
      "SELECT last_dispatched_at FROM tracked_routes WHERE origin = 'BLR' AND destination = 'IXZ'",
    );
    assert.equal(afterFail.rows[0]?.last_dispatched_at, null, "failed dispatch must roll back last_dispatched_at");

    // 2. Two concurrent claims for the same route -> exactly one wins ('queued') and dispatches once, the other is 'throttled'
    let dispatches = 0;
    const [resA, resB] = await Promise.all([
      trackRoute(route, {
        now: nowMs,
        clientKey: "10.0.0.2",
        githubToken: "ghp_tok",
        githubRepo: "acme/trippie",
        fetch: async () => {
          await new Promise((r) => setTimeout(r, 20));
          dispatches++;
          return new Response(null, { status: 204 });
        },
      }),
      trackRoute(route, {
        now: nowMs,
        clientKey: "10.0.0.3",
        githubToken: "ghp_tok",
        githubRepo: "acme/trippie",
        fetch: async () => {
          await new Promise((r) => setTimeout(r, 20));
          dispatches++;
          return new Response(null, { status: 204 });
        },
      }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    assert.deepEqual(statuses, ["queued", "throttled"]);
    assert.equal(dispatches, 1);

    client.close();
  } finally {
    if (prevUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = prevUrl;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup race on Windows
    }
  }
});

test("freshness for round trips requires BOTH legs to meet >= 60% coverage within the 12h freshness window", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trippie-track-rtfresh-"));
  const dbPath = join(dir, "rtfresh.db").replace(/\\/g, "/");
  const prevUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  try {
    const client = await getClient();
    const nowMs = Date.parse("2026-10-17T12:00:00.000Z");
    const scrapedAt = "2026-10-17T10:00:00.000Z"; // 2h ago (<12h)
    const route = {
      origin: "BLR",
      destination: "IXZ",
      month: "2027-02",
      trip: "round" as const,
      minGap: 5,
      maxGap: 7,
      cabin: "economy" as const,
    };
    const { first } = monthBounds("2027-02"); // 28 days
    const inFrom = addDays(first, 5); // 2027-02-06..2027-03-07 (30 days)

    // 1. One fresh outbound date with no return fares is NOT fresh => dispatches ('queued')
    await saveFares([
      {
        day: "2026-10-17",
        origin: "BLR",
        destination: "IXZ",
        date: "2027-02-10",
        cabin: "economy",
        price: 5200,
        status: "ok",
        scrapedAt,
      },
    ]);

    let dispatches = 0;
    const oneDateRes = await trackRoute(route, {
      now: nowMs,
      clientKey: "10.1.0.1",
      githubToken: "ghp_tok",
      githubRepo: "acme/trippie",
      fetch: async () => {
        dispatches++;
        return new Response(null, { status: 204 });
      },
    });
    assert.equal(oneDateRes.status, "queued");
    assert.equal(dispatches, 1);

    // Clear cooldown so we can test full outbound + missing inbound
    await client.execute("UPDATE tracked_routes SET last_dispatched_at = NULL");

    // 2. 100% fresh outbound dates (28/28) but 0 return fares is STILL NOT fresh for a round trip
    const allOutbound = Array.from({ length: 28 }, (_, i) => ({
      day: "2026-10-17",
      origin: "BLR",
      destination: "IXZ",
      date: addDays(first, i),
      cabin: "economy" as const,
      price: 5200,
      status: "ok" as const,
      scrapedAt,
    }));
    await saveFares(allOutbound);

    const outOnlyRes = await trackRoute(route, {
      now: nowMs,
      clientKey: "10.1.0.1",
      githubToken: "ghp_tok",
      githubRepo: "acme/trippie",
      fetch: async () => {
        dispatches++;
        return new Response(null, { status: 204 });
      },
    });
    assert.equal(outOnlyRes.status, "queued");
    assert.equal(dispatches, 2);

    await client.execute("UPDATE tracked_routes SET last_dispatched_at = NULL");

    // 3. Seed >= 60% fresh return fares (18/30 = 60%) => now BOTH legs meet coverage and route is 'fresh'
    const returnFares = Array.from({ length: 18 }, (_, i) => ({
      day: "2026-10-17",
      origin: "IXZ",
      destination: "BLR",
      date: addDays(inFrom, i),
      cabin: "economy" as const,
      price: 5400,
      status: "ok" as const,
      scrapedAt,
    }));
    await saveFares(returnFares);

    const bothFreshRes = await trackRoute(route, {
      now: nowMs,
      clientKey: "10.1.0.1",
      githubToken: "ghp_tok",
      githubRepo: "acme/trippie",
      fetch: async () => {
        dispatches++;
        return new Response(null, { status: 204 });
      },
    });
    assert.deepEqual(bothFreshRes, { status: "fresh", etaMinutes: null });
    assert.equal(dispatches, 2);

    client.close();
  } finally {
    if (prevUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = prevUrl;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup race on Windows
    }
  }
});
