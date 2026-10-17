import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { markRouteScraped, parseTrackBody, upsertTrackedRoute } from "../src/lib/routes/track.ts";
import { findCheapestRowIndex, parseResults, type ParseOutcome } from "../src/lib/scrape/parse.ts";
import { legsFor, selectRoutesToScrape, shouldMarkComplete } from "../src/lib/scrape/plan.ts";
import type { SearchParams } from "../src/lib/search.ts";
import { doneDates, finishRun, saveFares, startRun, type FareRecord } from "../src/lib/store.ts";
import type { Cabin } from "../src/lib/types.ts";

// Usage: bun scripts/scrape.ts [--route '<json>'] [--alerts-only] [--refresh-age <hours>] [--routes routes.json] [--limit N] [--debug] [--headed]
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : (args[i + 1] ?? "true");
};
const routeJson = opt("route");
const alertsOnly = args.includes("--alerts-only");
const rawRefreshAge = opt("refresh-age");
const refreshAgeHours = rawRefreshAge !== undefined ? Number(rawRefreshAge) : undefined;
if (refreshAgeHours !== undefined && (!Number.isFinite(refreshAgeHours) || refreshAgeHours <= 0)) {
  throw new Error("--refresh-age must be a positive number of hours");
}
const routesFile = opt("routes") ?? "routes.json";
const limit = Number(opt("limit") ?? Infinity);
const debug = args.includes("--debug");
const CONCURRENCY = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

async function scrapeDate(page: Page, origin: string, dest: string, date: string, cabin: Cabin): Promise<ParseOutcome> {
  const q = `Flights to ${dest} from ${origin} on ${date} oneway${cabin === "business" ? " business class" : ""}`;
  await page.goto(`https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&curr=INR&hl=en&gl=in`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll("li")].some((li) => /₹\s?\d/.test((li as HTMLElement).innerText)) ||
        /no (flights|options)|unusual traffic|not a robot/i.test(document.body.innerText),
      undefined,
      { timeout: 20_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1_000);
  const body = await page.locator("body").innerText();
  const rows = await page.locator("li").evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText));

  let expandedRow: string | undefined;
  const bestIdx = findCheapestRowIndex(rows);
  if (bestIdx >= 0) {
    try {
      const li = page.locator("li").nth(bestIdx);
      const toggle = li
        .locator('button[aria-expanded="false"], [aria-expanded="false"]')
        .first();
      if ((await toggle.count()) > 0) {
        await toggle.click({ timeout: 3_000 });
        await page.waitForTimeout(500);
        expandedRow = await li.innerText({ timeout: 3_000 });
      }
    } catch {
      // Expansion failures must not fail the date; store nulls for flight_no/aircraft
    }
  }

  if (debug) {
    console.log(
      JSON.stringify({
        url: page.url(),
        cabin,
        rows: rows.filter((r) => r.includes("₹")).slice(0, 3),
        expandedSample: expandedRow ? expandedRow.split("\n").slice(0, 12) : null,
      }),
    );
  }
  const out = parseResults(page.url(), body, rows, expandedRow, cabin);
  if (out.status === "parse_error") {
    mkdirSync("artifacts", { recursive: true });
    await page.screenshot({ path: `artifacts/${origin}-${dest}-${cabin}-${date}.png`, fullPage: true }).catch(() => {});
  }
  return out;
}

async function resolveRoutes(): Promise<SearchParams[]> {
  if (routeJson) {
    let raw: unknown;
    try {
      raw = JSON.parse(routeJson);
    } catch {
      throw new Error("--route must be valid JSON");
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error("--route must be a JSON object");
    }
    const parsed = parseTrackBody(raw as Record<string, unknown>);
    if ("error" in parsed) throw new Error(`--route: ${parsed.error}`);
    await upsertTrackedRoute(parsed, "search");
    return [parsed];
  }

  if (alertsOnly) {
    return selectRoutesToScrape({ alertsOnly: true });
  }

  const configRoutes = existsSync(routesFile)
    ? (JSON.parse(readFileSync(routesFile, "utf8")) as Record<string, unknown>[])
    : [];
  return selectRoutesToScrape({ configRoutes });
}

async function main() {
  const routes = await resolveRoutes();
  const browser = await chromium.launch({ headless: !args.includes("--headed") });
  const ctx = await browser.newContext({ locale: "en-IN", timezoneId: "Asia/Kolkata", viewport: { width: 1280, height: 1600 } });
  const runId = await startRun();
  let ok = 0;
  let failed = 0;
  let blocked = false;
  const scrapedInRun = new Map<string, ParseOutcome["status"]>();

  for (const params of routes) {
    let routePlanned = 0;
    let routeOk = 0;
    let routeNoFlights = 0;
    let routeFailed = 0;
    let routeTruncated = false;

    for (const leg of legsFor(params, today)) {
      const done = await doneDates(today, leg.origin, leg.destination, leg.cabin, { refreshAgeHours });
      const candidates: string[] = [];
      for (const d of leg.dates) {
        const key = `${leg.origin}|${leg.destination}|${leg.cabin}|${d}`;
        const prevStatus = scrapedInRun.get(key);
        if (prevStatus !== undefined) {
          routePlanned++;
          if (prevStatus === "ok") routeOk++;
          else if (prevStatus === "no_flights") routeNoFlights++;
          else routeFailed++;
          continue;
        }
        if (!done.has(d)) {
          candidates.push(d);
        }
      }

      const queue = candidates.slice(0, limit);
      if (queue.length < candidates.length) {
        routeTruncated = true;
      }
      routePlanned += queue.length;

      console.log(
        `${leg.origin}->${leg.destination} (${leg.cabin}): ${queue.length} dates to scrape (${done.size} already done today)`,
      );

      const worker = async () => {
        const page = await ctx.newPage();
        for (let date = queue.shift(); date && !blocked; date = queue.shift()) {
          let out = await scrapeDate(page, leg.origin, leg.destination, date, leg.cabin).catch(
            (): ParseOutcome => ({ status: "parse_error" }),
          );
          if (out.status === "parse_error") {
            await sleep(3_000);
            out = await scrapeDate(page, leg.origin, leg.destination, date, leg.cabin).catch(
              (): ParseOutcome => ({ status: "parse_error" }),
            );
          }
          const rec: FareRecord = {
            day: today,
            origin: leg.origin,
            destination: leg.destination,
            date,
            cabin: leg.cabin,
            price: out.status === "ok" ? out.fare.price : null,
            airline: out.status === "ok" ? out.fare.airline : null,
            stops: out.status === "ok" ? out.fare.stops : null,
            depTime: out.status === "ok" ? out.fare.depTime : null,
            arrTime: out.status === "ok" ? out.fare.arrTime : null,
            arrDayOffset: out.status === "ok" ? out.fare.arrDayOffset : null,
            durationMin: out.status === "ok" ? out.fare.durationMin : null,
            flightNo: out.status === "ok" ? out.fare.flightNo : null,
            aircraft: out.status === "ok" ? out.fare.aircraft : null,
            status: out.status,
          };
          await saveFares([rec]);
          scrapedInRun.set(`${leg.origin}|${leg.destination}|${leg.cabin}|${date}`, out.status);
          console.log(
            `  ${date} ${out.status}${
              out.status === "ok"
                ? ` ₹${out.fare.price} ${out.fare.airline ?? ""} ${out.fare.depTime ?? ""}-${out.fare.arrTime ?? ""} ${out.fare.flightNo ?? ""} ${out.fare.aircraft ?? ""}`.trimEnd()
                : ""
            }`,
          );
          if (out.status === "ok") {
            ok++;
            routeOk++;
          } else if (out.status === "no_flights") {
            ok++;
            routeNoFlights++;
          } else {
            failed++;
            routeFailed++;
          }
          if (out.status === "blocked") {
            blocked = true; // never retry or evade; stop the run
            routeTruncated = true;
          }
          await sleep(2_000 + Math.random() * 3_000);
        }
        await page.close();
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(queue.length, 1)) }, worker));
      if (blocked) {
        routeTruncated = true;
        break;
      }
    }
    if (blocked) break;
    if (
      shouldMarkComplete({
        planned: routePlanned,
        ok: routeOk,
        noFlights: routeNoFlights,
        failed: routeFailed,
        truncated: routeTruncated,
      })
    ) {
      await markRouteScraped(params);
    }
  }

  await browser.close();
  await finishRun(runId, ok, failed, blocked ? "blocked by Google; run stopped" : "completed");
  console.log(`done: ok=${ok} failed=${failed}${blocked ? " (BLOCKED)" : ""}`);
  if (blocked) process.exitCode = 2;
}

await main();

