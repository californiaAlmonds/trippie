import type { Cabin, DayFare, FareProvider } from "../types.ts";
import { dbConfigured } from "../store.ts";
import { dbProvider } from "./db.ts";
import { demoProvider } from "./demo.ts";
import { travelpayoutsProvider } from "./travelpayouts.ts";

function isEstimateProvider(p: FareProvider): boolean {
  return /travelpayouts|aviasales/i.test(p.name);
}

/**
 * Queries providers in priority order: scraped DB fares always win per date;
 * Travelpayouts is used only for economy dates with no scraped fare and marked `estimate: true`.
 */
export function merged(providers: FareProvider[]): FareProvider {
  return {
    name: providers.map((p) => p.name).join(" + "),
    isDemo: providers.every((p) => p.isDemo),
    async getOneWayFares(origin, destination, from, to, cabin: Cabin = "economy") {
      const active = cabin === "business" ? providers.filter((p) => !isEstimateProvider(p)) : providers;
      if (active.length === 0) return [];

      const settled = await Promise.allSettled(
        active.map((p) => p.getOneWayFares(origin, destination, from, to, cabin)),
      );
      const byDate = new Map<string, DayFare>();
      let failures = 0;

      for (let i = 0; i < settled.length; i++) {
        const s = settled[i];
        const provider = active[i];
        if (s.status === "rejected") {
          failures++;
          console.error(s.reason);
          continue;
        }
        const isEst = isEstimateProvider(provider);
        for (const raw of s.value) {
          const f: DayFare = isEst || raw.source === "aviasales" ? { ...raw, estimate: true } : raw;
          const existing = byDate.get(f.date);
          if (!existing) {
            byDate.set(f.date, f);
          } else if (existing.estimate && !f.estimate) {
            byDate.set(f.date, f);
          }
        }
      }

      if (failures === active.length) throw new Error("All fare providers failed");
      return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    },
  };
}

// FARE_PROVIDER=demo forces simulated fares; otherwise use whatever real sources are configured.
export function getProvider(): FareProvider {
  if (process.env.FARE_PROVIDER === "demo") return demoProvider;
  const providers: FareProvider[] = [];
  if (dbConfigured()) providers.push(dbProvider);
  if (process.env.TRAVELPAYOUTS_TOKEN) providers.push(travelpayoutsProvider(process.env.TRAVELPAYOUTS_TOKEN));
  if (providers.length === 0) return demoProvider;
  return providers.length === 1 && !isEstimateProvider(providers[0]) ? providers[0] : merged(providers);
}

