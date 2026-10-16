import { Suspense } from "react";
import ResetForm from "@/components/auth/ResetForm";

type SearchParams = Promise<{ token?: string | string[] }>;

async function ResetTokenReader({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = sp.token;
  const token = typeof raw === "string" ? raw : Array.isArray(raw) ? (raw[0] ?? "") : "";
  return <ResetForm token={token} />;
}

export default function ResetPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md p-6 text-sm">Loading...</main>}>
      <ResetTokenReader searchParams={searchParams} />
    </Suspense>
  );
}
