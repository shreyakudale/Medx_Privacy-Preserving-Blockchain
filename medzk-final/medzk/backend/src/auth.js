import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { ethers } from "ethers";
import { config } from "./config.js";
import { asyncRoute } from "./security.js";

const NONCE_TTL_MS = 5 * 60 * 1000;
const nonces = new Map(); // address -> { nonce, expires }
const revoked = new Map(); // token id (jti) -> expiry (unix seconds)

// Drop expired nonces and revocations so the maps cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of nonces) if (v.expires < now) nonces.delete(k);
  const nowSec = Math.floor(now / 1000);
  for (const [k, exp] of revoked) if (exp <= nowSec) revoked.delete(k);
}, 60 * 1000).unref();

export function loginMessage(address, nonce) {
  return `Sign in to MedZK\n\nAddress: ${address}\nNonce: ${nonce}\n\nThis signature does not send a transaction or cost gas.`;
}

export const authRouter = express.Router();

authRouter.get("/nonce", (req, res) => {
  const address = String(req.query.address || "");
  if (!ethers.isAddress(address)) return res.status(400).json({ error: "Provide a valid wallet address." });
  const nonce = crypto.randomBytes(16).toString("hex");
  nonces.set(address.toLowerCase(), { nonce, expires: Date.now() + NONCE_TTL_MS });
  res.json({ nonce, message: loginMessage(ethers.getAddress(address), nonce) });
});

authRouter.post("/verify", (req, res) => {
  const { address, signature } = req.body || {};
  if (!ethers.isAddress(address) || typeof signature !== "string" || signature.length > 200) {
    return res.status(400).json({ error: "Address and signature are required." });
  }
  const entry = nonces.get(address.toLowerCase());
  if (!entry || entry.expires < Date.now()) {
    return res.status(401).json({ error: "Sign-in request expired. Request a new nonce." });
  }
  let recovered;
  try {
    recovered = ethers.verifyMessage(loginMessage(ethers.getAddress(address), entry.nonce), signature);
  } catch {
    return res.status(401).json({ error: "Signature could not be verified." });
  }
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return res.status(401).json({ error: "Signature does not match this address." });
  }
  nonces.delete(address.toLowerCase()); // single use
  const token = jwt.sign({ sub: address.toLowerCase() }, config.jwtSecret, {
    expiresIn: config.jwtTtlSeconds,
    jwtid: crypto.randomUUID(),
    algorithm: "HS256",
  });
  res.json({ token, expiresInSeconds: config.jwtTtlSeconds });
});

/** Express middleware: sets req.user = lower-case wallet address. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sign in with your wallet first.", code: "NO_SESSION" });
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    if (payload.jti && revoked.has(payload.jti)) {
      return res.status(401).json({ error: "You have signed out. Sign in again.", code: "SESSION_ENDED" });
    }
    req.user = payload.sub;
    req.tokenId = payload.jti;
    req.tokenExp = payload.exp;
    next();
  } catch {
    res.status(401).json({ error: "Session expired. Sign in again.", code: "SESSION_EXPIRED" });
  }
}

/** Ends the current session on the server, so a copied token stops working. */
authRouter.post(
  "/logout",
  requireAuth,
  asyncRoute(async (req, res) => {
    if (req.tokenId) revoked.set(req.tokenId, req.tokenExp);
    res.json({ ok: true });
  })
);
