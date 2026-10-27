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

describe("MedicalDataExchange: lifecycle and hardening", function () {
  it("rejects zero addresses for admin-controlled settings", async function () {
    const ctx = await deploy();
    await expect(ctx.exchange.setGateway(ethers.ZeroAddress)).to.be.revertedWithCustomError(ctx.exchange, "ZeroAddress");
    await expect(ctx.exchange.transferAdmin(ethers.ZeroAddress)).to.be.revertedWithCustomError(ctx.exchange, "ZeroAddress");
    await expect(ctx.exchange.registerHospital(ethers.ZeroAddress, "X", 1, 2)).to.be.revertedWithCustomError(ctx.exchange, "ZeroAddress");
  });

  it("only the admin can use admin functions", async function () {
    const ctx = await deploy();
    await setupParticipants(ctx);
    await expect(ctx.exchange.connect(ctx.stranger).setGateway(ctx.stranger.address)).to.be.revertedWithCustomError(ctx.exchange, "NotAdmin");
    await expect(ctx.exchange.connect(ctx.hospital).registerHospital(ctx.stranger.address, "Rogue", 1, 2)).to.be.revertedWithCustomError(ctx.exchange, "NotAdmin");
    await expect(ctx.exchange.connect(ctx.hospital).setHospitalActive(ctx.hospital.address, false)).to.be.revertedWithCustomError(ctx.exchange, "NotAdmin");
    await expect(ctx.exchange.connect(ctx.stranger).revokeIssuerKey(ctx.hospital.address)).to.be.revertedWithCustomError(ctx.exchange, "NotAdmin");
  });

  it("only a patient can add records and only the owner can deactivate them", async function () {
    const ctx = await deploy();
    const id = await setupParticipants(ctx);
    const hash = ethers.sha256(ethers.toUtf8Bytes("x"));
    await expect(ctx.exchange.connect(ctx.doctor).addRecord(hash, "r", "Lab report")).to.be.revertedWithCustomError(ctx.exchange, "NotRole");
    await expect(ctx.exchange.connect(ctx.doctor).deactivateRecord(id)).to.be.revertedWithCustomError(ctx.exchange, "NotRecordOwner");
  });

  it("cannot request an inactive record, and a cancelled request cannot be approved", async function () {
    const ctx = await deploy();
    const id = await setupParticipants(ctx);
    await ctx.exchange.connect(ctx.doctor).requestAccess(id, HOUR, "x");
    await expect(ctx.exchange.connect(ctx.stranger).cancelRequest(1)).to.be.revertedWithCustomError(ctx.exchange, "InvalidGrantee");
    await ctx.exchange.connect(ctx.doctor).cancelRequest(1);
    await expect(ctx.exchange.connect(ctx.patient).approveRequest(1, 0)).to.be.revertedWithCustomError(ctx.exchange, "RequestNotPending");

    await ctx.exchange.connect(ctx.patient).deactivateRecord(id);
    await expect(ctx.exchange.connect(ctx.doctor).requestAccess(id, HOUR, "again")).to.be.revertedWithCustomError(ctx.exchange, "RecordInactive");
  });

  it("enforces the 30 day grant ceiling", async function () {
    const ctx = await deploy();
    const id = await setupParticipants(ctx);
    await expect(ctx.exchange.connect(ctx.patient).grantAccess(id, ctx.doctor.address, 31 * 24 * HOUR))
      .to.be.revertedWithCustomError(ctx.exchange, "InvalidDuration");
    await expect(ctx.exchange.connect(ctx.doctor).requestAccess(id, 0, "x"))
      .to.be.revertedWithCustomError(ctx.exchange, "InvalidDuration");
  });

  it("a hospital can revoke its doctor, which immediately ends their access", async function () {
    const ctx = await deploy();
    const id = await setupParticipants(ctx);
    await ctx.exchange.connect(ctx.patient).grantAccess(id, ctx.doctor.address, 24 * HOUR);
    expect(await ctx.exchange.hasAccess(id, ctx.doctor.address)).to.equal(true);

    await expect(ctx.exchange.connect(ctx.stranger).revokeDoctor(ctx.doctor.address)).to.be.revertedWithCustomError(ctx.exchange, "NotRole");
    await expect(ctx.exchange.connect(ctx.hospital).revokeDoctor(ctx.doctor.address)).to.emit(ctx.exchange, "DoctorRevoked");

    expect(await ctx.exchange.hasAccess(id, ctx.doctor.address)).to.equal(false);
    await expect(ctx.exchange.connect(ctx.gateway).logAccess(id, ctx.doctor.address)).to.be.revertedWithCustomError(ctx.exchange, "NoAccess");
    await expect(ctx.exchange.connect(ctx.doctor).requestAccess(id, HOUR, "x")).to.be.revertedWithCustomError(ctx.exchange, "NotVerified");

    // the hospital can re-verify
    await ctx.exchange.connect(ctx.hospital).verifyDoctor(ctx.doctor.address);
    expect(await ctx.exchange.hasAccess(id, ctx.doctor.address)).to.equal(true);
  });

  it("a hospital cannot revoke a doctor from a different hospital", async function () {
    const ctx = await deploy();
    await setupParticipants(ctx);
    const [, , , , , , , otherHospital] = await ethers.getSigners();
    await ctx.exchange.registerHospital(otherHospital.address, "Other", 3, 4);
    await expect(ctx.exchange.connect(otherHospital).revokeDoctor(ctx.doctor.address)).to.be.revertedWithCustomError(ctx.exchange, "InvalidGrantee");
    await expect(ctx.exchange.connect(otherHospital).verifyDoctor(ctx.doctor.address)).to.be.revertedWithCustomError(ctx.exchange, "InvalidGrantee");
  });

  it("suspending a hospital blocks its powers and stops trusting its credential key; reactivating restores them", async function () {
    const ctx = await deploy();
    const id = await setupParticipants(ctx, { ax: 11n, ay: 12n });
    await ctx.exchange.connect(ctx.patient).setEmergencyAccess(id, ctx.hospital.address, true);
    expect(await ctx.exchange.issuerFor(11n, 12n)).to.equal(ctx.hospital.address);

    await expect(ctx.exchange.setHospitalActive(ctx.hospital.address, false)).to.emit(ctx.exchange, "HospitalStatusChanged");
    expect(await ctx.exchange.issuerFor(11n, 12n)).to.equal(ethers.ZeroAddress);
    await expect(ctx.exchange.connect(ctx.hospital).breakGlass(id, "Unconscious in ER")).to.be.revertedWithCustomError(ctx.exchange, "NotVerified");
    await expect(ctx.exchange.connect(ctx.hospital).verifyDoctor(ctx.doctor.address)).to.be.revertedWithCustomError(ctx.exchange, "NotVerified");
    await expect(ctx.exchange.setHospitalActive(ctx.stranger.address, true)).to.be.revertedWithCustomError(ctx.exchange, "NotRole");

    await ctx.exchange.setHospitalActive(ctx.hospital.address, true);
    expect(await ctx.exchange.issuerFor(11n, 12n)).to.equal(ctx.hospital.address);
    await expect(ctx.exchange.connect(ctx.hospital).breakGlass(id, "Unconscious in ER")).to.emit(ctx.exchange, "EmergencyAccessUsed");
  });

  it("switching emergency access off ends an open emergency session", async function () {
    const ctx = await deploy();
    const id = await setupParticipants(ctx);
    await ctx.exchange.connect(ctx.patient).setEmergencyAccess(id, ctx.hospital.address, true);
    await ctx.exchange.connect(ctx.hospital).breakGlass(id, "Unconscious in ER");
    expect(await ctx.exchange.hasAccess(id, ctx.hospital.address)).to.equal(true);

    await expect(ctx.exchange.connect(ctx.patient).setEmergencyAccess(id, ctx.hospital.address, false))
      .to.emit(ctx.exchange, "AccessRevoked");
    expect(await ctx.exchange.hasAccess(id, ctx.hospital.address)).to.equal(false);
    await expect(ctx.exchange.connect(ctx.hospital).breakGlass(id, "Trying again"))
      .to.be.revertedWithCustomError(ctx.exchange, "EmergencyNotAllowed");
  });

  it("switching emergency access off does not remove a normal grant", async function () {
    const ctx = await deploy();
    const id = await setupParticipants(ctx);
    await ctx.exchange.connect(ctx.patient).grantAccess(id, ctx.hospital.address, 24 * HOUR);
    await ctx.exchange.connect(ctx.patient).setEmergencyAccess(id, ctx.hospital.address, true);
    await ctx.exchange.connect(ctx.patient).setEmergencyAccess(id, ctx.hospital.address, false);
    expect(await ctx.exchange.hasAccess(id, ctx.hospital.address)).to.equal(true);
  });

  it("break-glass never shortens a longer grant the patient already gave", async function () {
    const ctx = await deploy();
    const id = await setupParticipants(ctx);
    await ctx.exchange.connect(ctx.patient).grantAccess(id, ctx.hospital.address, 24 * HOUR);
    await ctx.exchange.connect(ctx.patient).setEmergencyAccess(id, ctx.hospital.address, true);
    await expect(ctx.exchange.connect(ctx.hospital).breakGlass(id, "Not actually needed"))
      .to.be.revertedWithCustomError(ctx.exchange, "AlreadyHasAccess");
    const g = await ctx.exchange.grants(id, ctx.hospital.address);
    expect(g.emergency).to.equal(false);
  });

  it("emergency access cannot be pre-authorised for a non-hospital or used on an inactive record", async function () {
    const ctx = await deploy();
    const id = await setupParticipants(ctx);
    await expect(ctx.exchange.connect(ctx.patient).setEmergencyAccess(id, ctx.doctor.address, true))
      .to.be.revertedWithCustomError(ctx.exchange, "NotRole");
    await ctx.exchange.connect(ctx.patient).setEmergencyAccess(id, ctx.hospital.address, true);
    await ctx.exchange.connect(ctx.patient).deactivateRecord(id);
    await expect(ctx.exchange.connect(ctx.hospital).breakGlass(id, "Unconscious in ER"))
      .to.be.revertedWithCustomError(ctx.exchange, "RecordInactive");
  });

  it("every logged access increments the on-chain counter and names the accessor", async function () {
    const ctx = await deploy();
    const id = await setupParticipants(ctx);
    await ctx.exchange.connect(ctx.patient).grantAccess(id, ctx.doctor.address, HOUR);
    await expect(ctx.exchange.connect(ctx.gateway).logAccess(id, ctx.doctor.address))
      .to.emit(ctx.exchange, "RecordAccessed").withArgs(id, ctx.patient.address, ctx.doctor.address, (v) => v > 0n);
    await ctx.exchange.connect(ctx.gateway).logAccess(id, ctx.doctor.address);
    expect(await ctx.exchange.accessCount(id)).to.equal(2n);
    await time.increase(HOUR + 1);
    await expect(ctx.exchange.connect(ctx.gateway).logAccess(id, ctx.doctor.address)).to.be.revertedWithCustomError(ctx.exchange, "NoAccess");
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

  it("only a verified doctor or hospital can record a verification", async function () {
    const ctx = await deploy();
    const issuerPrv = Buffer.from("44".repeat(32), "hex");
    const issuerPub = eddsa.prv2pub(issuerPrv);
    await setupParticipants(ctx, { ax: F.toObject(issuerPub[0]), ay: F.toObject(issuerPub[1]) });
    const year = Number(await ctx.claim.currentYear());
    const proof = await makeProof({
      issuerPrv, subject: ctx.patient.address, birthYear: 1985, vaccinated: 0,
      currentYear: year, minAge: 18, requireVaccinated: 0,
    });
    await expect(ctx.claim.connect(ctx.stranger).verifyAndRecord(proof.a, proof.b, proof.c, proof.p))
      .to.be.revertedWithCustomError(ctx.claim, "NotAuthorizedVerifier");
    await expect(ctx.claim.connect(ctx.patient).verifyAndRecord(proof.a, proof.b, proof.c, proof.p))
      .to.be.revertedWithCustomError(ctx.claim, "NotAuthorizedVerifier");
    // read-only checking stays open to anyone
    await ctx.claim.connect(ctx.stranger).check(proof.a, proof.b, proof.c, proof.p);

    // a revoked doctor can no longer record
    await ctx.exchange.connect(ctx.hospital).revokeDoctor(ctx.doctor.address);
    await expect(ctx.claim.connect(ctx.doctor).verifyAndRecord(proof.a, proof.b, proof.c, proof.p))
      .to.be.revertedWithCustomError(ctx.claim, "NotAuthorizedVerifier");
  });

  it("rejects stale-year proofs, a different subject, and a suspended issuer", async function () {
    const ctx = await deploy();
    const issuerPrv = Buffer.from("55".repeat(32), "hex");
    const issuerPub = eddsa.prv2pub(issuerPrv);
    await setupParticipants(ctx, { ax: F.toObject(issuerPub[0]), ay: F.toObject(issuerPub[1]) });
    const year = Number(await ctx.claim.currentYear());

    const stale = await makeProof({
      issuerPrv, subject: ctx.patient.address, birthYear: 1985, vaccinated: 1,
      currentYear: year - 5, minAge: 18, requireVaccinated: 0,
    });
    await expect(ctx.claim.check(stale.a, stale.b, stale.c, stale.p))
      .to.be.revertedWithCustomError(ctx.claim, "StaleYear");

    const good = await makeProof({
      issuerPrv, subject: ctx.patient.address, birthYear: 1985, vaccinated: 1,
      currentYear: year, minAge: 18, requireVaccinated: 1,
    });
    // pretend the proof is about another patient
    const swapped = [...good.p];
    swapped[2] = BigInt(ctx.stranger.address).toString();
    await expect(ctx.claim.check(good.a, good.b, good.c, swapped))
      .to.be.revertedWithCustomError(ctx.claim, "InvalidProof");
    // drop the vaccination requirement from the public signals
    const weakened = [...good.p];
    weakened[5] = "0";
    await expect(ctx.claim.check(good.a, good.b, good.c, weakened))
      .to.be.revertedWithCustomError(ctx.claim, "InvalidProof");
    // out-of-range signal
    const bad = [...good.p];
    bad[5] = "2";
    await expect(ctx.claim.check(good.a, good.b, good.c, bad))
      .to.be.revertedWithCustomError(ctx.claim, "BadSignal");

    await ctx.claim.check(good.a, good.b, good.c, good.p);
    await ctx.exchange.setHospitalActive(ctx.hospital.address, false);
    await expect(ctx.claim.check(good.a, good.b, good.c, good.p))
      .to.be.revertedWithCustomError(ctx.claim, "UntrustedIssuer");
    await ctx.exchange.setHospitalActive(ctx.hospital.address, true);
    await ctx.exchange.revokeIssuerKey(ctx.hospital.address);
    await expect(ctx.claim.check(good.a, good.b, good.c, good.p))
      .to.be.revertedWithCustomError(ctx.claim, "UntrustedIssuer");
  });
});
