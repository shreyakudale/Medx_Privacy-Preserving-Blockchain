// Hybrid encryption in the browser (WebCrypto).
//
//  - Each record gets its own random AES-256-GCM key.
//  - That key is "wrapped" (encrypted) with an RSA-OAEP public key: first the
//    patient's own, later each authorised doctor's or hospital's.
//  - Private RSA keys never leave the browser. They are stored in
//    localStorage for this demo; users can export a backup.

const subtle = window.crypto.subtle;
const RSA = { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };

export const b64 = {
  encode(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  decode(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};

const storageKey = (address) => `medzk:rsa:${address.toLowerCase()}`;

// ---------------------------------------------------------------- key pairs
export async function generateKeyPair(address) {
  const pair = await subtle.generateKey(RSA, true, ["encrypt", "decrypt"]);
  const publicJwk = await subtle.exportKey("jwk", pair.publicKey);
  const privateJwk = await subtle.exportKey("jwk", pair.privateKey);
  localStorage.setItem(storageKey(address), JSON.stringify({ publicJwk, privateJwk }));
  return publicKeyString(publicJwk);
}

export function hasLocalKey(address) {
  return !!localStorage.getItem(storageKey(address));
}

export function localPublicKeyString(address) {
  const raw = localStorage.getItem(storageKey(address));
  return raw ? publicKeyString(JSON.parse(raw).publicJwk) : null;
}

function publicKeyString(jwk) {
  // Minimal, canonical JWK so it can be stored on-chain and compared.
  return JSON.stringify({ kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RSA-OAEP-256" });
}

export function exportKeyBackup(address) {
  const raw = localStorage.getItem(storageKey(address));
  if (!raw) throw new Error("No key on this device.");
  return raw;
}

export function importKeyBackup(address, text) {
  const parsed = JSON.parse(text);
  if (!parsed.publicJwk || !parsed.privateJwk) throw new Error("This file is not a MedZK key backup.");
  localStorage.setItem(storageKey(address), JSON.stringify(parsed));
}

async function privateKey(address) {
  const raw = localStorage.getItem(storageKey(address));
  if (!raw) throw new Error("Your decryption key is not on this device. Import your key backup first.");
  return subtle.importKey("jwk", JSON.parse(raw).privateJwk, RSA, false, ["decrypt"]);
}

async function importPublic(publicKeyStr) {
  if (!publicKeyStr) throw new Error("This account has not published an encryption key yet.");
  const jwk = JSON.parse(publicKeyStr);
  return subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RSA-OAEP-256", ext: true }, RSA, false, ["encrypt"]);
}

// ------------------------------------------------------------- AES + wrapping
export async function newRecordKey() {
  return subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function wrapKeyFor(aesKey, recipientPublicKeyStr) {
  const raw = await subtle.exportKey("raw", aesKey);
  const pub = await importPublic(recipientPublicKeyStr);
  return b64.encode(await subtle.encrypt({ name: "RSA-OAEP" }, pub, raw));
}

export async function unwrapKey(address, wrappedB64) {
  const prv = await privateKey(address);
  const raw = await subtle.decrypt({ name: "RSA-OAEP" }, prv, b64.decode(wrappedB64));
  return subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

export async function aesEncrypt(aesKey, data) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, aesKey, data);
  return { ciphertext: new Uint8Array(ct), iv: b64.encode(iv) };
}

export async function aesDecrypt(aesKey, ciphertext, ivB64) {
  return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: b64.decode(ivB64) }, aesKey, ciphertext));
}

export async function sha256Hex(data) {
  const h = new Uint8Array(await subtle.digest("SHA-256", data));
  return "0x" + Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------ high level
export async function encryptRecord(file, title, ownerPublicKeyStr) {
  const key = await newRecordKey();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { ciphertext, iv } = await aesEncrypt(key, bytes);
  const metaJson = new TextEncoder().encode(JSON.stringify({ title, fileName: file.name, mimeType: file.type || "application/octet-stream" }));
  const meta = await aesEncrypt(key, metaJson);
  return {
    ciphertext,
    iv,
    encMeta: b64.encode(meta.ciphertext),
    metaIv: meta.iv,
    ownerWrappedKey: await wrapKeyFor(key, ownerPublicKeyStr),
    contentHash: await sha256Hex(ciphertext),
  };
}

export async function decryptMeta(address, wrappedKey, encMeta, metaIv) {
  const key = await unwrapKey(address, wrappedKey);
  const plain = await aesDecrypt(key, b64.decode(encMeta), metaIv);
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Rewrap a record key the caller already holds for another recipient. */
export async function rewrapFor(address, myWrappedKey, recipientPublicKeyStr) {
  const key = await unwrapKey(address, myWrappedKey);
  return wrapKeyFor(key, recipientPublicKeyStr);
}

/** Decrypt a gateway response; verifies the ciphertext hash first. */
export async function openDownload(address, payload) {
  const ciphertext = b64.decode(payload.ciphertext);
  const hash = await sha256Hex(ciphertext);
  if (hash.toLowerCase() !== payload.contentHash.toLowerCase()) {
    const err = new Error("Integrity check failed: the file does not match the hash recorded on the blockchain.");
    err.computedHash = hash;
    throw err;
  }
  const key = await unwrapKey(address, payload.wrappedKey);
  const plain = await aesDecrypt(key, ciphertext, payload.iv);
  const meta = JSON.parse(new TextDecoder().decode(await aesDecrypt(key, b64.decode(payload.encMeta), payload.metaIv)));
  return { blob: new Blob([plain], { type: meta.mimeType }), meta, hash };
}
