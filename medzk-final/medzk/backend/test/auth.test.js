// Unit and regression tests for MedZK authentication (wallet-signature, nonce, JWT, logout)
process.env.JWT_SECRET ||= "test-secret-test-secret-test-secret-123456";
process.env.ISSUER_KEY_SECRET ||= "test-issuer-secret-test-issuer-secret-12";
process.env.GATEWAY_PRIVATE_KEY ||= "0x" + "11".repeat(32);

import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import jwt from "jsonwebtoken";
import { config } from "../src/config.js";
import { authRouter, requireAuth, loginMessage } from "../src/auth.js";

function mockReqRes({ method = "GET", url = "/", query = {}, body = {}, headers = {} } = {}) {
  const req = {
    method,
    url,
    query,
    body,
    headers: { ...headers },
    ip: "127.0.0.1",
  };
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return { req, res };
}

function handleRoute(router, req, res) {
  return new Promise((resolve, reject) => {
    router(req, res, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

test("auth: nonce generation requires a valid Ethereum address", async () => {
  const { req: badReq, res: badRes } = mockReqRes({ query: { address: "not-an-address" } });
  authRouter.handle(badReq, badRes, () => {});
  // Directly test the route logic:
  const { req, res } = mockReqRes({ url: "/nonce", query: { address: "invalid" } });
  // find route
  const getNonceHandler = authRouter.stack.find((s) => s.route?.path === "/nonce")?.route.stack[0].handle;
  assert.ok(getNonceHandler, "GET /nonce handler found");

  const r1 = mockReqRes({ query: { address: "0x123" } });
  getNonceHandler(r1.req, r1.res);
  assert.equal(r1.res.statusCode, 400);
  assert.match(r1.res.body.error, /Provide a valid wallet address/);

  const wallet = ethers.Wallet.createRandom();
  const r2 = mockReqRes({ query: { address: wallet.address } });
  getNonceHandler(r2.req, r2.res);
  assert.equal(r2.res.statusCode, 200);
  assert.ok(typeof r2.res.body.nonce === "string" && r2.res.body.nonce.length === 32);
  assert.ok(r2.res.body.message.includes(wallet.address));
  assert.ok(r2.res.body.message.includes(r2.res.body.nonce));
});

test("auth: signature verification issues token and consumes nonce (single-use)", async () => {
  const getNonceHandler = authRouter.stack.find((s) => s.route?.path === "/nonce")?.route.stack[0].handle;
  const verifyHandler = authRouter.stack.find((s) => s.route?.path === "/verify")?.route.stack[0].handle;
  assert.ok(getNonceHandler && verifyHandler);

  const wallet = ethers.Wallet.createRandom();
  const nonceRes = mockReqRes({ query: { address: wallet.address } });
  getNonceHandler(nonceRes.req, nonceRes.res);
  const { nonce, message } = nonceRes.res.body;

  // Sign message with wallet
  const signature = await wallet.signMessage(message);

  // POST /verify with valid signature
  const verifyRes = mockReqRes({
    method: "POST",
    body: { address: wallet.address, signature },
  });
  verifyHandler(verifyRes.req, verifyRes.res);
  assert.equal(verifyRes.res.statusCode, 200);
  assert.ok(verifyRes.res.body.token, "Returned JWT token");
  assert.equal(typeof verifyRes.res.body.token, "string");

  // Replay attempt: Try verifying again with the same nonce
  const replayRes = mockReqRes({
    method: "POST",
    body: { address: wallet.address, signature },
  });
  verifyHandler(replayRes.req, replayRes.res);
  assert.equal(replayRes.res.statusCode, 401, "Replayed nonce must be rejected");
  assert.match(replayRes.res.body.error, /Sign-in request expired/);
});

test("auth: signature verification rejects forged or mismatched signatures", async () => {
  const getNonceHandler = authRouter.stack.find((s) => s.route?.path === "/nonce")?.route.stack[0].handle;
  const verifyHandler = authRouter.stack.find((s) => s.route?.path === "/verify")?.route.stack[0].handle;

  const walletAlice = ethers.Wallet.createRandom();
  const walletBob = ethers.Wallet.createRandom();

  const nonceRes = mockReqRes({ query: { address: walletAlice.address } });
  getNonceHandler(nonceRes.req, nonceRes.res);
  const { message } = nonceRes.res.body;

  // Bob signs Alice's message
  const forgedSig = await walletBob.signMessage(message);

  const verifyRes = mockReqRes({
    method: "POST",
    body: { address: walletAlice.address, signature: forgedSig },
  });
  verifyHandler(verifyRes.req, verifyRes.res);
  assert.equal(verifyRes.res.statusCode, 401);
  assert.match(verifyRes.res.body.error, /Signature does not match this address/);
});

test("auth: requireAuth validates JWT and extracts user address", () => {
  const wallet = ethers.Wallet.createRandom();
  const token = jwt.sign({ sub: wallet.address.toLowerCase() }, config.jwtSecret, {
    expiresIn: 3600,
    jwtid: "test-uuid-1",
  });

  const { req, res } = mockReqRes({ headers: { authorization: `Bearer ${token}` } });
  let nextCalled = false;
  requireAuth(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.user, wallet.address.toLowerCase());
  assert.equal(req.tokenId, "test-uuid-1");
});

test("auth: requireAuth rejects missing and malformed tokens", () => {
  const r1 = mockReqRes();
  requireAuth(r1.req, r1.res, () => assert.fail("Should not call next"));
  assert.equal(r1.res.statusCode, 401);
  assert.equal(r1.res.body.code, "NO_SESSION");

  const r2 = mockReqRes({ headers: { authorization: "Bearer invalid.token.payload" } });
  requireAuth(r2.req, r2.res, () => assert.fail("Should not call next"));
  assert.equal(r2.res.statusCode, 401);
  assert.equal(r2.res.body.code, "SESSION_EXPIRED");
});

test("auth: logout revokes session token", async () => {
  const logoutHandler = authRouter.stack.find((s) => s.route?.path === "/logout")?.route.stack.slice(-1)[0].handle;
  assert.ok(logoutHandler);

  const wallet = ethers.Wallet.createRandom();
  const jti = "revoked-test-uuid";
  const token = jwt.sign({ sub: wallet.address.toLowerCase() }, config.jwtSecret, {
    expiresIn: 3600,
    jwtid: jti,
  });

  // Verify token is active before logout
  const rBefore = mockReqRes({ headers: { authorization: `Bearer ${token}` } });
  let passed = false;
  requireAuth(rBefore.req, rBefore.res, () => { passed = true; });
  assert.equal(passed, true);

  // Call logout handler with authenticated request
  const logoutReqRes = mockReqRes({ headers: { authorization: `Bearer ${token}` } });
  logoutReqRes.req.tokenId = jti;
  logoutReqRes.req.tokenExp = Math.floor(Date.now() / 1000) + 3600;
  await logoutHandler(logoutReqRes.req, logoutReqRes.res, () => {});
  assert.equal(logoutReqRes.res.statusCode, 200);
  assert.equal(logoutReqRes.res.body.ok, true);

  // Verify token is rejected after logout
  const rAfter = mockReqRes({ headers: { authorization: `Bearer ${token}` } });
  requireAuth(rAfter.req, rAfter.res, () => assert.fail("Revoked token should not pass"));
  assert.equal(rAfter.res.statusCode, 401);
  assert.equal(rAfter.res.body.code, "SESSION_ENDED");
});
