import assert from "node:assert/strict";
import { test } from "node:test";
import { checkOrigin, clientKey, readJson } from "./guard.ts";

test("checkOrigin accepts matching Origin and rejects missing or mismatched Origin", () => {
  const reqNoOrigin = new Request("http://localhost:3111/api/auth/login", { method: "POST" });
  const resNoOrigin = checkOrigin(reqNoOrigin, "");
  assert.equal(resNoOrigin?.status, 403);
  assert.equal(resNoOrigin?.headers.get("Cache-Control"), "no-store");

  const reqWrongOrigin = new Request("http://localhost:3111/api/auth/login", {
    method: "POST",
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(checkOrigin(reqWrongOrigin, "")?.status, 403);

  const reqGoodOrigin = new Request("http://localhost:3111/api/auth/login", {
    method: "POST",
    headers: { Origin: "http://localhost:3111" },
  });
  assert.equal(checkOrigin(reqGoodOrigin, ""), null);
  assert.equal(checkOrigin(reqGoodOrigin, "https://trippie.example.com")?.status, 403);
  assert.equal(checkOrigin(reqGoodOrigin, "http://localhost:3111"), null);
});

test("readJson validates Content-Type, size limit (16 KB), and JSON object syntax", async () => {
  const badCt = new Request("http://localhost:3111/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: '{"a":1}',
  });
  const r1 = await readJson(badCt);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.response.status, 415);

  const tooBig = new Request("http://localhost:3111/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: "x".repeat(20_000) }),
  });
  const r2 = await readJson(tooBig);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.response.status, 413);

  const badJson = new Request("http://localhost:3111/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not-json",
  });
  const r3 = await readJson(badJson);
  assert.equal(r3.ok, false);
  if (!r3.ok) assert.equal(r3.response.status, 400);

  const arrayJson = new Request("http://localhost:3111/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "[1,2,3]",
  });
  const r4 = await readJson(arrayJson);
  assert.equal(r4.ok, false);
  if (!r4.ok) assert.equal(r4.response.status, 400);

  const goodJson = new Request("http://localhost:3111/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "a@b.co" }),
  });
  const r5 = await readJson<{ email: string }>(goodJson);
  assert.equal(r5.ok, true);
  if (r5.ok) assert.equal(r5.data.email, "a@b.co");
});

test("clientKey returns 'shared' unless TRUSTED_PROXY=1 and returns first X-Forwarded-For hop only then", () => {
  const prev = process.env.TRUSTED_PROXY;
  try {
    delete process.env.TRUSTED_PROXY;
    const reqWithXff = new Request("http://localhost:3111/api/auth/login", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    const reqWithoutXff = new Request("http://localhost:3111/api/auth/login");
    const reqBlankXff = new Request("http://localhost:3111/api/auth/login", {
      headers: { "x-forwarded-for": "   " },
    });

    assert.equal(clientKey(reqWithXff), "shared");
    assert.equal(clientKey(reqWithoutXff), "shared");

    process.env.TRUSTED_PROXY = "0";
    assert.equal(clientKey(reqWithXff), "shared");

    process.env.TRUSTED_PROXY = "true";
    assert.equal(clientKey(reqWithXff), "shared");

    process.env.TRUSTED_PROXY = "1";
    assert.equal(clientKey(reqWithXff), "203.0.113.7");
    assert.equal(clientKey(reqWithoutXff), "shared");
    assert.equal(clientKey(reqBlankXff), "shared");
  } finally {
    if (prev === undefined) delete process.env.TRUSTED_PROXY;
    else process.env.TRUSTED_PROXY = prev;
  }
});
