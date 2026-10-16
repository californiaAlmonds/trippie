import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 2 ** 15; // 32768
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const KEY_LEN = 64;
const MAX_MEM = 64 * 1024 * 1024; // 64 MiB
const MAX_CONCURRENT = 2;

export const PASSWORD_MIN_LEN = 15;
export const PASSWORD_MAX_LEN = 128;

// Semaphore limiting concurrent scrypt invocations to 2.
let activeCount = 0;
const queue: Array<() => void> = [];

async function withSemaphore<T>(fn: () => Promise<T>): Promise<T> {
  if (activeCount >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  activeCount++;
  try {
    return await fn();
  } finally {
    activeCount--;
    const next = queue.shift();
    if (next) next();
  }
}

function deriveKey(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return withSemaphore(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        scryptCb(password, salt, KEY_LEN, { N, r, p, maxmem: MAX_MEM }, (err, derivedKey) => {
          if (err) reject(err);
          else resolve(derivedKey);
        });
      }),
  );
}

export type PasswordPolicyResult = { ok: true } | { ok: false; error: string };

/** Policy: 15..128 characters, spaces and any characters allowed, no composition rules; reject NUL. */
export function validatePasswordPolicy(password: unknown): PasswordPolicyResult {
  if (typeof password !== "string") {
    return { ok: false, error: "Password is required" };
  }
  if (password.includes("\0")) {
    return { ok: false, error: "Password cannot contain NUL characters" };
  }
  if (password.length < PASSWORD_MIN_LEN) {
    return { ok: false, error: `Password must be at least ${PASSWORD_MIN_LEN} characters` };
  }
  if (password.length > PASSWORD_MAX_LEN) {
    return { ok: false, error: `Password must be at most ${PASSWORD_MAX_LEN} characters` };
  }
  return { ok: true };
}

/** Hashes a password with scrypt(N=2^15, r=8, p=1) and returns `scrypt$N$r$p$saltB64$hashB64`. */
export async function hashPassword(password: string): Promise<string> {
  const check = validatePasswordPolicy(password);
  if (!check.ok) {
    throw new Error(check.error);
  }
  const salt = randomBytes(SALT_BYTES);
  const hash = await deriveKey(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

const STRICT_INT = /^\d+$/;
const STRICT_B64 = /^[A-Za-z0-9+/]+=*$/;

function parseStoredHash(stored: string): { N: number; r: number; p: number; salt: Buffer; expected: Buffer } | null {
  if (typeof stored !== "string") return null;
  const parts = stored.split("$");
  if (parts.length !== 6) return null;
  const [alg, nStr, rStr, pStr, saltB64, hashB64] = parts;
  if (alg !== "scrypt") return null;
  if (!STRICT_INT.test(nStr) || !STRICT_INT.test(rStr) || !STRICT_INT.test(pStr)) return null;

  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);

  // Validate scrypt parameters to reject absurd values or DoS params.
  // N must be a power of 2 in [16384, 32768], r in [1, 16], p in [1, 4], and 128*N*r*p < MAX_MEM.
  if (!Number.isSafeInteger(N) || N < 16384 || N > 32768 || (N & (N - 1)) !== 0) return null;
  if (!Number.isSafeInteger(r) || r < 1 || r > 16) return null;
  if (!Number.isSafeInteger(p) || p < 1 || p > 4) return null;
  if (128 * N * r * p > MAX_MEM / 2) return null;

  if (!saltB64 || !hashB64 || !STRICT_B64.test(saltB64) || !STRICT_B64.test(hashB64)) return null;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  if (salt.length !== SALT_BYTES || expected.length !== KEY_LEN) return null;
  if (salt.toString("base64") !== saltB64 || expected.toString("base64") !== hashB64) return null;

  return { N, r, p, salt, expected };
}

/** Verifies a candidate password against a stored `scrypt$N$r$p$saltB64$hashB64` string. */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (typeof password !== "string" || password.includes("\0") || password.length > PASSWORD_MAX_LEN) {
    return false;
  }
  const parsed = parseStoredHash(storedHash);
  if (!parsed) return false;
  try {
    const actual = await deriveKey(password, parsed.salt, parsed.N, parsed.r, parsed.p);
    if (actual.length !== parsed.expected.length) return false;
    return timingSafeEqual(actual, parsed.expected);
  } catch {
    return false;
  }
}

const DUMMY_SALT = randomBytes(SALT_BYTES);
const DUMMY_EXPECTED = randomBytes(KEY_LEN);

/** Burns equivalent scrypt time for unknown emails so login timing does not leak account existence. */
export async function dummyVerify(password = "dummy-password-placeholder"): Promise<void> {
  const safeInput =
    typeof password === "string" && !password.includes("\0") && password.length <= PASSWORD_MAX_LEN
      ? password
      : "dummy-password-placeholder";
  try {
    const derived = await deriveKey(safeInput, DUMMY_SALT, SCRYPT_N, SCRYPT_R, SCRYPT_P);
    timingSafeEqual(derived, DUMMY_EXPECTED);
  } catch {
    // Ignore errors in dummy verification
  }
}
