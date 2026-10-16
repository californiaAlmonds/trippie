import { emailBaseOrigin } from "../auth/tokens.ts";
import { orderedSites } from "../links.ts";
import { escapeHtml, mailConfigured, type SendMailInput, sendMail } from "../mailer.ts";
import { isMonthExpired } from "../plans/index.ts";
import type { TripMode } from "../search.ts";
import { getClient, getFreshFares } from "../store.ts";
import type { DayFare, TripWindow } from "../types.ts";
import { addDays, computeWindows, diffDays, monthBounds } from "../windows.ts";
import { appSecretConfigured, signUnsubscribeToken } from "./unsubscribe.ts";

export const MAX_ALERTS_PER_RUN = 200;

export interface AlertPlanRow {
  id: string;
  userId: string;
  email: string;
  origin: string;
  destination: string;
  month: string;
  trip: TripMode;
  minGap: number;
  maxGap: number;
  targetPrice: number | null;
  lastAlertPrice: number | null;
  revision: number;
}

export type AlertBestOptions =
  | { trip: "round"; bestPrice: number; windows: TripWindow[] }
  | { trip: "oneway"; bestPrice: number; days: DayFare[] };

export interface AlertRunHooks {
  beforeClaim?(plan: AlertPlanRow): Promise<void> | void;
  beforeComplete?(plan: AlertPlanRow): Promise<void> | void;
}

export interface AlertRunOptions {
  now?: Date;
  sendMail?: (input: SendMailInput) => Promise<void>;
  appSecret?: string;
  appOrigin?: string;
  maxEmails?: number;
  dryRun?: boolean;
  hooks?: AlertRunHooks;
}

export interface AlertRunSummary {
  dryRun: boolean;
  considered: number;
  wouldAlert: number;
  sent: number;
  failed: number;
  skipped: Record<string, number>;
}

const SQLITE_BUSY_RE = /SQLITE_BUSY|database is locked/i;

async function withBusyRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < 10 && SQLITE_BUSY_RE.test(String(err))) {
        await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

export function formatInr(amount: number): string {
  return Math.round(amount).toLocaleString("en-IN");
}

export function formatMonthYear(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Builds the alert email (text + HTML + optional List-Unsubscribe header).
 * Escapes all dynamic values in the HTML body using `escapeHtml`.
 */
export function buildAlertEmail(
  plan: AlertPlanRow,
  best: AlertBestOptions,
  options?: { appOrigin?: string; appSecret?: string },
): SendMailInput {
  const baseOrigin = emailBaseOrigin(options?.appOrigin ?? process.env.APP_ORIGIN);
  const token = signUnsubscribeToken(plan.id, options?.appSecret ?? process.env.APP_SECRET);
  const unsubscribeUrl = `${baseOrigin}/unsubscribe?token=${encodeURIComponent(token)}`;

  const monthLabel = formatMonthYear(plan.month);
  const bestFormatted = formatInr(best.bestPrice);
  const subject = `Trippie: ${plan.origin} → ${plan.destination} from ₹${bestFormatted} in ${monthLabel}`;

  const sites = orderedSites("google");

  const textLines: string[] = [
    `Price alert for ${plan.origin} → ${plan.destination} (${monthLabel})`,
    `Best price found: ₹${bestFormatted}`,
    "",
  ];

  const htmlItems: string[] = [];

  if (best.trip === "round") {
    textLines.push("Top cheapest round-trip windows:");
    for (const w of best.windows.slice(0, 3)) {
      const airlines = [w.depart.airline, w.ret.airline].filter(Boolean).join(" / ");
      const airlineSuffix = airlines ? ` (${airlines})` : "";
      textLines.push(
        `- ${w.depart.date} to ${w.ret.date} (${w.gap}d): ₹${formatInr(w.total)} (out ₹${formatInr(w.depart.price)}, back ₹${formatInr(w.ret.price)})${airlineSuffix}`,
      );
      for (const site of sites) {
        textLines.push(`  ${site.label}: ${site.url(plan.origin, plan.destination, w.depart.date, w.ret.date)}`);
      }

      const linksHtml = sites
        .map((site) => {
          const href = escapeHtml(site.url(plan.origin, plan.destination, w.depart.date, w.ret.date));
          const label = escapeHtml(site.label);
          return `<a href="${href}">${label}</a>`;
        })
        .join(" &middot; ");

      const airlineHtml = airlines ? ` &mdash; <span>${escapeHtml(airlines)}</span>` : "";
      htmlItems.push(
        `<li><strong>${escapeHtml(w.depart.date)} &rarr; ${escapeHtml(w.ret.date)}</strong> (${w.gap}d): <strong>&#8377;${escapeHtml(formatInr(w.total))}</strong> (&#8377;${escapeHtml(formatInr(w.depart.price))} + &#8377;${escapeHtml(formatInr(w.ret.price))})${airlineHtml}<br/>${linksHtml}</li>`,
      );
    }
  } else {
    textLines.push("Top cheapest one-way dates:");
    for (const d of best.days.slice(0, 3)) {
      const airlineSuffix = d.airline ? ` (${d.airline})` : "";
      textLines.push(`- ${d.date}: ₹${formatInr(d.price)}${airlineSuffix}`);
      for (const site of sites) {
        textLines.push(`  ${site.label}: ${site.url(plan.origin, plan.destination, d.date)}`);
      }

      const linksHtml = sites
        .map((site) => {
          const href = escapeHtml(site.url(plan.origin, plan.destination, d.date));
          const label = escapeHtml(site.label);
          return `<a href="${href}">${label}</a>`;
        })
        .join(" &middot; ");

      const airlineHtml = d.airline ? ` &mdash; <span>${escapeHtml(d.airline)}</span>` : "";
      htmlItems.push(
        `<li><strong>${escapeHtml(d.date)}</strong>: <strong>&#8377;${escapeHtml(formatInr(d.price))}</strong>${airlineHtml}<br/>${linksHtml}</li>`,
      );
    }
  }

  textLines.push("", `Unsubscribe from this alert: ${unsubscribeUrl}`);

  const safeOrigin = escapeHtml(plan.origin);
  const safeDest = escapeHtml(plan.destination);
  const safeMonth = escapeHtml(monthLabel);
  const safeBest = escapeHtml(bestFormatted);
  const safeUnsubUrl = escapeHtml(unsubscribeUrl);

  const html = [
    `<p>Price alert for <strong>${safeOrigin} &rarr; ${safeDest}</strong> in ${safeMonth}: best fare from <strong>&#8377;${safeBest}</strong>.</p>`,
    `<ul>${htmlItems.join("")}</ul>`,
    `<p><a href="${safeUnsubUrl}">Unsubscribe from alerts for this plan</a></p>`,
  ].join("");

  const headers: Record<string, string> | undefined = baseOrigin.startsWith("https://")
    ? { "List-Unsubscribe": `<${unsubscribeUrl}>` }
    : undefined;

  return {
    to: plan.email,
    subject,
    text: textLines.join("\n"),
    html,
    ...(headers ? { headers } : {}),
  };
}

/**
 * Evaluates all active alert plans against fresh fares (snapshot_day >= today - 1 UTC)
 * and sends at most 200 alert emails per run with at-most-once daily ledger claiming.
 */
export async function runAlerts(options?: AlertRunOptions): Promise<AlertRunSummary> {
  const now = options?.now ?? new Date();
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);
  const minSnapshotDay = addDays(today, -1);

  const appSecret = options?.appSecret ?? process.env.APP_SECRET;
  const appOrigin = options?.appOrigin ?? process.env.APP_ORIGIN;
  const maxEmails = options?.maxEmails ?? MAX_ALERTS_PER_RUN;
  const hasCustomSender = typeof options?.sendMail === "function";
  const sendMailFn = options?.sendMail ?? sendMail;

  const dryRun =
    options?.dryRun ?? (!appSecretConfigured(appSecret) || (!hasCustomSender && !mailConfigured()));

  const skipped: Record<string, number> = {};
  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  const client = await getClient();
  const rs = await client.execute({
    sql: `SELECT p.id, p.user_id, p.origin, p.destination, p.month, p.trip,
                 p.min_gap, p.max_gap, p.alert_enabled, p.target_price,
                 p.last_alert_price, p.last_alert_at, p.revision, p.created_at,
                 u.email, u.verified_at
          FROM plans p
          JOIN users u ON u.id = p.user_id
          WHERE p.alert_enabled = 1
          ORDER BY p.created_at ASC, p.id ASC`,
    args: [],
  });

  let considered = 0;
  let wouldAlert = 0;
  let sent = 0;
  let failed = 0;

  for (const row of rs.rows) {
    considered++;

    if (row.verified_at == null) {
      skip("unverified");
      continue;
    }

    const month = String(row.month);
    if (isMonthExpired(month, now)) {
      skip("expired");
      continue;
    }

    const plan: AlertPlanRow = {
      id: String(row.id),
      userId: String(row.user_id),
      email: String(row.email),
      origin: String(row.origin),
      destination: String(row.destination),
      month,
      trip: String(row.trip) as TripMode,
      minGap: Number(row.min_gap),
      maxGap: Number(row.max_gap),
      targetPrice: row.target_price == null ? null : Number(row.target_price),
      lastAlertPrice: row.last_alert_price == null ? null : Number(row.last_alert_price),
      revision: Number(row.revision ?? 0),
    };

    const { first, last } = monthBounds(plan.month);
    const outFrom = first >= today ? first : today;
    if (outFrom > last) {
      skip("expired");
      continue;
    }
    const expectedOutDates = diffDays(outFrom, last) + 1;
    if (expectedOutDates <= 0) {
      skip("expired");
      continue;
    }
    const outbound = await getFreshFares(plan.origin, plan.destination, outFrom, last, minSnapshotDay);
    if (outbound.length * 2 < expectedOutDates) {
      skip("insufficient data");
      continue;
    }

    let best: AlertBestOptions;
    if (plan.trip === "oneway") {
      const days = [...outbound].sort((a, b) => a.price - b.price || (a.date < b.date ? -1 : 1));
      if (days.length === 0) {
        skip("insufficient data");
        continue;
      }
      best = { trip: "oneway", bestPrice: days[0].price, days: days.slice(0, 3) };
    } else {
      const inFrom = addDays(outFrom, plan.minGap);
      const inTo = addDays(last, plan.maxGap);
      const expectedInDates = diffDays(inFrom, inTo) + 1;
      const inbound = await getFreshFares(plan.destination, plan.origin, inFrom, inTo, minSnapshotDay);
      if (inbound.length * 2 < expectedInDates) {
        skip("insufficient data");
        continue;
      }
      const windows = computeWindows(outbound, inbound, plan.minGap, plan.maxGap);
      if (windows.length === 0) {
        skip("insufficient data");
        continue;
      }
      best = { trip: "round", bestPrice: windows[0].total, windows: windows.slice(0, 3) };
    }

    const B = best.bestPrice;
    if (plan.targetPrice !== null && B > plan.targetPrice) {
      skip("above target");
      continue;
    }
    if (plan.lastAlertPrice !== null && B >= plan.lastAlertPrice) {
      skip("no price drop");
      continue;
    }

    if (dryRun) {
      wouldAlert++;
      continue;
    }

    if (sent >= maxEmails) {
      skip("cap reached");
      continue;
    }

    await options?.hooks?.beforeClaim?.(plan);

    const claimRs = await withBusyRetry(() =>
      client.execute({
        sql: `INSERT OR IGNORE INTO alert_deliveries(plan_id, day, status, created_at)
              SELECT ?, ?, 'claimed', ?
              WHERE EXISTS (
                SELECT 1 FROM plans p
                JOIN users u ON u.id = p.user_id
                WHERE p.id = ?
                  AND p.alert_enabled = 1
                  AND p.revision = ?
                  AND u.verified_at IS NOT NULL
                  AND (p.target_price IS NULL OR p.target_price >= ?)
              )`,
        args: [plan.id, today, nowIso, plan.id, plan.revision, B],
      }),
    );

    if ((claimRs.rowsAffected ?? 0) === 0) {
      skip("already claimed");
      continue;
    }

    wouldAlert++;

    try {
      const emailPayload = buildAlertEmail(plan, best, { appOrigin, appSecret });
      await sendMailFn(emailPayload);
    } catch {
      failed++;
      await withBusyRetry(() =>
        client.execute({
          sql: "UPDATE alert_deliveries SET status = 'failed' WHERE plan_id = ? AND day = ?",
          args: [plan.id, today],
        }),
      );
      continue;
    }

    await options?.hooks?.beforeComplete?.(plan);

    await withBusyRetry(() =>
      client.batch(
        [
          {
            sql: "UPDATE alert_deliveries SET status = 'sent' WHERE plan_id = ? AND day = ?",
            args: [plan.id, today],
          },
          {
            sql: "UPDATE plans SET last_alert_price = ?, last_alert_at = ? WHERE id = ? AND revision = ?",
            args: [B, nowIso, plan.id, plan.revision],
          },
        ],
        "write",
      ),
    );
    sent++;
  }

  return {
    dryRun,
    considered,
    wouldAlert,
    sent,
    failed,
    skipped,
  };
}
