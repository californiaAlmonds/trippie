"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

export default function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) {
      setStatus("error");
      setMessage("Missing reset token.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Invalid or expired link");
        return;
      }
      setStatus("done");
      setMessage("Your password has been updated. You can now sign in with your new password.");
      setPassword("");
    } catch {
      setStatus("error");
      setMessage("Network error while resetting password.");
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      {status === "done" ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-green-700">{message}</p>
          <Link href="/" className="inline-block rounded bg-black px-4 py-2 text-sm text-white">
            Back to Trippie
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {!token && <p className="text-sm text-red-600">No reset token was provided in the link.</p>}
          <div>
            <label htmlFor="new-password" className="block text-sm font-medium">
              New password (15–128 characters)
            </label>
            <input
              id="new-password"
              type="password"
              required
              minLength={15}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          {status === "error" && message && <p className="text-sm text-red-600">{message}</p>}
          <button
            type="submit"
            disabled={!token || status === "submitting"}
            className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {status === "submitting" ? "Updating..." : "Reset password"}
          </button>
        </form>
      )}
    </main>
  );
}
