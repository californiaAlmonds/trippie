export {
  type Query,
  parseRecent,
  pushRecent,
  readRecent,
  serverSnapshotRecent,
  subscribeRecent,
} from "./recentStore";

export const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export function formatDeltaFromBest(price: number, best: number): {
  pct: number;
  tone: "green" | "amber" | "red";
  label: string;
} {
  if (best <= 0 || price <= best) {
    return { pct: 0, tone: "green", label: "0%" };
  }
  const pct = Math.max(1, Math.round(((price - best) / best) * 100));
  const tone = pct <= 8 ? "green" : pct <= 20 ? "amber" : "red";
  return { pct, tone, label: `+${pct}%` };
}
