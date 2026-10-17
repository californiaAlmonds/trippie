export interface ParsedFare {
  price: number;
  airline: string | null;
  stops: number | null;
  depTime: string | null;
  arrTime: string | null;
  arrDayOffset: number | null;
  durationMin: number | null;
  flightNo: string | null;
  aircraft: string | null;
}

export type ParseOutcome =
  | { status: "ok"; fare: ParsedFare }
  | { status: "no_flights" | "blocked" | "parse_error" };

const TIME_ROW = /^\d{1,2}:\d{2}[\s\u00a0\u202f]*[AP]M\s*(\r?\n|$)/i;
const TIME_LINE = /^(\d{1,2}):(\d{2})[\s\u00a0\u202f]*([AP]M)(?:\+(\d+))?$/i;
const PRICE = /₹\s?([\d,]+)/;
// Lines between the departure time and the airline name: dash, arrival time, +1 marker.
const NOISE = /^([–-]|\d{1,2}:\d{2}[\s\u00a0\u202f]*[AP]M(\+\d+)?|\+\d+)$/i;
const DURATION_LINE = /^(?:(\d+)\s*hr(?:s)?\s*)?(?:(\d+)\s*min(?:s)?)?$/i;

const EXPANDED_LEG_LINE =
  /^(.*?)(?:Premium Economy|Business Class|First Class|Economy|Business|First)\s*(.*?)\s*([A-Z]{2}|[A-Z]\d|\d[A-Z])\s+(\d{1,4})$/;
const STANDALONE_AIRCRAFT =
  /^(Airbus\s+[A-Z0-9-]+(?:\s*neo)?|Boeing\s+[0-9A-Z -]+|ATR\s+[0-9A-Z -]+|Embraer\s+[0-9A-Z -]+|De Havilland\s+[0-9A-Z -]+|Bombardier\s+[0-9A-Z -]+)$/i;
const STANDALONE_FLIGHT_NO = /^([A-Z]{2}|[A-Z]\d|\d[A-Z])\s+(\d{1,4})$/;

export function isBlocked(url: string, bodyText: string): boolean {
  return /\/sorry\/|consent\.google/.test(url) || /unusual traffic|not a robot/i.test(bodyText);
}

/** Converts a 12-hour time line like "10:40 PM" or "6:50 AM+1" into 24h "HH:MM" and optional day offset. */
export function parseTime12h(raw: string): { time: string; dayOffset: number | null } | null {
  const m = TIME_LINE.exec(raw.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2];
  const mer = m[3].toUpperCase();
  if (mer === "AM") {
    if (h === 12) h = 0;
  } else if (h !== 12) {
    h += 12;
  }
  const offset = m[4] ? Number(m[4]) : null;
  return {
    time: `${String(h).padStart(2, "0")}:${min}`,
    dayOffset: offset && offset > 0 ? offset : null,
  };
}

/** Parses a duration line like "8 hr 10 min", "3 hr", or "45 min" into total minutes. */
export function parseDurationMin(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = DURATION_LINE.exec(trimmed);
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

function cleanAirline(raw: string | null): string | null {
  if (!raw) return null;
  const withoutOperated = raw.split(/operated by/i)[0].trim();
  const first = withoutOperated.split(",")[0].trim();
  return first || null;
}

/**
 * Extracts first leg's flight number (e.g. "6E 895") and aircraft (e.g. "Airbus A320neo")
 * from an expanded Google Flights row text.
 */
export function parseExpandedDetails(text: string): { flightNo: string | null; aircraft: string | null } {
  if (!text) return { flightNo: null, aircraft: null };
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[\u00a0\u202f]/g, " ").replace(/\s*Operated by.*$/i, "").trim());
  for (const line of lines) {
    if (!line) continue;
    const m = EXPANDED_LEG_LINE.exec(line);
    if (m) {
      const aircraft = m[2].trim() || null;
      const flightNo = `${m[3]} ${m[4]}`;
      return { flightNo, aircraft };
    }
  }

  let fallbackAircraft: string | null = null;
  let fallbackFlightNo: string | null = null;
  for (const line of lines) {
    if (!fallbackAircraft && STANDALONE_AIRCRAFT.test(line)) {
      fallbackAircraft = line;
    }
    if (!fallbackFlightNo) {
      const fm = STANDALONE_FLIGHT_NO.exec(line);
      if (fm) fallbackFlightNo = `${fm[1]} ${fm[2]}`;
    }
    if (fallbackAircraft && fallbackFlightNo) break;
  }
  return { flightNo: fallbackFlightNo, aircraft: fallbackAircraft };
}

/** Returns the index in `rows` of the cheapest valid flight row, or -1 if none. */
export function findCheapestRowIndex(rows: string[]): number {
  let bestIdx = -1;
  let bestPrice = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!TIME_ROW.test(row)) continue;
    const m = PRICE.exec(row);
    if (!m) continue;
    const price = Number(m[1].replaceAll(",", ""));
    if (price < bestPrice) {
      bestPrice = price;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * rows: innerText of each flight list item; body: full page text; expandedRow: optional innerText of the expanded cheapest row.
 * Takes the cheapest row, and the "Cheapest from" tab as a lower bound when it undercuts the visible rows.
 */
export function parseResults(url: string, body: string, rows: string[], expandedRow?: string): ParseOutcome {
  if (isBlocked(url, body)) return { status: "blocked" };

  let best: ParsedFare | null = null;
  let bestRowText: string | null = null;

  for (const row of rows) {
    if (!TIME_ROW.test(row)) continue;
    const m = PRICE.exec(row);
    if (!m) continue;
    const price = Number(m[1].replaceAll(",", ""));
    if (best && price >= best.price) continue;

    const lines = row
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const dep = lines[0] ? parseTime12h(lines[0]) : null;
    let arr: { time: string; dayOffset: number | null } | null = null;
    for (let i = 1; i < Math.min(lines.length, 5); i++) {
      const parsed = parseTime12h(lines[i]);
      if (parsed) {
        let dayOffset = parsed.dayOffset;
        if (dayOffset === null && lines[i + 1] && /^\+(\d+)$/.test(lines[i + 1])) {
          dayOffset = Number(lines[i + 1].slice(1));
        }
        arr = { time: parsed.time, dayOffset };
        break;
      }
    }

    const rawAirline = lines.slice(1).find((l) => !NOISE.test(l)) ?? null;
    let durationMin: number | null = null;
    for (const l of lines.slice(2)) {
      const d = parseDurationMin(l);
      if (d !== null) {
        durationMin = d;
        break;
      }
    }

    const stops = /nonstop/i.test(row) ? 0 : Number(/(\d+) stops?/i.exec(row)?.[1] ?? NaN);
    best = {
      price,
      airline: cleanAirline(rawAirline),
      stops: Number.isNaN(stops) ? null : stops,
      depTime: dep?.time ?? null,
      arrTime: arr?.time ?? null,
      arrDayOffset: arr?.dayOffset ?? null,
      durationMin,
      flightNo: null,
      aircraft: null,
    };
    bestRowText = row;
  }

  if (best) {
    const details = parseExpandedDetails(expandedRow ?? bestRowText ?? "");
    best.flightNo = details.flightNo;
    best.aircraft = details.aircraft;
  }

  const tab = /Cheapest\s+from\s+₹\s?([\d,]+)/i.exec(body);
  const tabPrice = tab ? Number(tab[1].replaceAll(",", "")) : null;
  if (tabPrice !== null && (!best || tabPrice < best.price)) {
    best = {
      price: tabPrice,
      airline: null,
      stops: null,
      depTime: null,
      arrTime: null,
      arrDayOffset: null,
      durationMin: null,
      flightNo: null,
      aircraft: null,
    };
  }

  if (best) return { status: "ok", fare: best };
  if (/no (flights|options)|couldn.t find/i.test(body)) return { status: "no_flights" };
  return { status: "parse_error" };
}

