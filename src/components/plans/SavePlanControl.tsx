"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useAccount } from "../account/AccountProvider";
import { inr } from "../format";
import {
  AlertIcon,
  BellIcon,
  BookmarkIcon,
  CheckIcon,
  CloseIcon,
  SpinnerIcon,
} from "../icons";
import type { Query } from "../recentStore";

interface SavePlanControlProps {
  query: Query;
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

export default function SavePlanControl({ query }: SavePlanControlProps) {
  const { user, openAuthDialog, createPlan, openPlans, plans } = useAccount();

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [alertPref, setAlertPref] = useState<boolean | null>(null);
  const [targetRaw, setTargetRaw] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [serverError, setServerError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const targetInputId = useId();
  const targetHintId = useId();
  const targetErrId = useId();
  const unverifiedHintId = useId();

  const effectiveAlertEnabled = Boolean(
    user?.verified && (alertPref ?? true),
  );

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
      (query.trip === "oneway" ||
        (p.minGap === query.minGap && p.maxGap === query.maxGap)),
  );

  function handleTriggerClick() {
    setServerError("");
    setFieldError("");

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
    setFieldError("");
    setServerError("");

    const parsed = parseTargetPriceInput(targetRaw);
    if (!parsed.valid) {
      setFieldError(parsed.error ?? "Invalid target price.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await createPlan({
        origin: query.origin,
        destination: query.destination,
        month: query.month,
        trip: query.trip,
        minGap: query.minGap,
        maxGap: query.maxGap,
        alertEnabled: effectiveAlertEnabled,
        targetPrice: parsed.value,
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

  const parsedPreview = parseTargetPriceInput(targetRaw);

  return (
    <div ref={containerRef} className="relative inline-flex items-center gap-2">
      {savedSuccess || alreadySaved ? (
        <div
          role="status"
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--badge-lowest-border)] bg-[var(--badge-lowest-bg)] px-3 py-1 text-xs font-semibold text-[var(--badge-lowest-text)]"
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
          className="glass-field focus-ring inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] cursor-pointer disabled:opacity-60"
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
          className="glass-strong absolute right-0 top-full z-40 mt-2 w-80 p-4 sm:p-5 text-left animate-results"
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
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPopoverOpen(false)}
              aria-label="Close save options"
              className="glass-field focus-ring inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
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
            <div className="glass-subtle rounded-2xl p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <BellIcon className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    Alert me when the price drops
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={effectiveAlertEnabled}
                  aria-label="Alert me when the price drops"
                  aria-describedby={!user.verified ? unverifiedHintId : undefined}
                  disabled={!user.verified}
                  onClick={() => setAlertPref(!effectiveAlertEnabled)}
                  className={`focus-ring relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    effectiveAlertEnabled
                      ? "bg-[var(--accent)]"
                      : "bg-slate-400/40 dark:bg-slate-600/60"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                      effectiveAlertEnabled
                        ? "translate-x-5"
                        : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                By email, and on your phone if notifications are on
              </p>

              {!user.verified && (
                <p
                  id={unverifiedHintId}
                  className="mt-1.5 text-[11px] text-[var(--text-muted)]"
                >
                  Verify your email to enable price alerts. You can still save
                  this search now.
                </p>
              )}
            </div>

            <div className="grid gap-1.5">
              <label
                htmlFor={targetInputId}
                className="text-xs font-medium text-[var(--text-secondary)]"
              >
                Only if below ₹___ (optional)
              </label>
              <div className="relative flex items-center">
                <span className="pointer-events-none absolute left-3.5 text-xs font-semibold text-[var(--text-muted)]">
                  ₹
                </span>
                <input
                  id={targetInputId}
                  type="number"
                  inputMode="numeric"
                  min={500}
                  max={1000000}
                  step={1}
                  value={targetRaw}
                  onChange={(e) => {
                    setTargetRaw(e.target.value);
                    if (fieldError) setFieldError("");
                  }}
                  aria-invalid={Boolean(fieldError)}
                  aria-describedby={
                    fieldError ? `${targetHintId} ${targetErrId}` : targetHintId
                  }
                  placeholder="e.g. 12000"
                  className="glass-field min-h-[40px] w-full rounded-xl pl-7 pr-3 py-1.5 text-xs sm:text-sm tabular-nums text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/70"
                />
              </div>

              <p id={targetHintId} className="text-[11px] text-[var(--text-muted)]">
                {parsedPreview.valid && parsedPreview.value !== null
                  ? `Alert threshold: ${inr.format(parsedPreview.value)} (500–10,00,000)`
                  : "Whole INR between ₹500 and ₹10,00,000"}
              </p>

              {fieldError && (
                <p
                  id={targetErrId}
                  className="text-xs font-medium text-[var(--delta-red-text)]"
                >
                  {fieldError}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn-accent focus-ring inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-full px-4 py-2 text-xs sm:text-sm font-semibold cursor-pointer disabled:opacity-60"
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
