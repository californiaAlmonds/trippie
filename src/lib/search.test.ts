import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSearch } from "./search.ts";

test("parseSearch defaults trip to round and requires valid gaps", () => {
  const ok = parseSearch(new URLSearchParams("origin=blr&destination=ixz&month=2027-02&minGap=5&maxGap=7"));
  assert.deepEqual(ok, { origin: "BLR", destination: "IXZ", month: "2027-02", trip: "round", minGap: 5, maxGap: 7, cabin: "economy" });

  const missingGap = parseSearch(new URLSearchParams("origin=BLR&destination=IXZ&month=2027-02"));
  assert.ok("error" in missingGap);

  const invalidGap = parseSearch(new URLSearchParams("origin=BLR&destination=IXZ&month=2027-02&minGap=8&maxGap=5"));
  assert.ok("error" in invalidGap);
});

test("parseSearch accepts trip=oneway without minGap/maxGap and sets gaps to 0", () => {
  const res = parseSearch(new URLSearchParams("origin=BLR&destination=IXZ&month=2027-02&trip=oneway"));
  assert.deepEqual(res, { origin: "BLR", destination: "IXZ", month: "2027-02", trip: "oneway", minGap: 0, maxGap: 0, cabin: "economy" });
  const biz = parseSearch(new URLSearchParams("origin=BLR&destination=IXZ&month=2027-02&trip=oneway&cabin=business"));
  assert.equal("cabin" in biz && biz.cabin, "business");
  assert.ok("error" in parseSearch(new URLSearchParams("origin=BLR&destination=IXZ&month=2027-02&trip=oneway&cabin=first")));
});

test("parseSearch rejects invalid trip values", () => {
  const res = parseSearch(new URLSearchParams("origin=BLR&destination=IXZ&month=2027-02&trip=foo&minGap=5&maxGap=7"));
  assert.ok("error" in res);
});
