import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import {
  clearAccessTokenCache,
  FCM_SCOPE,
  OAUTH_TOKEN_URL,
  pushConfigured,
  sendPush,
} from "./fcm.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const TEST_SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account",
  project_id: "trippie-test-proj",
  client_email: "fcm-sender@trippie-test-proj.iam.gserviceaccount.com",
  private_key: privateKey,
});

test("pushConfigured validates FCM_SERVICE_ACCOUNT JSON fields", () => {
  assert.equal(pushConfigured({ NODE_ENV: "test" }), false);
  assert.equal(pushConfigured({ NODE_ENV: "test", FCM_SERVICE_ACCOUNT: "not-json" }), false);
  assert.equal(
    pushConfigured({
      NODE_ENV: "test",
      FCM_SERVICE_ACCOUNT: JSON.stringify({
        type: "authorized_user",
        project_id: "p",
        client_email: "e",
        private_key: "k",
      }),
    }),
    false,
  );
  assert.equal(
    pushConfigured({
      NODE_ENV: "test",
      FCM_SERVICE_ACCOUNT: TEST_SERVICE_ACCOUNT,
    }),
    true,
  );
});

test("sendPush signs RS256 JWT with expected claims, caches OAuth token until 5m before expiry, and sends expected FCM v1 message shape", async () => {
  clearAccessTokenCache();
  let currentMs = 1_760_000_000_000;
  let tokenExchangeCalls = 0;
  let fcmSendCalls = 0;
  let capturedAssertion = "";
  let capturedFcmUrl = "";
  let capturedFcmAuth = "";
  let capturedFcmBody: Record<string, unknown> | null = null;

  const fakeFetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === OAUTH_TOKEN_URL) {
      tokenExchangeCalls++;
      const params = new URLSearchParams(String(init?.body ?? ""));
      assert.equal(params.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      capturedAssertion = params.get("assertion") ?? "";
      return Response.json(
        {
          access_token: `ya29.test_access_token_${tokenExchangeCalls}`,
          expires_in: 3600,
        },
        { status: 200 },
      );
    }

    fcmSendCalls++;
    capturedFcmUrl = url;
    const headers = new Headers(init?.headers);
    capturedFcmAuth = headers.get("authorization") ?? "";
    capturedFcmBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return Response.json({ name: "projects/trippie-test-proj/messages/1" }, { status: 200 });
  };

  const res1 = await sendPush(
    "device_token_123456789012345",
    {
      title: "BLR → IXZ from ₹23,159",
      body: "February 2027 · best 2027-02-10 – 2027-02-16",
      url: "https://trippie-mu.vercel.app/?origin=BLR&destination=IXZ&month=2027-02&trip=round&minGap=5&maxGap=7",
      tag: "plan-uuid-123",
    },
    {
      fetch: fakeFetch,
      clock: () => currentMs,
      serviceAccountJson: TEST_SERVICE_ACCOUNT,
    },
  );

  assert.equal(res1, "ok");
  assert.equal(tokenExchangeCalls, 1);
  assert.equal(fcmSendCalls, 1);

  // Verify RS256 JWT header, claims, and cryptographic signature using generated publicKey
  const parts = capturedAssertion.split(".");
  assert.equal(parts.length, 3);
  const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8"));
  const claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
  assert.deepEqual(header, { alg: "RS256", typ: "JWT" });
  const expectedIat = Math.floor(currentMs / 1000);
  assert.deepEqual(claims, {
    iss: "fcm-sender@trippie-test-proj.iam.gserviceaccount.com",
    scope: FCM_SCOPE,
    aud: OAUTH_TOKEN_URL,
    iat: expectedIat,
    exp: expectedIat + 3600,
  });

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  assert.equal(verifier.verify(publicKey, parts[2]!, "base64url"), true);

  // Verify FCM HTTP v1 URL, Authorization header, and request JSON shape
  assert.equal(
    capturedFcmUrl,
    "https://fcm.googleapis.com/v1/projects/trippie-test-proj/messages:send",
  );
  assert.equal(capturedFcmAuth, "Bearer ya29.test_access_token_1");
  assert.deepEqual(capturedFcmBody, {
    message: {
      token: "device_token_123456789012345",
      notification: {
        title: "BLR → IXZ from ₹23,159",
        body: "February 2027 · best 2027-02-10 – 2027-02-16",
      },
      data: {
        url: "https://trippie-mu.vercel.app/?origin=BLR&destination=IXZ&month=2027-02&trip=round&minGap=5&maxGap=7",
      },
      android: {
        priority: "HIGH",
        notification: {
          channel_id: "price_alerts",
          tag: "plan-uuid-123",
        },
      },
    },
  });

  // Advance clock by 54 minutes (still > 5 minutes before 60m expiry) -> cached token reused
  currentMs += 54 * 60 * 1000;
  const res2 = await sendPush(
    "device_token_123456789012345",
    {
      title: "BLR → IXZ from ₹22,000",
      body: "February 2027 · best 2027-02-10",
      url: "/?origin=BLR&destination=IXZ&month=2027-02&trip=oneway&minGap=0&maxGap=0",
      tag: "plan-uuid-123",
    },
    {
      fetch: fakeFetch,
      clock: () => currentMs,
      serviceAccountJson: TEST_SERVICE_ACCOUNT,
    },
  );
  assert.equal(res2, "ok");
  assert.equal(tokenExchangeCalls, 1);
  assert.equal(fcmSendCalls, 2);

  // Advance clock into the 5-minute refresh buffer (56 minutes elapsed >= 55m) -> refreshes token
  currentMs += 2 * 60 * 1000;
  const res3 = await sendPush(
    "device_token_123456789012345",
    {
      title: "BLR → IXZ from ₹21,000",
      body: "February 2027 · best 2027-02-10",
      url: "/?origin=BLR&destination=IXZ&month=2027-02&trip=oneway&minGap=0&maxGap=0",
      tag: "plan-uuid-123",
    },
    {
      fetch: fakeFetch,
      clock: () => currentMs,
      serviceAccountJson: TEST_SERVICE_ACCOUNT,
    },
  );
  assert.equal(res3, "ok");
  assert.equal(tokenExchangeCalls, 2);
  assert.equal(capturedFcmAuth, "Bearer ya29.test_access_token_2");
});

test("sendPush classifies 404, FcmError UNREGISTERED, and FcmError INVALID_ARGUMENT with message.token fieldViolation as invalid_token, and ambiguous INVALID_ARGUMENT or other failures as error", async () => {
  clearAccessTokenCache();
  let fcmResponseFactory: () => Response = () => Response.json({}, { status: 200 });

  const fakeFetch: typeof globalThis.fetch = async (input) => {
    if (String(input) === OAUTH_TOKEN_URL) {
      return Response.json({ access_token: "ya29.cached", expires_in: 3600 }, { status: 200 });
    }
    return fcmResponseFactory();
  };

  // HTTP 404 -> invalid_token (even without details)
  fcmResponseFactory = () =>
    Response.json(
      {
        error: {
          code: 404,
          message: "Requested entity was not found.",
          status: "NOT_FOUND",
        },
      },
      { status: 404 },
    );
  assert.equal(
    await sendPush(
      "tok_unreg_123456789012345",
      { title: "T", body: "B", url: "/", tag: "p1" },
      { fetch: fakeFetch, serviceAccountJson: TEST_SERVICE_ACCOUNT },
    ),
    "invalid_token",
  );

  // FcmError UNREGISTERED -> invalid_token
  fcmResponseFactory = () =>
    Response.json(
      {
        error: {
          code: 400,
          message: "App instance has been unregistered.",
          status: "INVALID_ARGUMENT",
          details: [
            {
              "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
              errorCode: "UNREGISTERED",
            },
          ],
        },
      },
      { status: 400 },
    );
  assert.equal(
    await sendPush(
      "tok_unreg2_12345678901234",
      { title: "T", body: "B", url: "/", tag: "p1" },
      { fetch: fakeFetch, serviceAccountJson: TEST_SERVICE_ACCOUNT },
    ),
    "invalid_token",
  );

  // HTTP 400 with FcmError INVALID_ARGUMENT + BadRequest fieldViolation for message.token -> invalid_token
  fcmResponseFactory = () =>
    Response.json(
      {
        error: {
          code: 400,
          message: "The registration token is not a valid FCM registration token",
          status: "INVALID_ARGUMENT",
          details: [
            {
              "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
              errorCode: "INVALID_ARGUMENT",
            },
            {
              "@type": "type.googleapis.com/google.rpc.BadRequest",
              fieldViolations: [
                {
                  field: "message.token",
                  description: "Invalid registration token",
                },
              ],
            },
          ],
        },
      },
      { status: 400 },
    );
  assert.equal(
    await sendPush(
      "tok_bad_12345678901234567",
      { title: "T", body: "B", url: "/", tag: "p1" },
      { fetch: fakeFetch, serviceAccountJson: TEST_SERVICE_ACCOUNT },
    ),
    "invalid_token",
  );

  // INVALID_ARGUMENT without token-specific evidence (e.g. empty message, no details, or non-token fieldViolation) -> error
  for (const body of [
    {
      error: {
        code: 400,
        message: "",
        status: "INVALID_ARGUMENT",
      },
    },
    {
      error: {
        code: 400,
        message: "Invalid payload",
        status: "INVALID_ARGUMENT",
        details: [
          {
            "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
            errorCode: "INVALID_ARGUMENT",
          },
        ],
      },
    },
    {
      error: {
        code: 400,
        message: "Invalid TTL format",
        status: "INVALID_ARGUMENT",
        details: [
          {
            "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
            errorCode: "INVALID_ARGUMENT",
          },
          {
            "@type": "type.googleapis.com/google.rpc.BadRequest",
            fieldViolations: [
              {
                field: "message.android.ttl",
                description: "Invalid value",
              },
            ],
          },
        ],
      },
    },
  ]) {
    fcmResponseFactory = () => Response.json(body, { status: 400 });
    assert.equal(
      await sendPush(
        "tok_valid_123456789012345",
        { title: "T", body: "B", url: "/", tag: "p1" },
        { fetch: fakeFetch, serviceAccountJson: TEST_SERVICE_ACCOUNT },
      ),
      "error",
    );
  }

  // HTTP 500 / INTERNAL -> error
  fcmResponseFactory = () =>
    Response.json(
      {
        error: {
          code: 500,
          message: "Internal error encountered.",
          status: "INTERNAL",
        },
      },
      { status: 500 },
    );
  assert.equal(
    await sendPush(
      "tok_valid_123456789012345",
      { title: "T", body: "B", url: "/", tag: "p1" },
      { fetch: fakeFetch, serviceAccountJson: TEST_SERVICE_ACCOUNT },
    ),
    "error",
  );

  // HTTP 429 / QUOTA_EXCEEDED -> error
  fcmResponseFactory = () =>
    Response.json(
      {
        error: {
          code: 429,
          message: "Quota exceeded.",
          status: "RESOURCE_EXHAUSTED",
        },
      },
      { status: 429 },
    );
  assert.equal(
    await sendPush(
      "tok_valid_123456789012345",
      { title: "T", body: "B", url: "/", tag: "p1" },
      { fetch: fakeFetch, serviceAccountJson: TEST_SERVICE_ACCOUNT },
    ),
    "error",
  );
});

test("sendPush aborts a response whose body never finishes within the timeout and returns error", async () => {
  clearAccessTokenCache();

  // 1. Stalled OAuth token response body
  let oauthSignalAborted = false;
  const stalledOAuthFetch: typeof globalThis.fetch = async (_input, init) => {
    init?.signal?.addEventListener("abort", () => {
      oauthSignalAborted = true;
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"access_token":'));
        // Never closes
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const oauthRes = await sendPush(
    "tok_stalled_oauth_123456789",
    { title: "T", body: "B", url: "/", tag: "p1" },
    {
      fetch: stalledOAuthFetch,
      serviceAccountJson: TEST_SERVICE_ACCOUNT,
      timeoutMs: 30,
    },
  );
  assert.equal(oauthRes, "error");
  assert.equal(oauthSignalAborted, true);

  // 2. Stalled FCM send response body (headers resolve 200 immediately, body never finishes)
  clearAccessTokenCache();
  let fcmSignalAborted = false;
  const stalledFcmFetch: typeof globalThis.fetch = async (input, init) => {
    if (String(input) === OAUTH_TOKEN_URL) {
      return Response.json({ access_token: "ya29.ok", expires_in: 3600 }, { status: 200 });
    }
    init?.signal?.addEventListener("abort", () => {
      fcmSignalAborted = true;
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"name":'));
        // Never closes
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const fcmRes = await sendPush(
    "tok_stalled_fcm_12345678901",
    { title: "T", body: "B", url: "/", tag: "p1" },
    {
      fetch: stalledFcmFetch,
      serviceAccountJson: TEST_SERVICE_ACCOUNT,
      timeoutMs: 30,
    },
  );
  assert.equal(fcmRes, "error");
  assert.equal(fcmSignalAborted, true);
});
