"use client";

import { type FormEvent, useId, useRef, useState } from "react";
import {
  AlertIcon,
  CloseIcon,
  EyeIcon,
  EyeOffIcon,
  SpinnerIcon,
  TrashIcon,
} from "../icons";
import { useAccount } from "./AccountProvider";
import { useFocusTrap } from "./useFocusTrap";

interface DeleteAccountDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function DeleteAccountDialog({
  open,
  onClose,
}: DeleteAccountDialogProps) {
  const { user, deleteAccount } = useAccount();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [serverError, setServerError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  const titleId = useId();
  const descId = useId();
  const passId = useId();
  const errId = useId();

  useFocusTrap(open, dialogRef, onClose, passwordInputRef);

  if (!open || !user) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFieldError("");
    setServerError("");
    if (!password) {
      setFieldError("Enter your password to confirm account deletion.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await deleteAccount(password);
      if (!res.ok) {
        setServerError(res.error ?? "Could not delete account.");
      } else {
        setPassword("");
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-xs animate-results"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className="glass-strong relative w-full max-w-md p-6 sm:p-7 outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-[var(--delta-red-text)]">
              <TrashIcon className="h-4 w-4" />
            </span>
            <div>
              <h2
                id={titleId}
                className="text-base sm:text-lg font-semibold tracking-tight text-[var(--text-primary)]"
              >
                Delete account
              </h2>
              <p id={descId} className="text-xs text-[var(--text-secondary)]">
                Permanently remove {user.email} and all saved plans.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close delete account dialog"
            className="glass-field focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {serverError && (
          <div
            role="alert"
            className="glass-danger mt-4 flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-xs font-medium"
          >
            <AlertIcon className="h-4 w-4 shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-4 grid gap-4">
          <div className="grid gap-1.5">
            <label
              htmlFor={passId}
              className="text-xs font-medium text-[var(--text-secondary)]"
            >
              Confirm your password
            </label>
            <div className="relative flex items-center">
              <input
                ref={passwordInputRef}
                id={passId}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldError) setFieldError("");
                }}
                aria-invalid={Boolean(fieldError)}
                aria-describedby={fieldError ? errId : undefined}
                placeholder="Enter your password"
                className="glass-field min-h-[44px] w-full rounded-2xl pl-3.5 pr-11 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/70"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="focus-ring absolute right-2 inline-flex h-8 w-8 items-center justify-center rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                {showPassword ? (
                  <EyeOffIcon className="h-4 w-4" />
                ) : (
                  <EyeIcon className="h-4 w-4" />
                )}
              </button>
            </div>
            {fieldError && (
              <p
                id={errId}
                className="text-xs font-medium text-[var(--delta-red-text)]"
              >
                {fieldError}
              </p>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="glass-field focus-ring inline-flex min-h-[44px] items-center justify-center rounded-full px-5 py-2 text-xs sm:text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="focus-ring inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-red-600 hover:bg-red-700 px-5 py-2 text-xs sm:text-sm font-semibold text-white shadow-sm cursor-pointer disabled:opacity-60"
            >
              {submitting && <SpinnerIcon className="h-4 w-4 animate-spin" />}
              <span>{submitting ? "Deleting…" : "Delete account"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
