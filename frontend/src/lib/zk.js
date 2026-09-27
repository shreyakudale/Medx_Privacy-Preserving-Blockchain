// Zero-knowledge proof generation runs entirely in the browser, so the
// patient's birth year and vaccination status never leave the device.
import * as snarkjs from "snarkjs";

const WASM = "/zk/medicalClaim.wasm";
const ZKEY = "/zk/medicalClaim_final.zkey";

/**
 * @param credential hospital-signed credential {subject, birthYear, vaccinated, issuerAx, issuerAy, sigR8x, sigR8y, sigS}
 * @param claim      {minAge, requireVaccinated, currentYear}
 */
export async function proveClaim(credential, claim) {
  const input = {
    issuerAx: credential.issuerAx,
    issuerAy: credential.issuerAy,
    subject: BigInt(credential.subject).toString(),
    currentYear: String(claim.currentYear),
    minAge: String(claim.minAge),
    requireVaccinated: claim.requireVaccinated ? "1" : "0",
    birthYear: String(credential.birthYear),
    vaccinated: String(credential.vaccinated),
    sigR8x: credential.sigR8x,
    sigR8y: credential.sigR8y,
    sigS: credential.sigS,
  };
  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
    return { proof, publicSignals };
  } catch (e) {
    // The witness generator fails when the statement is false.
    throw new Error("This credential doesn't satisfy the condition, so no proof can be created.");
  }
}

/** Converts a snarkjs proof into the argument arrays the Solidity verifier expects. */
export async function toCalldata(proof, publicSignals) {
  const cd = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  return JSON.parse("[" + cd + "]");
}

export function describeSignals(publicSignals) {
  return {
    subject: "0x" + BigInt(publicSignals[2]).toString(16).padStart(40, "0"),
    currentYear: Number(publicSignals[3]),
    minAge: Number(publicSignals[4]),
    requireVaccinated: publicSignals[5] === "1",
  };
}
