import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { ethers } from "ethers";
import { config } from "./config.js";
import { ParticipantProfile } from "./models.js";

const NONCE_TTL_MS = 5 * 60 * 1000;
const nonces = new Map(); // address -> { nonce, expires }

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

authRouter.post("/verify", async (req, res) => {
  const { address, signature, email, name } = req.body || {};
  if (!ethers.isAddress(address) || typeof signature !== "string") {
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
  nonces.delete(address.toLowerCase());

  // Update profile record in MongoDB database
  await ParticipantProfile.updateOne(
    { address: address.toLowerCase() },
    {
      $set: {
        lastLoginAt: new Date(),
        ...(email ? { email } : {}),
        ...(name ? { name } : {}),
      },
    },
    { upsert: true }
  );

  const token = jwt.sign({ sub: address.toLowerCase() }, config.jwtSecret, { expiresIn: "8h" });
  res.json({ token });
});

/** Save registration data (patient/doctor name, role, hospital) into MongoDB */
authRouter.post("/profile", requireAuth, async (req, res) => {
  const { name, role, encryptionPublicKey, hospitalAddress, email } = req.body || {};
  const profile = await ParticipantProfile.findOneAndUpdate(
    { address: req.user },
    {
      address: req.user,
      ...(name ? { name } : {}),
      ...(role ? { role } : {}),
      ...(encryptionPublicKey ? { encryptionPublicKey } : {}),
      ...(hospitalAddress ? { hospitalAddress } : {}),
      ...(email ? { email } : {}),
      lastLoginAt: new Date(),
    },
    { upsert: true, new: true }
  );
  res.json({ ok: true, profile });
});

/** Fetch profile data from MongoDB */
authRouter.get("/profile", requireAuth, async (req, res) => {
  const profile = await ParticipantProfile.findOne({ address: req.user });
  res.json({ profile: profile || { address: req.user } });
});

/** Express middleware: sets req.user = lower-case wallet address. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sign in with your wallet first." });
  try {
    req.user = jwt.verify(token, config.jwtSecret).sub;
    next();
  } catch {
    res.status(401).json({ error: "Session expired. Sign in again." });
  }
}
