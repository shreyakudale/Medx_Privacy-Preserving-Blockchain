const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;
  const signers = await ethers.getSigners();
  const deployer = signers[0];

  // Local: Hardhat account #1 is the backend gateway. Other networks: set GATEWAY_ADDRESS.
  const gateway = process.env.GATEWAY_ADDRESS || (signers[1] && signers[1].address);
  if (!gateway) throw new Error("Set GATEWAY_ADDRESS in .env for this network");

  console.log(`Network:  ${network.name}`);
  console.log(`Deployer: ${deployer.address} (admin)`);
  console.log(`Gateway:  ${gateway}`);

  const exchange = await (await ethers.getContractFactory("MedicalDataExchange")).deploy(gateway);
  await exchange.waitForDeployment();
  const deployBlock = (await exchange.deploymentTransaction().wait()).blockNumber;
  const groth = await (await ethers.getContractFactory("Groth16Verifier")).deploy();
  await groth.waitForDeployment();
  const claim = await (await ethers.getContractFactory("ClaimVerifier")).deploy(
    await groth.getAddress(),
    await exchange.getAddress()
  );
  await claim.waitForDeployment();

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    admin: deployer.address,
    gateway,
    deployBlock,
    MedicalDataExchange: {
      address: await exchange.getAddress(),
      abi: (await hre.artifacts.readArtifact("MedicalDataExchange")).abi,
    },
    ClaimVerifier: {
      address: await claim.getAddress(),
      abi: (await hre.artifacts.readArtifact("ClaimVerifier")).abi,
    },
  };

  const targets = [
    path.join(__dirname, "../deployments", `${network.name}.json`),
    path.join(__dirname, "../../backend/src/contracts.json"),
    path.join(__dirname, "../../frontend/src/contracts.json"),
  ];
  for (const t of targets) {
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, JSON.stringify(out, null, 2));
    console.log(`Wrote ${path.relative(path.join(__dirname, "../.."), t)}`);
  }
  console.log(`MedicalDataExchange: ${out.MedicalDataExchange.address}`);
  console.log(`ClaimVerifier:       ${out.ClaimVerifier.address}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
