import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing environment variable ${name}`);
  return v;
}

const PLACEHOLDER = /^change-me/i;
const isProd = process.env.NODE_ENV === "production";

/**
 * Secrets must not be the shipped placeholders in production, and must be long
 * enough to resist guessing everywhere. Locally we only warn, so the documented
 * quick start still works.
 */
function secret(name) {
  const v = required(name);
  const weak = PLACEHOLDER.test(v) || v.length < 32;
  if (weak && isProd) {
    throw new Error(`${name} is a placeholder or shorter than 32 characters. Generate one with: openssl rand -hex 32`);
  }
  if (weak) console.warn(`[config] WARNING: ${name} is weak or a placeholder. Fine for local development only.`);
  return v;
}

const num = (name, fallback, { min = 1 } = {}) => {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(n) || n < min) throw new Error(`${name} must be a number >= ${min}`);
  return n;
};

export const config = {
  isProd,
  port: num("PORT", 4000),
  mongoUri: required("MONGO_URI", "mongodb://127.0.0.1:27017/medzk"),
  jwtSecret: secret("JWT_SECRET"),
  jwtTtlSeconds: num("JWT_TTL_MINUTES", 120) * 60,
  rpcUrl: required("RPC_URL", "http://127.0.0.1:8545"),
  gatewayPrivateKey: required("GATEWAY_PRIVATE_KEY"),
  // Used to encrypt hospital issuer keys and credential attributes at rest
  issuerKeySecret: secret("ISSUER_KEY_SECRET"),
  storageDir: path.resolve(__dirname, "..", process.env.STORAGE_DIR || "storage"),
  contractsFile: path.resolve(__dirname, "contracts.json"),
  // Comma-separated list of allowed browser origins
  corsOrigins: (process.env.CORS_ORIGIN || "http://localhost:5173").split(",").map((s) => s.trim()).filter(Boolean),
  maxUploadBytes: num("MAX_UPLOAD_MB", 20) * 1024 * 1024,
  // A pending (not yet on-chain) upload older than this is discarded
  pendingUploadTtlMs: num("PENDING_UPLOAD_TTL_MINUTES", 60) * 60 * 1000,
  lowGatewayBalanceEth: num("LOW_GATEWAY_BALANCE_ETH", 0.01, { min: 0 }),
};
