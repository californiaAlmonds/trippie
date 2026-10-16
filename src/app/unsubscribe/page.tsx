import { Suspense } from "react";
import UnsubscribeForm from "@/components/auth/UnsubscribeForm";

type SearchParams = Promise<{ token?: string | string[] }>;

async function UnsubscribeTokenReader({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = sp.token;
  const token = typeof raw === "string" ? raw : Array.isArray(raw) ? (raw[0] ?? "") : "";
  return <UnsubscribeForm token={token} />;
}

export default function UnsubscribePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md p-6 text-sm">Loading...</main>}>
      <UnsubscribeTokenReader searchParams={searchParams} />
    </Suspense>
  );
}
