import { Suspense } from "react";
import { connection } from "next/server";
import Planner from "@/components/Planner";

// Next February; per-request because it depends on today's date.
async function PlannerWithDefaults() {
  await connection();
  const now = new Date();
  const year = now.getUTCMonth() >= 2 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  return <Planner defaultMonth={`${year}-02`} />;
}

export default function Home() {
  return (
    <Suspense>
      <PlannerWithDefaults />
    </Suspense>
  );
}
