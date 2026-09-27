const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const path = require("path");
const fs = require("fs");
const snarkjs = require("snarkjs");
const { buildEddsa, buildPoseidon } = require("circomlibjs");

const HOUR = 3600;
// Prefer fresh circuit build output; fall back to the copies shipped with the frontend.
const BUILD = path.join(__dirname, "../../circuits/build");
const SHIPPED = path.join(__dirname, "../../frontend/public/zk");
const pick = (a, b) => (fs.existsSync(a) ? a : b);
const WASM = pick(path.join(BUILD, "medicalClaim_js/medicalClaim.wasm"), path.join(SHIPPED, "medicalClaim.wasm"));
const ZKEY = pick(path.join(BUILD, "medicalClaim_final.zkey"), path.join(SHIPPED, "medicalClaim_final.zkey"));

async function deploy() {
  const [admin, gateway, hospital, doctor, patient, stranger, doctor2] = await ethers.getSigners();

  const Exchange = await ethers.getContractFactory("MedicalDataExchange");
  const exchange = await Exchange.deploy(gateway.address);

  const Groth = await ethers.getContractFactory("Groth16Verifier");
  const groth = await Groth.deploy();
  const Claim = await ethers.getContractFactory("ClaimVerifier");
  const claim = await Claim.deploy(await groth.getAddress(), await exchange.getAddress());

  return { exchange, claim, admin, gateway, hospital, doctor, patient, stranger, doctor2 };
}

async function setupParticipants(ctx, issuer = { ax: 1n, ay: 2n }) {
  const { exchange, hospital, doctor, patient } = ctx;
  await exchange.registerHospital(hospital.address, "City Hospital", issuer.ax, issuer.ay);
  await exchange.connect(patient).registerPatient("patient-7f3a", "{\"kty\":\"RSA\"}");
  await exchange.connect(doctor).registerDoctor("Dr. Rao", "{\"kty\":\"RSA\"}", hospital.address);
  await exchange.connect(hospital).verifyDoctor(doctor.address);
  const hash = ethers.sha256(ethers.toUtf8Bytes("ciphertext"));
  await exchange.connect(patient).addRecord(hash, "store-1", "Lab report");
  return 1n;
}

describe("MedicalDataExchange", function () {
  it("registers participants and records", async function () {
    const ctx = await deploy();
    const id = await setupParticipants(ctx);
    const rec = await ctx.exchange.getRecord(id);
    expect(rec.owner).to.equal(ctx.patient.address);
    expect(await ctx.exchange.getPatientRecords(ctx.patient.address)).to.deep.equal([1n]);
    expect(await ctx.exchange.hasAccess(id, ctx.patient.address)).to.equal(true);
    expect(await ctx.exchange.hasAccess(id, ctx.doctor.address)).to.equal(false);
  });

  it("blocks unverified doctors from requesting access", async function () {
    const ctx = await deploy();
    await setupParticipants(ctx);
    await ctx.exchange.connect(ctx.doctor2).registerDoctor("Dr. New", "", ctx.hospital.address);
    await expect(ctx.exchange.connect(ctx.doctor2).requestAccess(1, HOUR, "consult"))
      .to.be.revertedWithCustomError(ctx.exchange, "NotVerified");
  });

  it("runs request -> approve -> expiry", async function () {
    const ctx = await deploy();
    const id = await setupParticipants(ctx);
    await expect(ctx.exchange.connect(ctx.doctor).requestAccess(id, 24 * HOUR, "Follow-up consult"))
      .to.emit(ctx.exchange, "AccessRequested");

    // only the owner can approve
    await expect(ctx.exchange.connect(ctx.stranger).approveRequest(1, 0))
      .to.be.revertedWithCustomError(ctx.exchange, "NotRecordOwner");

    // patient shortens to 2 hours
    await expect(ctx.exchange.connect(ctx.patient).approveRequest(1, 2 * HOUR))
      .to.emit(ctx.exchange, "AccessGranted");
    expect(await ctx.exchange.hasAccess(id, ctx.doctor.address)).to.equal(true);

    await time.increase(2 * HOUR + 1);
    expect(await ctx.exchange.hasAccess(id, ctx.doctor.address)).to.equal(false);
  });

  it("rejects and revokes", async function () {
    const ctx = await deploy();
    const id = await setupParticipants(ctx);
    await ctx.exchange.connect(ctx.doctor).requestAccess(id, HOUR, "x");
    await ctx.exchange.connect(ctx.patient).rejectRequest(1);
    await expect(ctx.exchange.connect(ctx.patient).approveRequest(1, 0))
      .to.be.revertedWithCustomError(ctx.exchange, "RequestNotPending");

    await ctx.exchange.connect(ctx.patient).grantAccess(id, ctx.doctor.address, HOUR);
    expect(await ctx.exchange.hasAccess(id, ctx.doctor.address)).to.equal(true);
    await ctx.exchange.connect(ctx.patient).revokeAccess(id, ctx.doctor.address);
    expect(await ctx.exchange.hasAccess(id, ctx.doctor.address)).to.equal(false);
  });

  it("only the gateway can log access, and only for authorised accessors", async function () {
    const ctx = await deploy();
    const id = await setupParticipants(ctx);
    await expect(ctx.exchange.connect(ctx.stranger).logAccess(id, ctx.doctor.address))
      .to.be.revertedWithCustomError(ctx.exchange, "NotGateway");
    await expect(ctx.exchange.connect(ctx.gateway).logAccess(id, ctx.doctor.address))
      .to.be.revertedWithCustomError(ctx.exchange, "NoAccess");

    await ctx.exchange.connect(ctx.patient).grantAccess(id, ctx.doctor.address, HOUR);
    await expect(ctx.exchange.connect(ctx.gateway).logAccess(id, ctx.doctor.address))
      .to.emit(ctx.exchange, "RecordAccessed");
    expect(await ctx.exchange.accessCount(id)).to.equal(1n);
  });

  it("break-glass requires patient pre-authorisation and expires", async function () {
    const ctx = await deploy();
    const id = await setupParticipants(ctx);
    await expect(ctx.exchange.connect(ctx.hospital).breakGlass(id, "Unconscious in ER"))
      .to.be.revertedWithCustomError(ctx.exchange, "EmergencyNotAllowed");

    await ctx.exchange.connect(ctx.patient).setEmergencyAccess(id, ctx.hospital.address, true);
    await expect(ctx.exchange.connect(ctx.hospital).breakGlass(id, "Unconscious in ER"))
      .to.emit(ctx.exchange, "EmergencyAccessUsed");
    const g = await ctx.exchange.grants(id, ctx.hospital.address);
    expect(g.emergency).to.equal(true);

    await time.increase(6 * HOUR + 1);
    expect(await ctx.exchange.hasAccess(id, ctx.hospital.address)).to.equal(false);
  });

  it("deactivated records are inaccessible even to grantees", async function () {
    const ctx = await deploy();
    const id = await setupParticipants(ctx);
    await ctx.exchange.connect(ctx.patient).grantAccess(id, ctx.doctor.address, HOUR);
    await ctx.exchange.connect(ctx.patient).deactivateRecord(id);
    expect(await ctx.exchange.hasAccess(id, ctx.doctor.address)).to.equal(false);
  });
});

describe("ClaimVerifier (zero-knowledge)", function () {
  this.timeout(180000);

  let eddsa, poseidon, F;
  before(async function () {
    if (!fs.existsSync(WASM) || !fs.existsSync(ZKEY)) {
      console.log("    circuit artifacts missing - run `npm run build` in /circuits first");
      this.skip();
    }
    eddsa = await buildEddsa();
    poseidon = await buildPoseidon();
    F = eddsa.babyJub.F;
  });

  async function makeProof({ issuerPrv, subject, birthYear, vaccinated, currentYear, minAge, requireVaccinated }) {
    const pub = eddsa.prv2pub(issuerPrv);
    const msg = poseidon([BigInt(subject), BigInt(birthYear), BigInt(vaccinated)]);
    const sig = eddsa.signPoseidon(issuerPrv, msg);
    const input = {
      issuerAx: F.toObject(pub[0]).toString(),
      issuerAy: F.toObject(pub[1]).toString(),
      subject: BigInt(subject).toString(),
      currentYear, minAge, requireVaccinated,
      birthYear, vaccinated,
      sigR8x: F.toObject(sig.R8[0]).toString(),
      sigR8y: F.toObject(sig.R8[1]).toString(),
      sigS: sig.S.toString(),
    };
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
    const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
    const [a, b, c, p] = JSON.parse("[" + calldata + "]");
    return { a, b, c, p, issuer: { ax: F.toObject(pub[0]), ay: F.toObject(pub[1]) } };
  }

  it("verifies an age + vaccination claim without revealing birth year", async function () {
    const ctx = await deploy();
    const issuerPrv = Buffer.from("11".repeat(32), "hex");
    const issuerPub = eddsa.prv2pub(issuerPrv);
    await setupParticipants(ctx, { ax: F.toObject(issuerPub[0]), ay: F.toObject(issuerPub[1]) });

    const year = Number(await ctx.claim.currentYear());
    const proof = await makeProof({
      issuerPrv, subject: ctx.patient.address, birthYear: 1990, vaccinated: 1,
      currentYear: year, minAge: 18, requireVaccinated: 1,
    });

    const [issuer, patient] = await ctx.claim.check(proof.a, proof.b, proof.c, proof.p);
    expect(issuer).to.equal(ctx.hospital.address);
    expect(patient).to.equal(ctx.patient.address);

    await expect(ctx.claim.connect(ctx.doctor).verifyAndRecord(proof.a, proof.b, proof.c, proof.p))
      .to.emit(ctx.claim, "ClaimVerified");
    // birth year is not among the public signals
    expect(proof.p.map(BigInt)).to.not.include(1990n);
  });

  it("cannot prove a false claim", async function () {
    const issuerPrv = Buffer.from("22".repeat(32), "hex");
    await expect(makeProof({
      issuerPrv, subject: "0x0000000000000000000000000000000000000001", birthYear: 2015, vaccinated: 1,
      currentYear: 2026, minAge: 18, requireVaccinated: 0,
    })).to.be.rejected;
  });

  it("rejects proofs from untrusted issuers and tampered signals", async function () {
    const ctx = await deploy();
    await setupParticipants(ctx); // hospital registered with a dummy key
    const year = Number(await ctx.claim.currentYear());
    const rogue = Buffer.from("33".repeat(32), "hex");
    const proof = await makeProof({
      issuerPrv: rogue, subject: ctx.patient.address, birthYear: 1990, vaccinated: 0,
      currentYear: year, minAge: 18, requireVaccinated: 0,
    });
    await expect(ctx.claim.check(proof.a, proof.b, proof.c, proof.p))
      .to.be.revertedWithCustomError(ctx.claim, "UntrustedIssuer");

    // trust the rogue key, then tamper with minAge
    await ctx.exchange.setIssuerKey(ctx.hospital.address, proof.issuer.ax, proof.issuer.ay);
    const tampered = [...proof.p];
    tampered[4] = "0x" + (21).toString(16);
    await expect(ctx.claim.check(proof.a, proof.b, proof.c, tampered))
      .to.be.revertedWithCustomError(ctx.claim, "InvalidProof");
  });
});
