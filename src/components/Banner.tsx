import type { ReactNode } from "react";
import { AlertIcon, InfoIcon } from "./icons";

interface BannerProps {
  tone: "error" | "demo";
  children: ReactNode;
}

export default function Banner({ tone, children }: BannerProps) {
  if (tone === "error") {
    return (
      <div
        role="alert"
        className="glass-danger mt-5 flex items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-medium"
      >
        <AlertIcon className="h-4 w-4 shrink-0" />
        <span>{children}</span>
      </div>
    );
  }

  return (
    <div className="glass-amber mt-5 flex items-center gap-2.5 rounded-2xl px-4 py-3 text-xs sm:text-sm font-medium">
      <InfoIcon className="h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
