import type { DayFare, IsoDate, TripWindow } from "./types.ts";

const DAY_MS = 86_400_000;

const toUtc = (d: IsoDate) => Date.parse(`${d}T00:00:00Z`);

export const addDays = (d: IsoDate, n: number): IsoDate =>
  new Date(toUtc(d) + n * DAY_MS).toISOString().slice(0, 10);

export const diffDays = (a: IsoDate, b: IsoDate): number => Math.round((toUtc(b) - toUtc(a)) / DAY_MS);

export const monthBounds = (month: string): { first: IsoDate; last: IsoDate } => {
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { first, last };
};

/**
 * Indian domestic round trips are priced as two one-ways, so every window is
 * outbound(date) + inbound(date + gap); no extra API calls per window are needed.
 */
export function computeWindows(
  outbound: DayFare[],
  inbound: DayFare[],
  minGap: number,
  maxGap: number,
): TripWindow[] {
  const inByDate = new Map(inbound.map((f) => [f.date, f]));
  const windows: TripWindow[] = [];
  for (const depart of outbound) {
    for (let gap = minGap; gap <= maxGap; gap++) {
      const ret = inByDate.get(addDays(depart.date, gap));
      if (ret) windows.push({ depart, ret, gap, total: depart.price + ret.price });
    }
  }
  return windows.sort((a, b) => a.total - b.total || a.gap - b.gap || (a.depart.date < b.depart.date ? -1 : 1));
}
