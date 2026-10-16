import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { dummyVerify, hashPassword, validatePasswordPolicy, verifyPassword } from "./password.ts";

test("password policy enforces 15..128 chars, allows spaces/symbols, and rejects NUL", () => {
  assert.equal(validatePasswordPolicy("short password").ok, false); // 14 chars
  assert.equal(validatePasswordPolicy("123456789012345").ok, true); // 15 chars
  assert.equal(validatePasswordPolicy("a spaces and symbols !@#$%^&*() passphrase").ok, true);
  assert.equal(validatePasswordPolicy("x".repeat(128)).ok, true);
  assert.equal(validatePasswordPolicy("x".repeat(129)).ok, false);
  assert.equal(validatePasswordPolicy("valid-length-with-\0-nul-byte").ok, false);
  assert.equal(validatePasswordPolicy(null).ok, false);
});

test("hashPassword and verifyPassword round trip and reject wrong passwords", async () => {
  const pw = "correct horse battery staple!";
  const stored = await hashPassword(pw);
  assert.match(stored, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);

  assert.equal(await verifyPassword(pw, stored), true);
  assert.equal(await verifyPassword("wrong horse battery staple!", stored), false);
  assert.equal(await verifyPassword("correct horse battery staple!\0", stored), false);
});

test("verifyPassword rejects malformed stored hashes and absurd scrypt parameters", async () => {
  const validSalt = randomBytes(16).toString("base64");
  const validHash = randomBytes(64).toString("base64");

  const malformed = [
    "",
    "bcrypt$32768$8$1$" + validSalt + "$" + validHash,
    "scrypt$32768$8$1$" + validSalt,
    "scrypt$30000$8$1$" + validSalt + "$" + validHash, // N not power of 2
    "scrypt$1048576$8$1$" + validSalt + "$" + validHash, // N too large
    "scrypt$512$8$1$" + validSalt + "$" + validHash, // N too small
    "scrypt$32768$64$1$" + validSalt + "$" + validHash, // r too large
    "scrypt$32768$8$16$" + validSalt + "$" + validHash, // p too large
    "scrypt$32768$8$1$not_base64!$" + validHash,
    "scrypt$32768$8$1$" + randomBytes(8).toString("base64") + "$" + validHash, // wrong salt len
    "scrypt$32768$8$1$" + validSalt + "$" + randomBytes(32).toString("base64"), // wrong hash len
  ];

  for (const h of malformed) {
    assert.equal(await verifyPassword("correct horse battery staple!", h), false, `Expected false for: ${h}`);
  }
});

test("dummyVerify completes without error and semaphore handles >2 concurrent hashes", async () => {
  const results = await Promise.all([
    hashPassword("first concurrent password 123"),
    hashPassword("second concurrent password 123"),
    hashPassword("third concurrent password 123"),
    dummyVerify("unknown user password"),
  ]);
  assert.equal(typeof results[0], "string");
  assert.equal(typeof results[1], "string");
  assert.equal(typeof results[2], "string");
});
