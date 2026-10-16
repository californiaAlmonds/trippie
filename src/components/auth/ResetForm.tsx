"use client";

import Link from "next/link";
import { type FormEvent, useId, useState } from "react";
import { api } from "@/components/account/api";
import {
  AlertIcon,
  BrandMarkIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  SpinnerIcon,
} from "@/components/icons";

export default function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [status, setStatus] = useState<
    "idle" | "submitting" | "done" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  const passwordHelpId = useId();
  const passwordErrId = useId();

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFieldError("");
    setMessage("");

    if (!token) {
      setStatus("error");
      setMessage("Missing reset token.");
      return;
    }

    if (password.length < 15) {
      setFieldError("Password must be at least 15 characters.");
      return;
    }
    if (password.length > 128) {
      setFieldError("Password must be at most 128 characters.");
      return;
    }

    setStatus("submitting");
    const res = await api<{ error?: string }>("/api/auth/reset", {
      method: "POST",
      body: { token, password },
    });

    if (!res.ok) {
      setStatus("error");
      setMessage(res.error ?? "Invalid or expired link");
      return;
    }

    setStatus("done");
    setMessage(
      "Your password has been updated. You can now sign in with your new password.",
    );
    setPassword("");
  }

  const describedBy = [passwordHelpId, fieldError ? passwordErrId : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex min-h-screen w-full flex-col">
      <header className="sticky top-0 z-30 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-[var(--glass-highlight)] backdrop-blur-2xl backdrop-saturate-[1.75]">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            href="/"
            className="focus-ring inline-flex items-center gap-2.5 rounded-lg"
          >
            <BrandMarkIcon className="h-7 w-7 shrink-0 rounded-lg shadow-xs" />
            <span className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
              Trippie
            </span>
          </Link>
          <Link
            href="/"
            className="glass-field focus-ring inline-flex items-center rounded-full px-3.5 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Back to Trippie
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12 sm:px-6">
        <div className="glass-strong p-6 sm:p-8 animate-results">
          <div className="flex items-center gap-3">
            <BrandMarkIcon className="h-8 w-8 shrink-0 rounded-xl shadow-xs" />
            <div>
              <h1 className="text-lg sm:text-xl font-semibold tracking-tight text-[var(--text-primary)]">
                Reset your password
              </h1>
              <p className="text-xs text-[var(--text-secondary)]">
                Choose a new password for your Trippie account
              </p>
            </div>
          </div>

          {status === "done" ? (
            <div className="mt-6 grid gap-4">
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-2xl border border-[var(--badge-lowest-border)] bg-[var(--badge-lowest-bg)] p-4 text-xs sm:text-sm font-medium text-[var(--badge-lowest-text)]"
              >
                <CheckIcon className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{message}</span>
              </div>
              <Link
                href="/"
                className="btn-accent focus-ring inline-flex min-h-[44px] w-full items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold"
              >
                Back to Trippie
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="mt-6 grid gap-4">
              {!token && (
                <div
                  role="alert"
                  className="glass-danger flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-xs font-medium"
                >
                  <AlertIcon className="h-4 w-4 shrink-0" />
                  <span>No reset token was provided in the link.</span>
                </div>
              )}

              {status === "error" && message && (
                <div
                  role="alert"
                  className="glass-danger flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-xs font-medium"
                >
                  <AlertIcon className="h-4 w-4 shrink-0" />
                  <span>{message}</span>
                </div>
              )}

              <div className="grid gap-1.5">
                <label
                  htmlFor="new-password"
                  className="text-xs font-medium text-[var(--text-secondary)]"
                >
                  New password
                </label>
                <div className="relative flex items-center">
                  <input
                    id="new-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={15}
                    maxLength={128}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldError) setFieldError("");
                    }}
                    aria-invalid={Boolean(fieldError)}
                    aria-describedby={describedBy}
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

                {fieldError && (
                  <p
                    id={passwordErrId}
                    className="text-xs font-medium text-[var(--delta-red-text)]"
                  >
                    {fieldError}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={!token || status === "submitting"}
                className="btn-accent focus-ring inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {status === "submitting" && (
                  <SpinnerIcon className="h-4 w-4 animate-spin" />
                )}
                <span>
                  {status === "submitting" ? "Updating…" : "Reset password"}
                </span>
              </button>

              <div className="pt-1 text-center">
                <Link
                  href="/"
                  className="focus-ring rounded px-2 py-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  Back to Trippie
                </Link>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
