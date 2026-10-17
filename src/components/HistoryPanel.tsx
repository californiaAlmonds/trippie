"use client";

import { useEffect, useId, useState } from "react";
import type { Cabin, TripWindow } from "@/lib/types";
import { useCurrency } from "./currency/CurrencyProvider";
import { SparklineEmptyIcon } from "./icons";

interface Point {
  day: string;
  total: number;
}

interface HistoryPanelProps {
  window: TripWindow;
  origin: string;
  destination: string;
  cabin?: Cabin;
}

function buildSmoothPaths(coords: { x: number; y: number }[], bottomY: number) {
  if (coords.length === 0) return { line: "", area: "" };
  if (coords.length === 1) {
    const p = coords[0];
    return { line: `M ${p.x},${p.y}`, area: "" };
  }

  let d = `M ${coords[0].x},${coords[0].y}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const curr = coords[i];
    const next = coords[i + 1];
    const midX = (curr.x + next.x) / 2;
    d += ` C ${midX},${curr.y} ${midX},${next.y} ${next.x},${next.y}`;
  }

  const first = coords[0];
  const last = coords[coords.length - 1];
  const area = `${d} L ${last.x},${bottomY} L ${first.x},${bottomY} Z`;
  return { line: d, area };
}

export default function HistoryPanel({
  window: w,
  origin,
  destination,
  cabin = "economy",
}: HistoryPanelProps) {
  const { format } = useCurrency();
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
      cabin,
    });
    let stale = false;
    fetch(`/api/history?${qs}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((p: Point[]) => !stale && setPoints(p))
      .catch(() => !stale && setPoints([]));
    return () => {
      stale = true;
    };
  }, [w, origin, destination, cabin]);

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

  const coords = points.map((p, i) => ({ x: x(i), y: y(p.total) }));
  const { line, area } = buildSmoothPaths(coords, H - 2);
  const lastIndex = points.length - 1;

  return (
    <section className="glass p-5 sm:p-6 grid gap-2.5">
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
        <div className="glass-subtle flex items-center gap-3 rounded-2xl px-3.5 py-3 text-xs text-[var(--text-muted)]">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-500/10 text-[var(--accent)]">
            <SparklineEmptyIcon className="h-4 w-4" />
          </span>
          <p>
            {points.length === 0 ? "No snapshots yet." : "1 snapshot so far."}{" "}
            History builds up with each daily scrape.
          </p>
        </div>
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
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.34" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <path d={area} fill={`url(#${gradId})`} />
              <path
                d={line}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle
                cx={coords[lastIndex].x}
                cy={coords[lastIndex].y}
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
              low{" "}
              <strong className="font-semibold text-[var(--text-primary)]">
                {format(lo)}
              </strong>
              , high{" "}
              <strong className="font-semibold text-[var(--text-primary)]">
                {format(hi)}
              </strong>
            </span>
          </div>
        </>
      )}
    </section>
  );
}
