import { mkdirSync, readFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { parseResults, type ParseOutcome } from "../src/lib/scrape/parse.ts";
import { legsFor } from "../src/lib/scrape/plan.ts";
import { parseSearch } from "../src/lib/search.ts";
import { doneDates, finishRun, saveFares, startRun, type FareRecord } from "../src/lib/store.ts";

// Usage: bun scripts/scrape.ts [--routes routes.json] [--limit N] [--debug] [--headed]
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : (args[i + 1] ?? "true");
};
const routesFile = opt("routes") ?? "routes.json";
const limit = Number(opt("limit") ?? Infinity);
const debug = args.includes("--debug");
const CONCURRENCY = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

async function scrapeDate(page: Page, origin: string, dest: string, date: string): Promise<ParseOutcome> {
  const q = `Flights to ${dest} from ${origin} on ${date} oneway`;
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
  if (debug) console.log(JSON.stringify({ url: page.url(), rows: rows.filter((r) => r.includes("₹")).slice(0, 3) }));
  const out = parseResults(page.url(), body, rows);
  if (out.status === "parse_error") {
    mkdirSync("artifacts", { recursive: true });
    await page.screenshot({ path: `artifacts/${origin}-${dest}-${date}.png`, fullPage: true }).catch(() => {});
  }
  return out;
}

async function main() {
  const routes = JSON.parse(readFileSync(routesFile, "utf8")) as Record<string, string | number>[];
  const browser = await chromium.launch({ headless: !args.includes("--headed") });
  const ctx = await browser.newContext({ locale: "en-IN", timezoneId: "Asia/Kolkata", viewport: { width: 1280, height: 1600 } });
  const runId = await startRun();
  let ok = 0;
  let failed = 0;
  let blocked = false;

  for (const route of routes) {
    const params = parseSearch(new URLSearchParams(Object.entries(route).map(([k, v]) => [k, String(v)])));
    if ("error" in params) throw new Error(`${routesFile}: ${params.error}`);

    for (const leg of legsFor(params, today)) {
      const done = await doneDates(today, leg.origin, leg.destination);
      const queue = leg.dates.filter((d) => !done.has(d)).slice(0, limit);
      console.log(`${leg.origin}->${leg.destination}: ${queue.length} dates to scrape (${done.size} already done today)`);

      const worker = async () => {
        const page = await ctx.newPage();
        for (let date = queue.shift(); date && !blocked; date = queue.shift()) {
          let out = await scrapeDate(page, leg.origin, leg.destination, date).catch(
            (): ParseOutcome => ({ status: "parse_error" }),
          );
          if (out.status === "parse_error") {
            await sleep(3_000);
            out = await scrapeDate(page, leg.origin, leg.destination, date).catch((): ParseOutcome => ({ status: "parse_error" }));
          }
          const rec: FareRecord = {
            day: today,
            origin: leg.origin,
            destination: leg.destination,
            date,
            price: out.status === "ok" ? out.fare.price : null,
            airline: out.status === "ok" ? out.fare.airline : null,
            stops: out.status === "ok" ? out.fare.stops : null,
            status: out.status,
          };
          await saveFares([rec]);
          console.log(`  ${date} ${out.status}${out.status === "ok" ? ` ₹${out.fare.price} ${out.fare.airline ?? ""}` : ""}`);
          if (out.status === "ok" || out.status === "no_flights") ok++;
          else failed++;
          if (out.status === "blocked") blocked = true; // never retry or evade; stop the run
          await sleep(2_000 + Math.random() * 3_000);
        }
        await page.close();
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (blocked) break;
    }
    if (blocked) break;
  }

  await browser.close();
  await finishRun(runId, ok, failed, blocked ? "blocked by Google; run stopped" : "completed");
  console.log(`done: ok=${ok} failed=${failed}${blocked ? " (BLOCKED)" : ""}`);
  if (blocked) process.exitCode = 2;
}

await main();
