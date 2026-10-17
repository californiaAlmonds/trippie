import type { TripMode } from "@/lib/search";
import type { Cabin } from "@/lib/types";
import AirportPicker from "./AirportPicker";
import { SpinnerIcon, SwapIcon } from "./icons";
import SegmentedControl from "./SegmentedControl";

interface SearchFormProps {
  trip: TripMode;
  cabin: Cabin;
  origin: string;
  destination: string;
  month: string;
  minGap: number;
  maxGap: number;
  loading: boolean;
  onTripChange: (trip: TripMode) => void;
  onCabinChange: (cabin: Cabin) => void;
  onOriginChange: (origin: string) => void;
  onDestinationChange: (destination: string) => void;
  onSwapAirports: () => void;
  onMonthChange: (month: string) => void;
  onMinGapChange: (minGap: number) => void;
  onMaxGapChange: (maxGap: number) => void;
  onSubmit: (e: React.FormEvent) => void;
}

const TRIP_OPTIONS = [
  { value: "round", label: "Round trip" },
  { value: "oneway", label: "One way" },
] as const;

const CABIN_OPTIONS = [
  { value: "economy", label: "Economy" },
  { value: "business", label: "Business" },
] as const;

const pillInputClass =
  "glass-field min-h-[44px] w-full rounded-2xl px-3.5 py-2 text-sm font-medium text-[var(--text-primary)]";

export default function SearchForm({
  trip,
  cabin,
  origin,
  destination,
  month,
  minGap,
  maxGap,
  loading,
  onTripChange,
  onCabinChange,
  onOriginChange,
  onDestinationChange,
  onSwapAirports,
  onMonthChange,
  onMinGapChange,
  onMaxGapChange,
  onSubmit,
}: SearchFormProps) {
  return (
    <section aria-label="Search flights" className="glass-strong p-4 sm:p-6">
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <div className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Trip
            </span>
            <SegmentedControl
              ariaLabel="Trip type"
              options={TRIP_OPTIONS}
              value={trip}
              onChange={onTripChange}
            />
          </div>

          <div className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Cabin
            </span>
            <SegmentedControl
              ariaLabel="Cabin class"
              options={CABIN_OPTIONS}
              value={cabin}
              onChange={onCabinChange}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
          <AirportPicker
            label="From"
            value={origin}
            onChange={onOriginChange}
          />

          <button
            type="button"
            onClick={onSwapAirports}
            aria-label="Swap origin and destination"
            title="Swap origin and destination"
            className="glass-field focus-ring inline-flex min-h-[44px] h-[44px] w-[44px] shrink-0 items-center justify-center justify-self-center sm:mt-[22px] rounded-2xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:scale-95 transition-transform cursor-pointer"
          >
            <SwapIcon className="h-4 w-4 rotate-90 sm:rotate-0" />
          </button>

          <AirportPicker
            label="To"
            value={destination}
            onChange={onDestinationChange}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
          <label className="grid w-full gap-1.5 text-xs font-medium text-[var(--text-secondary)] lg:w-48">
            <span className="tracking-wide">Month</span>
            <input
              type="month"
              className={pillInputClass}
              value={month}
              onChange={(e) => onMonthChange(e.target.value)}
              required
            />
          </label>

          {trip === "round" && (
            <div className="grid grid-cols-2 gap-2.5 sm:col-span-1 lg:w-48">
              <label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
                <span className="tracking-wide">Stay (days) min</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  className={`${pillInputClass} tabular-nums`}
                  value={minGap}
                  onChange={(e) => onMinGapChange(Number(e.target.value))}
                />
              </label>
              <label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
                <span className="tracking-wide">max</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  className={`${pillInputClass} tabular-nums`}
                  value={maxGap}
                  onChange={(e) => onMaxGapChange(Number(e.target.value))}
                />
              </label>
            </div>
          )}

          <div className="sm:col-span-2 lg:col-span-1 lg:ml-auto flex items-end">
            <button
              type="submit"
              disabled={loading}
              className="btn-accent focus-ring inline-flex min-h-[44px] w-full lg:w-auto items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold tracking-tight cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading && <SpinnerIcon className="h-4 w-4 animate-spin" />}
              <span>{loading ? "Searching…" : "Find best dates"}</span>
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
