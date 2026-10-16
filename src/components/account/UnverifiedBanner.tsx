"use client";

import { useState } from "react";
import { CheckIcon, InfoIcon, SpinnerIcon } from "../icons";
import { useAccount } from "./AccountProvider";
import { api } from "./api";

export default function UnverifiedBanner() {
  const { user } = useAccount();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "rate_limited" | "error">("idle");
  const [feedback, setFeedback] = useState("");

  if (!user || user.verified) return null;

  async function handleResend() {
    setState("sending");
    setFeedback("");
    const res = await api<{ ok?: boolean }>("/api/auth/resend", {
      method: "POST",
      body: {},
    });

    if (res.ok || res.status === 202) {
      setState("sent");
      setFeedback("Sent");
      return;
    }

    if (res.status === 429) {
      setState("rate_limited");
      setFeedback(
        res.error ?? "Please wait a few minutes before requesting another link.",
      );
      return;
    }

    setState("error");
    setFeedback(res.error ?? "Could not send verification link right now.");
  }

  return (
    <div
      role="region"
      aria-label="Email verification notice"
      className="glass-amber border-x-0 border-t-0 rounded-none"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs sm:px-6">
        <div className="flex items-center gap-2 font-medium">
          <InfoIcon className="h-4 w-4 shrink-0" />
          <span>Verify your email to turn on price alerts</span>
        </div>

        <div className="flex items-center gap-2.5">
          {state === "sent" ? (
            <span
              role="status"
              className="inline-flex items-center gap-1 font-semibold"
            >
              <CheckIcon className="h-3.5 w-3.5" />
              <span>Sent</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={handleResend}
              disabled={state === "sending"}
              className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-[var(--amber-glass-border)] bg-white/30 dark:bg-black/20 px-3 py-1 text-xs font-semibold hover:bg-white/50 dark:hover:bg-black/35 cursor-pointer disabled:opacity-60"
            >
              {state === "sending" && (
                <SpinnerIcon className="h-3 w-3 animate-spin" />
              )}
              <span>{state === "sending" ? "Sending…" : "Resend link"}</span>
            </button>
          )}

          {(state === "rate_limited" || state === "error") && feedback && (
            <span role="alert" className="text-[11px] font-medium">
              {feedback}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
