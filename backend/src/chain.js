import fs from "node:fs";
import { ethers } from "ethers";
import { config } from "./config.js";

if (!fs.existsSync(config.contractsFile)) {
  throw new Error(
    `contracts.json not found at ${config.contractsFile}. Deploy the contracts first (blockchain: npm run deploy:local).`
  );
}

const deployment = JSON.parse(fs.readFileSync(config.contractsFile, "utf8"));

export const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const baseWallet = new ethers.Wallet(config.gatewayPrivateKey, provider);
// NonceManager lets several logAccess transactions be sent concurrently
export const gatewaySigner = new ethers.NonceManager(baseWallet);

export const exchange = new ethers.Contract(
  deployment.MedicalDataExchange.address,
  deployment.MedicalDataExchange.abi,
  gatewaySigner
);

export const Role = { None: 0, Patient: 1, Doctor: 2, Hospital: 3 };

export async function getParticipant(address) {
  const p = await exchange.getParticipant(address);
  return {
    role: Number(p.role),
    verified: p.verified,
    name: p.name,
    encryptionPublicKey: p.encryptionPublicKey,
    hospital: p.hospital,
  };
}

export async function getRecord(recordId) {
  const r = await exchange.getRecord(recordId);
  if (r.owner === ethers.ZeroAddress) return null;
  return {
    owner: r.owner,
    contentHash: r.contentHash,
    storageRef: r.storageRef,
    category: r.category,
    createdAt: Number(r.createdAt),
    active: r.active,
  };
}

export async function checkGatewayConfig() {
  const onChainGateway = await exchange.gateway();
  const me = await baseWallet.getAddress();
  if (onChainGateway.toLowerCase() !== me.toLowerCase()) {
    console.warn(
      `[chain] WARNING: contract gateway is ${onChainGateway} but backend wallet is ${me}. ` +
        "Access logging will fail until the admin calls setGateway()."
    );
  }
  return me;
}
