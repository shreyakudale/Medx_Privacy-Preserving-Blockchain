import mongoose from "mongoose";

const lower = { type: String, lowercase: true, trim: true };

/**
 * Off-chain metadata for an encrypted record.
 */
const recordMetaSchema = new mongoose.Schema(
  {
    storageRef: { type: String, required: true, unique: true },
    recordId: { type: Number, index: true, sparse: true },
    owner: { ...lower, required: true, index: true },
    category: { type: String, required: true },
    contentHash: { type: String, required: true },
    iv: { type: String, required: true },
    encMeta: { type: String, required: true },
    metaIv: { type: String, required: true },
    size: Number,
    ownerWrappedKey: String,
    status: { type: String, enum: ["pending", "active"], default: "pending" },
  },
  { timestamps: true }
);

/** Record AES key wrapped (RSA-OAEP) for one specific account. */
const wrappedKeySchema = new mongoose.Schema(
  {
    recordId: { type: Number, required: true },
    grantee: { ...lower, required: true },
    wrappedKey: { type: String, required: true },
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

/** A hospital-signed credential. Held for the patient. */
const credentialSchema = new mongoose.Schema(
  {
    subject: { ...lower, required: true, index: true },
    issuer: { ...lower, required: true },
    issuerName: String,
    birthYear: { type: Number, required: true },
    vaccinated: { type: Number, enum: [0, 1], required: true },
    issuerAx: String,
    issuerAy: String,
    sigR8x: String,
    sigR8y: String,
    sigS: String,
  },
  { timestamps: true }
);

/** ZK proof sent to a doctor. */
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

/** Persistent Participant Profile (Patients, Doctors, Hospitals) stored in MongoDB */
const profileSchema = new mongoose.Schema(
  {
    address: { ...lower, required: true, unique: true },
    name: String,
    role: String,
    encryptionPublicKey: String,
    hospitalAddress: String,
    verified: { type: Boolean, default: false },
    email: String,
    lastLoginAt: Date,
  },
  { timestamps: true }
);

export const RecordMeta = mongoose.model("RecordMeta", recordMetaSchema);
export const WrappedKey = mongoose.model("WrappedKey", wrappedKeySchema);
export const IssuerKey = mongoose.model("IssuerKey", issuerKeySchema);
export const Credential = mongoose.model("Credential", credentialSchema);
export const SharedProof = mongoose.model("SharedProof", sharedProofSchema);
export const ParticipantProfile = mongoose.model("ParticipantProfile", profileSchema);
export const StorageBlob = mongoose.model('StorageBlob', new mongoose.Schema({ ref: { type: String, required: true, unique: true }, data: { type: Buffer, required: true } }));
