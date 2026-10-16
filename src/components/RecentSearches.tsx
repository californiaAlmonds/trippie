import { ClockIcon } from "./icons";
import type { Query } from "./recentStore";

interface RecentSearchesProps {
  recent: Query[];
  onSelect: (q: Query) => void;
  onClear?: () => void;
}

export default function RecentSearches({
  recent,
  onSelect,
  onClear,
}: RecentSearchesProps) {
  if (recent.length === 0) return null;

  return (
    <div
      aria-label="Recent searches"
      className="mt-3.5 flex flex-wrap items-center gap-2"
    >
      <span className="shrink-0 text-xs font-medium text-[var(--text-muted)]">
        Recent:
      </span>
      {recent.map((q) => (
        <button
          key={JSON.stringify(q)}
          type="button"
          onClick={() => onSelect(q)}
          className="glass-subtle-interactive focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <ClockIcon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          <span>
            {q.origin}→{q.destination} {q.month}{" "}
            {q.trip === "oneway"
              ? "(one way)"
              : `(${q.minGap === q.maxGap ? q.minGap : `${q.minGap}-${q.maxGap}`}d)`}
          </span>
        </button>
      ))}
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="focus-ring rounded-full px-2.5 py-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          Clear
        </button>
      )}
    </div>
  );
}

