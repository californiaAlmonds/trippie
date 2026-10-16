import type { ButtonHTMLAttributes, ReactNode } from "react";
import { SpinnerIcon } from "./Icons";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  children: ReactNode;
}

export default function Button({
  loading = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`btn-accent focus-ring inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold tracking-tight cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${className}`.trim()}
      {...rest}
    >
      {loading && <SpinnerIcon className="h-4 w-4 animate-spin" />}
      <span>{children}</span>
    </button>
  );
}
