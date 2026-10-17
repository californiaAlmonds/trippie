import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Airport {
  iata: string;
  icao: string | null;
  name: string;
  city: string;
  country: string;
  countryName: string;
  lat: number;
  lon: number;
  tz: string | null;
  size: "large" | "medium" | "small";
}

const OURAIRPORTS_AIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const OURAIRPORTS_COUNTRIES_URL = "https://davidmegginson.github.io/ourairports-data/countries.csv";
const OPENFLIGHTS_AIRPORTS_URL = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat";

/**
 * Hand-written CSV parser supporting RFC-4180 "" escapes as well as backslash \" escapes
 * (used by OpenFlights airports.dat).
 */
export function parseCsv(text: string, allowBackslashEscape = false): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (allowBackslashEscape && ch === "\\" && i + 1 < len) {
        field += text[i + 1];
        i++;
      } else if (ch === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\r") {
        if (i + 1 < len && text[i + 1] === "\n") {
          i++;
        }
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

const SIZE_MAP: Record<string, Airport["size"] | undefined> = {
  large_airport: "large",
  medium_airport: "medium",
  small_airport: "small",
};

const SIZE_RANK: Record<Airport["size"], number> = {
  large: 3,
  medium: 2,
  small: 1,
};

function roundCoord(n: number): number {
  return Math.round(n * 10000) / 10000;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function main() {
  console.log("Downloading OurAirports and OpenFlights datasets...");
  const [airportsCsv, countriesCsv, openFlightsDat] = await Promise.all([
    fetchText(OURAIRPORTS_AIRPORTS_URL),
    fetchText(OURAIRPORTS_COUNTRIES_URL),
    fetchText(OPENFLIGHTS_AIRPORTS_URL),
  ]);

  // 1. Parse countries.csv
  const countryRows = parseCsv(countriesCsv, false);
  const countryHeader = countryRows[0] ?? [];
  const cCodeIdx = countryHeader.indexOf("code");
  const cNameIdx = countryHeader.indexOf("name");
  if (cCodeIdx < 0 || cNameIdx < 0) {
    throw new Error("Unexpected countries.csv header");
  }

  const countryNames = new Map<string, string>();
  for (let i = 1; i < countryRows.length; i++) {
    const r = countryRows[i];
    if (!r) continue;
    const code = (r[cCodeIdx] ?? "").trim().toUpperCase();
    const name = (r[cNameIdx] ?? "").trim();
    if (code && name) {
      countryNames.set(code, name);
    }
  }

  // 2. Parse OpenFlights airports.dat for IANA tz (and fallback ICAO/city)
  const ofRows = parseCsv(openFlightsDat, true);
  const tzByIata = new Map<string, string>();
  const icaoByIata = new Map<string, string>();
  const cityByIata = new Map<string, string>();

  for (const r of ofRows) {
    if (r.length < 12) continue;
    const iata = (r[4] ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(iata)) continue;
    const icao = (r[5] ?? "").trim().toUpperCase();
    if (/^[A-Z]{4}$/.test(icao) && !icaoByIata.has(iata)) {
      icaoByIata.set(iata, icao);
    }
    const city = (r[2] ?? "").trim();
    if (city && city !== "\\N" && !cityByIata.has(iata)) {
      cityByIata.set(iata, city);
    }
    const tz = (r[11] ?? "").trim();
    if (tz && tz !== "\\N" && tz.includes("/") && !tzByIata.has(iata)) {
      tzByIata.set(iata, tz);
    }
  }

  // 3. Parse OurAirports airports.csv
  const airportRows = parseCsv(airportsCsv, false);
  const aHeader = airportRows[0] ?? [];
  const col = (name: string) => {
    const idx = aHeader.indexOf(name);
    if (idx < 0) throw new Error(`Missing column ${name} in airports.csv`);
    return idx;
  };

  const idIdx = col("id");
  const identIdx = col("ident");
  const typeIdx = col("type");
  const nameIdx = col("name");
  const latIdx = col("latitude_deg");
  const lonIdx = col("longitude_deg");
  const countryIdx = col("iso_country");
  const cityIdx = col("municipality");
  const schedIdx = col("scheduled_service");
  const iataIdx = col("iata_code");
  const icaoIdx = aHeader.indexOf("icao_code");
  const gpsIdx = aHeader.indexOf("gps_code");

  const byIata = new Map<string, { airport: Airport; idNum: number }>();

  for (let i = 1; i < airportRows.length; i++) {
    const r = airportRows[i];
    if (!r || r.length <= iataIdx) continue;

    const iata = (r[iataIdx] ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(iata)) continue;

    const scheduled = (r[schedIdx] ?? "").trim().toLowerCase();
    if (scheduled !== "yes") continue;

    const rawType = (r[typeIdx] ?? "").trim();
    const size = SIZE_MAP[rawType];
    if (!size) continue;

    const lat = Number(r[latIdx]);
    const lon = Number(r[lonIdx]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const country = (r[countryIdx] ?? "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) continue;

    const countryName = countryNames.get(country) ?? country;
    const name = (r[nameIdx] ?? "").trim();
    if (!name) continue;

    const rawCity = (r[cityIdx] ?? "").trim();
    const city = rawCity || cityByIata.get(iata) || name;

    const icaoCandidates = [
      icaoIdx >= 0 ? (r[icaoIdx] ?? "").trim().toUpperCase() : "",
      gpsIdx >= 0 ? (r[gpsIdx] ?? "").trim().toUpperCase() : "",
      (r[identIdx] ?? "").trim().toUpperCase(),
      icaoByIata.get(iata) ?? "",
    ];
    const icao = icaoCandidates.find((c) => /^[A-Z]{4}$/.test(c)) ?? null;

    const tz = tzByIata.get(iata) ?? null;
    const idNum = Number(r[idIdx]) || Number.MAX_SAFE_INTEGER;

    const candidate: Airport = {
      iata,
      icao,
      name,
      city,
      country,
      countryName,
      lat: roundCoord(lat),
      lon: roundCoord(lon),
      tz,
      size,
    };

    const existing = byIata.get(iata);
    if (!existing) {
      byIata.set(iata, { airport: candidate, idNum });
    } else {
      const rankDiff = SIZE_RANK[candidate.size] - SIZE_RANK[existing.airport.size];
      if (
        rankDiff > 0 ||
        (rankDiff === 0 && candidate.icao && !existing.airport.icao) ||
        (rankDiff === 0 && Boolean(candidate.icao) === Boolean(existing.airport.icao) && idNum < existing.idNum)
      ) {
        byIata.set(iata, { airport: candidate, idNum });
      }
    }
  }

  const sorted = [...byIata.values()]
    .map((v) => v.airport)
    .sort((a, b) => (a.iata < b.iata ? -1 : a.iata > b.iata ? 1 : 0));

  const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib/geo/airports.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(sorted)}\n`, "utf8");

  const bytes = statSync(outPath).size;
  console.log(`Wrote ${sorted.length} airports to src/lib/geo/airports.json (${bytes} bytes, ${(bytes / 1024).toFixed(1)} KB)`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/build-airports.ts")) {
  await main();
}

