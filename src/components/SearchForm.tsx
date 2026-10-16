import { AIRPORTS } from "@/lib/airports";
import type { TripMode } from "@/lib/search";
import Button from "./ui/Button";
import Field, { glassFieldClass } from "./ui/Field";
import GlassCard from "./ui/GlassCard";
import { SwapIcon } from "./ui/Icons";
import Segmented from "./ui/Segmented";

interface SearchFormProps {
  trip: TripMode;
  origin: string;
  destination: string;
  month: string;
  minGap: number;
  maxGap: number;
  loading: boolean;
  onTripChange: (trip: TripMode) => void;
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

export default function SearchForm({
  trip,
  origin,
  destination,
  month,
  minGap,
  maxGap,
  loading,
  onTripChange,
  onOriginChange,
  onDestinationChange,
  onSwapAirports,
  onMonthChange,
  onMinGapChange,
  onMaxGapChange,
  onSubmit,
}: SearchFormProps) {
  return (
    <GlassCard className="p-4 sm:p-6">
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Trip type
            </span>
            <Segmented
              ariaLabel="Trip type"
              options={TRIP_OPTIONS}
              value={trip}
              onChange={onTripChange}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 sm:col-span-2 lg:flex-1 lg:min-w-[320px]">
            <Field label="From">
              <select
                className={glassFieldClass}
                value={origin}
                onChange={(e) => onOriginChange(e.target.value)}
              >
                {AIRPORTS.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.name} ({a.code})
                  </option>
                ))}
              </select>
            </Field>

            <button
              type="button"
              onClick={onSwapAirports}
              aria-label="Swap origin and destination"
              title="Swap origin and destination"
              className="glass-field focus-ring inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:scale-95 transition-transform cursor-pointer"
            >
              <SwapIcon className="h-4 w-4 sm:rotate-90" />
            </button>

            <Field label="To">
              <select
                className={glassFieldClass}
                value={destination}
                onChange={(e) => onDestinationChange(e.target.value)}
              >
                {AIRPORTS.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.name} ({a.code})
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Month" className="lg:w-44">
            <input
              type="month"
              className={glassFieldClass}
              value={month}
              onChange={(e) => onMonthChange(e.target.value)}
              required
            />
          </Field>

          {trip === "round" && (
            <div className="grid grid-cols-2 gap-2.5 sm:col-span-1 lg:w-44">
              <Field label="Stay (days) min">
                <input
                  type="number"
                  min={1}
                  max={30}
                  className={`${glassFieldClass} tabular-nums`}
                  value={minGap}
                  onChange={(e) => onMinGapChange(Number(e.target.value))}
                />
              </Field>
              <Field label="max">
                <input
                  type="number"
                  min={1}
                  max={30}
                  className={`${glassFieldClass} tabular-nums`}
                  value={maxGap}
                  onChange={(e) => onMaxGapChange(Number(e.target.value))}
                />
              </Field>
            </div>
          )}

          <div className="sm:col-span-2 lg:col-span-1 lg:ml-auto flex items-end">
            <Button type="submit" loading={loading} className="w-full lg:w-auto">
              Find best dates
            </Button>
          </div>
        </div>
      </form>
    </GlassCard>
  );
}
