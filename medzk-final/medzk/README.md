# MedZK: Privacy-Preserving Blockchain-Based Medical Data Exchange Using Zero-Knowledge Proofs

<p align="center">
  <img src="https://img.shields.io/badge/Solidity-0.8.24-363636?style=for-the-badge&logo=solidity" alt="Solidity" />
  <img src="https://img.shields.io/badge/Circom-2.1.9-FF851B?style=for-the-badge" alt="Circom" />
  <img src="https://img.shields.io/badge/Groth16-BN254-blue?style=for-the-badge" alt="Groth16" />
  <img src="https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=node.js" alt="Node.js" />
  <img src="https://img.shields.io/badge/React-18.x-61DAFB?style=for-the-badge&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/Vite-5.x-646CFF?style=for-the-badge&logo=vite" alt="Vite" />
  <img src="https://img.shields.io/badge/Hardhat%20Tests-25%2F25%20Passing-brightgreen?style=for-the-badge" alt="Hardhat Tests" />
  <img src="https://img.shields.io/badge/Backend%20Tests-14%2F14%20Passing-brightgreen?style=for-the-badge" alt="Backend Tests" />
</p>

---

## Table of Contents
- [1. Executive Summary](#1-executive-summary)
- [2. System Architecture](#2-system-architecture)
- [3. Cryptographic Core](#3-cryptographic-core)
  - [3.1 Client-Side Hybrid Encryption](#31-client-side-hybrid-encryption)
  - [3.2 Zero-Knowledge Attribute Claims (Groth16)](#32-zero-knowledge-attribute-claims-groth16)
- [4. Smart Contracts Overview](#4-smart-contracts-overview)
- [5. Repository Structure](#5-repository-structure)
- [6. Quick Start & Execution](#6-quick-start--execution)
  - [6.1 One-Click Launcher (Windows)](#61-one-click-launcher-windows)
  - [6.2 Manual Multi-Terminal Setup](#62-manual-multi-terminal-setup)
- [7. MetaMask Setup & Demo Role Directory](#7-metamask-setup--demo-role-directory)
- [8. End-to-End Walkthrough](#8-end-to-end-walkthrough)
- [9. Testing & Verification](#9-testing--verification)
- [10. Circuit Compilation & Setup](#10-circuit-compilation--setup)
- [11. Security Model & Production Roadmap](#11-security-model--production-roadmap)

---

## 1. Executive Summary

Healthcare record management presents a fundamental conflict: **patient data privacy** versus **inter-institutional clinical availability**. Centralized databases present single points of failure and data exfiltration targets, while fully on-chain solutions expose sensitive patient attributes to public scrutiny.

**MedZK** resolves this dilemma through a decentralized, dual-layer cryptographic framework:

1. **Client-Side Hybrid Encryption:** Medical files and metadata are encrypted entirely in the browser using individual `AES-256-GCM` keys. These keys are asymmetric-wrapped with `RSA-OAEP-256` keys belonging strictly to authorized participants.
2. **On-Chain Consent & Access Invariants:** Smart contracts enforce role-based access control (RBAC), immutable consent requests, time-limited access grants (maximum 30 days), and revocable emergency "break-glass" provisions.
3. **Zero-Knowledge Attribute Proofs (ZKPs):** Patients prove credentialed facts (e.g., "Age $\ge 18$", "Vaccination Complete") signed by trusted hospitals using in-browser Groth16 proofs without ever disclosing their birth date, medical record contents, or identity attributes.
4. **Hardware/Gateway Access Mediation:** Off-chain encrypted blobs are released only when the smart contract verifies an active grant, and an unforgeable on-chain access receipt is committed before ciphertext release.

> [!IMPORTANT]
> **No Plaintext Medical Data Ever Touches the Blockchain or Server.**  
> The blockchain strictly stores cryptographic hashes, opaque storage identifiers, pseudonymized wallet addresses, access grant timers, and audit logs.

---

## 2. System Architecture

```
                                  MEDZK PROTOCOL FLOW
                                  
  PATIENT BROWSER                         BACKEND GATEWAY                      ETHEREUM BLOCKCHAIN
  ───────────────                         ───────────────                      ───────────────────
  [File]
     │
     ▼ (AES-256-GCM)
  [Ciphertext] ───────────────► Stores Off-Chain Blob
  [SHA-256 Hash] ────────────────────────────────────────────────────────────► addRecord(contentHash, ref)
  [Wrapped AES Key] ──────────► (Stored in Mongo with record link)
  
  CLINICIAN BROWSER
  ─────────────────
  Doctor ────────────────────────────────────────────────────────────────────► requestAccess(recordId, duration)
                                                                                       │
  Patient approves request ◄───────────────────────────────────────────────────────────┘
  (Unwraps record AES key,
   re-wraps with Doctor PK) ──► Saves Doctor Wrapped Key 
  
  Doctor requests file ───────► Verifies active on-chain grant? ─────────────► hasAccess(recordId, doctor)
                                Re-checks ciphertext SHA-256
                                Executes audit transaction ──────────────────► logAccess(recordId, doctor)
  Doctor receives file ◄────── Releases Ciphertext + Wrapped Key                       │ (Emits RecordAccessed)
  (Unwraps with private key,                                                           ▼
   checks hash, decrypts)                                                      [On-Chain Audit Log]
```

---

## 3. Cryptographic Core

### 3.1 Client-Side Hybrid Encryption

MedZK executes all encryption and decryption operations within the client browser using the native W3C **Web Cryptography API** (`window.crypto.subtle`):

* **Symmetric Encryption:** Each file generates an ephemeral, cryptographically random 256-bit AES key. The file is encrypted using **AES-GCM** with a unique 96-bit Initialization Vector (IV).
* **Metadata Sealing:** Document title, original file name, and MIME type are bundled into JSON and encrypted with the record's AES key (`encMeta`), masking all operational metadata from storage nodes.
* **Key Wrapping:** The AES key is wrapped via **RSA-OAEP** with a 2048-bit modulus and SHA-256 hashing.
* **Dual Integrity Check:** A `SHA-256` digest is generated over the ciphertext. The hash is committed on-chain. Before decryption, the recipient independently re-computes the SHA-256 digest and asserts equality with the smart contract value, preventing tampering or storage truncation.

---

### 3.2 Zero-Knowledge Attribute Claims (Groth16)

The zero-knowledge subsystem enables patients to present cryptographic proofs of compliance with clinical or legal requirements without revealing private health indicators.

#### Circuit Specification: `circuits/src/medicalClaim.circom`

```
                               ┌─────────────────────────────────┐
                               │       MedicalClaim Circuit      │
   [Private Inputs]            │                                 │   [Public Inputs]
   - birthYear                 │ 1. Poseidon(subject, by, v)     │   - issuerAx, issuerAy
   - vaccinated                │ 2. EdDSAPoseidonVerifier        │   - subject (wallet)
   - sigR8x, sigR8y, sigS      │ 3. birthYear + minAge <= year   │   - currentYear
                               │ 4. requireVaccinated => vacc    │   - minAge
                               └────────────────┬────────────────┘   - requireVaccinated
                                                │
                                                ▼
                                    Groth16 Proof (π_A, π_B, π_C)
```

* **Curve & Proving System:** Groth16 zk-SNARK over the **BN254** (alt_bn128) pairing-friendly elliptic curve.
* **Credential Hash:** A hospital signs an authorization tuple using the Poseidon algebraic hash:
  $$\text{Message} = \text{Poseidon}_3(\text{subject}, \text{birthYear}, \text{vaccinated})$$
* **Signature Scheme:** EdDSA over the **BabyJubjub** twisted Edwards curve ($Ax, Ay, R8x, R8y, S$).
* **Constraint Safety:** Range checks utilize `Num2Bits(16)` and `LessEqThan(17)` to strictly prevent arithmetic underflow and field wrap-around exploits in $\mathbb{F}_p$.
* **Verification Invariant:** Verification checks are executed both locally off-chain via `snarkjs` and on-chain via [`ClaimVerifier.sol`](file:///c:/Users/shrey/Downloads/medzk-updated/medzk/blockchain/contracts/ClaimVerifier.sol), ensuring that the issuing hospital's public key is currently trusted and active.

---

## 4. Smart Contracts Overview

| Contract | Purpose | Key Security Invariants |
| :--- | :--- | :--- |
| **`MedicalDataExchange.sol`** | Protocol Core & RBAC | • **Admin Management:** Registers and suspends hospitals; manages gateway.<br>• **Verification Hierarchies:** Hospitals verify/revoke affiliated doctors.<br>• **Consent Engine:** 30-day max grant duration; revocation terminates access immediately.<br>• **Break-Glass Emergency:** 6-hour fixed window; requires patient pre-authorization; disabling ends open sessions.<br>• **Gateway Isolation:** `logAccess()` is guarded by `onlyGateway`. |
| **`ClaimVerifier.sol`** | ZK Claim Verification | • Validates Groth16 proof pairing equations.<br>• Rejects proofs from suspended or unknown issuing hospitals.<br>• Enforces year validity window ($\pm 1$ year from block timestamp).<br>• Restricts audit trail logging (`verifyAndRecord`) to verified clinicians. |
| **`Groth16Verifier.sol`** | Pairing Engine | Generated by `snarkjs`; implements the elliptic curve bilinear pairing checks on BN254. |

---

## 5. Repository Structure

```
medzk/
├── circuits/                         # Circom ZK circuits & proving infrastructure
│   ├── src/medicalClaim.circom       # Groth16 circuit definition
│   └── scripts/build.sh              # Ceremony & artifact build script
├── blockchain/                       # Hardhat & Solidity smart contracts
│   ├── contracts/                    # Core protocol contracts
│   ├── scripts/                      # Deployment (deploy.js) & Seeding (seed.js)
│   └── test/                         # Comprehensive 25-suite Hardhat test runner
├── backend/                          # Node.js + Express API Gateway
│   ├── src/
│   │   ├── routes/                   # records, credentials, admin routers
│   │   ├── auth.js                   # EIP-191 wallet signature auth & session management
│   │   ├── chain.js                  # Gateway on-chain access verification
│   │   └── security.js               # Rate limiting, input validation & secure headers
│   └── test/                         # Security & authentication regression tests
├── frontend/                         # React 18 + Vite Web Application
│   ├── src/
│   │   ├── views/                    # Patient, Doctor, Hospital, Admin dashboards
│   │   ├── lib/                      # WebCrypto, ZK snarkjs, Ethers chain client
│   │   └── components/               # UI components, ErrorBoundary, activity drawer
│   └── public/zk/                    # Proving key (zkey), WASM, verification key
├── start-dev.bat                     # Automated one-click Windows launcher
├── AUDIT.md                          # Comprehensive security audit findings
└── CHANGES.md                        # Incremental revision changelog
```

---

## 6. Quick Start & Execution

### 6.1 One-Click Launcher

Windows: double-click `start-dev.bat`. macOS / Linux: `./start-dev.sh`.

Prerequisites: Node.js 18+, Docker (for MongoDB; or your own MongoDB on port 27017), MetaMask in your browser.

It will:
1. Start MongoDB (`docker compose up -d`).
2. Create `backend/.env` from the example if you don't have one.
3. Run `npm install` in `blockchain`, `backend` and `frontend` if needed.
4. Start the local Hardhat blockchain on `http://127.0.0.1:8545` (chain ID `31337`) and wait until it answers.
5. Deploy the contracts, then seed **one** thing: the demo hospital (account #2) with a trusted signing key. The seed is safe to re-run.
6. Start the backend (`:4000`) and the web app (`:5173`).

The patient, doctor, records and requests are not pre-made: you create them in the app (section 8), because each needs a real encryption key generated in your browser.

**Every time the blockchain node restarts it forgets everything**, so run the launcher again (it redeploys). The backend notices that stored records no longer match the new chain and archives them automatically.

---

### 6.2 Manual Multi-Terminal Setup

For Linux, macOS, or granular terminal control:

#### 1. MongoDB Service
Ensure MongoDB is running locally on port `27017` or start via Docker:
```bash
docker compose up -d
```

#### 2. Local Blockchain & Seeding
```bash
cd medzk/blockchain
npm install
npx hardhat node
```
*In a second terminal, deploy and seed (needs MongoDB running and `backend` dependencies installed, because the seed saves the hospital's signing key):*
```bash
cd medzk/blockchain
npm run deploy:local
npm run seed:local
```

#### 3. Backend Gateway
```bash
cd medzk/backend
cp .env.example .env
npm install
npm run dev
# Gateway runs on http://localhost:4000
```

#### 4. Frontend Application
```bash
cd medzk/frontend
npm install
npm run dev
# Frontend runs on http://localhost:5173
```

---

## 7. MetaMask Setup & Demo Role Directory

### Network Configuration

In MetaMask, add a Custom Network with the following settings (the frontend will also prompt you automatically):

* **Network Name:** `Hardhat Local`
* **RPC URL:** `http://127.0.0.1:8545`
* **Chain ID:** `31337`
* **Currency Symbol:** `ETH`

### Pre-Funded Demo Accounts

Each account is pre-funded with 10,000 local test ETH. Import these private keys into MetaMask:

| Role | Account | Public Address | Private Key (Local Dev Only) |
| :--- | :--- | :--- | :--- |
| **System Admin** | `#0` | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| **Backend Gateway** | `#1` | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | *Reserved for Backend Gateway (`GATEWAY_PRIVATE_KEY`)* |
| **Hospital** | `#2` | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` |
| **Doctor** | `#3` | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6` |
| **Patient** | `#4` | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` | `0x47e179ec197488593b1002f79304ef2441af49b0770c5d14e2303cb80a61ecc5` |
| **Unregistered User** | `#5` | `0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc` | `0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba` |

> [!CAUTION]
> **Never use these test keys on Ethereum Mainnet or public networks.** They are standard publicly known test vectors.

---

## 8. End-to-End Walkthrough

0. **Set up the people (once per fresh chain).** Import accounts #0, #2, #3, #4 into MetaMask (section 7). Each account's encryption key is created and kept in this browser (per account), so you can switch MetaMask accounts in one browser. Back the key up when prompted: if browser data is cleared, records shared with that key can't be opened until they are shared again.
   * **Hospital (#2)** is already registered by the seed. Sign in, then click **Create & Publish Key to Blockchain** when the key banner appears (needed for emergency access).
   * **Doctor (#3):** sign in, choose **Doctor**, enter a name and pick *Metro General Hospital*. The doctor shows as waiting for verification.
   * **Hospital (#2):** open **Doctor Roster** and click **Verify Doctor** next to the doctor.
   * **Patient (#4):** sign in, choose **Patient**, enter a pseudonym.
1. **Patient Upload (Account #4):**
   * Open **My Records** and use **Upload Record**. Select a medical file (PDF, image, or lab results).
   * The file is encrypted client-side via AES-256-GCM. The encrypted ciphertext is stored off-chain, and only the SHA-256 hash is anchored on Ethereum.
2. **Clinical Consent Request (Doctor - Account #3):**
   * Switch to Doctor Account #3 (verified in step 0).
   * Open **Request Record** (search the patient's wallet address), choose the record, a duration and a reason, and send the request.
3. **Consent Grant (Patient - Account #4):**
   * Switch back to Patient Account #4.
   * Open **Access Requests**. You'll see the doctor's request.
   * Click **Approve & Share Key**. The browser unwraps the record's AES key and re-encrypts it specifically for that doctor's public RSA key.
4. **Decryption & Audited Access (Doctor - Account #3):**
   * Switch back to Doctor Account #3.
   * Under **Shared With Me**, click **Open Record**.
   * The gateway asserts `hasAccess()` on-chain, submits an on-chain `logAccess()` transaction, and streams the ciphertext. The doctor's browser verifies the hash and decrypts the file.
5. **Zero-Knowledge Credential Issuance & Verification:**
   * **Hospital (Account #2):** Open **Issue Credentials**, input Patient #4's address, enter birth year (e.g. `1995`) and vaccination status (`1`), and sign.
   * **Patient (Account #4):** Open **ZK Proofs & Claims**. Select "Prove Age $\ge 18$". Click **Generate Proof**. An in-browser Groth16 proof is constructed in seconds and shared with the doctor.
   * **Doctor (Account #3):** Open **Verify ZK Proofs** and pick the shared proof. Verify mathematically in the browser, then click **Record on-chain** to write an immutable verification receipt to the patient's audit ledger without ever seeing their birth year.
6. **Break-Glass Emergency Access:**
   * **Patient:** Open **Manage Sharing** on a critical record and toggle **Allow Emergency Break-Glass** for Metro General Hospital.
   * **Hospital:** Open **Emergency Break-Glass**, enter the record ID and a clinical justification (e.g., "Unconscious trauma patient in ED").
   * Access is immediately authorized for a strict 6-hour window, and an emergency alert is logged to the patient's activity ledger.

---

## 9. Testing & Verification

### Smart Contracts & Circuit Tests (Hardhat)
```bash
cd medzk/blockchain
npx hardhat test
```
*Expected: 25 passing test suites (including real Groth16 proof construction, negative proofs, signal bounds, doctor revocation, and emergency grants).*

### Gateway & Security Regression Tests (Node.js)
```bash
cd medzk/backend
npm test
```
*Expected: 14 passing unit and regression tests (verifying wallet nonce generation, replay protection, JWT verification, token logout revocation, rate limiting, and security headers).*

### Frontend Production Compilation (Vite)
```bash
cd medzk/frontend
npm run build
```
*Expected: Clean compilation with 0 errors (`✓ built in ~2s`).*

---

### Troubleshooting

| Symptom | Cause and fix |
| :--- | :--- |
| "Contracts are not deployed on the connected network" | The blockchain node was restarted. Run `start-dev.bat` / `./start-dev.sh` again (or `npm run deploy:local` + `npm run seed:local`), restart the backend, refresh the page. |
| Seed says it can't reach MongoDB | `docker compose up -d`, wait a few seconds, run the seed again. |
| "The server's wallet is not authorised on the contract" / access logging fails | The backend wallet is not the contract's gateway. Admin dashboard → System status shows a one-click fix. |
| Can't open a record: "patient hasn't shared the decryption key" | The patient approved on-chain but the key hand-off failed. The patient re-approves or re-shares from **Manage sharing**. |
| Decrypt fails / "key isn't on this device" | MetaMask account's encryption key lives in that browser. Restore your key backup, or have the patient re-share to your new key. |
| 429 "Too many requests" | Rate limit protection; wait a minute. |
| Proof verification says "year" is wrong | Proofs are valid only for the current on-chain year; create a new one. |

## 10. Circuit Compilation & Setup

To modify or recompile the Circom circuit:

```bash
cd medzk/circuits
npm install
npm run build
```

This shell pipeline compiles `medicalClaim.circom` using `circom 2.1.x`, conducts a local phase-2 Groth16 setup ceremony using `snarkjs`, exports the proving artifacts (`.wasm`, `.zkey`, `verification_key.json`) directly to `frontend/public/zk/`, and updates `blockchain/contracts/Groth16Verifier.sol`.

> [!NOTE]
> The included powers-of-tau ceremony is generated locally for development. Production deployments should ingest a public universal SRS ceremony, such as the Hermez `powersOfTau28_hez_final_13.ptau`.

---

## 11. Security Model & Production Roadmap

| Operational Boundary | Current Prototype Design | Production Roadmap |
| :--- | :--- | :--- |
| **Private Key Custody** | RSA-OAEP private keys are generated via WebCrypto and held in browser `localStorage`. | Passphrase-wrapped WebCrypto keys via PBKDF2/AES-KW or hardware-backed WebAuthn credentials. |
| **Hospital Signing Keys** | EdDSA BabyJubjub signing keys are held encrypted at rest in MongoDB using AES-256-GCM. | Enterprise PKCS#11 HSM integration or Cloud KMS (AWS KMS / GCP Cloud HSM). |
| **Proof Replay Protection** | Proofs are bound to `subject` (patient address) and `currentYear`. | Add dynamic verifier nonce (`signal input challengeNonce`) to eliminate multi-clinician re-submission. |
| **Credential Revocation** | Hospital key revocation stops all issued proofs. | Implement on-chain sparse Merkle trees (SMT) for cryptographic per-credential revocation. |
| **Off-Chain Blob Storage** | Local filesystem driver with SHA-256 integrity validation. | Decentralized IPFS/Filecoin pinning clusters or private S3 buckets with client-side zero-knowledge encryption. |

---

## License

This project is released under the **MIT License**. See `LICENSE` for details.
