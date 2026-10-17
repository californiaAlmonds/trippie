/**
 * Validates a notification target URL against `trustedOrigin`.
 * Returns an absolute `http(s)` URL (`url.href`) whose origin matches `trustedOrigin`
 * and whose normalized pathname is not a protocol-relative path (`//...`),
 * or `null` if invalid or cross-origin.
 */
export function safeSameOriginUrl(
  input: string,
  trustedOrigin: string,
): string | null {
  if (typeof input !== "string" || typeof trustedOrigin !== "string") {
    return null;
  }

  const trimmed = input.trim();
  const originTrimmed = trustedOrigin.trim();
  if (!trimmed || !originTrimmed) {
    return null;
  }

  let base: URL;
  try {
    base = new URL(originTrimmed);
  } catch {
    return null;
  }

  if (base.protocol !== "http:" && base.protocol !== "https:") {
    return null;
  }
  if (base.origin !== originTrimmed.replace(/\/+$/, "")) {
    return null;
  }

  if (trimmed.startsWith("//") || trimmed.startsWith("\\")) {
    return null;
  }
  if (!trimmed.startsWith("/") && !/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed, base.origin);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  if (url.origin !== base.origin) {
    return null;
  }
  if (url.username || url.password) {
    return null;
  }
  if (
    !url.pathname.startsWith("/") ||
    url.pathname.startsWith("//") ||
    url.pathname.includes("\\")
  ) {
    return null;
  }

  return url.href;
}
