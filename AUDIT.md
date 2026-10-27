# MedZK audit (performed before any change)

Method: every file in `contracts/`, `test/`, `scripts/`, `circuits/`, `backend/src`, and `frontend/src` was read.
Nothing could be executed in the audit environment (no network, so `npm install` fails), so the status below
comes from reading code, not from running it. "Works" means "the code is complete and consistent on reading".

Legend: OK = implemented and consistent · PARTIAL = exists but incomplete · MISSING · BUG · SEC = security weakness

## Authentication and roles
| Item | Status | Finding |
|---|---|---|
| MetaMask connect + signed nonce login | OK | Nonce is single use, 5 min TTL, address bound. |
| Session token | PARTIAL | JWT held in memory (good) but no logout, no server-side revocation, 8 h lifetime, 401 not handled (user sees raw errors). |
| Logout | MISSING | No logout control anywhere. |
| Wrong-network handling | OK | Switch/add chain prompt exists. |
| Role separation on chain | OK | Patient/Doctor/Hospital via modifiers; admin is deployer. |
| Doctor verification by hospital | OK | `verifyDoctor`. |
| Doctor/hospital **revocation** | MISSING | A verified doctor can never lose verified status. Suspended hospital impossible. |
| Admin hospital controls | PARTIAL | Register, replace key, revoke key. No suspend/reactivate. |
| Rate limiting / security headers | MISSING | None on auth or API. |
| JWT secret quality | SEC | Placeholder secret accepted silently. |

## Records and sharing
| Item | Status | Finding |
|---|---|---|
| Browser-side AES-256-GCM + RSA-OAEP wrapping | OK | Fresh key per record, metadata encrypted too. |
| Hash registered on chain, verified on download | OK | Gateway and browser both check. |
| Log access on chain before release | OK | `logAccess` awaited before response. |
| Upload orphan handling | BUG | If `addRecord` fails or the tab closes, encrypted blob and Mongo row stay forever. If the tx succeeds but `/confirm` fails, the record is on-chain but invisible to the patient (no recovery). |
| Deactivated records in patient list | BUG | `/records/mine` ignores on-chain `active`, so deactivated records still show with working buttons. |
| Record listing by owner address | SEC | `/records/by-owner/:address` is open to any logged-in wallet, even unregistered ones. |
| Upload validation | PARTIAL | Only presence checks; no format/size validation of iv, encMeta, wrapped key; category free text. |
| Wrapped key release | OK | Only after on-chain `hasAccess`. |
| Request/approve/reject/cancel | OK | Contract and UI complete. |
| Emergency pre-authorisation | OK | Patient wraps key for hospital at opt-in time. |
| Turning emergency **off** | BUG | Disables future break-glass but an already-open emergency grant stays valid until it expires. |
| `breakGlass` overwrites grant | BUG | Can shorten a longer grant the patient gave the same hospital. |
| Activity ledger | PARTIAL | Missing cancelled requests and deactivated records. |

## Zero-knowledge
| Item | Status | Finding |
|---|---|---|
| Circuit, zkey, wasm, Solidity verifier | OK | Real Groth16; tests build real proofs. |
| Issuer trust check, year window, signal ranges | OK | `ClaimVerifier.check`. |
| `verifyAndRecord` caller | SEC | Anyone (even unregistered) can write verification records that appear in a patient's activity. |
| Credential at rest | SEC | Birth year and vaccination status stored as plain Mongo fields. |
| Proof sharing validation | PARTIAL | Recipient role and proof validity not checked on submit; invalid proofs reach the doctor's inbox. |
| Patient manages proofs | MISSING | Sent proofs cannot be listed or withdrawn. |
| Doctor verification | PARTIAL | Only an on-chain read call; no off-chain Groth16 check with the shipped verification key. |
| Replay | LIMITATION | Circuit has no verifier nonce, so a valid proof can be re-shown by whoever holds it (it is bound to the patient and the year, not to a session). Fixing it needs a circuit change and a new trusted setup, which cannot be done here. |

## Admin and operations
| Item | Status | Finding |
|---|---|---|
| Gateway change | OK | `setGateway` on chain. |
| System status dashboard | MISSING | Admin sees addresses only; no gateway balance, backend/DB health, gateway mismatch warning, participant counts. |
| Health endpoint | PARTIAL | Returns contract address only; does not check DB or chain. |

## Not changed (by design)
Private RSA key in `localStorage`, hospital signing keys held by the backend, public metadata on chain, local trusted setup. All
are documented prototype limitations in README and remain so.
