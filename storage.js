import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";

/**
 * Off-chain storage for encrypted blobs. Files arrive already encrypted by the
 * browser, so this layer never sees plaintext. The local-disk implementation
 * can be swapped for IPFS (return the CID as storageRef) or S3 without
 * changing the routes.
 */
export const storage = {
  async init() {
    await fs.mkdir(config.storageDir, { recursive: true });
  },

  async put(buffer) {
    const ref = crypto.randomUUID();
    await fs.writeFile(path.join(config.storageDir, ref), buffer);
    return ref;
  },

  async get(ref) {
    if (!/^[0-9a-f-]{36}$/.test(ref)) throw new Error("Invalid storage reference");
    return fs.readFile(path.join(config.storageDir, ref));
  },

  async remove(ref) {
    if (!/^[0-9a-f-]{36}$/.test(ref)) return;
    await fs.rm(path.join(config.storageDir, ref), { force: true });
  },
};

export function sha256Hex(buffer) {
  return "0x" + crypto.createHash("sha256").update(buffer).digest("hex");
}
