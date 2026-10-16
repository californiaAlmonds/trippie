"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";

function VerifyForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) {
      setStatus("error");
      setMessage("Missing verification token.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Verification failed.");
        return;
      }
      setStatus("done");
      setMessage("Your email has been verified and you are now signed in.");
    } catch {
      setStatus("error");
      setMessage("Network error while verifying email.");
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold">Confirm your email</h1>
      {status === "done" ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-green-700">{message}</p>
          <Link href="/" className="inline-block rounded bg-black px-4 py-2 text-sm text-white">
            Go to Trippie
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <p className="text-sm text-neutral-700">Click the button below to confirm your email address.</p>
          {!token && <p className="text-sm text-red-600">No verification token was provided in the link.</p>}
          {status === "error" && message && <p className="text-sm text-red-600">{message}</p>}
          <button
            type="submit"
            disabled={!token || status === "submitting"}
            className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {status === "submitting" ? "Confirming..." : "Confirm email"}
          </button>
        </form>
      )}
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md p-6 text-sm">Loading...</main>}>
      <VerifyForm />
    </Suspense>
  );
}
