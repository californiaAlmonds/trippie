import type { DayFare, FareProvider } from "../types.ts";
import { dbConfigured } from "../store.ts";
import { dbProvider } from "./db.ts";
import { demoProvider } from "./demo.ts";
import { travelpayoutsProvider } from "./travelpayouts.ts";

/** Queries every provider and keeps the cheapest fare per date; one failing provider doesn't sink the search. */
function merged(providers: FareProvider[]): FareProvider {
  if (providers.length === 1) return providers[0];
  return {
    name: providers.map((p) => p.name).join(" + "),
    isDemo: false,
    async getOneWayFares(origin, destination, from, to) {
      const settled = await Promise.allSettled(providers.map((p) => p.getOneWayFares(origin, destination, from, to)));
      const best = new Map<string, DayFare>();
      let failures = 0;
      for (const s of settled) {
        if (s.status === "rejected") {
          failures++;
          console.error(s.reason);
          continue;
        }
        for (const f of s.value) if (!best.has(f.date) || f.price < best.get(f.date)!.price) best.set(f.date, f);
      }
      if (failures === providers.length) throw new Error("All fare providers failed");
      return [...best.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    },
  };
}

// FARE_PROVIDER=demo forces simulated fares; otherwise use whatever real sources are configured.
export function getProvider(): FareProvider {
  if (process.env.FARE_PROVIDER === "demo") return demoProvider;
  const providers: FareProvider[] = [];
  if (dbConfigured()) providers.push(dbProvider);
  if (process.env.TRAVELPAYOUTS_TOKEN) providers.push(travelpayoutsProvider(process.env.TRAVELPAYOUTS_TOKEN));
  return providers.length ? merged(providers) : demoProvider;
}
