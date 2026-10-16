import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildClearSessionCookieOptions,
  buildSessionCookieOptions,
  computeSessionExpiry,
  generateSessionToken,
  hashSessionToken,
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

test("cookie name and options switch between __Host-trippie_session (https) and trippie_session (http)", () => {
  const exp = new Date(1_700_000_000_000);

  assert.equal(sessionCookieName("https://trippie.example.com"), "__Host-trippie_session");
  assert.equal(sessionCookieName("http://localhost:3000"), "trippie_session");
  assert.equal(sessionCookieName(""), "trippie_session");

  const httpsOpts = buildSessionCookieOptions(exp, "https://trippie.example.com");
  assert.deepEqual(httpsOpts, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: true,
    expires: exp,
    maxAge: SESSION_TTL_SECONDS,
  });

  const httpOpts = buildSessionCookieOptions(exp, "http://localhost:3000");
  assert.equal(httpOpts.secure, false);
  assert.equal(httpOpts.httpOnly, true);
  assert.equal(httpOpts.sameSite, "lax");
  assert.equal(httpOpts.path, "/");

  const clearOpts = buildClearSessionCookieOptions("https://trippie.example.com");
  assert.equal(clearOpts.maxAge, 0);
  assert.equal(clearOpts.secure, true);
  assert.equal(clearOpts.expires.getTime(), 0);
});
