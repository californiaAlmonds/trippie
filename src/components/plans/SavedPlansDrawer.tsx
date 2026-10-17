"use client";

import { useId, useRef, useState } from "react";
import { useAccount } from "../account/AccountProvider";
import type { Plan } from "../account/api";
import { useFocusTrap } from "../account/useFocusTrap";
import { lookupKnownAirportCity } from "../AirportPicker";
import { useCurrency } from "../currency/CurrencyProvider";
import { AlertIcon, BellIcon, CloseIcon, TrashIcon } from "../icons";
import PriceLimitSlider, {
  clampAndRoundInr,
  computeDefaultTargetInr,
} from "./PriceLimitSlider";

function PlanCard({ plan }: { plan: Plan }) {
  const { user, updatePlan, deletePlan, searchAgain } = useAccount();
  const { format } = useCurrency();

  const defaultTarget = computeDefaultTargetInr(
    null,
    plan.lastSeenPrice ?? plan.lastAlertPrice ?? 12_000,
  );

  const [prevServerTarget, setPrevServerTarget] = useState<number | null>(
    plan.targetPrice,
  );
  const [limitOpen, setLimitOpen] = useState(plan.targetPrice !== null);
  const [targetInr, setTargetInr] = useState<number>(
    plan.targetPrice !== null ? plan.targetPrice : defaultTarget,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [itemError, setItemError] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingLimit, setSavingLimit] = useState(false);
  const commitSeqRef = useRef(0);

  if (plan.targetPrice !== prevServerTarget) {
    setPrevServerTarget(plan.targetPrice);
    setLimitOpen(plan.targetPrice !== null);
    if (plan.targetPrice !== null) {
      setTargetInr(plan.targetPrice);
    }
  }

  const stayLabel =
    plan.trip === "oneway"
      ? "One way"
      : plan.minGap === plan.maxGap
        ? `${plan.minGap} days`
        : `${plan.minGap}-${plan.maxGap} days`;

  const cabinLabel = (plan.cabin ?? "economy") === "business" ? "Business" : "Economy";

  async function handleToggleAlert() {
    if (!user?.verified || plan.expired || busy) return;
    setItemError("");
    setBusy(true);
    try {
      const res = await updatePlan(plan.id, {
        alertEnabled: !plan.alertEnabled,
      });
      if (!res.ok) {
        setItemError(res.error ?? "Could not update alert preference.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleLimit() {
    if (plan.expired || busy) return;
    setItemError("");
    commitSeqRef.current++;
    const prevTarget = targetInr;
    const nextEnabled = !limitOpen;
    setLimitOpen(nextEnabled);

    const nextTarget = nextEnabled
      ? clampAndRoundInr(plan.targetPrice ?? targetInr ?? defaultTarget)
      : null;

    if (nextTarget !== null) {
      setTargetInr(nextTarget);
    }

    setBusy(true);
    try {
      const res = await updatePlan(plan.id, { targetPrice: nextTarget });
      if (!res.ok) {
        setItemError(res.error ?? "Could not update target price.");
        setLimitOpen(plan.targetPrice !== null);
        setTargetInr(plan.targetPrice ?? prevTarget);
      }
    } catch {
      setItemError("Could not update target price.");
      setLimitOpen(plan.targetPrice !== null);
      setTargetInr(plan.targetPrice ?? prevTarget);
    } finally {
      setBusy(false);
    }
  }

  async function handleCommitSliderLimit(nextInr: number) {
    if (plan.expired) return;
    const clamped = clampAndRoundInr(nextInr);
    setTargetInr(clamped);
    if (clamped === plan.targetPrice) {
      return;
    }

    const seq = ++commitSeqRef.current;
    const rollbackTarget = plan.targetPrice ?? defaultTarget;
    const rollbackOpen = plan.targetPrice !== null;

    setItemError("");
    setSavingLimit(true);
    try {
      const res = await updatePlan(plan.id, { targetPrice: clamped });
      if (commitSeqRef.current !== seq) return;
      if (!res.ok) {
        setItemError(res.error ?? "Could not update target price.");
        setTargetInr(rollbackTarget);
        setLimitOpen(rollbackOpen);
      }
    } catch {
      if (commitSeqRef.current !== seq) return;
      setItemError("Could not update target price.");
      setTargetInr(rollbackTarget);
      setLimitOpen(rollbackOpen);
    } finally {
      if (commitSeqRef.current === seq) {
        setSavingLimit(false);
      }
    }
  }

  async function handleConfirmDelete() {
    setItemError("");
    setConfirmDelete(false);
    setBusy(true);
    try {
      const res = await deletePlan(plan.id);
      if (!res.ok) {
        setItemError(res.error ?? "Could not delete plan.");
      }
    } finally {
      setBusy(false);
    }
  }

  const displayedTarget = limitOpen ? targetInr : null;

  return (
    <li className="glass-subtle rounded-2xl p-4 grid gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {plan.origin} → {plan.destination}
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-500/10 px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
              {plan.month}
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-500/10 px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
              {stayLabel}
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-500/10 px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
              {cabinLabel}
            </span>
            {plan.expired && (
              <span className="inline-flex items-center rounded-full border border-[var(--delta-amber-border)] bg-[var(--delta-amber-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--delta-amber-text)]">
                Expired
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            {lookupKnownAirportCity(plan.origin)} to {lookupKnownAirportCity(plan.destination)}
          </p>
        </div>
      </div>

      {/* Last checked / Last alert summary */}
      {(plan.lastSeenPrice != null || plan.lastAlertPrice != null) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)] tabular-nums">
          {plan.lastSeenPrice != null && (
            <span>
              Last checked price:{" "}
              <strong className="font-semibold text-[var(--text-primary)]">
                {format(plan.lastSeenPrice)}
              </strong>
            </span>
          )}
          {plan.lastAlertPrice != null && (
            <span className="text-[11px] text-[var(--text-muted)]">
              Last alert: {format(plan.lastAlertPrice)}
            </span>
          )}
        </div>
      )}

      {itemError && (
        <div
          role="alert"
          className="glass-danger flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium"
        >
          <AlertIcon className="h-3.5 w-3.5 shrink-0" />
          <span>{itemError}</span>
        </div>
      )}

      {/* Alert toggle + optional limit slider */}
      <div className="grid gap-2.5 rounded-xl border border-[var(--glass-border-subtle)] bg-white/20 dark:bg-white/[0.02] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <BellIcon className="h-4 w-4 shrink-0 text-[var(--accent)]" />
              <span className="text-xs font-medium text-[var(--text-primary)]">
                Price alerts
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
              {displayedTarget !== null
                ? `We'll notify you when it goes below ${format(displayedTarget)}.`
                : "We'll notify you when the price drops."}
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={plan.alertEnabled}
            aria-label={`Price drop alert for ${plan.origin} to ${plan.destination}`}
            disabled={!user?.verified || plan.expired || busy}
            onClick={handleToggleAlert}
            className="focus-ring inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-end cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                plan.alertEnabled
                  ? "bg-[var(--accent)]"
                  : "bg-slate-400/40 dark:bg-slate-600/60"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                  plan.alertEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </span>
          </button>
        </div>

        {!user?.verified && (
          <p className="text-[11px] text-[var(--text-muted)]">
            Verify your email to enable price alerts.
          </p>
        )}

        <div className="border-t border-[var(--glass-border-subtle)] pt-2.5 grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-[var(--text-primary)]">
              Only alert below a price
              {displayedTarget !== null ? (
                <span className="ml-1.5 font-semibold tabular-nums text-[var(--accent)]">
                  ({format(displayedTarget)})
                </span>
              ) : null}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={limitOpen}
              aria-label={`Only alert below a price for ${plan.origin} to ${plan.destination}`}
              disabled={plan.expired || busy}
              onClick={handleToggleLimit}
              className="focus-ring inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-end cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                  limitOpen
                    ? "bg-[var(--accent)]"
                    : "bg-slate-400/40 dark:bg-slate-600/60"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                    limitOpen ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </span>
            </button>
          </div>

          {limitOpen && !plan.expired && (
            <PriceLimitSlider
              currentBest={plan.lastSeenPrice ?? plan.lastAlertPrice ?? null}
              targetPriceInr={targetInr}
              onChangeInr={(val) => {
                setTargetInr(clampAndRoundInr(val));
              }}
              onCommitInr={(val) => {
                void handleCommitSliderLimit(val);
              }}
              saving={savingLimit}
              label={`Alert limit for ${plan.origin} to ${plan.destination}`}
            />
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <button
          type="button"
          onClick={() =>
            searchAgain({
              origin: plan.origin,
              destination: plan.destination,
              month: plan.month,
              trip: plan.trip,
              minGap: plan.trip === "oneway" ? 0 : plan.minGap,
              maxGap: plan.trip === "oneway" ? 0 : plan.maxGap,
              cabin: plan.cabin ?? "economy",
            })
          }
          className="glass-field focus-ring inline-flex min-h-[44px] items-center justify-center rounded-full px-4 py-1.5 text-xs font-semibold text-[var(--text-primary)] cursor-pointer"
        >
          Search again
        </button>

        {confirmDelete ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-[var(--text-muted)]">
              Remove plan?
            </span>
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={busy}
              className="focus-ring min-h-[44px] rounded-full bg-red-600 hover:bg-red-700 px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="glass-field focus-ring min-h-[44px] rounded-full px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] cursor-pointer"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="focus-ring inline-flex min-h-[44px] items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-[var(--delta-red-text)] hover:bg-red-500/10 cursor-pointer"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            <span>Delete</span>
          </button>
        )}
      </div>
    </li>
  );
}

export default function SavedPlansDrawer() {
  const { plansOpen, closePlans, plans, plansLoading } = useAccount();
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();

  useFocusTrap(plansOpen, drawerRef, closePlans, closeBtnRef);

  if (!plansOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end bg-slate-950/40 backdrop-blur-xs animate-results"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePlans();
      }}
    >
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="glass-strong flex max-h-[86vh] w-full flex-col rounded-t-3xl rounded-b-none p-5 sm:p-6 outline-none md:max-h-none md:h-full md:max-w-md md:rounded-l-3xl md:rounded-r-none"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--glass-border-subtle)] pb-4">
          <div>
            <h2
              id={titleId}
              className="text-base sm:text-lg font-semibold tracking-tight text-[var(--text-primary)]"
            >
              Saved plans
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              {plans.length} of 20 saved routes
            </p>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            onClick={closePlans}
            aria-label="Close saved plans"
            className="glass-field focus-ring inline-flex min-h-[44px] h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex-1 overflow-y-auto pr-1">
          {plansLoading && plans.length === 0 ? (
            <div className="grid gap-3">
              {Array.from({ length: 3 }, (_, i) => (
                <div
                  key={i}
                  className="skeleton-shimmer h-28 w-full rounded-2xl"
                />
              ))}
            </div>
          ) : plans.length === 0 ? (
            <div className="glass-subtle my-6 rounded-2xl px-5 py-8 text-center">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                No saved plans yet
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                Run a flight search and click “Save this search” on the results
                card to bookmark a route or turn on email price alerts.
              </p>
            </div>
          ) : (
            <ul className="grid gap-3">
              {plans.map((p) => (
                <PlanCard key={String(p.id)} plan={p} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
