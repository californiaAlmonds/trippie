"use client";

import { type FormEvent, useId, useRef, useState } from "react";
import {
  AlertIcon,
  BrandMarkIcon,
  CheckIcon,
  CloseIcon,
  EyeIcon,
  EyeOffIcon,
  SpinnerIcon,
} from "../icons";
import SegmentedControl from "../SegmentedControl";
import { useAccount } from "./AccountProvider";
import { api } from "./api";
import { useFocusTrap } from "./useFocusTrap";

const AUTH_TABS = [
  { value: "signin", label: "Sign in" },
  { value: "signup", label: "Create account" },
] as const;

type AuthTab = "signin" | "signup";
type DialogView = "auth" | "forgot";

function AuthDialogModal({
  initialTab,
  onClose,
}: {
  initialTab: AuthTab;
  onClose: () => void;
}) {
  const { signIn, signUp } = useAccount();

  const [tab, setTab] = useState<AuthTab>(initialTab);
  const [view, setView] = useState<DialogView>("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [serverError, setServerError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const emailInputRef = useRef<HTMLInputElement | null>(null);

  const titleId = useId();
  const emailId = useId();
  const emailErrId = useId();
  const passwordId = useId();
  const passwordHelpId = useId();
  const passwordErrId = useId();

  useFocusTrap(true, dialogRef, onClose, emailInputRef);

  function switchTab(next: AuthTab) {
    setTab(next);
    setView("auth");
    setPassword("");
    setEmailError("");
    setPasswordError("");
    setServerError("");
  }

  function validateFields(requireMinPassword: boolean): boolean {
    let valid = true;
    setEmailError("");
    setPasswordError("");
    setServerError("");

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setEmailError("Enter a valid email address.");
      valid = false;
    }

    if (view === "auth") {
      if (!password) {
        setPasswordError("Enter your password.");
        valid = false;
      } else if (requireMinPassword && password.length < 15) {
        setPasswordError("Password must be at least 15 characters.");
        valid = false;
      } else if (password.length > 128) {
        setPasswordError("Password must be at most 128 characters.");
        valid = false;
      }
    }

    return valid;
  }

  async function handleAuthSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validateFields(tab === "signup")) return;

    setSubmitting(true);
    setServerError("");
    try {
      const res =
        tab === "signin"
          ? await signIn(email.trim(), password)
          : await signUp(email.trim(), password);

      if (!res.ok) {
        setServerError(
          res.error ??
            (tab === "signin"
              ? "Invalid email or password"
              : "Could not create account"),
        );
      } else {
        setPassword("");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validateFields(false)) return;

    setSubmitting(true);
    setServerError("");
    try {
      const res = await api("/api/auth/forgot", {
        method: "POST",
        body: { email: email.trim() },
      });
      if (!res.ok && res.status === 429) {
        setServerError(
          res.error ?? "Too many requests. Please try again later.",
        );
        return;
      }
      setForgotSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  const passwordDescribedBy = [
    passwordHelpId,
    passwordError ? passwordErrId : "",
  ]
    .filter(Boolean)
    .join(" ");

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
        tabIndex={-1}
        className="glass-strong relative w-full max-w-md p-6 sm:p-7 outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <BrandMarkIcon className="h-7 w-7 shrink-0 rounded-lg shadow-xs" />
            <div>
              <h2
                id={titleId}
                className="text-lg font-semibold tracking-tight text-[var(--text-primary)]"
              >
                {view === "forgot"
                  ? "Reset your password"
                  : tab === "signin"
                    ? "Sign in to Trippie"
                    : "Create your Trippie account"}
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                {view === "forgot"
                  ? "We’ll send a password reset link to your email."
                  : "Save flight searches and get email alerts when fares drop."}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close sign in dialog"
            className="glass-field focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {view === "auth" && (
          <div className="mt-5">
            <SegmentedControl
              ariaLabel="Account action"
              options={AUTH_TABS}
              value={tab}
              onChange={switchTab}
            />
          </div>
        )}

        {serverError && (
          <div
            role="alert"
            className="glass-danger mt-4 flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-xs font-medium"
          >
            <AlertIcon className="h-4 w-4 shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        {view === "auth" ? (
          <form onSubmit={handleAuthSubmit} noValidate className="mt-4 grid gap-4">
            <div className="grid gap-1.5">
              <label
                htmlFor={emailId}
                className="text-xs font-medium text-[var(--text-secondary)]"
              >
                Email address
              </label>
              <input
                ref={emailInputRef}
                id={emailId}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError("");
                }}
                aria-invalid={Boolean(emailError)}
                aria-describedby={emailError ? emailErrId : undefined}
                placeholder="you@example.com"
                className="glass-field min-h-[44px] w-full rounded-2xl px-3.5 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/70"
              />
              {emailError && (
                <p
                  id={emailErrId}
                  className="text-xs font-medium text-[var(--delta-red-text)]"
                >
                  {emailError}
                </p>
              )}
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor={passwordId}
                  className="text-xs font-medium text-[var(--text-secondary)]"
                >
                  Password
                </label>
                {tab === "signin" && (
                  <button
                    type="button"
                    onClick={() => {
                      setView("forgot");
                      setPassword("");
                      setPasswordError("");
                      setServerError("");
                      setForgotSent(false);
                    }}
                    className="focus-ring rounded text-xs font-medium text-[var(--accent)] hover:underline cursor-pointer"
                  >
                    Forgot password?
                  </button>
                )}
              </div>

              <div className="relative flex items-center">
                <input
                  id={passwordId}
                  type={showPassword ? "text" : "password"}
                  autoComplete={
                    tab === "signin" ? "current-password" : "new-password"
                  }
                  required
                  minLength={15}
                  maxLength={128}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (passwordError) setPasswordError("");
                  }}
                  aria-invalid={Boolean(passwordError)}
                  aria-describedby={passwordDescribedBy}
                  placeholder="•••••••••••••••"
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

              <p
                id={passwordHelpId}
                className="text-[11px] text-[var(--text-muted)]"
              >
                At least 15 characters; spaces allowed
              </p>

              {passwordError && (
                <p
                  id={passwordErrId}
                  className="text-xs font-medium text-[var(--delta-red-text)]"
                >
                  {passwordError}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn-accent focus-ring mt-1 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting && <SpinnerIcon className="h-4 w-4 animate-spin" />}
              <span>
                {submitting
                  ? tab === "signin"
                    ? "Signing in…"
                    : "Creating account…"
                  : tab === "signin"
                    ? "Sign in"
                    : "Create account"}
              </span>
            </button>
          </form>
        ) : forgotSent ? (
          <div className="mt-5 grid gap-4">
            <div
              role="status"
              className="glass-subtle flex items-start gap-2.5 rounded-2xl p-4 text-xs sm:text-sm text-[var(--text-primary)]"
            >
              <CheckIcon className="h-4 w-4 shrink-0 mt-0.5 text-[var(--badge-lowest-text)]" />
              <span>If that account exists, we sent a link</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setView("auth");
                setForgotSent(false);
                setServerError("");
              }}
              className="glass-field focus-ring inline-flex min-h-[44px] w-full items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold text-[var(--text-primary)] cursor-pointer"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleForgotSubmit} noValidate className="mt-5 grid gap-4">
            <div className="grid gap-1.5">
              <label
                htmlFor={emailId}
                className="text-xs font-medium text-[var(--text-secondary)]"
              >
                Email address
              </label>
              <input
                ref={emailInputRef}
                id={emailId}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError("");
                }}
                aria-invalid={Boolean(emailError)}
                aria-describedby={emailError ? emailErrId : undefined}
                placeholder="you@example.com"
                className="glass-field min-h-[44px] w-full rounded-2xl px-3.5 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/70"
              />
              {emailError && (
                <p
                  id={emailErrId}
                  className="text-xs font-medium text-[var(--delta-red-text)]"
                >
                  {emailError}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="submit"
                disabled={submitting}
                className="btn-accent focus-ring inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold cursor-pointer disabled:opacity-60"
              >
                {submitting && <SpinnerIcon className="h-4 w-4 animate-spin" />}
                <span>{submitting ? "Sending…" : "Send reset link"}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setView("auth");
                  setServerError("");
                  setEmailError("");
                }}
                className="glass-field focus-ring inline-flex min-h-[44px] items-center justify-center rounded-full px-4 py-2.5 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                Back to sign in
              </button>
            </div>
          </form>
        )}

        <div className="mt-5 border-t border-[var(--glass-border-subtle)] pt-3.5 text-center">
          <button
            type="button"
            onClick={onClose}
            className="focus-ring rounded-lg px-2 py-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            Continue as guest
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AuthDialog() {
  const { authDialogOpen, authDialogTab, closeAuthDialog } = useAccount();
  if (!authDialogOpen) return null;
  return (
    <AuthDialogModal
      key={authDialogTab}
      initialTab={authDialogTab}
      onClose={closeAuthDialog}
    />
  );
}
