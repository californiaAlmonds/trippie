import { Suspense } from "react";
import VerifyForm from "@/components/auth/VerifyForm";

type SearchParams = Promise<{ token?: string | string[] }>;

async function VerifyTokenReader({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const raw = sp.token;
  const token =
    typeof raw === "string" ? raw : Array.isArray(raw) ? (raw[0] ?? "") : "";
  return <VerifyForm token={token} />;
}

export default function VerifyPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12">
          <div className="glass-strong p-6 sm:p-8">
            <div className="skeleton-shimmer h-6 w-44 rounded-lg" />
            <div className="skeleton-shimmer mt-4 h-12 w-full rounded-2xl" />
          </div>
        </main>
      }
    >
      <VerifyTokenReader searchParams={searchParams} />
    </Suspense>
  );
}
