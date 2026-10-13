import type { DayFare, FareProvider } from "../types.ts";
import { addDays, diffDays } from "../windows.ts";

const SOURCES = ["makemytrip", "ixigo", "google", "cleartrip", "kayak"];

// Deterministic pseudo-prices so the UI works without any API key.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

export const demoProvider: FareProvider = {
  name: "Demo data (not real fares)",
  isDemo: true,
  async getOneWayFares(origin, destination, from, to) {
    const fares: DayFare[] = [];
    for (let i = 0; i <= diffDays(from, to); i++) {
      const date = addDays(from, i);
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      const weekend = dow === 5 || dow === 0 ? 1.25 : 1;
      const noise = 0.75 + hash(`${origin}${destination}${date}`) * 0.7;
      fares.push({
        date,
        price: Math.round((5200 * weekend * noise) / 10) * 10,
        source: SOURCES[Math.floor(hash(`s${origin}${date}`) * SOURCES.length)],
        stops: 0,
      });
    }
    return fares;
  },
};
