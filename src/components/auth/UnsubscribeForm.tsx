"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

export default function UnsubscribeForm({ token }: { token: string }) {
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
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
    try {
      const res = await fetch("/api/alerts/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Invalid or expired link");
        return;
      }
      setStatus("done");
      setMessage("Price alerts have been disabled for this plan.");
    } catch {
      setStatus("error");
      setMessage("Network error while unsubscribing.");
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold">Unsubscribe from price alerts</h1>
      {status === "done" ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-green-700">{message}</p>
          <Link href="/" className="inline-block rounded bg-black px-4 py-2 text-sm text-white">
            Go to Trippie
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <p className="text-sm text-neutral-700">
            Click the button below to stop receiving email price alerts for this saved plan.
          </p>
          {!token && <p className="text-sm text-red-600">No unsubscribe token was provided in the link.</p>}
          {status === "error" && message && <p className="text-sm text-red-600">{message}</p>}
          <button
            type="submit"
            disabled={!token || status === "submitting"}
            className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {status === "submitting" ? "Unsubscribing..." : "Unsubscribe"}
          </button>
        </form>
      )}
    </main>
  );
}
