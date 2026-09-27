import { BrowserProvider, Contract } from "ethers";
import deployment from "../contracts.json";

export const Role = { None: 0, Patient: 1, Doctor: 2, Hospital: 3 };
export const RoleName = ["Unregistered", "Patient", "Doctor", "Hospital"];
export const RequestStatus = ["None", "Pending", "Approved", "Rejected", "Cancelled"];
export { deployment };

const CHAINS = {
  31337: { chainId: "0x7a69", chainName: "Hardhat Local", rpcUrls: ["http://127.0.0.1:8545"], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } },
  11155111: { chainId: "0xaa36a7" },
};

export async function connectWallet() {
  if (!window.ethereum) throw new Error("MetaMask is not installed. Install it to continue.");
  const provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== deployment.chainId) {
    const target = CHAINS[deployment.chainId];
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: target.chainId }] });
    } catch (e) {
      if (e.code === 4902 && target.rpcUrls) {
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [target] });
      } else {
        throw new Error(`Switch MetaMask to the ${deployment.network} network (chain id ${deployment.chainId}).`);
      }
    }
  }
  const p2 = new BrowserProvider(window.ethereum);
  const signer = await p2.getSigner();
  return {
    provider: p2,
    signer,
    address: (await signer.getAddress()),
    exchange: new Contract(deployment.MedicalDataExchange.address, deployment.MedicalDataExchange.abi, signer),
    claim: new Contract(deployment.ClaimVerifier.address, deployment.ClaimVerifier.abi, signer),
  };
}

export async function readParticipant(exchange, address) {
  const p = await exchange.getParticipant(address);
  return {
    address,
    role: Number(p.role),
    verified: p.verified,
    name: p.name,
    encryptionPublicKey: p.encryptionPublicKey,
    hospital: p.hospital,
  };
}

/** Turns an ethers error into one readable sentence. */
export function explain(err) {
  if (err?.code === "ACTION_REJECTED" || err?.info?.error?.code === 4001) return "You cancelled the request in MetaMask.";
  const name = err?.revert?.name;
  const str = String(err?.message || err?.shortMessage || err || "");

  const map = {
    NotAdmin: "Only the admin account can do this.",
    NotVerified: "Your account hasn't been verified by your hospital yet.",
    NotRole: "The selected hospital is not registered on-chain yet.",
    AlreadyRegistered: "This address is already registered on-chain under a role.",
    NotRecordOwner: "Only the patient who owns this record can do this.",
    RecordInactive: "This record has been deactivated.",
    InvalidDuration: "Choose a duration between 1 hour and 30 days.",
    InvalidGrantee: "That address isn't a verified doctor or hospital.",
    RequestNotPending: "This request has already been handled.",
    EmergencyNotAllowed: "The patient hasn't enabled emergency access for your hospital on this record.",
    UntrustedIssuer: "The credential was signed by a hospital that isn't trusted on-chain.",
    InvalidProof: "The proof is invalid. It may have been altered.",
    StaleYear: "The proof was generated for a different year. Ask for a new proof.",
    BadSignal: "The proof contains out-of-range values.",
  };

  if (name && map[name]) return map[name];
  if (str.includes("AlreadyRegistered")) return map.AlreadyRegistered;
  if (str.includes("NotRole")) return map.NotRole;
  if (str.includes("ENS") || str.includes("resolveName")) {
    return "Invalid wallet address format. Please enter a valid 42-character Ethereum address (e.g. 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65).";
  }
  if (str.includes("unknown custom error")) {
    return "Execution Reverted: This account is already registered, OR the selected hospital is not yet registered on-chain by the Admin.";
  }
  return err?.shortMessage || err?.message || "Something went wrong.";
}

export async function events(contract, eventName, ...args) {
  const filter = contract.filters[eventName](...args);
  return contract.queryFilter(filter, deployment.deployBlock || 0);
}
