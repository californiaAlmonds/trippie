import type { SearchParams } from "../search.ts";
import { addDays, monthBounds } from "../windows.ts";

export interface Leg {
  origin: string;
  destination: string;
  dates: string[];
}

/** One-way dates to scrape for a route: outbound across the month, return across month + gap spill. */
export function legsFor(p: SearchParams, today: string): Leg[] {
  const { first, last } = monthBounds(p.month);
  const range = (from: string, to: string) => {
    const dates: string[] = [];
    for (let d = from < today ? today : from; d <= to; d = addDays(d, 1)) dates.push(d);
    return dates;
  };
  return [
    { origin: p.origin, destination: p.destination, dates: range(first, last) },
    { origin: p.destination, destination: p.origin, dates: range(addDays(first, p.minGap), addDays(last, p.maxGap)) },
  ];
}
