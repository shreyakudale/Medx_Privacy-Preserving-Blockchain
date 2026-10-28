import express from "express";
import multer from "multer";
import { ethers } from "ethers";
import { config } from "../config.js";
import { requireAuth } from "../auth.js";
import { RecordMeta, WrappedKey } from "../models.js";
import { storage, sha256Hex } from "../storage.js";
import { exchange, getParticipant, getRecord, isVerifiedClinician, Role } from "../chain.js";
import { asyncRoute, isBase64, rateLimit, toRecordId, CATEGORIES } from "../security.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 8 },
});
export const recordsRouter = express.Router();
recordsRouter.use(requireAuth);
recordsRouter.use(rateLimit({ windowMs: 60_000, max: 120, byUser: true }));

const MAX_PENDING_PER_PATIENT = 10;
const ivOk = (v) => isBase64(v, { min: 16, max: 16 }) && Buffer.from(v, "base64").length === 12;
// RSA-OAEP output is as long as the modulus: 256 bytes (344 chars) for 2048-bit, 512 bytes (684 chars) for 4096-bit.
const wrappedKeyOk = (v) => isBase64(v, { min: 300, max: 700 });

function publicMeta(m) {
  return {
    recordId: m.recordId,
    owner: m.owner,
    category: m.category,
    contentHash: m.contentHash,
    size: m.size,
    createdAt: m.createdAt,
  };
}

/**
 * A stored record whose on-chain counterpart no longer matches (the chain was reset or redeployed, so the
 * same id now means something else, or nothing). It is archived, its id released and its wrapped keys deleted,
 * so a stale key can never be served for a different record. Returns true if it was archived.
 */
export async function archiveIfStale(meta) {
  const onChain = await getRecord(meta.recordId); // throws if the node is unreachable: never archive on a network error
  if (matchesChain(meta, onChain)) return false;
  await WrappedKey.deleteMany({ recordId: meta.recordId });
  await RecordMeta.updateOne({ _id: meta._id }, { status: "archived", $unset: { recordId: 1 } });
  console.warn(`[records] archived stale record #${meta.recordId}: it does not match the current blockchain`);
  return true;
}

/** Startup / periodic check that everything stored still matches the chain it claims to belong to. */
export async function validateAgainstChain() {
  let archived = 0;
  for (const m of await RecordMeta.find({ status: "active" })) {
    if (await archiveIfStale(m)) archived += 1;
  }
  // Wrapped keys that no active record points at (older than 5 min so an in-flight confirm is never hit).
  const live = new Set((await RecordMeta.find({ status: "active" }, { recordId: 1 })).map((m) => m.recordId));
  const old = await WrappedKey.find({ createdAt: { $lt: new Date(Date.now() - 5 * 60_000) } }, { recordId: 1 });
  const orphaned = [...new Set(old.map((k) => k.recordId))].filter((id) => !live.has(id));
  if (orphaned.length) await WrappedKey.deleteMany({ recordId: { $in: orphaned }, createdAt: { $lt: new Date(Date.now() - 5 * 60_000) } });
  return archived;
}

/** Links an uploaded blob to its confirmed on-chain id and stores the owner's wrapped key. */
async function linkOnChain(meta, recordId) {
  // If an old record from a previous chain still holds this id, retire it first (or refuse if it is genuinely live).
  const clash = await RecordMeta.findOne({ recordId: Number(recordId), status: "active", _id: { $ne: meta._id } });
  if (clash && !(await archiveIfStale(clash))) {
    const e = new Error(`Record ID ${recordId} is already linked to another upload.`);
    e.status = 409;
    throw e;
  }
  meta.recordId = Number(recordId);
  meta.status = "active";
  await WrappedKey.updateOne(
    { recordId: meta.recordId, grantee: meta.owner },
    { wrappedKey: meta.ownerWrappedKey },
    { upsert: true }
  );
  meta.ownerWrappedKey = undefined;
  await meta.save();
}

function matchesChain(meta, onChain) {
  return (
    !!onChain &&
    onChain.owner.toLowerCase() === meta.owner &&
    onChain.storageRef === meta.storageRef &&
    onChain.contentHash.toLowerCase() === meta.contentHash.toLowerCase()
  );
}

/**
 * Heals the "transaction mined but /confirm never arrived" case (tab closed,
 * network drop): finds the patient's on-chain records whose storage reference
 * matches a pending upload and links them.
 */
export async function reconcilePending(owner) {
  const pending = await RecordMeta.find({ owner, status: "pending" });
  if (!pending.length) return 0;
  const ids = (await exchange.getPatientRecords(owner)).map(Number);
  const known = new Set((await RecordMeta.find({ owner, recordId: { $in: ids } }, { recordId: 1 })).map((m) => m.recordId));
  let linked = 0;
  for (const id of ids) {
    if (known.has(id)) continue;
    const onChain = await getRecord(id);
    const meta = pending.find((m) => matchesChain(m, onChain));
    if (meta) {
      await linkOnChain(meta, id);
      linked += 1;
    }
  }
  return linked;
}

/** Removes uploads that never reached the chain, so abandoned encrypted blobs do not accumulate. */
export async function sweepPending() {
  const cutoff = new Date(Date.now() - config.pendingUploadTtlMs);
  const stale = await RecordMeta.find({ status: "pending", createdAt: { $lt: cutoff } });
  const owners = [...new Set(stale.map((m) => m.owner))];
  for (const o of owners) await reconcilePending(o).catch((e) => console.error("[sweep] reconcile failed", e?.shortMessage || e?.message));
  const left = await RecordMeta.find({ status: "pending", createdAt: { $lt: cutoff } });
  for (const m of left) {
    await storage.remove(m.storageRef);
    await RecordMeta.deleteOne({ _id: m._id });
  }
  return left.length;
}

/**
 * Step 1 of upload: the browser sends the already-encrypted file.
 * We store it, hash the ciphertext, and return the values the patient then
 * writes on-chain with addRecord().
 */
recordsRouter.post(
  "/",
  rateLimit({ windowMs: 60_000, max: 20, byUser: true, message: "Too many uploads. Please wait a minute." }),
  upload.single("file"),
  asyncRoute(async (req, res) => {
    const me = await getParticipant(req.user);
    if (me.role !== Role.Patient) return res.status(403).json({ error: "Only patients can upload records." });
    const { iv, encMeta, metaIv, category, ownerWrappedKey } = req.body;
    if (!req.file) return res.status(400).json({ error: "Missing encrypted file." });
    if (req.file.size < 17) return res.status(400).json({ error: "The encrypted file is too small to be valid." });
    if (!ivOk(iv) || !ivOk(metaIv)) return res.status(400).json({ error: "Invalid encryption parameters." });
    if (!isBase64(encMeta, { min: 24, max: 6000 })) return res.status(400).json({ error: "Invalid record metadata." });
    if (!wrappedKeyOk(ownerWrappedKey)) return res.status(400).json({ error: "Invalid wrapped key." });
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: "Choose one of the listed categories." });

    const pendingCount = await RecordMeta.countDocuments({ owner: req.user, status: "pending" });
    if (pendingCount >= MAX_PENDING_PER_PATIENT) {
      await reconcilePending(req.user).catch(() => {});
      if ((await RecordMeta.countDocuments({ owner: req.user, status: "pending" })) >= MAX_PENDING_PER_PATIENT) {
        return res.status(429).json({ error: "You have several uploads waiting for confirmation. Finish or wait for them to expire." });
      }
    }

    const storageRef = await storage.put(req.file.buffer);
    const contentHash = sha256Hex(req.file.buffer);
    try {
      await RecordMeta.create({
        storageRef, owner: req.user, category,
        contentHash, iv, encMeta, metaIv, size: req.file.size, status: "pending",
        ownerWrappedKey,
      });
    } catch (e) {
      await storage.remove(storageRef); // do not leave an orphan blob behind
      throw e;
    }
    res.status(201).json({ storageRef, contentHash });
  })
);

/** Step 2: after addRecord() is mined, link the on-chain id and verify it matches. */
recordsRouter.post(
  "/confirm",
  asyncRoute(async (req, res) => {
    const { storageRef, recordId } = req.body || {};
    const id = toRecordId(recordId);
    if (typeof storageRef !== "string" || !id) return res.status(400).json({ error: "storageRef and recordId are required." });
    const meta = await RecordMeta.findOne({ storageRef, owner: req.user });
    if (!meta) return res.status(404).json({ error: "Upload not found." });
    if (meta.status === "active" && meta.recordId === id) return res.json(publicMeta(meta)); // idempotent retry
    if (meta.status !== "pending") return res.status(409).json({ error: "This upload was already confirmed." });
    const onChain = await getRecord(id);
    if (!matchesChain(meta, onChain)) {
      return res.status(409).json({ error: "On-chain record does not match this upload." });
    }
    try {
      await linkOnChain(meta, id);
    } catch (e) {
      if (e.status === 409) return res.status(409).json({ error: e.message });
      throw e;
    }
    res.json(publicMeta(meta));
  })
);

/** Patient's own records, including encrypted metadata only they can open. */
recordsRouter.get(
  "/mine",
  asyncRoute(async (req, res) => {
    await reconcilePending(req.user).catch((e) => console.error("[records] reconcile failed", e?.shortMessage || e?.message));
    const list = await RecordMeta.find({ owner: req.user, status: "active" }).sort({ recordId: -1 });
    const [keys, chain] = await Promise.all([
      WrappedKey.find({ grantee: req.user, recordId: { $in: list.map((m) => m.recordId) } }),
      Promise.all(list.map((m) => getRecord(m.recordId))),
    ]);
    const byId = new Map(keys.map((k) => [k.recordId, k.wrappedKey]));
    res.json(
      list.map((m, i) => ({
        ...publicMeta(m),
        active: !!chain[i]?.active, // false once the patient has deactivated it on-chain
        encMeta: m.encMeta,
        metaIv: m.metaIv,
        wrappedKey: byId.get(m.recordId) || null,
      }))
    );
  })
);

/**
 * Category and date of a patient's records, so a clinician can pick one to request.
 * Limited to verified doctors/hospitals (and the patient themself): arbitrary wallets
 * cannot enumerate who has records.
 */
recordsRouter.get(
  "/by-owner/:address",
  asyncRoute(async (req, res) => {
    if (!ethers.isAddress(req.params.address)) return res.status(400).json({ error: "Invalid address." });
    const owner = req.params.address.toLowerCase();
    if (owner !== req.user && !(await isVerifiedClinician(req.user))) {
      return res.status(403).json({ error: "Only verified doctors and hospitals can look up patient records." });
    }
    const list = await RecordMeta.find({ owner, status: "active" }).sort({ recordId: -1 });
    const chain = await Promise.all(list.map((m) => getRecord(m.recordId)));
    res.json(list.filter((_, i) => chain[i]?.active).map(publicMeta));
  })
);

/** Records currently shared with the signed-in doctor or hospital. */
recordsRouter.get(
  "/shared-with-me",
  asyncRoute(async (req, res) => {
    const keys = await WrappedKey.find({ grantee: req.user });
    const out = [];
    for (const k of keys) {
      const meta = await RecordMeta.findOne({ recordId: k.recordId, status: "active" });
      if (!meta || meta.owner === req.user) continue;
      const [allowed, grant] = await Promise.all([
        exchange.hasAccess(k.recordId, req.user),
        exchange.grants(k.recordId, req.user),
      ]);
      if (!allowed) continue;
      out.push({ ...publicMeta(meta), expiresAt: Number(grant.expiresAt), emergency: grant.emergency });
    }
    res.json(out);
  })
);

/**
 * Patient shares the record's AES key, wrapped with the grantee's public key.
 * Holding a wrapped key is not enough on its own: the gateway still checks the
 * on-chain grant before releasing the ciphertext.
 */
recordsRouter.post(
  "/:recordId/keys",
  asyncRoute(async (req, res) => {
    const recordId = toRecordId(req.params.recordId);
    const { grantee, wrappedKey } = req.body || {};
    if (!recordId) return res.status(400).json({ error: "Invalid record." });
    if (!ethers.isAddress(grantee) || !wrappedKeyOk(wrappedKey)) {
      return res.status(400).json({ error: "grantee and a valid wrappedKey are required." });
    }
    const onChain = await getRecord(recordId);
    if (!onChain || onChain.owner.toLowerCase() !== req.user) {
      return res.status(403).json({ error: "Only the record owner can share its key." });
    }
    if (!onChain.active) return res.status(409).json({ error: "This record has been deactivated." });
    const g = await getParticipant(grantee);
    if (![Role.Doctor, Role.Hospital].includes(g.role) || !g.verified) {
      return res.status(400).json({ error: "Keys can only be shared with verified doctors or hospitals." });
    }
    await WrappedKey.updateOne({ recordId, grantee: grantee.toLowerCase() }, { wrappedKey }, { upsert: true });
    res.json({ ok: true });
  })
);

/** Returns the caller's own wrapped key (the owner needs it to re-wrap for a doctor). */
recordsRouter.get(
  "/:recordId/key",
  asyncRoute(async (req, res) => {
    const recordId = toRecordId(req.params.recordId);
    if (!recordId) return res.status(400).json({ error: "Invalid record." });
    const key = await WrappedKey.findOne({ recordId, grantee: req.user });
    if (!key) return res.status(404).json({ error: "No key stored for you on this record." });
    res.json({ wrappedKey: key.wrappedKey });
  })
);

/** Patient removes a stored wrapped key (used alongside on-chain revocation). */
recordsRouter.delete(
  "/:recordId/keys/:grantee",
  asyncRoute(async (req, res) => {
    const recordId = toRecordId(req.params.recordId);
    if (!recordId || !ethers.isAddress(req.params.grantee)) return res.status(400).json({ error: "Invalid request." });
    const onChain = await getRecord(recordId);
    if (!onChain || onChain.owner.toLowerCase() !== req.user) {
      return res.status(403).json({ error: "Only the record owner can remove keys." });
    }
    const grantee = req.params.grantee.toLowerCase();
    if (grantee === req.user) return res.status(400).json({ error: "You can't remove your own key." });
    await WrappedKey.deleteOne({ recordId, grantee });
    res.json({ ok: true });
  })
);

/**
 * Erasure after deactivation: once the patient has deactivated a record on-chain,
 * delete the encrypted file and every wrapped key. The hash stays on-chain
 * (blockchains are append-only) but reveals nothing without the file.
 */
recordsRouter.delete(
  "/:recordId",
  asyncRoute(async (req, res) => {
    const recordId = toRecordId(req.params.recordId);
    if (!recordId) return res.status(400).json({ error: "Invalid record." });
    const onChain = await getRecord(recordId);
    if (!onChain || onChain.owner.toLowerCase() !== req.user) {
      return res.status(403).json({ error: "Only the record owner can delete it." });
    }
    if (onChain.active) return res.status(409).json({ error: "Deactivate the record on-chain first." });
    const meta = await RecordMeta.findOne({ recordId, owner: req.user });
    if (meta && meta.status !== "deleted") {
      await storage.remove(meta.storageRef);
      await RecordMeta.updateOne({ _id: meta._id }, { status: "deleted" });
    }
    await WrappedKey.deleteMany({ recordId });
    res.json({ ok: true });
  })
);

/**
 * Gateway download. Releases ciphertext + the caller's wrapped key only if
 * the smart contract says the caller currently has access, verifies file
 * integrity against the on-chain hash, and records the access on-chain.
 */
recordsRouter.get(
  "/:recordId/content",
  rateLimit({ windowMs: 60_000, max: 30, byUser: true, message: "Too many downloads. Please wait a minute." }),
  asyncRoute(async (req, res) => {
    const recordId = toRecordId(req.params.recordId);
    if (!recordId) return res.status(400).json({ error: "Invalid record." });
    const onChain = await getRecord(recordId);
    if (!onChain || !onChain.active) return res.status(404).json({ error: "Record not found or deactivated." });

    const allowed = await exchange.hasAccess(recordId, req.user);
    if (!allowed) {
      return res.status(403).json({
        error: "You don't have active permission for this record. It may have expired or been revoked.",
        code: "NO_ACCESS",
      });
    }

    const meta = await RecordMeta.findOne({ recordId, status: "active" });
    const key = await WrappedKey.findOne({ recordId, grantee: req.user });
    if (!meta) return res.status(404).json({ error: "Encrypted file not found." });
    if (!key) {
      return res.status(409).json({ error: "Access is granted, but the patient hasn't shared the decryption key with you yet." });
    }

    let blob;
    try {
      blob = await storage.get(meta.storageRef);
    } catch (e) {
      if (e?.code === "ENOENT") return res.status(404).json({ error: "Encrypted file not found." });
      throw e;
    }
    const hash = sha256Hex(blob);
    if (hash.toLowerCase() !== onChain.contentHash.toLowerCase()) {
      console.error(`[integrity] record ${recordId} does not match its on-chain hash`);
      return res.status(500).json({ error: "Integrity check failed: stored file does not match the on-chain hash." });
    }

    let auditTx = null;
    const isOwner = onChain.owner.toLowerCase() === req.user;
    if (!isOwner) {
      // Log before releasing: no audit entry, no data. A NoAccess revert here means the grant
      // expired between the check above and this transaction; the error handler returns 403.
      const tx = await exchange.logAccess(recordId, req.user);
      const receipt = await tx.wait();
      auditTx = receipt.hash;
    }

    res.json({
      recordId,
      ciphertext: blob.toString("base64"),
      iv: meta.iv,
      encMeta: meta.encMeta,
      metaIv: meta.metaIv,
      wrappedKey: key.wrappedKey,
      contentHash: onChain.contentHash,
      auditTx,
    });
  })
);
