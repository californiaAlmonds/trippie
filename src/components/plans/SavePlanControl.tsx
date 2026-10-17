"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useAccount } from "../account/AccountProvider";
import { useCurrency } from "../currency/CurrencyProvider";
import {
  AlertIcon,
  BellIcon,
  BookmarkIcon,
  CheckIcon,
  CloseIcon,
  SpinnerIcon,
} from "../icons";
import type { PriceStats } from "../PriceInsightsCard";
import type { Query } from "../recentStore";
import PriceLimitSlider, {
  clampAndRoundInr,
  computeDefaultTargetInr,
} from "./PriceLimitSlider";

interface SavePlanControlProps {
  query: Query;
  stats?: PriceStats | null;
  currentBest?: number | null;
}

export function parseTargetPriceInput(raw: string): {
  valid: boolean;
  value: number | null;
  error?: string;
} {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!trimmed) {
    return { valid: true, value: null };
  }
  const num = Number(trimmed);
  if (!Number.isInteger(num) || num < 500 || num > 1_000_000) {
    return {
      valid: false,
      value: null,
      error: "Enter a whole rupee amount between ₹500 and ₹10,00,000.",
    };
  }
  return { valid: true, value: num };
}

export default function SavePlanControl({
  query,
  stats,
  currentBest,
}: SavePlanControlProps) {
  const { user, openAuthDialog, createPlan, openPlans, plans } = useAccount();
  const { format } = useCurrency();

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [alertPref, setAlertPref] = useState<boolean | null>(null);
  const [limitEnabled, setLimitEnabled] = useState(false);
  const [targetInr, setTargetInr] = useState<number>(() =>
    computeDefaultTargetInr(stats, currentBest),
  );
  const [serverError, setServerError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const unverifiedHintId = useId();

  const effectiveAlertEnabled = Boolean(
    user?.verified && (alertPref ?? true),
  );

  const queryCabin = query.cabin === "business" ? "business" : "economy";

  useEffect(() => {
    if (!popoverOpen) return;

    function handlePointerDown(e: MouseEvent) {
      if (
        containerRef.current &&
        e.target instanceof Node &&
        !containerRef.current.contains(e.target)
      ) {
        setPopoverOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPopoverOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [popoverOpen]);

  const alreadySaved = plans.some(
    (p) =>
      p.origin === query.origin &&
      p.destination === query.destination &&
      p.month === query.month &&
      p.trip === query.trip &&
      (p.cabin ?? "economy") === queryCabin &&
      (query.trip === "oneway" ||
        (p.minGap === query.minGap && p.maxGap === query.maxGap)),
  );

  function handleTriggerClick() {
    setServerError("");

    if (!user) {
      openAuthDialog({
        tab: "signin",
        onSuccess: async (authedUser) => {
          setSubmitting(true);
          try {
            const res = await createPlan({
              origin: query.origin,
              destination: query.destination,
              month: query.month,
              trip: query.trip,
              minGap: query.minGap,
              maxGap: query.maxGap,
              cabin: queryCabin,
              alertEnabled: Boolean(authedUser.verified),
              targetPrice: null,
            });
            if (res.ok) {
              setSavedSuccess(true);
            } else {
              setPopoverOpen(true);
              setServerError(res.error ?? "Could not save search.");
            }
          } finally {
            setSubmitting(false);
          }
        },
      });
      return;
    }

    setPopoverOpen((prev) => !prev);
  }

  async function handleSaveSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError("");

    const finalTargetPrice = limitEnabled ? clampAndRoundInr(targetInr) : null;

    setSubmitting(true);
    try {
      const res = await createPlan({
        origin: query.origin,
        destination: query.destination,
        month: query.month,
        trip: query.trip,
        minGap: query.minGap,
        maxGap: query.maxGap,
        cabin: queryCabin,
        alertEnabled: effectiveAlertEnabled,
        targetPrice: finalTargetPrice,
      });

      if (!res.ok) {
        setServerError(res.error ?? "Could not save this search.");
        return;
      }

      setPopoverOpen(false);
      setSavedSuccess(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div ref={containerRef} className="relative inline-flex items-center gap-2">
      {savedSuccess || alreadySaved ? (
        <div
          role="status"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[var(--badge-lowest-border)] bg-[var(--badge-lowest-bg)] px-3.5 py-1.5 text-xs font-semibold text-[var(--badge-lowest-text)]"
        >
          <CheckIcon className="h-3.5 w-3.5 shrink-0" />
          <span>Saved</span>
          <button
            type="button"
            onClick={openPlans}
            className="focus-ring ml-1 underline hover:opacity-80 cursor-pointer"
          >
            View plans
          </button>
        </div>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={handleTriggerClick}
          disabled={submitting}
          aria-expanded={user ? popoverOpen : undefined}
          aria-haspopup={user ? "dialog" : undefined}
          className="glass-field focus-ring inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-[var(--text-primary)] cursor-pointer disabled:opacity-60"
        >
          {submitting ? (
            <SpinnerIcon className="h-3.5 w-3.5 animate-spin text-[var(--accent)]" />
          ) : (
            <BookmarkIcon className="h-3.5 w-3.5 text-[var(--accent)]" />
          )}
          <span>Save this search</span>
          {!user && (
            <span className="rounded-full bg-slate-500/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
              Sign in
            </span>
          )}
        </button>
      )}

      {popoverOpen && user && (
        <div
          role="dialog"
          aria-label="Save search options"
          className="glass-strong absolute right-0 top-full z-40 mt-2 w-80 sm:w-96 p-4 sm:p-5 text-left animate-results"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Save {query.origin} → {query.destination}
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">
                {query.month} ·{" "}
                {query.trip === "oneway"
                  ? "One way"
                  : query.minGap === query.maxGap
                    ? `${query.minGap} days`
                    : `${query.minGap}-${query.maxGap} days`}
                {queryCabin === "business" ? " · Business" : " · Economy"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPopoverOpen(false)}
              aria-label="Close save options"
              className="glass-field focus-ring inline-flex min-h-[44px] h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          {serverError && (
            <div
              role="alert"
              className="glass-danger mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium"
            >
              <AlertIcon className="h-4 w-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          <form onSubmit={handleSaveSubmit} noValidate className="mt-3.5 grid gap-3.5">
            <div className="glass-subtle rounded-2xl p-3 grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <BellIcon className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                    <span className="text-xs font-semibold text-[var(--text-primary)]">
                      Price alerts
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                    {limitEnabled
                      ? `We'll notify you when it goes below ${format(clampAndRoundInr(targetInr))}.`
                      : "We'll notify you when the price drops."}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={effectiveAlertEnabled}
                  aria-label="Alert me when the price drops"
                  aria-describedby={!user.verified ? unverifiedHintId : undefined}
                  disabled={!user.verified}
                  onClick={() => setAlertPref(!effectiveAlertEnabled)}
                  className="focus-ring inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-end cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                      effectiveAlertEnabled
                        ? "bg-[var(--accent)]"
                        : "bg-slate-400/40 dark:bg-slate-600/60"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                        effectiveAlertEnabled
                          ? "translate-x-6"
                          : "translate-x-1"
                      }`}
                    />
                  </span>
                </button>
              </div>

              {!user.verified && (
                <p
                  id={unverifiedHintId}
                  className="text-[11px] text-[var(--text-muted)]"
                >
                  Verify your email to enable price alerts. You can still save
                  this search now.
                </p>
              )}

              <div className="border-t border-[var(--glass-border-subtle)] pt-2.5 grid gap-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-[var(--text-primary)]">
                    Only alert below a price
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={limitEnabled}
                    aria-label="Only alert below a price"
                    onClick={() => {
                      setLimitEnabled((prev) => {
                        if (!prev) {
                          setTargetInr(computeDefaultTargetInr(stats, currentBest));
                        }
                        return !prev;
                      });
                    }}
                    className="focus-ring inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-end cursor-pointer"
                  >
                    <span
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                        limitEnabled
                          ? "bg-[var(--accent)]"
                          : "bg-slate-400/40 dark:bg-slate-600/60"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                          limitEnabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </span>
                  </button>
                </div>

                {limitEnabled && (
                  <PriceLimitSlider
                    stats={stats}
                    currentBest={currentBest}
                    targetPriceInr={targetInr}
                    onChangeInr={setTargetInr}
                    label="Alert limit"
                  />
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn-accent focus-ring inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full px-4 py-2 text-xs sm:text-sm font-semibold cursor-pointer disabled:opacity-60"
            >
              {submitting && <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />}
              <span>{submitting ? "Saving…" : "Save plan"}</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
