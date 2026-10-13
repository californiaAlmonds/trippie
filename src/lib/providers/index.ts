import type { FareProvider } from "../types.ts";
import { demoProvider } from "./demo.ts";
import { travelpayoutsProvider } from "./travelpayouts.ts";

export function getProvider(): FareProvider {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  const choice = process.env.FARE_PROVIDER ?? (token ? "travelpayouts" : "demo");
  if (choice === "travelpayouts") {
    if (!token) throw new Error("FARE_PROVIDER=travelpayouts requires TRAVELPAYOUTS_TOKEN");
    return travelpayoutsProvider(token);
  }
  return demoProvider;
}
