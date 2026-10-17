import assert from "node:assert/strict";
import { test } from "node:test";
import { safeSameOriginUrl } from "./safeUrl.ts";

const TRUSTED = "https://trippie-mu.vercel.app";

test("safeSameOriginUrl rejects cross-origin, protocol-relative, and normalized //evil.example URLs", () => {
  const rejected = [
    `${TRUSTED}//evil.example`,
    `${TRUSTED}//evil.example/path?x=1`,
    "/a/..//evil.example",
    "/a/b/../..//evil.example",
    "//evil.example",
    "//evil.example/path",
    "\\\\evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://evil.example/",
    "https://evil.example/?origin=BLR",
    "http://trippie-mu.vercel.app/x",
    `https://user:pass@trippie-mu.vercel.app/x`,
    "",
    "   ",
  ];

  for (const input of rejected) {
    assert.equal(
      safeSameOriginUrl(input, TRUSTED),
      null,
      `Expected ${JSON.stringify(input)} to be rejected`,
    );
  }
});

test("safeSameOriginUrl accepts relative and same-origin URLs and returns an absolute URL on the trusted origin", () => {
  const r1 = safeSameOriginUrl("/?origin=BLR", TRUSTED);
  assert.equal(r1, `${TRUSTED}/?origin=BLR`);
  assert.equal(new URL(r1!).origin, TRUSTED);

  const r2 = safeSameOriginUrl(`${TRUSTED}/x?y=1`, TRUSTED);
  assert.equal(r2, `${TRUSTED}/x?y=1`);
  assert.equal(new URL(r2!).origin, TRUSTED);

  const r3 = safeSameOriginUrl(
    "/?origin=BLR&destination=IXZ&month=2027-02&trip=round&minGap=5&maxGap=7#results",
    "http://localhost:3111",
  );
  assert.equal(
    r3,
    "http://localhost:3111/?origin=BLR&destination=IXZ&month=2027-02&trip=round&minGap=5&maxGap=7#results",
  );
  assert.equal(new URL(r3!).origin, "http://localhost:3111");
});
