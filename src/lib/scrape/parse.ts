export interface ParsedFare {
  price: number;
  airline: string | null;
  stops: number | null;
}

export type ParseOutcome =
  | { status: "ok"; fare: ParsedFare }
  | { status: "no_flights" | "blocked" | "parse_error" };

const TIME_ROW = /^\d{1,2}:\d{2}\s?[AP]M/;
const PRICE = /₹\s?([\d,]+)/;
// Lines between the departure time and the airline name: dash, arrival time, +1 marker.
const NOISE = /^([–-]|\d{1,2}:\d{2}\s?[AP]M(\+\d)?|\+\d+)$/;

export function isBlocked(url: string, bodyText: string): boolean {
  return /\/sorry\/|consent\.google/.test(url) || /unusual traffic|not a robot/i.test(bodyText);
}

/**
 * rows: innerText of each flight list item; body: full page text.
 * Takes the cheapest row, and the "Cheapest from" tab as a lower bound when it undercuts the visible rows.
 */
export function parseResults(url: string, body: string, rows: string[]): ParseOutcome {
  if (isBlocked(url, body)) return { status: "blocked" };

  let best: ParsedFare | null = null;
  for (const row of rows) {
    if (!TIME_ROW.test(row)) continue;
    const m = PRICE.exec(row);
    if (!m) continue;
    const price = Number(m[1].replaceAll(",", ""));
    if (best && price >= best.price) continue;
    const lines = row.split("\n").map((l) => l.trim()).filter(Boolean);
    const stops = /nonstop/i.test(row) ? 0 : Number(/(\d+) stops?/i.exec(row)?.[1] ?? NaN);
    best = { price, airline: lines.slice(1).find((l) => !NOISE.test(l)) ?? null, stops: Number.isNaN(stops) ? null : stops };
  }

  const tab = /Cheapest\s+from\s+₹\s?([\d,]+)/i.exec(body);
  const tabPrice = tab ? Number(tab[1].replaceAll(",", "")) : null;
  if (tabPrice !== null && (!best || tabPrice < best.price)) best = { price: tabPrice, airline: null, stops: null };

  if (best) return { status: "ok", fare: best };
  if (/no (flights|options)|couldn.t find/i.test(body)) return { status: "no_flights" };
  return { status: "parse_error" };
}
