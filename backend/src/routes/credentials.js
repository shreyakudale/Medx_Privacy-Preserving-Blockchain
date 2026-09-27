import crypto from "node:crypto";
import express from "express";
import { ethers } from "ethers";
import { buildEddsa, buildPoseidon } from "circomlibjs";
import { config } from "../config.js";
import { requireAuth } from "../auth.js";
import { IssuerKey, Credential, SharedProof } from "../models.js";
import { exchange, getParticipant, Role } from "../chain.js";

export const credentialsRouter = express.Router();
credentialsRouter.use(requireAuth);

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

let eddsa, poseidon, F;
async function crypto_() {
  if (!eddsa) {
    eddsa = await buildEddsa();
    poseidon = await buildPoseidon();
    F = eddsa.babyJub.F;
  }
}

// ---- issuer key encryption at rest (AES-256-GCM) -----------------------
const secret = crypto.createHash("sha256").update(config.issuerKeySecret).digest();

function sealKey(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", secret, iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}

function openKey(b64) {
  const raw = Buffer.from(b64, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", secret, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
}

/**
 * Returns (creating on first call) the Baby Jubjub public key this account will
 * use to sign credentials. The admin registers the hospital on-chain with it.
 *
 * Demo simplification: the key is held by this backend on the hospital's behalf.
 * In production the hospital signs inside its own system or an HSM.
 */
credentialsRouter.get(
  "/issuer-key",
  asyncRoute(async (req, res) => {
    await crypto_();
    let k = await IssuerKey.findOne({ hospital: req.user });
    if (!k) {
      const prv = crypto.randomBytes(32);
      const pub = eddsa.prv2pub(prv);
      k = await IssuerKey.create({
        hospital: req.user,
        encPrivateKey: sealKey(prv),
        ax: F.toObject(pub[0]).toString(),
        ay: F.toObject(pub[1]).toString(),
      });
    }
    const trustedFor = await exchange.issuerFor(k.ax, k.ay);
    res.json({ ax: k.ax, ay: k.ay, registered: trustedFor.toLowerCase() === req.user });
  })
);

/** A verified hospital signs a credential for a patient. */
credentialsRouter.post(
  "/issue",
  asyncRoute(async (req, res) => {
    await crypto_();
    const me = await getParticipant(req.user);
    if (me.role !== Role.Hospital || !me.verified) {
      return res.status(403).json({ error: "Only registered hospitals can issue credentials." });
    }
    const k = await IssuerKey.findOne({ hospital: req.user });
    if (!k) return res.status(400).json({ error: "Create an issuer key first." });
    const trustedFor = await exchange.issuerFor(k.ax, k.ay);
    if (trustedFor.toLowerCase() !== req.user) {
      return res.status(400).json({ error: "Your issuer key is not registered on-chain. Ask the admin to register it." });
    }

    const { subject, birthYear, vaccinated } = req.body || {};
    const by = Number(birthYear);
    const vac = Number(vaccinated) ? 1 : 0;
    const nowYear = new Date().getUTCFullYear();
    if (!ethers.isAddress(subject)) return res.status(400).json({ error: "Enter the patient's wallet address." });
    if (!Number.isInteger(by) || by < 1900 || by > nowYear) {
      return res.status(400).json({ error: `Birth year must be between 1900 and ${nowYear}.` });
    }
    const patient = await getParticipant(subject);
    if (patient.role !== Role.Patient) return res.status(400).json({ error: "That address is not a registered patient." });

    const prv = openKey(k.encPrivateKey);
    const msg = poseidon([BigInt(subject), BigInt(by), BigInt(vac)]);
    const sig = eddsa.signPoseidon(prv, msg);

    const cred = await Credential.create({
      subject, issuer: req.user, issuerName: me.name,
      birthYear: by, vaccinated: vac,
      issuerAx: k.ax, issuerAy: k.ay,
      sigR8x: F.toObject(sig.R8[0]).toString(),
      sigR8y: F.toObject(sig.R8[1]).toString(),
      sigS: sig.S.toString(),
    });
    res.status(201).json({ id: cred._id, subject: cred.subject, issuedAt: cred.createdAt });
  })
);

/** Credentials issued to the signed-in patient. Only the subject can read them. */
credentialsRouter.get(
  "/mine",
  asyncRoute(async (req, res) => {
    const list = await Credential.find({ subject: req.user }).sort({ createdAt: -1 });
    res.json(list);
  })
);

// ---- proof sharing ------------------------------------------------------

credentialsRouter.post(
  "/proofs",
  asyncRoute(async (req, res) => {
    const { to, label, proof, publicSignals } = req.body || {};
    if (!ethers.isAddress(to) || !proof || !Array.isArray(publicSignals)) {
      return res.status(400).json({ error: "Recipient, proof and public signals are required." });
    }
    // The subject signal must be the sender, so nobody can share another patient's proof as their own.
    if (BigInt(publicSignals[2]) !== BigInt(req.user)) {
      return res.status(400).json({ error: "You can only share proofs about yourself." });
    }
    const doc = await SharedProof.create({ from: req.user, to, label: String(label || "").slice(0, 120), proof, publicSignals });
    res.status(201).json({ id: doc._id });
  })
);

credentialsRouter.get(
  "/proofs/inbox",
  asyncRoute(async (req, res) => {
    const list = await SharedProof.find({ to: req.user }).sort({ createdAt: -1 }).limit(50);
    res.json(list);
  })
);
