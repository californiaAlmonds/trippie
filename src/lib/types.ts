export type IsoDate = string; // YYYY-MM-DD

export interface DayFare {
  date: IsoDate;
  price: number; // INR, one-way, per adult
  source: string; // site/gate that reported the fare, lowercase key (see links.ts)
  airline?: string;
  stops?: number;
}

export interface FareProvider {
  name: string;
  isDemo: boolean;
  /** Cheapest one-way fare per day in [from, to], INR. Days with no data are omitted. */
  getOneWayFares(origin: string, destination: string, from: IsoDate, to: IsoDate): Promise<DayFare[]>;
}

export interface TripWindow {
  depart: DayFare;
  ret: DayFare;
  gap: number; // days between departure and return
  total: number;
}
