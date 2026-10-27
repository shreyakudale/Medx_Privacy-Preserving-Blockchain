const { ethers } = require("hardhat");
const { buildEddsa } = require("circomlibjs");
const crypto = require("crypto");
const path = require("path");
const mongoose = require(path.resolve(__dirname, "../../backend/node_modules/mongoose"));

async function main() {
  console.log("=== SEEDING MEDZK DEMO PARTICIPANTS & DATA ===");

  const [admin, gateway, hospital, doctor, patient] = await ethers.getSigners();
  const dep = require("../../frontend/src/contracts.json");
  const exchange = await ethers.getContractAt("MedicalDataExchange", dep.MedicalDataExchange.address);

  // 1. Build BabyJubjub signing key for Hospital
  const eddsa = await buildEddsa();
  const F = eddsa.babyJub.F;
  const prv = crypto.randomBytes(32);
  const pub = eddsa.prv2pub(prv);
  const ax = F.toObject(pub[0]).toString();
  const ay = F.toObject(pub[1]).toString();

  console.log("Generated Hospital Issuer Key:");
  console.log("  ax:", ax);
  console.log("  ay:", ay);

  // 2. Save IssuerKey in MongoDB for Hospital
  try {
    const mongoUri = "mongodb://127.0.0.1:27017/medzk";
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB for key sync.");

    const issuerKeySecret = "change-me-to-another-long-random-string";
    const issuerSecret = crypto.createHash("sha256").update(issuerKeySecret).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", issuerSecret, iv);
    const enc = Buffer.concat([cipher.update(prv), cipher.final()]);
    const encPrivateKey = Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");

    const IssuerKeyModel = mongoose.model(
      "IssuerKey_seed",
      new mongoose.Schema(
        {
          hospital: { type: String, lowercase: true, trim: true, unique: true },
          encPrivateKey: String,
          ax: String,
          ay: String,
        },
        { collection: "issuerkeys" }
      )
    );

    await IssuerKeyModel.findOneAndUpdate(
      { hospital: hospital.address.toLowerCase() },
      { encPrivateKey, ax, ay },
      { upsert: true, new: true }
    );
    console.log("✓ Hospital signing key saved in MongoDB");
  } catch (err) {
    console.warn("MongoDB sync notice:", err.message);
  } finally {
    try {
      await mongoose.disconnect();
    } catch {}
  }

  // 3. Register Hospital on-chain (by Admin)
  const hospPart = await exchange.participants(hospital.address);
  if (Number(hospPart.role) === 0) {
    console.log("Registering Hospital (#2) on-chain...");
    const tx = await exchange.connect(admin).registerHospital(
      hospital.address,
      "Metro General Hospital",
      BigInt(ax),
      BigInt(ay)
    );
    await tx.wait();
    console.log("✓ Hospital registered & issuer key trusted");
  } else {
    console.log("Hospital (#2) is already registered on-chain");
  }

  // 4. Register Patient (#4) on-chain
  const patPart = await exchange.participants(patient.address);
  if (Number(patPart.role) === 0) {
    console.log("Registering Patient (#4) on-chain...");
    const dummyKey = JSON.stringify({ kty: "RSA", alg: "RSA-OAEP-256", n: "dummy", e: "AQAB" });
    const tx = await exchange.connect(patient).registerPatient("Alice Chen (Patient)", dummyKey);
    await tx.wait();
    console.log("✓ Patient registered");
  } else {
    console.log("Patient (#4) is already registered on-chain");
  }

  // 5. Register Doctor (#3) on-chain
  const docPart = await exchange.participants(doctor.address);
  if (Number(docPart.role) === 0) {
    console.log("Registering Doctor (#3) on-chain...");
    const dummyDocKey = JSON.stringify({ kty: "RSA", alg: "RSA-OAEP-256", n: "dummy", e: "AQAB" });
    const tx = await exchange.connect(doctor).registerDoctor(
      "Dr. Marcus Vance (Cardiologist)",
      dummyDocKey,
      hospital.address
    );
    await tx.wait();
    console.log("✓ Doctor registered affiliated with Metro General Hospital");
  } else {
    console.log("Doctor (#3) is already registered on-chain");
  }

  // 6. Verify Doctor (#3) by Hospital (#2)
  const docPartCurrent = await exchange.participants(doctor.address);
  if (!docPartCurrent.verified) {
    console.log("Verifying Doctor (#3) by Hospital (#2)...");
    const tx = await exchange.connect(hospital).verifyDoctor(doctor.address);
    await tx.wait();
    console.log("✓ Doctor verified by Hospital");
  } else {
    console.log("Doctor (#3) is already verified");
  }

  // 7. Add sample medical records for Patient
  const patientRecords = await exchange.getPatientRecords(patient.address);
  if (patientRecords.length === 0) {
    console.log("Adding sample encrypted medical records for Patient (#4)...");
    const h1 = ethers.sha256(ethers.toUtf8Bytes("demo-record-content-cbc-lipid-panel"));
    const tx1 = await exchange.connect(patient).addRecord(h1, "ipfs://bafy-lab-lipid-panel-2026", "Lab report");
    await tx1.wait();
    console.log("✓ Record #1 added: Lab report");

    const h2 = ethers.sha256(ethers.toUtf8Bytes("demo-record-content-mri-lumbar-spine"));
    const tx2 = await exchange.connect(patient).addRecord(h2, "ipfs://bafy-rad-mri-lumbar-spine", "Radiology");
    await tx2.wait();
    console.log("✓ Record #2 added: Radiology (MRI)");

    // 8. Doctor requests access to Record #1
    console.log("Doctor (#3) requesting access to Record #1...");
    const txReq = await exchange.connect(doctor).requestAccess(
      1,
      7 * 86400, // 7 days
      "Pre-operative Cardiology & Anesthesia Consultation"
    );
    await txReq.wait();
    console.log("✓ Access request #1 created (Pending approval from Patient)");

    // 9. Patient grants active access to Record #2 for Doctor
    console.log("Patient (#4) granting active access to Record #2 for Doctor (#3)...");
    const txGrant = await exchange.connect(patient).grantAccess(
      2,
      doctor.address,
      14 * 86400 // 14 days
    );
    await txGrant.wait();
    console.log("✓ Active access grant created for Record #2");
  } else {
    console.log(`Patient already has ${patientRecords.length} records on-chain.`);
  }

  console.log("\n==============================================");
  console.log("DEMO ACCOUNTS READY TO TEST IN METAMASK:");
  console.log("==============================================");
  console.log("1. Admin:    Account #0 (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)");
  console.log("   - Can view hospital status, rotate keys, system audit log.");
  console.log("2. Hospital: Account #2 (0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC)");
  console.log("   - Verified ✓, Issuer Key Active ✓, Dr. Marcus Vance verified ✓.");
  console.log("   - Can issue ZK credentials to patients, manage doctors.");
  console.log("3. Doctor:   Account #3 (0x90F79bf6EB2c4f870365E785982E1f101E93b906)");
  console.log("   - Verified by Metro General Hospital ✓.");
  console.log("   - Has Pending Request for Record #1, Active Grant for Record #2.");
  console.log("4. Patient:  Account #4 (0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65)");
  console.log("   - 2 Records uploaded, Pending Request from Dr. Vance ready to Approve/Reject.");
  console.log("==============================================");
}

main().catch((err) => {
  console.error("Seed error:", err);
  process.exitCode = 1;
});
