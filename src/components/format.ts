import type { Site } from "@/lib/links";
import type { Cabin, DayFare, IsoDate } from "@/lib/types";

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

export function formatDuration(durationMin?: number): string | null {
  if (typeof durationMin !== "number" || !Number.isFinite(durationMin) || durationMin <= 0) {
    return null;
  }
  const total = Math.round(durationMin);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function formatStops(stops?: number): string | null {
  if (typeof stops !== "number" || !Number.isFinite(stops) || stops < 0) {
    return null;
  }
  if (stops === 0) return "Nonstop";
  if (stops === 1) return "1 stop";
  return `${stops} stops`;
}

export function formatFlightTimes(leg: Pick<DayFare, "depTime" | "arrTime" | "arrDayOffset">): string | null {
  if (!leg.depTime && !leg.arrTime) return null;
  if (leg.depTime && leg.arrTime) {
    const offset =
      typeof leg.arrDayOffset === "number" && leg.arrDayOffset > 0
        ? `+${leg.arrDayOffset}`
        : "";
    return `${leg.depTime}→${leg.arrTime}${offset}`;
  }
  return leg.depTime ?? leg.arrTime ?? null;
}

export function formatRelativeChecked(iso?: string | null, nowMs = Date.now()): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const diffSec = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (diffSec < 60) return "Checked just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Checked ${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 48) return `Checked ${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `Checked ${diffDays}d ago`;
}

export const ESTIMATE_TOOLTIP =
  "Cached price from a third-party source; may be outdated";

export function buildBookingUrl(
  site: Site,
  origin: string,
  destination: string,
  departDate: IsoDate,
  returnDate?: IsoDate,
  opts?: { currency?: string; cabin?: Cabin },
): string {
  return site.url(origin, destination, departDate, returnDate, opts);
}

