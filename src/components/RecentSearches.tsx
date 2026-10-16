import type { Query } from "./format";
import { ClockIcon } from "./ui/Icons";

interface RecentSearchesProps {
  recent: Query[];
  onSelect: (q: Query) => void;
}

export default function RecentSearches({ recent, onSelect }: RecentSearchesProps) {
  if (recent.length === 0) return null;

  return (
    <div
      aria-label="Recent searches"
      className="mt-3.5 flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar"
    >
      <span className="shrink-0 text-xs font-medium text-[var(--text-muted)]">
        Recent:
      </span>
      <div className="flex items-center gap-2">
        {recent.map((q) => (
          <button
            key={JSON.stringify(q)}
            type="button"
            onClick={() => onSelect(q)}
            className="glass-subtle-interactive focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <ClockIcon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <span>
              {q.origin}→{q.destination} {q.month} ·{" "}
              {q.trip === "oneway"
                ? "one way"
                : `${q.minGap === q.maxGap ? q.minGap : `${q.minGap}-${q.maxGap}`}d`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
