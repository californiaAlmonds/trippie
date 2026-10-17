export type IsoDate = string; // YYYY-MM-DD

export type Cabin = "economy" | "business";

export interface DayFare {
  date: IsoDate;
  price: number; // INR, one-way, per adult
  source: string; // site/gate that reported the fare, lowercase key (see links.ts)
  airline?: string;
  stops?: number;
  depTime?: string; // "HH:MM", local time at origin
  arrTime?: string; // "HH:MM", local time at destination
  arrDayOffset?: number; // 1 when arriving the next day
  durationMin?: number;
  flightNo?: string; // e.g. "6E 5312"
  aircraft?: string; // e.g. "Airbus A320neo"
  checkedAt?: string; // ISO time the price was captured
  estimate?: boolean; // true for cached third-party prices (not a live scrape)
}

export interface FareProvider {
  name: string;
  isDemo: boolean;
  /** Cheapest one-way fare per day in [from, to], INR. Days with no data are omitted. */
  getOneWayFares(origin: string, destination: string, from: IsoDate, to: IsoDate, cabin?: Cabin): Promise<DayFare[]>;
}

export interface TripWindow {
  depart: DayFare;
  ret: DayFare;
  gap: number; // days between departure and return
  total: number;
}

export interface PriceStats {
  min: number;
  max: number;
  p25: number;
  median: number;
  samples: number;
  since: IsoDate; // first snapshot_day, YYYY-MM-DD
}

export interface RouteFreshness {
  lastCheckedAt: string | null;
  tracked: boolean;
  collecting: boolean;
}

