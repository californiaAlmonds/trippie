import { useEffect, useId, useState } from "react";
import type { TripWindow } from "@/lib/types";
import { inr } from "./format";
import GlassCard from "./ui/GlassCard";

interface Point {
  day: string;
  total: number;
}

interface PriceHistoryProps {
  window: TripWindow;
  origin: string;
  destination: string;
}

export default function PriceHistory({
  window: w,
  origin,
  destination,
}: PriceHistoryProps) {
  const [points, setPoints] = useState<Point[] | null>(null);
  const gradId = useId();

  useEffect(() => {
    const qs = new URLSearchParams({
      origin,
      destination,
      month: w.depart.date.slice(0, 7),
      minGap: String(w.gap),
      maxGap: String(w.gap),
      depart: w.depart.date,
      return: w.ret.date,
    });
    let stale = false;
    fetch(`/api/history?${qs}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((p: Point[]) => !stale && setPoints(p))
      .catch(() => !stale && setPoints([]));
    return () => {
      stale = true;
    };
  }, [w, origin, destination]);

  if (!points) return null;

  const W = 320;
  const H = 80;
  const padX = 6;
  const padY = 8;

  const totals = points.map((p) => p.total);
  const lo = points.length > 0 ? Math.min(...totals) : 0;
  const hi = points.length > 0 ? Math.max(...totals) : 0;

  const x = (i: number) =>
    points.length <= 1
      ? W / 2
      : padX + (i / (points.length - 1)) * (W - padX * 2);

  const y = (t: number) =>
    hi === lo
      ? H / 2
      : H - padY - ((t - lo) / (hi - lo)) * (H - padY * 2);

  const lineCoords = points.map((p, i) => `${x(i)},${y(p.total)}`).join(" ");
  const areaPath =
    points.length >= 2
      ? `M ${x(0)},${H - 2} L ${points
          .map((p, i) => `${x(i)},${y(p.total)}`)
          .join(" L ")} L ${x(points.length - 1)},${H - 2} Z`
      : "";

  const lastIndex = points.length - 1;

  return (
    <GlassCard as="section" className="p-5 sm:p-6 grid gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Price history
        </h2>
        {points.length >= 2 && (
          <span className="text-[11px] font-medium tabular-nums text-[var(--text-muted)]">
            {points.length} snapshots
          </span>
        )}
      </div>

      {points.length < 2 ? (
        <p className="glass-subtle rounded-xl px-3.5 py-2.5 text-xs text-[var(--text-muted)]">
          {points.length === 0 ? "No snapshots yet." : "1 snapshot so far."}{" "}
          History builds up with each daily scrape.
        </p>
      ) : (
        <>
          <div className="glass-subtle rounded-2xl p-3">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="w-full h-20 overflow-visible"
              role="img"
              aria-label="Round trip price over time"
            >
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <path d={areaPath} fill={`url(#${gradId})`} />
              <polyline
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={lineCoords}
              />
              <circle
                cx={x(lastIndex)}
                cy={y(points[lastIndex].total)}
                r="3.5"
                fill="var(--accent)"
              />
            </svg>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)] tabular-nums">
            <span>
              {points[0].day} to {points[lastIndex].day}
            </span>
            <span>
              low <strong className="font-semibold text-[var(--text-primary)]">{inr.format(lo)}</strong>, high{" "}
              <strong className="font-semibold text-[var(--text-primary)]">{inr.format(hi)}</strong>
            </span>
          </div>
        </>
      )}
    </GlassCard>
  );
}
