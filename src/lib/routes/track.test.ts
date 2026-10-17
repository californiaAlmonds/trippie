import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getClient, saveFares } from "../store.ts";
import {
  decideTrackDispatch,
  dispatchGitHubScrape,
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

    // Route with fresh fare (<12h) => 'fresh'
    await saveFares([
      {
        day: "2026-10-17",
        origin: "CCU",
        destination: "BLR",
        date: "2026-11-15",
        cabin: "business",
        price: 45000,
        status: "ok",
        scrapedAt: "2026-10-17T10:00:00.000Z",
      },
    ]);
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
