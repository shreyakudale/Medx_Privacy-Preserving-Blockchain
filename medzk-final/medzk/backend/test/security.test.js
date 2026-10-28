// Run with: npm test   (uses Node's built-in test runner, no extra dependencies)
process.env.JWT_SECRET ||= "test-secret-test-secret-test-secret-123456";
process.env.ISSUER_KEY_SECRET ||= "test-issuer-secret-test-issuer-secret-12";
process.env.GATEWAY_PRIVATE_KEY ||= "0x" + "11".repeat(32);

import test from "node:test";
import assert from "node:assert/strict";
const { isBase64, isDecimalString, isObjectId, toRecordId, rateLimit, securityHeaders, CATEGORIES } = await import("../src/security.js");

test("isBase64 accepts valid base64 and enforces length", () => {
  assert.equal(isBase64(Buffer.from("hello world!").toString("base64")), true);
  assert.equal(isBase64("not base64!!"), false);
  assert.equal(isBase64("abc"), false); // length not a multiple of 4
  assert.equal(isBase64(123), false);
  assert.equal(isBase64("QUJD", { min: 8 }), false);
  assert.equal(isBase64(Buffer.alloc(12).toString("base64"), { min: 16, max: 16 }), true);
  assert.equal(isBase64("A".repeat(5000)), false);
});

test("isDecimalString rejects hex, signs, decimals and oversized values", () => {
  assert.equal(isDecimalString("123456789"), true);
  assert.equal(isDecimalString("0x12"), false);
  assert.equal(isDecimalString("-1"), false);
  assert.equal(isDecimalString("1.5"), false);
  assert.equal(isDecimalString(""), false);
  assert.equal(isDecimalString("1".repeat(81)), false);
  assert.equal(isDecimalString(5), false);
});

test("toRecordId only accepts positive safe integers", () => {
  assert.equal(toRecordId("7"), 7);
  assert.equal(toRecordId(7), 7);
  for (const bad of ["0", "-3", "1.5", "abc", "", null, undefined, "9007199254740993", "1e3x"]) {
    assert.equal(toRecordId(bad), null, String(bad));
  }
});

test("isObjectId matches 24 hex characters only", () => {
  assert.equal(isObjectId("507f1f77bcf86cd799439011"), true);
  assert.equal(isObjectId("507f1f77bcf86cd79943901"), false);
  assert.equal(isObjectId({ $ne: null }), false);
});

test("category list matches what the UI offers", () => {
  assert.ok(CATEGORIES.includes("Lab report") && CATEGORIES.includes("Other"));
  assert.equal(new Set(CATEGORIES).size, CATEGORIES.length);
});

function fakeRes() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

test("rateLimit allows up to max then answers 429 with Retry-After", () => {
  const limit = rateLimit({ windowMs: 60_000, max: 3 });
  const req = { ip: "1.2.3.4" };
  let passed = 0;
  for (let i = 0; i < 3; i++) limit(req, fakeRes(), () => passed++);
  assert.equal(passed, 3);
  const res = fakeRes();
  let called = false;
  limit(req, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 429);
  assert.ok(Number(res.headers["Retry-After"]) >= 1);
});

test("rateLimit keeps separate counters per client and per signed-in user", () => {
  const limit = rateLimit({ windowMs: 60_000, max: 1, byUser: true });
  const a = { ip: "9.9.9.9", user: "0xaaa" };
  const b = { ip: "9.9.9.9", user: "0xbbb" };
  let n = 0;
  limit(a, fakeRes(), () => n++);
  limit(b, fakeRes(), () => n++);
  assert.equal(n, 2);
  const res = fakeRes();
  limit(a, res, () => n++);
  assert.equal(res.statusCode, 429);
});

test("security headers disable caching and framing", () => {
  const res = fakeRes();
  let next = false;
  securityHeaders({}, res, () => { next = true; });
  assert.equal(next, true);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.headers["X-Frame-Options"], "DENY");
  assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
});
