import { useState } from "react";
import {
  useSession,
  useAction,
  Button,
  Field,
  Panel,
  Empty,
  Pill,
  Address,
  useToast,
  CountdownBadge,
} from "./ui.jsx";
import { api } from "../lib/api.js";
import { useLoad, useParticipants, openRecord } from "../lib/hooks.js";
import { toCalldata, describeSignals, verifyLocal } from "../lib/zk.js";
import { explain, events } from "../lib/chain.js";
import { when, remaining } from "../lib/format.js";

/** Records the signed-in doctor/hospital can currently open. */
export function SharedRecords({ reloadKey }) {
  const { address, exchange } = useSession();
  const who = useParticipants(exchange);
  const toast = useToast();
  const [list, reload, error] = useLoad(() => api.sharedWithMe(), [reloadKey]);
  const [openingId, setOpeningId] = useState(null);

  const open = async (recordId) => {
    setOpeningId(recordId);
    try {
      const { meta, auditTx } = await openRecord(address, recordId);
      toast(
        `Opened "${meta.title}". Decrypted locally; access logged on-chain${
          auditTx ? ` (tx ${auditTx.slice(0, 10)}…)` : ""
        }.`,
        "ok"
      );
    } catch (e) {
      toast(
        e?.code === "NO_ACCESS" || e?.status === 403
          ? "Access to this record has expired or was revoked by the patient."
          : explain(e),
        "error"
      );
    } finally {
      setOpeningId(null);
      reload();
    }
  };

  const categoryIcons = {
    "Lab report": "🧪",
    Prescription: "💊",
    Diagnosis: "🩺",
    Imaging: "🩻",
    "Discharge summary": "🏥",
    Vaccination: "💉",
    Other: "📋",
  };

  return (
    <Panel
      title="Active Shared Records"
      subtitle="Decrypted client-side. Gateway writes an immutable audit record on-chain upon download."
      icon="📂"
      aside={<button className="btn-link" onClick={reload}>🔄 Refresh</button>}
    >
      {error ? <div className="alert-banner alert-banner-danger">{error}</div> : null}
      {!list ? (
        <div className="loading-state">Loading active grants...</div>
      ) : list.length === 0 ? (
        <Empty icon="🔒" title="No records shared with you right now">
          A record appears here once the patient approves your access request, and disappears
          automatically when the duration expires or access is revoked.
        </Empty>
      ) : (
        <div className="shared-records-grid">
          {list.map((r) => {
            const owner = who(r.owner);
            return (
              <div key={r.recordId} className="shared-record-card">
                <div className="shared-card-top">
                  <span className="shared-cat-icon">
                    {categoryIcons[r.category] || "📄"}
                  </span>
                  <div className="shared-card-info">
                    <strong className="shared-record-title">
                      Record #{r.recordId}: {r.category}
                    </strong>
                    <span className="shared-record-sub">
                      Patient: <Address value={r.owner} name={owner?.name} /> • Added{" "}
                      {new Date(r.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="shared-card-footer">
                  <div className="shared-card-tags">
                    {r.emergency ? <Pill tone="danger" icon="🚨">Emergency</Pill> : null}
                    <CountdownBadge expiresAt={r.expiresAt} />
                  </div>

                  <Button
                    busy={openingId === r.recordId}
                    onClick={() => open(r.recordId)}
                    variant="primary"
                    icon="🔓"
                  >
                    Open & Decrypt
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/** Verify a zero-knowledge claim, read-only first, then optionally record it on-chain. */
export function VerifyProofs() {
  const { claim, exchange } = useSession();
  const who = useParticipants(exchange);
  const [inbox, reloadInbox] = useLoad(() => api.proofInbox(), []);
  const [pasted, setPasted] = useState("");
  const [current, setCurrent] = useState(null);
  const [result, setResult] = useState(null);

  const load = (p) => {
    setCurrent(p);
    setResult(null);
  };

  const [check, checking] = useAction(async () => {
    setResult(null);
    if (!(await verifyLocal(current.proof, current.publicSignals))) {
      setResult({
        ok: false,
        reason:
          "The cryptographic Groth16 proof is mathematically invalid or was tampered with.",
      });
      return;
    }
    let args;
    try {
      args = await toCalldata(current.proof, current.publicSignals);
    } catch {
      setResult({ ok: false, reason: "The proof payload structure is malformed." });
      return;
    }
    try {
      const [issuer, patient] = await claim.check(...args);
      setResult({
        ok: true,
        issuer,
        patient,
        ...describeSignals(current.publicSignals),
      });
    } catch (e) {
      setResult({ ok: false, reason: explain(e) });
    }
  });

  const [record, recording] = useAction(async () => {
    const [a, b, c, pub] = await toCalldata(current.proof, current.publicSignals);
    const tx = await claim.verifyAndRecord(a, b, c, pub);
    setResult((r) => ({ ...r, txHash: tx.hash }));
    await tx.wait();
    setResult((r) => ({ ...r, recorded: true }));
  }, "Verification permanently recorded on Ethereum blockchain.");

  const [dismiss, dismissing] = useAction(async (p) => {
    await api.deleteProof(p._id);
    if (current?._id === p._id) {
      setCurrent(null);
      setResult(null);
    }
    reloadInbox();
  }, "Proof removed from inbox.");

  const usePasted = () => {
    try {
      const parsed = JSON.parse(pasted);
      const ok =
        parsed?.proof &&
        Array.isArray(parsed.publicSignals) &&
        parsed.publicSignals.length === 6;
      if (!ok) throw new Error();
      load({ ...parsed, label: parsed.label || "Pasted proof" });
    } catch {
      setCurrent(null);
      setResult({
        ok: false,
        reason: "The pasted text is not a valid MedZK Groth16 proof object.",
      });
    }
  };

  return (
    <div className="view-section">
      <Panel
        title="Zero-Knowledge Proof Inbox"
        subtitle="Proofs received from patients proving age or vaccination without disclosing private data"
        icon="📥"
        aside={<button className="btn-link" onClick={reloadInbox}>🔄 Refresh</button>}
      >
        {!inbox ? (
          <div className="loading-state">Checking inbox...</div>
        ) : inbox.length === 0 ? (
          <Empty icon="🛡️" title="No incoming proofs in inbox">
            Ask the patient to generate a zero-knowledge proof from their portal and send it to your
            wallet address.
          </Empty>
        ) : (
          <div className="proof-inbox-list">
            {inbox.map((p) => {
              const s = describeSignals(p.publicSignals);
              return (
                <div key={p._id} className="proof-inbox-item">
                  <div className="proof-inbox-main">
                    <strong className="proof-item-title">
                      {p.label || "Medical Eligibility Claim"}
                    </strong>
                    <span className="proof-item-meta">
                      Patient: <Address value={p.from} name={who(p.from)?.name} /> • Received{" "}
                      {new Date(p.createdAt).toLocaleString()}
                    </span>
                    <span className="proof-item-claim">
                      Claims: Age {s.minAge}+{s.requireVaccinated ? " & Vaccinated" : ""}
                    </span>
                  </div>
                  <div className="proof-inbox-actions">
                    <Button variant="primary" icon="🔬" onClick={() => load(p)}>
                      Inspect & Verify
                    </Button>
                    <button
                      className="btn-danger-sm"
                      disabled={dismissing}
                      onClick={() => dismiss(p)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Manual Paste Section */}
      <Panel
        title="Direct Proof Verification"
        subtitle="Or paste a proof JSON file directly to verify off-chain or on-chain"
        icon="📋"
      >
        <Field label="Proof JSON Payload">
          <textarea
            className="input-textarea"
            rows={3}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder='{"proof": { ... }, "publicSignals": [ ... ]}'
          />
        </Field>
        <Button
          variant="outline"
          onClick={usePasted}
          disabled={!pasted.trim()}
          icon="📥"
        >
          Load Pasted Proof
        </Button>
      </Panel>

      {!current && result && !result.ok ? (
        <div className="verdict-banner verdict-bad">
          <strong>❌ Proof Rejected:</strong> {result.reason}
        </div>
      ) : null}

      {/* Proof Evaluation Window */}
      {current ? (
        <Panel
          title={`Evaluating Claim: ${current.label || "Proof"}`}
          subtitle="Dual-check: Groth16 mathematical verification + Smart Contract issuer trust check"
          icon="🔬"
        >
          <ClaimSummary signals={current.publicSignals} who={who} />

          <div className="proof-eval-actions">
            <Button busy={checking} onClick={check} variant="primary" icon="✓">
              {checking ? "Checking Groth16 & Contracts..." : "Run Cryptographic Verification"}
            </Button>

            {result?.ok && !result.recorded ? (
              <Button
                variant="secondary"
                busy={recording}
                onClick={record}
                icon="⛓️"
              >
                Record Verification on Ethereum
              </Button>
            ) : null}
          </div>

          {result ? (
            result.ok ? (
              <div className="verdict-banner verdict-good">
                <span className="verdict-icon">🛡️</span>
                <div className="verdict-body">
                  <h4 className="verdict-heading">Cryptographically Verified Valid</h4>
                  <p>
                    The mathematical zk-SNARK constraints are satisfied, and the underlying
                    credential is authenticated by trusted issuer{" "}
                    <strong>{who(result.issuer)?.name || short(result.issuer)}</strong>. The patient's
                    exact birth year and medical records remain completely zero-knowledge and
                    hidden.
                  </p>
                  {result.recorded ? (
                    <div className="verdict-tx-stamp">
                      <span>✓ Recorded on-chain (ClaimVerified event emitted)</span>
                      {result.txHash ? (
                        <code>Tx: {short(result.txHash)}</code>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="verdict-banner verdict-bad">
                <span className="verdict-icon">❌</span>
                <div>
                  <h4>Proof Rejected</h4>
                  <p>{result.reason}</p>
                </div>
              </div>
            )
          ) : null}
        </Panel>
      ) : null}

      <VerificationHistory who={who} refreshKey={result?.recorded ? 1 : 0} />
    </div>
  );
}

function VerificationHistory({ who, refreshKey }) {
  const { claim, address, provider } = useSession();
  const [rows] = useLoad(async () => {
    const evs = await events(claim, "ClaimVerified", null, null, address);
    const blocks = new Map();
    await Promise.all(
      [...new Set(evs.map((e) => e.blockNumber))].map(async (n) =>
        blocks.set(n, (await provider.getBlock(n)).timestamp)
      )
    );
    return evs.map((e) => ({ ...e.args, ts: blocks.get(e.blockNumber) })).reverse();
  }, [address, refreshKey]);

  if (!rows || rows.length === 0) return null;

  return (
    <Panel
      title="Verifications You Recorded On-Chain"
      subtitle="Publicly verified claims stamped by your practitioner key"
      icon="⛓️"
    >
      <div className="history-table">
        {rows.map((r, i) => (
          <div key={i} className="history-row">
            <div className="history-main">
              <strong>
                Age {Number(r.minAge)}+{r.requireVaccinated ? " and vaccinated" : ""}
              </strong>
              <span className="history-sub">
                Patient: <Address value={r.patient} name={who(r.patient)?.name} /> • Verified {when(r.ts)}
              </span>
            </div>
            <Pill tone="ok" icon="✓">On-Chain</Pill>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function ClaimSummary({ signals, who }) {
  const s = describeSignals(signals);
  const p = who ? who(s.subject) : null;
  return (
    <div className="claim-summary-card">
      <div className="summary-field">
        <span className="summary-label">Subject Patient:</span>
        <Address value={s.subject} name={p?.name} />
      </div>
      <div className="summary-field">
        <span className="summary-label">Mathematical Claim:</span>
        <span className="summary-value">
          At least {s.minAge} years old in {s.currentYear}
          {s.requireVaccinated ? " & Vaccinated" : ""}
        </span>
      </div>
      <div className="summary-field">
        <span className="summary-label">Zero-Knowledge Disclosure:</span>
        <span className="summary-value text-teal">
          Only the binary truth value is revealed; birth year and health records remain hidden
        </span>
      </div>
    </div>
  );
}

/** Modern timeline audit ledger */
export function Ledger({ entries }) {
  if (!entries) return <div className="loading-state">Loading ledger...</div>;
  if (!entries.length)
    return (
      <Empty icon="📜" title="No ledger records yet">
        Transactions and access events will be logged here in chronological sequence.
      </Empty>
    );

  const getToneIcon = (tone) => {
    switch (tone) {
      case "ok":
        return "✓";
      case "danger":
        return "🚨";
      case "zk":
        return "🛡️";
      case "access":
        return "👁️";
      case "pending":
        return "⏳";
      default:
        return "📌";
    }
  };

  return (
    <div className="timeline-ledger">
      {entries.map((e, i) => (
        <div key={i} className={`timeline-entry timeline-${e.tone || "neutral"}`}>
          <div className="timeline-marker">
            <span className="timeline-icon">{getToneIcon(e.tone)}</span>
          </div>
          <div className="timeline-content">
            <div className="timeline-header">
              <strong className="timeline-title">{e.title}</strong>
              <span className="timeline-time">{when(e.ts)}</span>
            </div>
            {e.detail ? <p className="timeline-detail">{e.detail}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
