# MedZK change log and verification status

## Verification status (read this first)
The environment these changes were made in had **no network access**, so `npm install` could not download any package.
Therefore **none of the following was run**: Solidity compilation, the Hardhat test suite, `vite build`, the backend against
MongoDB, MetaMask flows, proof generation. Run the commands in "How to verify" below before trusting this revision.

What *was* actually run:
| Check | Result |
|---|---|
| `backend`: `node --test` (8 tests on validators, rate limiter, headers; `dotenv` stubbed) | 8 passed, 0 failed |
| `node --check` on every backend file and the Hardhat test file | pass (syntax only) |
| esbuild parse of all 16 frontend files and bundle of the local module graph | pass (syntax and imports only) |
| Solidity compile, Hardhat tests, `vite build`, end-to-end flows | **not run** |

The Solidity changes were reviewed by hand only. If `npx hardhat test` reports a compile error, that is the first thing to fix.

## Already working (before this revision)
Wallet signature login, role model, browser AES-GCM encryption with RSA key wrapping, on-chain hashes, request/approve/reject/
cancel/revoke, expiring grants, break-glass pre-authorisation, gateway-only access logging before release, real Groth16 circuit
and verifier, issuer trust checks, patient activity ledger, admin hospital registration and gateway change.

## Broken or missing, now addressed
See `AUDIT.md`. Summary: no logout/session revocation; deactivated records still listed; orphaned uploads and unrecoverable
"mined but unconfirmed" uploads; open record lookup by any wallet; turning emergency off did not end an open session;
`breakGlass` could shorten a longer grant; anyone could write verification records; credentials stored in plaintext;
invalid proofs reached inboxes; no way to revoke a doctor or suspend a hospital; no admin status view; cancelling a confirm
dialog still showed a success toast.

## Files changed
**Contracts** (`blockchain/contracts`)
- `MedicalDataExchange.sol`: zero-address checks, `AdminTransferred`, `setHospitalActive`, `revokeDoctor`, `hasAccess` requires a verified grantee, `issuerFor` ignores suspended hospitals, emergency-off ends open emergency grant, `breakGlass` cannot shorten a grant.
- `ClaimVerifier.sol`: `verifyAndRecord` restricted to verified doctors/hospitals (`NotAuthorizedVerifier`).

**Tests**: `blockchain/test/MedicalDataExchange.test.js` gained 13 contract tests and 2 ZK tests; existing tests are untouched.

**Backend** (`backend/src`)
- `config.js`: secret strength check (hard failure in production), TTL, CORS list, cleanup settings.
- `security.js` (new): headers, rate limiter, validators.
- `auth.js`: token ids, `POST /auth/logout` revocation, 2 h tokens, nonce cleanup.
- `chain.js`, `models.js`: verifier handle, clinician check, `sealed` credential field, `deleted` record status.
- `routes/records.js`: input validation, orphan reconciliation and sweep, deactivated flag, erasure endpoint, restricted owner lookup, race-safe confirm.
- `routes/credentials.js`: sealed attributes, server-side proof validation using the on-chain `check`, sent/withdraw proofs, issued history, key rotation, issuer keys limited to hospitals.
- `routes/admin.js` (new): `/admin/status`, `/admin/sweep-pending`.
- `index.js`: real health check, CORS allow-list, error mapping, graceful shutdown, periodic sweep.
- `test/security.test.js` (new), `package.json` (`npm test`), `.env.example`.

**Frontend** (`frontend/src`)
- `App.jsx`: sign-out, session-expiry handling, wallet-change handling, suspended flag.
- `components/ui.jsx`, `main.jsx`: accessible confirmation dialog, `CANCELLED` fix.
- `components/shared.jsx`: local Groth16 check then on-chain check, dismiss proofs, verification history.
- `views/Patient.jsx`, `Doctor.jsx`, `Hospital.jsx`, `Admin.jsx`, `KeyGuard.jsx`: features listed in `AUDIT.md`.
- `lib/api.js`, `lib/chain.js`, `lib/zk.js`, `styles.css`.

## Not done (and why)
- Passphrase-protected key storage in the browser, per-credential revocation, a per-verifier proof nonce, HSM-backed hospital keys: each needs design decisions or a new circuit setup; see README limitations.
- A full visual redesign: existing branding kept; additions follow its style. Not verified visually.
- Test deployment to a public testnet: needs your RPC and funded keys.

## How to verify
```bash
cd blockchain && npm install && npx hardhat test        # expect all tests to pass; fix any compile error first
cd ../backend && npm install && npm test
cd ../frontend && npm install && npm run build
```
Then follow the README run steps and the walkthrough, including the new features: revoke a doctor, suspend a hospital,
sign out, deactivate a record, withdraw a proof, admin status page.


---

# Revision 2: review of the "professional" build (restyled UI, realtime, seed)

This revision starts from the `medzk-updated-professional` package (restyled UI, realtime notifications, seed script,
extra tests) and fixes what a static review found. Same limitation as before: the review environment had no network, so
nothing could be installed or executed beyond the checks listed here.

## Fixed in this revision
| Area | Problem found | Fix |
|---|---|---|
| `components/shared.jsx` | `short()` used but never imported: the doctor's "proof verified" screen would crash with a ReferenceError the moment a proof verified | import added |
| `lib/realtime.jsx` | Notification handlers took event arguments in the wrong order (e.g. `AccessRequested` owner/requester swapped, `AccessGranted`/`AccessRevoked`/`RecordAccessed`/`EmergencyAccessUsed`/`ClaimVerified` all misaligned), so "is this for me?" was computed backwards; `DoctorVerified` always showed "revoked"; it listened to an event that doesn't exist (`HospitalVerified`) | rewritten against the compiled ABI; each person is only notified about events involving their own account; handles `DoctorRevoked`, `HospitalStatusChanged`, `RequestRejected` |
| `lib/realtime.jsx` | A 4-second heartbeat forced every data loader on every page to refetch even when no block was mined (constant backend/RPC traffic, rate-limit risk); effect re-bound listeners on every App render | refresh only when the block number changes; effect depends on stable values |
| `backend` records | The `unique` index on `recordId` turned a Hardhat restart into a permanent HTTP 409 on uploads (Mongo still held the old chain's record numbers) | stored records are checked against the chain at startup, every 15 min and on confirm; stale ones are archived, their id released and their wrapped keys deleted; indexes are re-synced after that |
| `blockchain/scripts/seed.js` | Registered patient and doctor with dummy RSA keys and created on-chain records/requests that have no encrypted file behind them (dead-end flows); hard-coded the encryption secret; every re-run replaced the hospital signing key with a new one that no longer matched the trusted key | seeds only the hospital, reads the secret from `backend/.env`, keeps an existing key, repairs the trusted key if it differs, aborts clearly if MongoDB is down |
| `components/ui.jsx`, `App.jsx` | Hardhat private keys were embedded in the production bundle | only present when `import.meta.env.DEV`; buttons hidden otherwise |
| `start-dev.bat` (+ new `start-dev.sh`) | Did not start MongoDB, create `backend/.env`, install dependencies, or wait for the node (fixed 5 s sleep) | all added; waits for the RPC to answer |
| `README.md` | Described seeded patient/doctor/sample records and used UI labels that do not exist | corrected, added troubleshooting table |

## Verification status of THIS revision
| Check | Result |
|---|---|
| Backend `security.test.js` (8 tests, `dotenv` stubbed) | 8 passed |
| Parse of all 17 frontend files, local module graph bundle | pass |
| Undefined-identifier scan (TypeScript) of frontend, backend, scripts | clean (3 known false positives: a JSDoc comment, `__dirname` in CommonJS scripts) |
| Every contract function/event/error name used by frontend and backend exists in the compiled ABI | pass |
| `node --check` on all backend, script and test files; `bash -n start-dev.sh` | pass |
| Solidity compile / `npx hardhat test` | **not run here.** The uploaded package contains compiled artifacts that include the new functions, so the contracts compile. Its README reports 25 passing; not confirmed by me |
| `backend/test/auth.test.js` | **not run here** (needs `ethers` and `jsonwebtoken` installed). README reports 14 backend tests passing in total |
| `vite build`, MongoDB, MetaMask, in-browser proof generation, the full multi-role walkthrough | **not run** |

## What is still a prototype
See README section 11: browser `localStorage` key storage, hospital signing keys held by the backend, a development
blockchain, no per-verifier proof nonce, in-memory rate limits and session revocations.
