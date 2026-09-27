import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT || 4000),
  mongoUri: required("MONGO_URI", "mongodb://127.0.0.1:27017/medzk"),
  jwtSecret: required("JWT_SECRET"),
  rpcUrl: required("RPC_URL", "http://127.0.0.1:8545"),
  gatewayPrivateKey: required("GATEWAY_PRIVATE_KEY"),
  // 32-byte hex secret used to encrypt hospital issuer keys at rest
  issuerKeySecret: required("ISSUER_KEY_SECRET"),
  storageDir: path.resolve(__dirname, "..", process.env.STORAGE_DIR || "storage"),
  contractsFile: path.resolve(__dirname, "contracts.json"),
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024,
};
