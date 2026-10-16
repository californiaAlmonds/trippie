import { Suspense } from "react";
import VerifyForm from "@/components/auth/VerifyForm";

type SearchParams = Promise<{ token?: string | string[] }>;

async function VerifyTokenReader({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = sp.token;
  const token = typeof raw === "string" ? raw : Array.isArray(raw) ? (raw[0] ?? "") : "";
  return <VerifyForm token={token} />;
}

export default function VerifyPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md p-6 text-sm">Loading...</main>}>
      <VerifyTokenReader searchParams={searchParams} />
    </Suspense>
  );
}
