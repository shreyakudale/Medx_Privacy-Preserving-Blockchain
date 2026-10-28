import mongoose from "mongoose";

const lower = { type: String, lowercase: true, trim: true };

/**
 * Off-chain metadata for an encrypted record. The title, file name and MIME
 * type are encrypted in the browser with the record's AES key (encMeta), so the
 * server only sees the generic category that is also on-chain.
 */
const recordMetaSchema = new mongoose.Schema(
  {
    storageRef: { type: String, required: true, unique: true },
    recordId: { type: Number, index: true, unique: true, sparse: true },
    owner: { ...lower, required: true, index: true },
    category: { type: String, required: true },
    contentHash: { type: String, required: true }, // 0x-prefixed SHA-256 of ciphertext
    iv: { type: String, required: true }, // base64 AES-GCM IV for the file
    encMeta: { type: String, required: true }, // base64 AES-GCM encrypted JSON {title, fileName, mimeType}
    metaIv: { type: String, required: true },
    size: Number,
    ownerWrappedKey: String, // held only until the on-chain id is confirmed
    // pending: uploaded, not yet on-chain. active: on-chain. deleted: deactivated and purged.
    // archived: belonged to a blockchain that no longer exists (e.g. the local node was reset); kept but unreachable.
    status: { type: String, enum: ["pending", "active", "deleted", "archived"], default: "pending" },
  },
  { timestamps: true }
);

/** Record AES key wrapped (RSA-OAEP) for one specific account. */
const wrappedKeySchema = new mongoose.Schema(
  {
    recordId: { type: Number, required: true },
    grantee: { ...lower, required: true },
    wrappedKey: { type: String, required: true }, // base64
  },
  { timestamps: true }
);
wrappedKeySchema.index({ recordId: 1, grantee: 1 }, { unique: true });

/** Hospital's Baby Jubjub signing key, encrypted at rest. */
const issuerKeySchema = new mongoose.Schema(
  {
    hospital: { ...lower, required: true, unique: true },
    encPrivateKey: { type: String, required: true },
    ax: { type: String, required: true },
    ay: { type: String, required: true },
  },
  { timestamps: true }
);

/** A hospital-signed credential. Held for the patient so they can build proofs. */
const credentialSchema = new mongoose.Schema(
  {
    subject: { ...lower, required: true, index: true },
    issuer: { ...lower, required: true },
    issuerName: String,
    // Sensitive attributes, AES-256-GCM sealed with a key derived from ISSUER_KEY_SECRET.
    sealed: String,
    // Legacy plaintext fields from earlier versions; still readable, never written again.
    birthYear: Number,
    vaccinated: { type: Number, enum: [0, 1] },
    issuerAx: String,
    issuerAy: String,
    sigR8x: String,
    sigR8y: String,
    sigS: String,
  },
  { timestamps: true }
);

/** A ZK proof a patient chose to send to a doctor. Contains no private attributes. */
const sharedProofSchema = new mongoose.Schema(
  {
    from: { ...lower, required: true },
    to: { ...lower, required: true, index: true },
    label: String,
    proof: { type: Object, required: true },
    publicSignals: { type: [String], required: true },
  },
  { timestamps: true }
);

export const RecordMeta = mongoose.model("RecordMeta", recordMetaSchema);
export const WrappedKey = mongoose.model("WrappedKey", wrappedKeySchema);
export const IssuerKey = mongoose.model("IssuerKey", issuerKeySchema);
export const Credential = mongoose.model("Credential", credentialSchema);
export const SharedProof = mongoose.model("SharedProof", sharedProofSchema);
