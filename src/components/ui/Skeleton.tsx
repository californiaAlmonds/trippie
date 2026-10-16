import GlassCard from "./GlassCard";

export default function ResultsSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading search results"
      className="mt-6 grid gap-6 md:grid-cols-[1.12fr_0.88fr]"
    >
      <GlassCard className="p-5 sm:p-6">
        <div className="skeleton-shimmer h-4 w-36 rounded-md" />
        <div className="mt-4 grid gap-2.5">
          {Array.from({ length: 7 }, (_, i) => (
            <div
              key={i}
              className="skeleton-shimmer h-[54px] w-full rounded-2xl"
            />
          ))}
        </div>
      </GlassCard>

      <div className="grid gap-6 content-start">
        <GlassCard className="p-5 sm:p-6">
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
        </GlassCard>

        <GlassCard className="p-5 sm:p-6">
          <div className="skeleton-shimmer h-4 w-28 rounded-md" />
          <div className="skeleton-shimmer mt-4 h-24 w-full rounded-2xl" />
        </GlassCard>
      </div>
    </div>
  );
}
