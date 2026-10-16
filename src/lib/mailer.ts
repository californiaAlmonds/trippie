import nodemailer from "nodemailer";

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
  devLink?: string;
}

/** True iff SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM are all set. */
export function mailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const port = Number(env.SMTP_PORT);
  return Boolean(
    env.SMTP_HOST?.trim() &&
      env.SMTP_PORT?.trim() &&
      Number.isInteger(port) &&
      port > 0 &&
      env.SMTP_USER?.trim() &&
      env.SMTP_PASS &&
      env.SMTP_FROM?.trim(),
  );
}

/** Escapes HTML special characters for safe interpolation into HTML email templates. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE_TOKEN = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Sends an email via SMTP with TLS and strict certificate validation.
 * When SMTP is not configured:
 * - in `'production'`, throws;
 * - in `'development'`, prints a single line with the subject and `devLink`;
 * - in any other environment (e.g. `'test'` or unset), logs only a fixed generic line with no URL or PII.
 * Never logs recipient addresses, tokens (outside development), SMTP error messages, or email bodies.
 */
export async function sendMail(input: SendMailInput): Promise<void> {
  if (!mailConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMTP is not configured");
    }
    if (process.env.NODE_ENV === "development") {
      console.info(`[dev-mail] subject=${JSON.stringify(input.subject)} link=${input.devLink ?? ""}`);
      return;
    }
    console.info("mail not configured; message skipped");
    return;
  }

  const host = process.env.SMTP_HOST!.trim();
  const port = Number(process.env.SMTP_PORT!.trim());
  const user = process.env.SMTP_USER!.trim();
  const pass = process.env.SMTP_PASS!;
  const from = process.env.SMTP_FROM!.trim();
  const secure = port === 465;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: true,
    },
  });

  try {
    await transporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      headers: input.headers,
    });
  } catch (err) {
    const rawName = err instanceof Error && SAFE_TOKEN.test(err.name) ? err.name : "Error";
    const rawCode =
      err && typeof err === "object" && "code" in err && typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : "unknown";
    const safeCode = SAFE_TOKEN.test(rawCode) ? rawCode : "unknown";
    console.error(`mail send failed (name=${rawName}, code=${safeCode})`);
    throw new Error("Failed to send email");
  }
}

/** Builds a verification email payload with escaped HTML and `devLink`. */
export function buildVerifyEmail(to: string, verifyUrl: string): SendMailInput {
  const safeUrl = escapeHtml(verifyUrl);
  return {
    to,
    subject: "Confirm your Trippie email",
    text: `Confirm your Trippie email by opening this link (valid for 24 hours):\n\n${verifyUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Confirm your Trippie email by opening the link below (valid for 24 hours):</p><p><a href="${safeUrl}">${safeUrl}</a></p><p>If you did not request this, you can ignore this email.</p>`,
    devLink: verifyUrl,
  };
}

/** Builds a password reset email payload with escaped HTML and `devLink`. */
export function buildResetEmail(to: string, resetUrl: string): SendMailInput {
  const safeUrl = escapeHtml(resetUrl);
  return {
    to,
    subject: "Reset your Trippie password",
    text: `Reset your Trippie password by opening this link (valid for 1 hour):\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Reset your Trippie password by opening the link below (valid for 1 hour):</p><p><a href="${safeUrl}">${safeUrl}</a></p><p>If you did not request this, you can ignore this email.</p>`,
    devLink: resetUrl,
  };
}
