import nodemailer from "nodemailer";

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

/** True when all required SMTP environment variables are set and non-empty. */
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

const SAFE_ERROR_CODE = /^[A-Za-z0-9_-]{1,32}$/;

/** Sends an email via SMTP with TLS and strict certificate validation. Never logs sensitive data. */
export async function sendMail(input: SendMailInput): Promise<void> {
  if (!mailConfigured()) {
    throw new Error("SMTP is not configured");
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
    const rawCode =
      err && typeof err === "object" && "code" in err && typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : "unknown";
    const safeCode = SAFE_ERROR_CODE.test(rawCode) ? rawCode : "unknown";
    console.error(`mail send failed (code=${safeCode})`);
    throw new Error("Failed to send email");
  }
}

/** Builds a plain and short verification email payload with escaped HTML. */
export function buildVerifyEmail(to: string, verifyUrl: string): SendMailInput {
  const safeUrl = escapeHtml(verifyUrl);
  return {
    to,
    subject: "Confirm your Trippie email",
    text: `Confirm your Trippie email by opening this link (valid for 24 hours):\n\n${verifyUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Confirm your Trippie email by opening the link below (valid for 24 hours):</p><p><a href="${safeUrl}">${safeUrl}</a></p><p>If you did not request this, you can ignore this email.</p>`,
  };
}

/** Builds a plain and short password reset email payload with escaped HTML. */
export function buildResetEmail(to: string, resetUrl: string): SendMailInput {
  const safeUrl = escapeHtml(resetUrl);
  return {
    to,
    subject: "Reset your Trippie password",
    text: `Reset your Trippie password by opening this link (valid for 1 hour):\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Reset your Trippie password by opening the link below (valid for 1 hour):</p><p><a href="${safeUrl}">${safeUrl}</a></p><p>If you did not request this, you can ignore this email.</p>`,
  };
}
