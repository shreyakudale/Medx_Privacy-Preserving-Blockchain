/**
 * Local development seed. Run after `npm run deploy:local`:
 *
 *   npm run seed:local
 *
 * What it does (safe to run repeatedly):
 *   - registers Hardhat account #2 as "Metro General Hospital" and makes its credential-signing key trusted on-chain
 *   - stores that signing key (encrypted, exactly as the backend does) so the hospital can issue credentials
 *
 * What it deliberately does NOT do:
 *   - It does not create patients, doctors, records or requests. Those need real browser-generated encryption keys
 *     and real encrypted files, so you create them through the app (see the README walkthrough). Fake rows here
 *     would show up on-chain but have no encrypted file behind them and could never be opened.
 *
 * Requires MongoDB running (docker compose up -d) and `npm install` done in ../backend.
 */
const { ethers } = require("hardhat");
const { buildEddsa } = require("circomlibjs");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/** Reads KEY=value lines from backend/.env (falls back to the documented local defaults). */
function readBackendEnv() {
  const out = {};
  const file = path.resolve(__dirname, "../../backend/.env");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } else {
    console.warn("! backend/.env not found: using the defaults from .env.example. Copy it first (cp .env.example .env).");
  }
  return {
    mongoUri: out.MONGO_URI || "mongodb://127.0.0.1:27017/medzk",
    issuerKeySecret: out.ISSUER_KEY_SECRET || "change-me-to-another-long-random-string",
  };
}

function loadMongoose() {
  try {
    return require(path.resolve(__dirname, "../../backend/node_modules/mongoose"));
  } catch {
    throw new Error("Run `npm install` in the backend folder first (the seed uses its MongoDB driver).");
  }
}

async function main() {
  console.log("=== MedZK local seed ===");
  const [admin, , hospital] = await ethers.getSigners();
  const dep = require("../../frontend/src/contracts.json");
  const exchange = await ethers.getContractAt("MedicalDataExchange", dep.MedicalDataExchange.address);

  if ((await ethers.provider.getCode(dep.MedicalDataExchange.address)) === "0x") {
    throw new Error("No contract at the deployed address. Run `npm run deploy:local` against the running node first.");
  }
  if ((await exchange.admin()).toLowerCase() !== admin.address.toLowerCase()) {
    throw new Error("Account #0 is not the contract admin. Redeploy with `npm run deploy:local`.");
  }

  // 1. The hospital's signing key lives in MongoDB (sealed the same way the backend seals it).
  const { mongoUri, issuerKeySecret } = readBackendEnv();
  const mongoose = loadMongoose();
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 4000 });
  } catch (e) {
    throw new Error(`Can't reach MongoDB at ${mongoUri}. Start it with \`docker compose up -d\` and run the seed again. (${e.message})`);
  }

  let ax, ay;
  try {
    const IssuerKey = mongoose.model(
      "IssuerKey_seed",
      new mongoose.Schema(
        { hospital: { type: String, lowercase: true, trim: true, unique: true }, encPrivateKey: String, ax: String, ay: String },
        { collection: "issuerkeys" }
      )
    );
    const hospitalAddr = hospital.address.toLowerCase();
    const doc = await IssuerKey.findOne({ hospital: hospitalAddr });
    if (doc) {
      // Re-runs must keep the existing key: replacing it would silently break credential issuing.
      ({ ax, ay } = doc);
      console.log("Hospital signing key already exists: keeping it.");
    } else {
      const eddsa = await buildEddsa();
      const F = eddsa.babyJub.F;
      const prv = crypto.randomBytes(32);
      const pub = eddsa.prv2pub(prv);
      ax = F.toObject(pub[0]).toString();
      ay = F.toObject(pub[1]).toString();
      const key = crypto.createHash("sha256").update(issuerKeySecret).digest();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const enc = Buffer.concat([cipher.update(prv), cipher.final()]);
      const encPrivateKey = Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
      await IssuerKey.create({ hospital: hospitalAddr, encPrivateKey, ax, ay });
      console.log("Created the hospital signing key and stored it in MongoDB.");
    }
  } finally {
    await mongoose.disconnect().catch(() => {});
  }

  // 2. Register the hospital on-chain, or repair its trusted key if it differs from the stored one.
  const part = await exchange.participants(hospital.address);
  if (Number(part.role) === 0) {
    await (await exchange.connect(admin).registerHospital(hospital.address, "Metro General Hospital", BigInt(ax), BigInt(ay))).wait();
    console.log("Registered hospital #2 on-chain and trusted its signing key.");
  } else if (Number(part.role) !== 3) {
    throw new Error("Account #2 is registered as something other than a hospital. Redeploy to start clean.");
  } else {
    const trusted = await exchange.issuerFor(BigInt(ax), BigInt(ay));
    if (trusted.toLowerCase() !== hospital.address.toLowerCase()) {
      await (await exchange.connect(admin).setIssuerKey(hospital.address, BigInt(ax), BigInt(ay))).wait();
      console.log("Hospital was registered with a different key: updated the trusted key to the stored one.");
    } else {
      console.log("Hospital #2 is already registered with the correct signing key.");
    }
  }

  const line = "=".repeat(64);
  console.log(`\n${line}\nLOCAL TEST ACCOUNTS (Hardhat's public test keys; import into MetaMask)\n${line}`);
  console.log(`Admin     #0  ${admin.address}   deployer, registers hospitals`);
  console.log(`Hospital  #2  ${hospital.address}   ready: registered, signing key trusted`);
  console.log("Doctor    #3  register it in the app: choose Doctor, pick the hospital address above");
  console.log("Patient   #4  register it in the app: choose Patient");
  console.log(`${line}\nNext: open http://localhost:5173 and follow the README walkthrough.\n${line}`);
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message || err);
  process.exitCode = 1;
});
