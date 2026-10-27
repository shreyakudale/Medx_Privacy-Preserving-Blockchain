import crypto from "node:crypto";
import express from "express";
import { ethers } from "ethers";
import { buildEddsa, buildPoseidon } from "circomlibjs";
import { config } from "../config.js";
import { requireAuth } from "../auth.js";
import { IssuerKey, Credential, SharedProof } from "../models.js";
import { exchange, claimVerifier, getParticipant, isVerifiedClinician, Role } from "../chain.js";
import { asyncRoute, isDecimalString, isObjectId, rateLimit } from "../security.js";

export const credentialsRouter = express.Router();
credentialsRouter.use(requireAuth);
credentialsRouter.use(rateLimit({ windowMs: 60_000, max: 120, byUser: true }));

let eddsa, poseidon, F;
async function crypto_() {
  if (!eddsa) {
    eddsa = await buildEddsa();
    poseidon = await buildPoseidon();
    F = eddsa.babyJub.F;
  }
}

// ---- encryption at rest (AES-256-GCM) ----------------------------------
// Hospital signing keys (legacy derivation kept so existing keys still open).
const issuerSecret = crypto.createHash("sha256").update(config.issuerKeySecret).digest();
// Credential attributes use a separate, domain-separated key.
const credentialSecret = Buffer.from(crypto.hkdfSync("sha256", config.issuerKeySecret, "", "medzk-credential-v1", 32));

function seal(buf, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}

function open(b64, key) {
  const raw = Buffer.from(b64, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
}

const sealKey = (buf) => seal(buf, issuerSecret);
const openKey = (b64) => open(b64, issuerSecret);

/** Credential as the patient sees it: sensitive attributes opened, internals removed. */
function presentCredential(c) {
  const attrs = c.sealed
    ? JSON.parse(open(c.sealed, credentialSecret).toString("utf8"))
    : { birthYear: c.birthYear, vaccinated: c.vaccinated }; // legacy plaintext document
  return {
    _id: c._id,
    subject: c.subject,
    issuer: c.issuer,
    issuerName: c.issuerName,
    birthYear: attrs.birthYear,
    vaccinated: attrs.vaccinated,
    issuerAx: c.issuerAx,
    issuerAy: c.issuerAy,
    sigR8x: c.sigR8x,
    sigR8y: c.sigR8y,
    sigS: c.sigS,
    createdAt: c.createdAt,
  };
}

/**
 * Returns (creating on first call) the Baby Jubjub public key this account will
 * use to sign credentials. The admin registers the hospital on-chain with it.
 * Patients and doctors cannot create one.
 *
 * Demo simplification: the key is held by this backend on the hospital's behalf.
 * In production the hospital signs inside its own system or an HSM.
 */
credentialsRouter.get(
  "/issuer-key",
  asyncRoute(async (req, res) => {
    await crypto_();
    const me = await getParticipant(req.user);
    if (me.role === Role.Patient || me.role === Role.Doctor) {
      return res.status(403).json({ error: "Only hospitals have a credential-signing key." });
    }
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

/**
 * Replaces this hospital's signing key with a fresh one. The old key is destroyed here, but the
 * admin must register the new public key on-chain before new credentials can be issued; until
 * then, credentials signed with the old key keep verifying only while the old key stays trusted.
 */
credentialsRouter.post(
  "/issuer-key/rotate",
  rateLimit({ windowMs: 60_000, max: 5, byUser: true }),
  asyncRoute(async (req, res) => {
    await crypto_();
    const me = await getParticipant(req.user);
    if (me.role !== Role.Hospital) return res.status(403).json({ error: "Only hospitals have a credential-signing key." });
    const prv = crypto.randomBytes(32);
    const pub = eddsa.prv2pub(prv);
    const ax = F.toObject(pub[0]).toString();
    const ay = F.toObject(pub[1]).toString();
    await IssuerKey.findOneAndUpdate(
      { hospital: req.user },
      { encPrivateKey: sealKey(prv), ax, ay },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const trustedFor = await exchange.issuerFor(ax, ay);
    res.json({ ax, ay, registered: trustedFor.toLowerCase() === req.user });
  })
);

/** A verified hospital signs a credential for a patient. */
credentialsRouter.post(
  "/issue",
  asyncRoute(async (req, res) => {
    await crypto_();
    const me = await getParticipant(req.user);
    if (me.role !== Role.Hospital || !me.verified) {
      return res.status(403).json({ error: "Only registered, active hospitals can issue credentials." });
    }
    const k = await IssuerKey.findOne({ hospital: req.user });
    if (!k) return res.status(400).json({ error: "Create an issuer key first." });
    const trustedFor = await exchange.issuerFor(k.ax, k.ay);
    if (trustedFor.toLowerCase() !== req.user) {
      return res.status(400).json({ error: "Your issuer key is not trusted on-chain. Ask the admin to register it." });
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
    const subj = ethers.getAddress(subject);
    const msg = poseidon([BigInt(subj), BigInt(by), BigInt(vac)]);
    const sig = eddsa.signPoseidon(prv, msg);

    const cred = await Credential.create({
      subject: subj, issuer: req.user, issuerName: me.name,
      sealed: seal(Buffer.from(JSON.stringify({ birthYear: by, vaccinated: vac }), "utf8"), credentialSecret),
      issuerAx: k.ax, issuerAy: k.ay,
      sigR8x: F.toObject(sig.R8[0]).toString(),
      sigR8y: F.toObject(sig.R8[1]).toString(),
      sigS: sig.S.toString(),
    });
    // Never log or echo the attributes: only identifiers.
    res.status(201).json({ id: cred._id, subject: cred.subject, issuedAt: cred.createdAt });
  })
);

/** What a hospital has issued: who and when, never the attribute values. */
credentialsRouter.get(
  "/issued",
  asyncRoute(async (req, res) => {
    const me = await getParticipant(req.user);
    if (me.role !== Role.Hospital) return res.status(403).json({ error: "Only hospitals can list issued credentials." });
    const list = await Credential.find({ issuer: req.user }).sort({ createdAt: -1 }).limit(100);
    res.json(list.map((c) => ({ id: c._id, subject: c.subject, issuedAt: c.createdAt })));
  })
);

/** Credentials issued to the signed-in patient. Only the subject can read them. */
credentialsRouter.get(
  "/mine",
  asyncRoute(async (req, res) => {
    const list = await Credential.find({ subject: req.user }).sort({ createdAt: -1 });
    res.json(list.map(presentCredential));
  })
);

// ---- proof sharing ------------------------------------------------------

/** Converts a snarkjs proof into the argument arrays the Solidity verifier expects. */
function toSolidityArgs(proof, pub) {
  const ok = (v) => isDecimalString(v);
  if (
    !proof || !Array.isArray(proof.pi_a) || !Array.isArray(proof.pi_b) || !Array.isArray(proof.pi_c) ||
    proof.pi_a.length < 2 || proof.pi_b.length < 2 || proof.pi_c.length < 2 ||
    !Array.isArray(proof.pi_b[0]) || !Array.isArray(proof.pi_b[1]) ||
    ![proof.pi_a[0], proof.pi_a[1], proof.pi_b[0][0], proof.pi_b[0][1], proof.pi_b[1][0], proof.pi_b[1][1], proof.pi_c[0], proof.pi_c[1]].every(ok) ||
    !Array.isArray(pub) || pub.length !== 6 || !pub.every(ok)
  ) return null;
  return [
    [proof.pi_a[0], proof.pi_a[1]],
    [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]],
    [proof.pi_c[0], proof.pi_c[1]],
    pub,
  ];
}

const PROOF_REJECTIONS = {
  UntrustedIssuer: "The credential was signed by a hospital that isn't trusted on-chain.",
  InvalidProof: "The proof is not valid. It may have been altered.",
  StaleYear: "The proof was made for a different year. Create a new one.",
  BadSignal: "The proof contains out-of-range values.",
};

credentialsRouter.post(
  "/proofs",
  rateLimit({ windowMs: 60_000, max: 20, byUser: true, message: "Too many proofs sent. Please wait a minute." }),
  asyncRoute(async (req, res) => {
    const { to, label, proof, publicSignals } = req.body || {};
    if (!ethers.isAddress(to) || !proof || !Array.isArray(publicSignals)) {
      return res.status(400).json({ error: "Recipient, proof and public signals are required." });
    }
    const args = toSolidityArgs(proof, publicSignals);
    if (!args) return res.status(400).json({ error: "That isn't a well-formed proof." });

    // The subject signal must be the sender, so nobody can share another patient's proof as their own.
    if (BigInt(publicSignals[2]) !== BigInt(req.user)) {
      return res.status(400).json({ error: "You can only share proofs about yourself." });
    }
    const me = await getParticipant(req.user);
    if (me.role !== Role.Patient) return res.status(403).json({ error: "Only patients can share proofs." });
    if (!(await isVerifiedClinician(to))) {
      return res.status(400).json({ error: "Send proofs to a verified doctor or hospital." });
    }
    if ((await SharedProof.countDocuments({ from: req.user })) >= 100) {
      return res.status(429).json({ error: "You have many proofs on file. Withdraw some before sending more." });
    }

    // Run the real on-chain verification (issuer trust, year window, Groth16) as a read-only call.
    // Invalid, tampered or untrusted proofs never reach a doctor's inbox.
    try {
      await claimVerifier.check.staticCall(...args);
    } catch (e) {
      const reason = PROOF_REJECTIONS[e?.revert?.name];
      if (reason) return res.status(400).json({ error: reason });
      throw e;
    }

    const doc = await SharedProof.create({
      from: req.user, to: to.toLowerCase(), label: String(label || "").slice(0, 120), proof, publicSignals,
    });
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

/** Proofs the signed-in patient has sent, so they can see and withdraw them. */
credentialsRouter.get(
  "/proofs/sent",
  asyncRoute(async (req, res) => {
    const list = await SharedProof.find({ from: req.user }).sort({ createdAt: -1 }).limit(100);
    res.json(list);
  })
);

/** The sender can withdraw a proof; the recipient can dismiss it from their inbox. */
credentialsRouter.delete(
  "/proofs/:id",
  asyncRoute(async (req, res) => {
    if (!isObjectId(req.params.id)) return res.status(400).json({ error: "Invalid proof id." });
    const r = await SharedProof.deleteOne({ _id: req.params.id, $or: [{ from: req.user }, { to: req.user }] });
    if (!r.deletedCount) return res.status(404).json({ error: "Proof not found." });
    res.json({ ok: true });
  })
);
