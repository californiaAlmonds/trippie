interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  ariaLabel: string;
  options: readonly [SegmentedOption<T>, SegmentedOption<T>];
  value: T;
  onChange: (next: T) => void;
}

export default function SegmentedControl<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const activeIndex = options[1].value === value ? 1 : 0;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="glass-field relative inline-grid grid-cols-2 items-center rounded-2xl p-1 min-h-[44px]"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl bg-[var(--accent)] shadow-sm transition-transform duration-200 ease-out"
        style={{
          transform: activeIndex === 1 ? "translateX(100%)" : "translateX(0%)",
        }}
      />
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`focus-ring relative z-10 rounded-xl px-4 py-1.5 text-xs sm:text-sm font-semibold transition-colors duration-150 cursor-pointer select-none ${
              active
                ? "text-white"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
