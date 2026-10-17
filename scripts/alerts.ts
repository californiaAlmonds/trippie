import { runAlerts } from "../src/lib/alerts/engine.ts";
import { getClient } from "../src/lib/store.ts";

async function main() {
  try {
    const summary = await runAlerts();
    const skippedParts = Object.entries(summary.skipped)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([reason, count]) => `${reason}=${count}`)
      .join(", ");

    if (summary.dryRun) {
      console.log(
        `alerts [dry-run]: considered=${summary.considered} would_alert=${summary.wouldAlert} email_sent=${summary.email_sent} push_sent=${summary.push_sent} invalid_tokens_removed=${summary.invalid_tokens_removed} skipped={${skippedParts || "none"}}`,
      );
    } else {
      console.log(
        `alerts: considered=${summary.considered} sent=${summary.sent} email_sent=${summary.email_sent} push_sent=${summary.push_sent} invalid_tokens_removed=${summary.invalid_tokens_removed} failed=${summary.failed} skipped={${skippedParts || "none"}}`,
      );
    }
  } finally {
    try {
      const client = await getClient();
      client.close();
    } catch {
      // Ignore close errors on exit
    }
  }
}

await main();
