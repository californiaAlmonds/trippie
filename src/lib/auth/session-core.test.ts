import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildClearSessionCookieOptions,
  buildSessionCookieOptions,
  computeSessionExpiry,
  generateSessionToken,
  hashSessionToken,
  isSessionCookieSecure,
  isSessionExpired,
  SESSION_TTL_MS,
  SESSION_TTL_SECONDS,
  sessionCookieName,
} from "./session-core.ts";

test("generateSessionToken produces 32-byte base64url tokens and hashSessionToken returns sha256 hex", () => {
  const t1 = generateSessionToken();
  const t2 = generateSessionToken();
  assert.notEqual(t1, t2);
  assert.equal(Buffer.from(t1, "base64url").length, 32);

  const h1 = hashSessionToken(t1);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(hashSessionToken(t1), h1);
  assert.notEqual(hashSessionToken(t2), h1);
});

test("computeSessionExpiry and isSessionExpired enforce 30-day TTL", () => {
  const now = 1_700_000_000_000;
  const exp = computeSessionExpiry(now);
  assert.equal(exp.getTime(), now + SESSION_TTL_MS);

  assert.equal(isSessionExpired(exp.toISOString(), now), false);
  assert.equal(isSessionExpired(exp.toISOString(), now + SESSION_TTL_MS - 1), false);
  assert.equal(isSessionExpired(exp.toISOString(), now + SESSION_TTL_MS), true);
  assert.equal(isSessionExpired("not-a-date", now), true);
});

test("cookie Secure flag and __Host- prefix depend on whether APP_ORIGIN starts with https", () => {
  const exp = new Date(1_700_000_000_000);

  // APP_ORIGIN starts with https -> secure = true, __Host-trippie_session
  assert.equal(isSessionCookieSecure("https://trippie.example.com"), true);
  assert.equal(sessionCookieName("https://trippie.example.com"), "__Host-trippie_session");
  assert.deepEqual(buildSessionCookieOptions(exp, "https://trippie.example.com"), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: true,
    expires: exp,
    maxAge: SESSION_TTL_SECONDS,
  });
  assert.equal(buildClearSessionCookieOptions("https://trippie.example.com").secure, true);
  assert.equal(buildClearSessionCookieOptions("https://trippie.example.com").maxAge, 0);

  // APP_ORIGIN http or unset -> secure = false, trippie_session
  for (const origin of ["http://localhost:3111", "http://localhost:3198", "", "   ", undefined]) {
    assert.equal(isSessionCookieSecure(origin), false);
    assert.equal(sessionCookieName(origin), "trippie_session");
    assert.equal(buildSessionCookieOptions(exp, origin).secure, false);
    assert.equal(buildClearSessionCookieOptions(origin).secure, false);
  }
});
