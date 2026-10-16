import type { SVGProps } from "react";

export function BrandMarkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id="trippie-brand-grad" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="50%" stopColor="#0a84ff" />
          <stop offset="100%" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <rect width="28" height="28" rx="8" fill="url(#trippie-brand-grad)" />
      <path
        d="M6.5 18.5C9.5 11.5 15 9.5 21.5 9.5"
        stroke="white"
        strokeOpacity="0.45"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="2 2.5"
      />
      <path
        d="M21.2 8.2 13.9 19.6c-.25.4-.85.32-.98-.13l-1.05-3.65-3.65-1.05c-.45-.13-.53-.73-.13-.98L19.5 6.5c.45-.28.98.25.7.7z"
        fill="white"
      />
    </svg>
  );
}

export function PlaneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
    </svg>
  );
}

export function SwapIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.85} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M7 8h13m0 0-3.5-3.5M20 8l-3.5 3.5" />
      <path d="M17 16H4m0 0 3.5-3.5M4 16l3.5 3.5" />
    </svg>
  );
}

export function ClockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function ExternalLinkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.85} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

export function AlertIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.85} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

export function InfoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.85} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

export function SparklineEmptyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M3 17l5-5 4 4 8-8" />
      <path d="M16 8h4v4" />
    </svg>
  );
}

export function EmptyRouteIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 120 72" fill="none" aria-hidden="true" {...props}>
      <circle cx="24" cy="48" r="14" fill="currentColor" fillOpacity="0.08" />
      <circle cx="96" cy="28" r="18" fill="currentColor" fillOpacity="0.08" />
      <path
        d="M24 48C42 22 74 18 96 28"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="4 4"
      />
      <circle cx="24" cy="48" r="4.5" fill="var(--accent)" />
      <circle cx="96" cy="28" r="4.5" fill="var(--accent)" />
      <g transform="translate(52, 18)">
        <path
          d="M16 6.5 9.2 15.8c-.2.3-.65.24-.75-.1l-.8-2.8-2.8-.8c-.34-.1-.4-.55-.1-.75L14.1 4.6c.35-.22.75.2.55.55z"
          fill="var(--accent)"
        />
      </g>
    </svg>
  );
}

export function SpinnerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M12 3a9 9 0 0 1 9 9h-3a6 6 0 0 0-6-6V3z"
      />
    </svg>
  );
}
