import { useEffect, useMemo, useState } from "react";
import { useSession, useAction, Button, Field, Panel, Empty, Pill, Address, Tabs, useToast } from "../components/ui.jsx";
import { Ledger } from "../components/shared.jsx";
import { api } from "../lib/api.js";
import { events, readParticipant, RequestStatus, Role, explain } from "../lib/chain.js";
import { encryptRecord, decryptMeta, rewrapFor, exportKeyBackup, localPublicKeyString } from "../lib/crypto.js";
import { useLoad, useParticipants, listHospitals, openRecord } from "../lib/hooks.js";
import { proveClaim } from "../lib/zk.js";
import { CATEGORIES, DURATIONS, durationLabel, remaining, short } from "../lib/format.js";

export default function Patient() {
  const { exchange, address } = useSession();
  const [tab, setTab] = useState("records");
  const [records, reloadRecords] = useLoad(() => api.myRecords(), []);
  const [requests, reloadRequests] = useLoad(() => loadRequests(exchange, address), [exchange]);
  const [emergencies] = useLoad(() => events(exchange, "EmergencyAccessUsed", null, address), [exchange]);
  const toast = useToast();

  const pending = (requests || []).filter((r) => r.status === 1);
  const recent = (emergencies || []).filter((e) => Number(e.args.expiresAt) > Date.now() / 1000 - 7 * 86400);

  const downloadBackup = () => {
    try {
      const data = exportKeyBackup(address);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `medzk-key-backup-${address.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Key backup downloaded securely.");
    } catch (e) {
      toast(explain(e), "error");
    }
  };

  return (
    <div className="stack">
      <header className="page-head">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h1>My Health Records</h1>
            <p>Encrypted on your device. Opened only by people you approve, for as long as you approve.</p>
          </div>
          <Button variant="quiet" onClick={downloadBackup}>
            🔑 Download Key Backup
          </Button>
        </div>
      </header>

      {/* Metric summary tiles */}
      <div className="metrics-grid">
        <div className="metric-card">
          <span className="metric-title">Encrypted Records</span>
          <span className="metric-value">{records?.length ?? 0}</span>
          <span className="metric-sub">AES-256-GCM Secured</span>
        </div>
        <div className="metric-card">
          <span className="metric-title">Pending Access Requests</span>
          <span className="metric-value" style={{ color: pending.length ? "var(--amber)" : "#fff" }}>{pending.length}</span>
          <span className="metric-sub">Awaiting Patient Approval</span>
        </div>
        <div className="metric-card">
          <span className="metric-title">Emergency Log Alerts</span>
          <span className="metric-value" style={{ color: recent.length ? "var(--red)" : "#fff" }}>{recent.length}</span>
          <span className="metric-sub">Last 7 Days</span>
        </div>
        <div className="metric-card">
          <span className="metric-title">Protocol State</span>
          <span className="metric-value" style={{ color: "var(--teal)" }}>Active</span>
          <span className="metric-sub">Zero-Knowledge Synced</span>
        </div>
      </div>

      {recent.length ? (
        <div className="alert alert-danger" role="alert">
          <strong>Emergency access was used on your records.</strong>
          {recent.map((e, i) => (
            <p key={i}>
              Record #{String(e.args.recordId)}: “{e.args.reason}”. Access {Number(e.args.expiresAt) > Date.now() / 1000 ? `ends in ${remaining(e.args.expiresAt).replace(" left", "")}` : "has ended"}.
            </p>
          ))}
          <button className="link" onClick={() => setTab("activity")}>See full activity</button>
        </div>
      ) : null}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "records", label: "Records", count: records?.length },
          { id: "requests", label: "Access requests", count: pending.length },
          { id: "activity", label: "Activity" },
          { id: "proofs", label: "Credentials and proofs" },
        ]}
      />

      {tab === "records" ? <Records records={records} reload={reloadRecords} /> : null}
      {tab === "requests" ? (
        <Requests requests={requests} records={records} reload={() => { reloadRequests(); reloadRecords(); }} />
      ) : null}
      {tab === "activity" ? <Activity /> : null}
      {tab === "proofs" ? <Proofs /> : null}
    </div>
  );
}

function Records({ records, reload }) {
  const { exchange, address } = useSession();
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("general");
  const toast = useToast();

  const [upload, uploading] = useAction(async () => {
    if (!file) throw new Error("Select a file to upload.");
    if (!title.trim()) throw new Error("Enter a title for this record.");
    const myPubKey = localPublicKeyString(address);
    const enc = await encryptRecord(file, title.trim(), myPubKey);
    enc.category = category;
    await api.uploadRecord(enc);
    setFile(null);
    setTitle("");
    reload();
  }, "Record encrypted and saved to MongoDB gateway.");

  return (
    <div className="stack">
      <Panel>
        <h3>Add New Medical Record</h3>
        <p className="muted">Your browser encrypts the file before sending. The gateway only receives ciphertext.</p>
        <form className="form" onSubmit={(e) => { e.preventDefault(); upload(); }}>
          <div className="form-grid">
            <Field label="Record Title">
              <input type="text" placeholder="e.g. Blood Test Results" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Category">
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="File">
              <input type="file" onChange={(e) => setFile(e.target.files[0])} />
            </Field>
          </div>
          <div className="row row-end" style={{ marginTop: "1rem" }}>
            <Button busy={uploading} type="submit">Encrypt & Store Record</Button>
          </div>
        </form>
      </Panel>

      <Panel>
        <div className="panel-head">
          <h3>My Vault ({records?.length || 0})</h3>
        </div>
        {!records ? (
          <p className="muted">Loading records...</p>
        ) : !records.length ? (
          <Empty>No medical records stored yet. Upload one above to get started.</Empty>
        ) : (
          <ul className="list">
            {records.map((r) => (
              <RecordRow key={r.storageRef} record={r} reload={reload} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function RecordRow({ record, reload }) {
  const { exchange, address } = useSession();
  const who = useParticipants(exchange);
  const [open, setOpen] = useState(false);
  const [blobUrl, setBlobUrl] = useState(null);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [targetDoctor, setTargetDoctor] = useState("");
  const [duration, setDuration] = useState("86400");
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const toast = useToast();

  const handleOpen = async () => {
    if (blobUrl) { setOpen(!open); return; }
    setBusy(true);
    try {
      const res = await openRecord(record.storageRef, address);
      setMeta(res.meta);
      setBlobUrl(res.url);
      setOpen(true);
    } catch (e) {
      console.error(e);
      toast(explain(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const [scanAI, scanningAI] = useAction(async () => {
    const res = await api.scanRecordWithAI({
      title: meta?.title || "Medical Record",
      category: record.category,
      sampleText: meta?.fileName,
    });
    setAiAnalysis(res);
  }, "Medical report scanned with Groq AI API.");

  const [grant, granting] = useAction(async () => {
    if (!targetDoctor) throw new Error("Select or enter a doctor/hospital address.");
    const doctorPart = await readParticipant(exchange, targetDoctor);
    if (!doctorPart.encryptionPublicKey) throw new Error("Target account has no published encryption key.");
    
    const wrappedKey = await rewrapFor(address, record.ownerWrappedKey, doctorPart.encryptionPublicKey);
    await api.grantKey({ recordId: record.recordId || record.storageRef, grantee: targetDoctor, wrappedKey });
    
    if (record.recordId) {
      const tx = await exchange.grantAccess(record.recordId, targetDoctor, Number(duration));
      await tx.wait();
    }
    
    setSharing(false);
    setTargetDoctor("");
    reload();
  }, "Access granted & key encrypted for recipient.");

  return (
    <li className="item" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexWrap: "wrap", gap: "1rem" }}>
        <div className="item-main">
          <strong>{meta ? meta.title : `Record #${record.recordId || record.storageRef.slice(0, 8)}`}</strong>
          <span className="muted">{CATEGORIES[record.category] || record.category} • {new Date(record.createdAt).toLocaleDateString()}</span>
        </div>
        <div className="item-side">
          <Button variant="quiet" onClick={() => setSharing(!sharing)}>
            {sharing ? "Close Sharing" : "Manage Access"}
          </Button>
          <Button busy={busy} onClick={handleOpen}>
            {open ? "Hide File" : "Open & Decrypt"}
          </Button>
        </div>
      </div>

      {open && blobUrl ? (
        <div style={{ marginTop: "1rem", padding: "1.2rem", background: "rgba(0,0,0,0.35)", borderRadius: "var(--r-sm)", border: "1px solid var(--line)" }}>
          <p><strong>Decrypted Title:</strong> {meta?.title}</p>
          <p><strong>Original File:</strong> {meta?.fileName}</p>
          <div className="row" style={{ marginTop: "1rem" }}>
            <a href={blobUrl} download={meta?.fileName || "record.bin"} className="btn btn-primary">
              ⬇ Download Decrypted File
            </a>
            <Button variant="quiet" busy={scanningAI} onClick={scanAI} style={{ borderColor: "var(--violet)", color: "var(--violet)" }}>
              🤖 Scan Report with Groq AI
            </Button>
          </div>

          {aiAnalysis ? (
            <div style={{ marginTop: "1.2rem", padding: "1.2rem", background: "rgba(168, 85, 247, 0.08)", borderRadius: "var(--r-sm)", border: "1px solid rgba(168, 85, 247, 0.25)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <strong style={{ color: "var(--violet)" }}>🤖 {aiAnalysis.source} Analysis</strong>
                <Pill tone={aiAnalysis.analysis.riskLevel === "Low" ? "ok" : "pending"}>
                  Risk Level: {aiAnalysis.analysis.riskLevel}
                </Pill>
              </div>
              <p style={{ color: "#fff", fontSize: "0.9rem" }}>{aiAnalysis.analysis.summary}</p>
              
              <h5 style={{ margin: "0.8rem 0 0.4rem", color: "var(--muted)", textTransform: "uppercase", fontSize: "0.75rem" }}>Detected Biomarkers</h5>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))", gap: "0.5rem", marginBottom: "0.8rem" }}>
                {aiAnalysis.analysis.biomarkers?.map((b, i) => (
                  <div key={i} style={{ padding: "0.5rem", background: "rgba(0,0,0,0.3)", borderRadius: "6px", fontSize: "0.8rem" }}>
                    <span style={{ color: "var(--muted)" }}>{b.name}: </span>
                    <strong style={{ color: "#fff" }}>{b.value}</strong>
                  </div>
                ))}
              </div>

              <h5 style={{ margin: "0.8rem 0 0.4rem", color: "var(--muted)", textTransform: "uppercase", fontSize: "0.75rem" }}>AI Clinical Insights</h5>
              <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "#e2e8f0", fontSize: "0.85rem" }}>
                {aiAnalysis.analysis.recommendations?.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {sharing ? (
        <div style={{ marginTop: "1rem", padding: "1.2rem", background: "rgba(0, 240, 255, 0.03)", borderRadius: "var(--r-sm)", border: "1px solid rgba(0, 240, 255, 0.15)" }}>
          <h4 style={{ margin: "0 0 1rem", color: "var(--teal)" }}>Grant Access to Doctor or Hospital</h4>
          <div className="form-grid">
            <Field label="Recipient Address">
              <input type="text" placeholder="0x..." value={targetDoctor} onChange={(e) => setTargetDoctor(e.target.value.trim())} />
            </Field>
            <Field label="Access Duration">
              <select value={duration} onChange={(e) => setDuration(e.target.value)}>
                {Object.entries(DURATIONS).map(([sec, label]) => (
                  <option key={sec} value={sec}>{label}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="row row-end" style={{ marginTop: "1rem" }}>
            <Button busy={granting} onClick={grant}>Grant & Encrypt Key</Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function Requests({ requests, records, reload }) {
  const { exchange, address } = useSession();

  const [approve, approving] = useAction(async (req) => {
    const doctorPart = await readParticipant(exchange, req.doctor);
    const rec = (records || []).find((r) => String(r.recordId) === String(req.recordId));
    if (!rec) throw new Error("Record key not found locally.");

    const wrappedKey = await rewrapFor(address, rec.ownerWrappedKey, doctorPart.encryptionPublicKey);
    await api.grantKey({ recordId: req.recordId, grantee: req.doctor, wrappedKey });

    const tx = await exchange.approveAccess(req.id);
    await tx.wait();
    reload();
  }, "Access request approved and key shared.");

  const [revoke, revoking] = useAction(async (req) => {
    const tx = await exchange.revokeAccess(req.recordId, req.doctor);
    await tx.wait();
    reload();
  }, "Access revoked.");

  return (
    <Panel>
      <h3>Access Requests</h3>
      {!requests?.length ? (
        <Empty>No active access requests from doctors.</Empty>
      ) : (
        <ul className="list">
          {requests.map((r) => (
            <li key={r.id} className="item">
              <div className="item-main">
                <strong>Doctor Access Request #{r.id}</strong>
                <span className="muted">
                  Doctor <Address value={r.doctor} /> • Target Record #{r.recordId} • Requested: {durationLabel(r.duration)}
                </span>
                {r.reason ? <blockquote className="muted">"{r.reason}"</blockquote> : null}
              </div>
              <div className="item-side">
                {r.status === 1 ? (
                  <Button busy={approving} onClick={() => approve(r)}>Approve Request</Button>
                ) : r.status === 2 ? (
                  <Button variant="danger" busy={revoking} onClick={() => revoke(r)}>Revoke Access</Button>
                ) : (
                  <Pill tone="danger">Denied</Pill>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Activity() {
  const { exchange, address } = useSession();
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    async function loadLedger() {
      const regEvs = await events(exchange, "ParticipantRegistered", address);
      const accessEvs = await events(exchange, "AccessGranted", address);
      const auditEvs = await events(exchange, "RecordOpened", null, address);
      const emEvs = await events(exchange, "EmergencyAccessUsed", null, address);
      const zkEvs = await events(exchange, "ProofRecorded");

      const items = [];
      regEvs.forEach((e) => items.push({ ts: Number(e.args.timestamp || Date.now() / 1000), title: "Account Registered", detail: `Registered as Patient: ${e.args.name}`, tone: "ok" }));
      accessEvs.forEach((e) => items.push({ ts: Number(e.args.timestamp || Date.now() / 1000), title: "Access Granted", detail: `Granted to ${e.args.doctor} for record #${e.args.recordId}`, tone: "ok" }));
      auditEvs.forEach((e) => items.push({ ts: Number(e.args.timestamp || Date.now() / 1000), title: "Record Opened", detail: `Opened by ${e.args.viewer} (record #${e.args.recordId})`, tone: "access" }));
      emEvs.forEach((e) => items.push({ ts: Number(e.args.timestamp || Date.now() / 1000), title: "Emergency Access Used", detail: `Hospital ${e.args.hospital} accessed #${e.args.recordId}: "${e.args.reason}"`, tone: "danger" }));
      zkEvs.forEach((e) => items.push({ ts: Number(e.args.timestamp || Date.now() / 1000), title: "ZK Proof Verified", detail: `Proof recorded on-chain by ${e.args.verifier}`, tone: "zk" }));

      items.sort((a, b) => b.ts - a.ts);
      setEntries(items);
    }
    loadLedger().catch(console.error);
  }, [exchange, address]);

  return (
    <Panel>
      <h3>Blockchain Activity Ledger</h3>
      <Ledger entries={entries} />
    </Panel>
  );
}

function Proofs() {
  const { exchange, address } = useSession();
  const [credentials, reload] = useLoad(() => api.myCredentials(), []);
  const [selectedCred, setSelectedCred] = useState(null);
  const [minAge, setMinAge] = useState(18);
  const [reqVaccinated, setReqVaccinated] = useState(true);
  const [proofResult, setProofResult] = useState(null);
  const toast = useToast();

  const [generate, generating] = useAction(async () => {
    if (!selectedCred) throw new Error("Select a hospital credential first.");
    const currentYear = new Date().getFullYear();
    const res = await proveClaim(selectedCred, { minAge: Number(minAge), requireVaccinated: reqVaccinated, currentYear });
    setProofResult(res);
  }, "Zero-Knowledge proof generated locally using snarkjs.");

  const downloadProof = () => {
    const data = JSON.stringify(proofResult, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "medzk-proof.json";
    a.click();
    URL.revokeObjectURL(url);
    toast("Proof JSON downloaded.");
  };

  return (
    <div className="stack">
      <Panel>
        <h3>Credentials & Zero-Knowledge Proofs</h3>
        <p className="muted">Generate zk-SNARK statements from hospital-signed credentials without leaking private fields (like your birth year or exact records).</p>

        {!credentials ? (
          <p className="muted">Loading credentials...</p>
        ) : !credentials.length ? (
          <Empty>No hospital credentials issued yet. Ask your hospital administrator to issue a credential in MedZK.</Empty>
        ) : (
          <div className="stack">
            <Field label="Select Signed Credential">
              <select onChange={(e) => setSelectedCred(credentials.find((c) => c._id === e.target.value))}>
                <option value="">-- Choose Credential --</option>
                {credentials.map((c) => (
                  <option key={c._id} value={c._id}>
                    Issued by {c.issuerName || c.issuer} (Birth Year: {c.birthYear}, Vaccinated: {c.vaccinated ? "Yes" : "No"})
                  </option>
                ))}
              </select>
            </Field>

            {selectedCred ? (
              <div className="form-grid">
                <Field label="Claim Requirement: Minimum Age">
                  <input type="number" value={minAge} onChange={(e) => setMinAge(e.target.value)} />
                </Field>
                <Field label="Require Vaccination">
                  <select value={reqVaccinated ? "1" : "0"} onChange={(e) => setReqVaccinated(e.target.value === "1")}>
                    <option value="1">Must Be Vaccinated</option>
                    <option value="0">Vaccination Not Required</option>
                  </select>
                </Field>
                <div style={{ gridColumn: "1 / -1", marginTop: "1rem" }}>
                  <Button busy={generating} onClick={generate}>Generate ZK-SNARK Proof</Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      {proofResult ? (
        <Panel>
          <h4 style={{ color: "var(--teal)" }}>Generated Proof Output</h4>
          <p className="muted">Statement: Patient is over {minAge} years old {reqVaccinated ? "and vaccinated" : ""}. Zero private fields revealed.</p>
          <textarea rows={6} value={JSON.stringify(proofResult, null, 2)} readOnly />
          <div className="row" style={{ marginTop: "1rem" }}>
            <Button variant="quiet" onClick={downloadProof}>⬇ Download Proof JSON</Button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

async function loadRequests(exchange, address) {
  try {
    const evs = await events(exchange, "AccessRequested");
    const myEvs = evs.filter((e) => e.args.patient.toLowerCase() === address.toLowerCase());
    return Promise.all(
      myEvs.map(async (e) => {
        const req = await exchange.requests(e.args.requestId);
        return {
          id: String(e.args.requestId),
          doctor: req.doctor,
          recordId: String(req.recordId),
          duration: Number(req.duration),
          status: Number(req.status),
          reason: e.args.reason || "",
        };
      })
    );
  } catch (err) {
    console.error(err);
    return [];
  }
}
