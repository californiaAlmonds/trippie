import type { ReactNode } from "react";
import { EmptyRouteIllustration } from "./icons";

export function ResultsSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading search results"
      className="mt-6 grid gap-6 md:grid-cols-[1.12fr_0.88fr]"
    >
      <div className="glass p-5 sm:p-6">
        <div className="skeleton-shimmer h-4 w-36 rounded-md" />
        <div className="mt-4 grid gap-2.5">
          {Array.from({ length: 7 }, (_, i) => (
            <div
              key={i}
              className="skeleton-shimmer h-[56px] w-full rounded-2xl"
            />
          ))}
        </div>
      </div>

      <div className="grid gap-6 content-start">
        <div className="glass p-5 sm:p-6">
          <div className="skeleton-shimmer h-4 w-32 rounded-md" />
          <div className="skeleton-shimmer mt-4 h-32 w-full rounded-2xl" />
          <div className="skeleton-shimmer mt-4 h-10 w-full rounded-xl" />
          <div className="mt-4 grid gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div
                key={i}
                className="skeleton-shimmer h-10 w-full rounded-xl"
              />
            ))}
          </div>
        </div>

        <div className="glass p-5 sm:p-6">
          <div className="skeleton-shimmer h-4 w-28 rounded-md" />
          <div className="skeleton-shimmer mt-4 h-24 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="glass mt-6 flex flex-col items-center justify-center px-6 py-10 text-center">
      <EmptyRouteIllustration className="h-16 w-28 text-[var(--text-secondary)]" />
      <p className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
        {title}
      </p>
      {description && (
        <p className="mt-1 max-w-md text-xs text-[var(--text-secondary)]">
          {description}
        </p>
      )}
    </div>
  );
}

export default ResultsSkeleton;
