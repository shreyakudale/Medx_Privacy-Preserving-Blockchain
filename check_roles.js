const { ethers } = require("hardhat");

async function main() {
  const signers = await ethers.getSigners();
  const dep = require("../../frontend/src/contracts.json");
  const c = await ethers.getContractAt("MedicalDataExchange", dep.MedicalDataExchange.address);

  const roles = ["None", "Patient", "Doctor", "Hospital"];
  const accounts = [
    { label: "Admin (#0)", addr: signers[0].address },
    { label: "Gateway (#1)", addr: signers[1].address },
    { label: "Hospital (#2)", addr: signers[2].address },
    { label: "Doctor (#3)", addr: signers[3].address },
    { label: "Patient (#4)", addr: signers[4].address },
  ];

  console.log("=== BLOCKCHAIN PARTICIPANT STATUS ===");
  for (const acc of accounts) {
    const part = await c.participants(acc.addr);
    const adminAddr = await c.admin();
    const isAdmin = acc.addr.toLowerCase() === adminAddr.toLowerCase();
    console.log(`${acc.label} [${acc.addr}]:`);
    console.log(`  Role:     ${roles[Number(part.role)]} (${Number(part.role)})`);
    console.log(`  Verified: ${part.verified}`);
    console.log(`  Name:     "${part.name}"`);
    console.log(`  IsAdmin:  ${isAdmin}`);
  }
}

main().catch(console.error);
