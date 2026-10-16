import type { ReactNode } from "react";

export const glassFieldClass =
  "glass-field min-h-[44px] w-full rounded-xl px-3.5 py-2 text-sm font-medium text-[var(--text-primary)]";

interface FieldProps {
  label: ReactNode;
  className?: string;
  children: ReactNode;
}

export default function Field({ label, className = "", children }: FieldProps) {
  return (
    <label className={`grid gap-1.5 text-xs font-medium text-[var(--text-secondary)] ${className}`.trim()}>
      <span className="tracking-wide">{label}</span>
      {children}
    </label>
  );
}
