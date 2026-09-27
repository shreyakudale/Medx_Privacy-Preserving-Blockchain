import { useState } from "react";
import { useSession, useAction, Button, Field, Panel, Empty, Pill, Address, useToast } from "./ui.jsx";
import { api } from "../lib/api.js";
import { useLoad, useParticipants, openRecord } from "../lib/hooks.js";
import { toCalldata, describeSignals } from "../lib/zk.js";
import { explain } from "../lib/chain.js";
import { when, remaining } from "../lib/format.js";

export function SharedRecords({ reloadKey }) {
  const { address, exchange } = useSession();
  const who = useParticipants(exchange);
  const toast = useToast();
  const [list, reload, error] = useLoad(() => api.sharedWithMe(), [reloadKey]);
  const [openingId, setOpeningId] = useState(null);
  const [verifications, setVerifications] = useState({});

  const open = async (recordId) => {
    setOpeningId(recordId);
    try {
      const { meta, auditTx, contentHash, computedHash } = await openRecord(address, recordId);
      toast(`Opened "${meta.title}". Access recorded on-chain${auditTx ? ` (tx ${auditTx.slice(0, 10)}…)` : ""}.`);
      setVerifications((v) => ({ ...v, [recordId]: { ok: true, hash: computedHash } }));
    } catch (e) {
      if (e.computedHash) {
        setVerifications((v) => ({ ...v, [recordId]: { ok: false, error: e.message } }));
      } else {
        toast(explain(e), "error");
      }
    } finally {
      setOpeningId(null);
      reload();
    }
  };

  return (
    <Panel title="Records shared with you" aside={<button className="link" onClick={reload}>Refresh</button>}>
      {error ? <p className="error">{error}</p> : null}
      {!list ? <p className="muted">Loading…</p> : list.length === 0 ? (
        <Empty>No records are shared with you right now. Access appears here once a patient approves it and shares the key.</Empty>
      ) : (
        <ul className="list">
          {list.map((r) => {
            const owner = who(r.owner);
            const v = verifications[r.recordId];
            return (
              <li key={r.recordId} className={v ? "item item-open" : "item"}>
                <div className={v ? "item-head" : ""}>
                  <div className="item-main">
                    <strong>Record #{r.recordId}: {r.category}</strong>
                    <span className="muted">
                      Patient <Address value={r.owner} name={owner?.name} /> added {new Date(r.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="item-side">
                    {r.emergency ? <Pill tone="danger">Emergency</Pill> : null}
                    <Pill tone="ok">{remaining(r.expiresAt)}</Pill>
                    <Button busy={openingId === r.recordId} onClick={() => open(r.recordId)}>Open record</Button>
                  </div>
                </div>
                {v ? (
                  <div className={`verdict ${v.ok ? "verdict-ok" : "verdict-bad"}`} style={{ marginTop: "1rem" }}>
                    {v.ok ? (
                      <><strong>🟢 Integrity Verified.</strong> The downloaded file exactly matches the blockchain hash.</>
                    ) : (
                      <><strong>🔴 Tamper Detected.</strong> {v.error}</>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="fine">Each time you open a record, the gateway writes an access entry to the blockchain that the patient can see.</p>
    </Panel>
  );
}

/** Verify a zero-knowledge claim, read-only first, then optionally record it on-chain. */
export function VerifyProofs() {
  const { claim, exchange } = useSession();
  const who = useParticipants(exchange);
  const [inbox, reloadInbox] = useLoad(() => api.proofInbox(), []);
  const [pasted, setPasted] = useState("");
  const [current, setCurrent] = useState(null); // {proof, publicSignals, label}
  const [result, setResult] = useState(null);

  const load = (p) => { setCurrent(p); setResult(null); };

  const [check, checking] = useAction(async () => {
    const [a, b, c, pub] = await toCalldata(current.proof, current.publicSignals);
    try {
      const [issuer, patient] = await claim.check(a, b, c, pub);
      setResult({ ok: true, issuer, patient, ...describeSignals(current.publicSignals) });
    } catch (e) {
      setResult({ ok: false, reason: explain(e) });
    }
  });

  const [record, recording] = useAction(async () => {
    const [a, b, c, pub] = await toCalldata(current.proof, current.publicSignals);
    await (await claim.verifyAndRecord(a, b, c, pub)).wait();
    setResult((r) => ({ ...r, recorded: true }));
  }, "Verification recorded on-chain. The patient can see it in their activity.");

  const usePasted = () => {
    try {
      const parsed = JSON.parse(pasted);
      if (!parsed.proof || !parsed.publicSignals) throw new Error();
      load({ ...parsed, label: parsed.label || "Pasted proof" });
    } catch {
      setResult({ ok: false, reason: "That text isn't a MedZK proof file." });
    }
  };

  return (
    <div className="stack">
      <Panel title="Proofs sent to you" aside={<button className="link" onClick={reloadInbox}>Refresh</button>}>
        {!inbox ? <p className="muted">Loading…</p> : inbox.length === 0 ? (
          <Empty>No proofs yet. Patients can send you one from their Credentials tab, or you can paste one below.</Empty>
        ) : (
          <ul className="list">
            {inbox.map((p) => {
              const s = describeSignals(p.publicSignals);
              return (
                <li key={p._id} className="item">
                  <div className="item-main">
                    <strong>{p.label || "Health claim"}</strong>
                    <span className="muted">
                      From <Address value={p.from} name={who(p.from)?.name} /> on {new Date(p.createdAt).toLocaleString()}.
                      Claims age {s.minAge}+{s.requireVaccinated ? " and vaccinated" : ""}.
                    </span>
                  </div>
                  <Button variant="quiet" onClick={() => load(p)}>Check this proof</Button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Paste a proof file">
        <Field label="Proof JSON">
          <textarea rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='{"proof": …, "publicSignals": […]}' />
        </Field>
        <Button variant="quiet" onClick={usePasted} disabled={!pasted.trim()}>Load proof</Button>
      </Panel>

      {current ? (
        <Panel title={`Checking: ${current.label || "proof"}`}>
          <ClaimSummary signals={current.publicSignals} who={who} />
          <div className="row">
            <Button busy={checking} onClick={check}>Verify proof</Button>
            {result?.ok && !result.recorded ? (
              <Button variant="quiet" busy={recording} onClick={record}>Record verification on-chain</Button>
            ) : null}
          </div>
          {result ? (
            result.ok ? (
              <div className="verdict verdict-ok">
                <strong>Proof is valid.</strong> Credential signed by {who(result.issuer)?.name || result.issuer}, a trusted hospital.
                The patient's birth year and vaccination record were not revealed.
                {result.recorded ? " This verification is now on-chain." : ""}
              </div>
            ) : (
              <div className="verdict verdict-bad"><strong>Proof rejected.</strong> {result.reason}</div>
            )
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}

export function ClaimSummary({ signals, who }) {
  const s = describeSignals(signals);
  const p = who ? who(s.subject) : null;
  return (
    <dl className="kv">
      <dt>Patient</dt><dd><Address value={s.subject} name={p?.name} /></dd>
      <dt>Claim</dt><dd>At least {s.minAge} years old in {s.currentYear}{s.requireVaccinated ? ", and vaccinated" : ""}</dd>
      <dt>Revealed</dt><dd>Only whether the claim is true</dd>
    </dl>
  );
}

/** Chart-style audit ledger. `entries` = [{ts, kind, title, detail, tone}] newest first. */
export function Ledger({ entries }) {
  if (!entries) return <p className="muted">Loading…</p>;
  if (!entries.length) return <Empty>Nothing has happened yet. Upload a record to get started.</Empty>;
  return (
    <ol className="ledger">
      {entries.map((e, i) => (
        <li key={i} className={`ledger-row ledger-${e.tone || "neutral"}`}>
          <time>{when(e.ts)}</time>
          <div>
            <strong>{e.title}</strong>
            {e.detail ? <p>{e.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
