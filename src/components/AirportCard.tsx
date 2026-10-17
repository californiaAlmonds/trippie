"use client";

import { useEffect, useState } from "react";
import { AIRPORTS } from "@/lib/airports";

export interface Airport {
  iata: string;
  icao: string | null;
  name: string;
  city: string;
  country: string; // ISO2
  countryName: string;
  lat: number;
  lon: number;
  tz: string | null;
  size: "large" | "medium" | "small";
}

const FALLBACK_INDIAN_META: Record<
  string,
  { icao: string; name: string; lat: number; lon: number; size: Airport["size"] }
> = {
  BLR: { icao: "VOBL", name: "Kempegowda International Airport", lat: 13.1986, lon: 77.7066, size: "large" },
  IXZ: { icao: "VOPB", name: "Veer Savarkar International Airport", lat: 11.6412, lon: 92.7297, size: "medium" },
  DEL: { icao: "VIDP", name: "Indira Gandhi International Airport", lat: 28.5562, lon: 77.1, size: "large" },
  BOM: { icao: "VABB", name: "Chhatrapati Shivaji Maharaj International Airport", lat: 19.0896, lon: 72.8656, size: "large" },
  MAA: { icao: "VOMM", name: "Chennai International Airport", lat: 12.9941, lon: 80.1709, size: "large" },
  HYD: { icao: "VOHS", name: "Rajiv Gandhi International Airport", lat: 17.2403, lon: 78.4294, size: "large" },
  CCU: { icao: "VECC", name: "Netaji Subhas Chandra Bose International Airport", lat: 22.6547, lon: 88.4467, size: "large" },
  COK: { icao: "VOCI", name: "Cochin International Airport", lat: 10.152, lon: 76.4019, size: "large" },
  GOI: { icao: "VOGO", name: "Goa Dabolim International Airport", lat: 15.3808, lon: 73.8314, size: "medium" },
  PNQ: { icao: "VAPO", name: "Pune Airport", lat: 18.5821, lon: 73.9197, size: "medium" },
  AMD: { icao: "VAAH", name: "Sardar Vallabhbhai Patel International Airport", lat: 23.0772, lon: 72.6347, size: "large" },
  JAI: { icao: "VIJP", name: "Jaipur International Airport", lat: 26.8242, lon: 75.8122, size: "medium" },
  IXL: { icao: "VILH", name: "Kushok Bakula Rimpochee Airport", lat: 34.1359, lon: 77.5465, size: "small" },
  SXR: { icao: "VISR", name: "Sheikh ul-Alam International Airport", lat: 33.9871, lon: 74.7742, size: "medium" },
};

export const FALLBACK_AIRPORTS: Airport[] = AIRPORTS.map((a) => {
  const meta = FALLBACK_INDIAN_META[a.code];
  return {
    iata: a.code,
    icao: meta?.icao ?? null,
    name: meta?.name ?? `${a.name} Airport`,
    city: a.name,
    country: "IN",
    countryName: "India",
    lat: meta?.lat ?? 20.5937,
    lon: meta?.lon ?? 78.9629,
    tz: "Asia/Kolkata",
    size: meta?.size ?? "medium",
  };
});

export function getFallbackAirport(code: string): Airport {
  const upper = code.trim().toUpperCase();
  const found = FALLBACK_AIRPORTS.find((a) => a.iata === upper);
  if (found) return found;
  return {
    iata: upper,
    icao: null,
    name: `${upper} Airport`,
    city: upper,
    country: "",
    countryName: "",
    lat: 0,
    lon: 0,
    tz: null,
    size: "medium",
  };
}

export function countryToFlagEmoji(iso2: string): string {
  const clean = iso2.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(clean)) return "🌐";
  return String.fromCodePoint(
    127397 + clean.charCodeAt(0),
    127397 + clean.charCodeAt(1),
  );
}

export function formatLocalTimeNow(tz: string | null, now = new Date()): string | null {
  if (!tz) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(now);
  } catch {
    return null;
  }
}

const SIZE_LABELS: Record<Airport["size"], string> = {
  large: "Major hub",
  medium: "Medium",
  small: "Regional",
};

export default function AirportCard({ airport }: { airport: Airport }) {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    if (!airport.tz) return;
    const id = window.setInterval(() => {
      setNow(new Date());
    }, 60_000);
    return () => window.clearInterval(id);
  }, [airport.tz]);

  const localTime = formatLocalTimeNow(airport.tz, now);
  const flag = airport.country ? countryToFlagEmoji(airport.country) : "✈️";
  const sizeLabel = SIZE_LABELS[airport.size] ?? airport.size;

  return (
    <div
      aria-label={`Selected airport ${airport.city} (${airport.iata})`}
      className="glass-subtle rounded-2xl px-3 py-2 text-xs text-[var(--text-secondary)] grid gap-1"
    >
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="font-semibold text-[var(--text-primary)] truncate" title={airport.name}>
          <span aria-hidden="true" className="mr-1.5">
            {flag}
          </span>
          {airport.name}
        </span>
        <span className="inline-flex shrink-0 items-center rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {sizeLabel}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] text-[var(--text-muted)]">
        <span className="truncate">
          {airport.city}
          {airport.countryName ? `, ${airport.countryName}` : airport.country ? `, ${airport.country}` : ""}
          {" · "}
          <strong className="font-semibold text-[var(--text-secondary)] tabular-nums">
            {airport.iata}
            {airport.icao ? ` / ${airport.icao}` : ""}
          </strong>
        </span>
        {localTime && (
          <span className="shrink-0 tabular-nums" title={airport.tz ?? undefined}>
            Local {localTime}
          </span>
        )}
      </div>
    </div>
  );
}
