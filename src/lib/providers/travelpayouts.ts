import type { DayFare, FareProvider } from "../types.ts";

interface GroupedPrice {
  price: number;
  airline?: string;
  transfers?: number;
  departure_at: string;
}

// Cached user-search prices (~48h old); India/INR coverage for niche routes is unverified.
export function travelpayoutsProvider(token: string, fetchFn: typeof fetch = fetch): FareProvider {
  return {
    name: "Travelpayouts (Aviasales cache)",
    isDemo: false,
    async getOneWayFares(origin, destination, from, to, cabin = "economy") {
      if (cabin !== "economy") return [];
      const months = new Set<string>();
      for (const d of [from, to]) months.add(d.slice(0, 7));
      const byDate = new Map<string, DayFare>();
      for (const month of months) {
        const url = new URL("https://api.travelpayouts.com/aviasales/v3/grouped_prices");
        url.search = new URLSearchParams({
          origin,
          destination,
          group_by: "departure_at",
          departure_at: month,
          currency: "inr",
          market: "in",
        }).toString();
        const res = await fetchFn(url, {
          headers: { "X-Access-Token": token, "Accept-Encoding": "gzip, deflate" },
          signal: AbortSignal.timeout(15_000),
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Travelpayouts responded ${res.status}`);
        const body = (await res.json()) as { success: boolean; data?: Record<string, GroupedPrice> };
        if (!body.success) throw new Error("Travelpayouts request failed");
        for (const [date, f] of Object.entries(body.data ?? {})) {
          if (date < from || date > to) continue;
          byDate.set(date, {
            date,
            price: f.price,
            source: "aviasales",
            airline: f.airline,
            stops: f.transfers,
            estimate: true,
          });
        }
      }
      return [...byDate.values()];
    },
  };
}

