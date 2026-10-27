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
