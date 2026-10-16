import type { FareProvider } from "../types.ts";
import { getLatestFares } from "../store.ts";

// Fares captured by scripts/scrape.ts from Google Flights (which aggregates the Indian booking sites).
export const dbProvider: FareProvider = {
  name: "Google Flights (scraped)",
  isDemo: false,
  getOneWayFares: getLatestFares,
};
