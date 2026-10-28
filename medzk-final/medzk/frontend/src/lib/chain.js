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
      const isMissingChain = e?.code === 4902 || e?.data?.originalError?.code === 4902 || /unrecognized|4902/i.test(e?.message || "");
      if (isMissingChain && target?.rpcUrls) {
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [target] });
      } else {
        throw new Error(`Switch MetaMask to the ${deployment.network} network (chain id ${deployment.chainId}).`);
      }
    }
  }
  const p2 = new BrowserProvider(window.ethereum);
  const signer = await p2.getSigner();

  // Verify that contracts are deployed on the connected node (detects node restarts)
  const exchangeCode = await p2.getCode(deployment.MedicalDataExchange.address);
  if (!exchangeCode || exchangeCode === "0x" || exchangeCode === "0x0") {
    throw new Error(
      `Contracts are not deployed on the connected network (${deployment.MedicalDataExchange.address}). If the local Hardhat blockchain was restarted, redeploy contracts by running 'npm run deploy:local' and 'npm run seed:local', then refresh.`
    );
  }

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
  if (err?.code === "INSUFFICIENT_FUNDS" || /insufficient funds/i.test(err?.message || "")) {
    return "Insufficient test ETH for gas. Use a funded demo account (Accounts #0, #2, #3, or #4) or request test ETH.";
  }
  if (err?.code === "TRANSACTION_REPLACED") return "The transaction was replaced or cancelled in your wallet.";
  if (err?.code === "TIMEOUT" || /timed out/i.test(err?.message || "")) {
    return "Transaction confirmation timed out. Check your MetaMask activity.";
  }
  const name = err?.revert?.name;
  const map = {
    NotAdmin: "Only the admin account can do this.",
    NotVerified: "Your account hasn't been verified by your hospital yet.",
    NotRole: "Your account's role can't perform this action.",
    AlreadyRegistered: "This address is already registered.",
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
    ZeroAddress: "An address can't be empty.",
    AlreadyHasAccess: "Your hospital already has longer access to this record, so emergency access isn't needed.",
    NotAuthorizedVerifier: "Only a verified doctor or hospital can record a verification.",
    NoAccess: "Access to this record has ended.",
  };
  if (name && map[name]) return map[name];
  if (err?.code === "CALL_EXCEPTION" && !name) {
    return "Contract call failed. The contract may not be deployed or the transaction reverted.";
  }
  if (err?.code === "NETWORK_ERROR" || /network changed|could not coalesce|failed to fetch/i.test(err?.message || "")) {
    return "Lost contact with the blockchain network. Check that MetaMask is on the right network and the node is running.";
  }
  return err?.shortMessage || err?.message || "Something went wrong.";
}

export async function events(contract, eventName, ...args) {
  const filter = contract.filters[eventName](...args);
  return contract.queryFilter(filter, deployment.deployBlock || 0);
}
