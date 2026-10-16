"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { api } from "@/components/account/api";
import {
  AlertIcon,
  BrandMarkIcon,
  CheckIcon,
  SpinnerIcon,
} from "@/components/icons";

export default function UnsubscribeForm({ token }: { token: string }) {
  const [status, setStatus] = useState<
    "idle" | "submitting" | "done" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) {
      setStatus("error");
      setMessage("Missing unsubscribe token.");
      return;
    }
    setStatus("submitting");
    setMessage("");

    const res = await api<{ error?: string }>("/api/alerts/unsubscribe", {
      method: "POST",
      body: { token },
    });

    if (!res.ok) {
      setStatus("error");
      setMessage(res.error ?? "Invalid or expired link");
      return;
    }

    setStatus("done");
    setMessage("Price alerts have been disabled for this plan.");
  }

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
                Unsubscribe from price alerts
              </h1>
              <p className="text-xs text-[var(--text-secondary)]">
                Stop emails for this saved plan
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
            <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
              <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
                Click the button below to Unsubscribe from price alerts address.
              </p>

              {!token && (
                <div
                  role="alert"
                  className="glass-danger flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-xs font-medium"
                >
                  <AlertIcon className="h-4 w-4 shrink-0" />
                  <span>No unsubscribe token was provided in the link.</span>
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

              <button
                type="submit"
                disabled={!token || status === "submitting"}
                className="btn-accent focus-ring inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {status === "submitting" && (
                  <SpinnerIcon className="h-4 w-4 animate-spin" />
                )}
                <span>
                  {status === "submitting" ? "Unsubscribing..." : "Unsubscribe"}
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

