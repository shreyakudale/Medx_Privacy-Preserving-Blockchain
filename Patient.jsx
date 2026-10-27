import { useEffect, useMemo, useState } from "react";
import {
  useSession,
  useAction,
  useConfirm,
  CANCELLED,
  Button,
  Field,
  Panel,
  Empty,
  Pill,
  Address,
  Tabs,
  useToast,
  StatCard,
  CountdownBadge,
} from "../components/ui.jsx";
import { Ledger } from "../components/shared.jsx";
import { api } from "../lib/api.js";
import { events, readParticipant, RequestStatus, Role, explain } from "../lib/chain.js";
import { encryptRecord, decryptMeta, rewrapFor } from "../lib/crypto.js";
import { useLoad, useParticipants, listHospitals, openRecord } from "../lib/hooks.js";
import { proveClaim, verifyLocal, describeSignals } from "../lib/zk.js";
import { CATEGORIES, DURATIONS, durationLabel, remaining, short, when } from "../lib/format.js";

export default function Patient() {
  const { exchange, address } = useSession();
  const [tab, setTab] = useState("records");
  const [records, reloadRecords] = useLoad(() => api.myRecords(), []);
  const [requests, reloadRequests] = useLoad(() => loadRequests(exchange, address), [exchange]);
  const [emergencies] = useLoad(() => events(exchange, "EmergencyAccessUsed", null, address), [exchange]);

  const pending = (requests || []).filter((r) => r.status === 1);
  const recent = (emergencies || []).filter(
    (e) => Number(e.args.expiresAt) > Date.now() / 1000 - 7 * 86400
  );

  return (
    <div className="view-stack">
      {/* Header and Stats */}
      <div className="dashboard-hero">
        <div className="dashboard-hero-text">
          <span className="hero-eyebrow">PATIENT PORTAL • PRIVATE VAULT</span>
          <h1 className="hero-headline">My Health Records</h1>
          <p className="hero-subtext">
            Client-side encrypted with AES-256-GCM. You hold the keys. Only approved doctors can open
            specific files, and access expires automatically.
          </p>
        </div>

        {/* Real-time stats row */}
        <div className="stats-row">
          <StatCard
            title="Encrypted Records"
            value={records ? records.length : "..."}
            subtitle="Stored off-chain, SHA-256 on-chain"
            icon="📁"
            tone="teal"
          />
          <StatCard
            title="Pending Requests"
            value={pending.length}
            subtitle={pending.length > 0 ? "Awaiting your consent" : "All requests handled"}
            icon="⏳"
            tone={pending.length > 0 ? "amber" : "neutral"}
          />
          <StatCard
            title="Active Requests"
            value={(requests || []).filter((r) => r.status === 2).length}
            subtitle="Approved doctor sessions"
            icon="🩺"
            tone="blue"
          />
          <StatCard
            title="Emergency Shield"
            value={recent.length > 0 ? "Triggered" : "Active"}
            subtitle={recent.length > 0 ? "Emergency access logged" : "Controlled hospital opt-in"}
            icon={recent.length > 0 ? "🚨" : "🛡️"}
            tone={recent.length > 0 ? "danger" : "purple"}
          />
        </div>
      </div>

      {recent.length ? (
        <div className="alert-banner alert-banner-danger" role="alert">
          <div className="alert-icon">🚨</div>
          <div className="alert-content">
            <strong>Emergency access was activated on your records!</strong>
            {recent.map((e, i) => (
              <p key={i}>
                Record #{String(e.args.recordId)}: “{e.args.reason}”. Access{" "}
                {Number(e.args.expiresAt) > Date.now() / 1000
                  ? `ends in ${remaining(e.args.expiresAt).replace(" left", "")}`
                  : "has ended"}
                .
              </p>
            ))}
          </div>
          <button className="btn-sm btn-outline-danger" onClick={() => setTab("activity")}>
            Review Activity Log
          </button>
        </div>
      ) : null}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "records", label: "My Records", icon: "📁", count: records?.length },
          { id: "requests", label: "Access Requests", icon: "📬", count: pending.length },
          { id: "activity", label: "Audit Ledger", icon: "⚡" },
          { id: "proofs", label: "ZK Proofs & Claims", icon: "🛡️" },
        ]}
      />

      {tab === "records" ? <Records records={records} reload={reloadRecords} /> : null}
      {tab === "requests" ? (
        <Requests
          requests={requests}
          records={records}
          reload={() => {
            reloadRequests();
            reloadRecords();
          }}
        />
      ) : null}
      {tab === "activity" ? <Activity /> : null}
      {tab === "proofs" ? <Proofs /> : null}
    </div>
  );
}

async function loadRequests(exchange, owner) {
  const evs = await events(exchange, "AccessRequested", null, null, owner);
  const out = await Promise.all(
    evs.map(async (e) => {
      const q = await exchange.getRequest(e.args.requestId);
      return {
        requestId: Number(e.args.requestId),
        recordId: Number(q.recordId),
        requester: q.requester,
        durationSeconds: Number(q.durationSeconds),
        createdAt: Number(q.createdAt),
        status: Number(q.status),
        purpose: q.purpose,
      };
    })
  );
  return out.sort((a, b) => b.requestId - a.requestId);
}

async function shareKey(address, exchange, record, grantee) {
  const p = await readParticipant(exchange, grantee);
  if (!p.encryptionPublicKey)
    throw new Error("That account hasn't published an encryption key yet.");
  const wrapped = await rewrapFor(address, record.wrappedKey, p.encryptionPublicKey);
  await api.shareKey(record.recordId, grantee, wrapped);
}

// ------------------------------------------------------------------ records
function Records({ records, reload }) {
  return (
    <div className="view-section">
      <Upload onDone={reload} />
      <Panel
        title="Your Health Records"
        subtitle="Stored securely with verifiable on-chain hashes"
        icon="🗄️"
        aside={<button className="btn-link" onClick={reload}>🔄 Refresh</button>}
      >
        {!records ? (
          <div className="loading-state">
            <span className="spinner-dot" />
            <span>Loading encrypted records...</span>
          </div>
        ) : records.length === 0 ? (
          <Empty icon="📄" title="No medical records uploaded yet">
            Upload your lab tests, prescriptions, imaging scans, or doctor reports above.
          </Empty>
        ) : (
          <div className="record-cards-grid">
            {records.map((r) => (
              <RecordItem key={r.recordId} record={r} onChanged={reload} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Upload({ onDone }) {
  const { exchange, address, participant } = useSession();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [file, setFile] = useState(null);
  const [step, setStep] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const toast = useToast();

  const [upload, busy] = useAction(async () => {
    if (!file) throw new Error("Choose a file to upload.");
    if (file.size === 0) throw new Error("That file is empty.");
    if (file.size > 20 * 1024 * 1024)
      throw new Error("That file is larger than 20 MB. Choose a smaller one.");
    if (!title.trim()) throw new Error("Give the record a title so you can find it later.");

    setStep("1/3 Encrypting in browser (AES-256-GCM)...");
    const enc = await encryptRecord(file, title.trim(), participant.encryptionPublicKey);

    setStep("2/3 Uploading encrypted ciphertext...");
    const form = new FormData();
    form.append("file", new Blob([enc.ciphertext]), "record.bin");
    form.append("iv", enc.iv);
    form.append("encMeta", enc.encMeta);
    form.append("metaIv", enc.metaIv);
    form.append("category", category);
    form.append("ownerWrappedKey", enc.ownerWrappedKey);
    const { storageRef, contentHash } = await api.uploadRecord(form);
    if (contentHash.toLowerCase() !== enc.contentHash.toLowerCase())
      throw new Error("The server stored a different file than was sent.");

    setStep("3/3 Sign MetaMask transaction to anchor hash...");
    const receipt = await (await exchange.addRecord(contentHash, storageRef, category)).wait();
    const ev = receipt.logs
      .map((l) => {
        try {
          return exchange.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((l) => l?.name === "RecordAdded");
    try {
      await api.confirmRecord(storageRef, Number(ev.args.recordId));
    } catch {
      toast(
        "The record is on-chain. Finishing server link; refresh in a moment if it isn't listed.",
        "info"
      );
    }

    setTitle("");
    setFile(null);
    setStep("");
    const fileInput = document.getElementById("record-file");
    if (fileInput) fileInput.value = "";
    onDone();
    return address;
  }, "Record encrypted and anchored on Ethereum blockchain.");

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <Panel
      title="Upload & Encrypt Medical Record"
      subtitle="Encrypted locally before network transmission; only ciphertext hash is published"
      icon="🔒"
      className="panel-upload"
    >
      <div className="upload-form-layout">
        <div className="upload-fields">
          <Field
            label="Record Title"
            hint="Encrypted: Only you and authorized doctors can read this"
            required
          >
            <input
              className="input-text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Blood Analysis & Lipid Profile - Oct 2026"
              maxLength={80}
            />
          </Field>

          <Field label="Medical Category" hint="Visible on-chain for record classification">
            <select
              className="input-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>

        {/* Drag and Drop Zone */}
        <div
          className={`dropzone-box ${dragActive ? "dropzone-active" : ""} ${
            file ? "dropzone-has-file" : ""
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            id="record-file"
            type="file"
            className="dropzone-file-input"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <div className="dropzone-inner">
            <span className="dropzone-icon">{file ? "📄" : "📤"}</span>
            {file ? (
              <div className="dropzone-file-info">
                <strong>{file.name}</strong>
                <span>{(file.size / 1024).toFixed(1)} KB • Ready to encrypt</span>
              </div>
            ) : (
              <div className="dropzone-prompt">
                <strong>Drag and drop file here, or click to browse</strong>
                <span>Supports PDF, Images (JPG, PNG), or Text documents up to 20 MB</span>
              </div>
            )}
          </div>
        </div>

        <div className="upload-action-row">
          <Button
            busy={busy}
            icon="🔐"
            onClick={() => upload().finally(() => setStep(""))}
          >
            {busy ? "Encrypting & Storing..." : "Encrypt & Upload Record"}
          </Button>

          {step ? (
            <div className="upload-progress-pill">
              <span className="spinner-dot" />
              <span>{step}</span>
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function RecordItem({ record, onChanged }) {
  const { address } = useSession();
  const toast = useToast();
  const [erase, erasing] = useAction(async () => {
    await api.purgeRecord(record.recordId);
    onChanged();
  }, "Encrypted file and keys erased.");
  const [title, setTitle] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!record.wrappedKey) return;
    decryptMeta(address, record.wrappedKey, record.encMeta, record.metaIv)
      .then((m) => setTitle(m.title))
      .catch(() => setTitle("(can't decrypt on this device)"));
  }, [record, address]);

  const open = async () => {
    setOpening(true);
    try {
      await openRecord(address, record.recordId);
    } catch (e) {
      toast(explain(e), "error");
    }
    setOpening(false);
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

  if (record.active === false) {
    return (
      <div className="record-card record-card-deactivated">
        <div className="record-card-top">
          <span className="record-cat-icon">🚫</span>
          <div className="record-card-info">
            <strong className="record-title">{title || "Record"}</strong>
            <span className="record-meta">
              #{record.recordId} • {record.category} • Deactivated on-chain
            </span>
          </div>
          <Pill tone="danger">Deactivated</Pill>
        </div>
        <div className="record-card-actions">
          <Button variant="quiet" busy={erasing} onClick={erase}>
            Erase Stored Ciphertext
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`record-card ${expanded ? "record-card-expanded" : ""}`}>
      <div className="record-card-top">
        <span className="record-cat-icon">{categoryIcons[record.category] || "📄"}</span>
        <div className="record-card-info">
          <strong className="record-title">{title || "Decrypting title..."}</strong>
          <span className="record-meta">
            Record #{record.recordId} • <Pill tone="neutral">{record.category}</Pill> • Added{" "}
            {new Date(record.createdAt).toLocaleDateString()}
          </span>
        </div>
        <div className="record-card-actions">
          <Button variant="outline" busy={opening} icon="👁️" onClick={open}>
            Open
          </Button>
          <Button
            variant={expanded ? "secondary" : "quiet"}
            icon="🤝"
            onClick={() => setExpanded((x) => !x)}
            aria-expanded={expanded}
          >
            {expanded ? "Close Sharing" : "Manage Sharing"}
          </Button>
        </div>
      </div>

      {expanded ? <Sharing record={record} onChanged={onChanged} /> : null}
    </div>
  );
}

function Sharing({ record, onChanged }) {
  const { exchange, address } = useSession();
  const confirm = useConfirm();
  const who = useParticipants(exchange);
  const [grants, reloadGrants] = useLoad(async () => {
    const evs = await events(exchange, "AccessGranted", record.recordId, address);
    const grantees = [...new Set(evs.map((e) => e.args.grantee))];
    const now = Date.now() / 1000;
    const rows = await Promise.all(
      grantees.map(async (g) => {
        const gr = await exchange.grants(record.recordId, g);
        return { grantee: g, expiresAt: gr.expiresAt, emergency: gr.emergency };
      })
    );
    return rows.filter((r) => Number(r.expiresAt) > now);
  }, [record.recordId]);

  const [hospitals, reloadHospitals] = useLoad(async () => {
    const hs = await listHospitals(exchange);
    return Promise.all(
      hs.map(async (h) => ({
        ...h,
        allowed: await exchange.emergencyAllowed(record.recordId, h.address),
      }))
    );
  }, [record.recordId]);

  const [grantee, setGrantee] = useState("");
  const [duration, setDuration] = useState(DURATIONS[1].seconds);

  const [grant, granting] = useAction(async () => {
    await shareKey(address, exchange, record, grantee);
    await (await exchange.grantAccess(record.recordId, grantee, duration)).wait();
    setGrantee("");
    reloadGrants();
  }, "Access granted on-chain.");

  const [revoke, revoking] = useAction(async (g) => {
    if (
      !(await confirm({
        title: "Revoke Access Immediately?",
        body: `${
          who(g)?.name || short(g)
        } will be permanently blocked from opening this record again.`,
        confirmLabel: "Revoke Access",
        danger: true,
      }))
    )
      return CANCELLED;
    await (await exchange.revokeAccess(record.recordId, g)).wait();
    await api.removeKey(record.recordId, g).catch(() => {});
    reloadGrants();
  }, "Access revoked on-chain.");

  const [toggleEmergency, toggling] = useAction(async (h) => {
    if (!h.allowed) await shareKey(address, exchange, record, h.address);
    await (await exchange.setEmergencyAccess(record.recordId, h.address, !h.allowed)).wait();
    if (h.allowed) await api.removeKey(record.recordId, h.address);
    reloadHospitals();
  }, "Emergency policy updated.");

  const [deactivate, deactivating] = useAction(async () => {
    if (
      !(await confirm({
        title: "Deactivate and Erase Record?",
        body: "This permanently blocks access on the blockchain and purges the file ciphertext. The on-chain SHA-256 hash remains in history.",
        confirmLabel: "Deactivate & Erase",
        danger: true,
      }))
    )
      return CANCELLED;
    await (await exchange.deactivateRecord(record.recordId)).wait();
    await api.purgeRecord(record.recordId).catch(() => {});
    onChanged();
  }, "Record deactivated.");

  return (
    <div className="sharing-accordion">
      <div className="sharing-grid">
        {/* Active Authorized Doctors */}
        <div className="sharing-column">
          <h4 className="sharing-subtitle">Authorized Doctors & Grants</h4>
          {!grants ? (
            <p className="loading-text">Checking grants...</p>
          ) : grants.length === 0 ? (
            <div className="sharing-empty-note">
              <span>🔒 Only you have access to this record.</span>
            </div>
          ) : (
            <div className="grants-list">
              {grants.map((g) => (
                <div key={g.grantee} className="grant-item">
                  <div className="grant-info">
                    <Address value={g.grantee} name={who(g.grantee)?.name} />
                  </div>
                  <div className="grant-status">
                    {g.emergency ? <Pill tone="danger">Emergency</Pill> : null}
                    <CountdownBadge expiresAt={g.expiresAt} />
                    <button
                      className="btn-danger-sm"
                      disabled={revoking}
                      onClick={() => revoke(g.grantee)}
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Direct Grant Form */}
          <div className="grant-input-box">
            <h5 className="subhead-small">Grant Direct Access to Doctor:</h5>
            <div className="grant-form-row">
              <input
                className="input-text-sm"
                value={grantee}
                onChange={(e) => setGrantee(e.target.value.trim())}
                placeholder="Doctor address (0x...)"
              />
              <select
                className="input-select-sm"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              >
                {DURATIONS.map((d) => (
                  <option key={d.seconds} value={d.seconds}>
                    {d.label}
                  </option>
                ))}
              </select>
              <Button
                busy={granting}
                disabled={!/^0x[0-9a-fA-F]{40}$/.test(grantee)}
                onClick={grant}
                variant="primary"
              >
                Grant
              </Button>
            </div>
          </div>
        </div>

        {/* Emergency Access Settings */}
        <div className="sharing-column">
          <h4 className="sharing-subtitle">Emergency Hospital Access</h4>
          <p className="sharing-hint">
            Allows authorized hospitals to break glass in life-or-death emergencies for max 6 hours,
            creating an unerasable blockchain audit entry.
          </p>

          <div className="emergency-hospitals-list">
            {(hospitals || []).map((h) => (
              <div key={h.address} className="emergency-item">
                <div className="emergency-info">
                  <strong>{h.name}</strong>
                  <Address value={h.address} />
                </div>
                <button
                  className={`btn-sm ${h.allowed ? "btn-danger" : "btn-outline"}`}
                  disabled={toggling}
                  onClick={() => toggleEmergency(h)}
                >
                  {h.allowed ? "Disable Emergency" : "Allow Emergency"}
                </button>
              </div>
            ))}
          </div>

          <div className="deactivate-area">
            <button className="btn-deactivate" disabled={deactivating} onClick={deactivate}>
              ⚠️ Deactivate & Erase Record
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ requests
function Requests({ requests, records, reload }) {
  const { exchange, address } = useSession();
  const who = useParticipants(exchange);
  const [durations, setDurations] = useState({});

  const byId = useMemo(() => new Map((records || []).map((r) => [r.recordId, r])), [records]);

  const [approve, approving] = useAction(async (q) => {
    const dur = durations[q.requestId] ?? q.durationSeconds;
    const rec = byId.get(q.recordId);
    if (!rec) throw new Error("Could not find record details to share key.");
    await shareKey(address, exchange, rec, q.requester);
    await (await exchange.approveRequest(q.requestId, dur)).wait();
    reload();
  }, "Request approved! Doctor can now decrypt this record.");

  const [reject, rejecting] = useAction(async (q) => {
    await (await exchange.rejectRequest(q.requestId)).wait();
    reload();
  }, "Request rejected.");

  const pending = (requests || []).filter((r) => r.status === 1);
  const past = (requests || []).filter((r) => r.status !== 1);

  return (
    <div className="view-section">
      <Panel
        title="Pending Access Requests"
        subtitle="Doctors requesting permission to read your encrypted records"
        icon="📬"
        aside={<button className="btn-link" onClick={reload}>🔄 Refresh</button>}
      >
        {!requests ? (
          <div className="loading-state">Loading requests...</div>
        ) : pending.length === 0 ? (
          <Empty icon="✨" title="No pending access requests">
            When a doctor requests permission to view one of your records, it will show up here in
            real time.
          </Empty>
        ) : (
          <div className="requests-cards-list">
            {pending.map((q) => {
              const doc = who(q.requester);
              const hosp = doc ? who(doc.hospital) : null;
              return (
                <div key={q.requestId} className="request-action-card">
                  <div className="request-action-header">
                    <div className="request-doctor-info">
                      <span className="doctor-avatar">🩺</span>
                      <div>
                        <strong className="doctor-name">
                          {doc?.name || short(q.requester)}
                        </strong>
                        <span className="doctor-sub">
                          {hosp ? `${hosp.name} • ` : ""}
                          <Address value={q.requester} />
                        </span>
                      </div>
                    </div>
                    <Pill tone="amber" icon="⏳">Needs Your Consent</Pill>
                  </div>

                  <div className="request-details-box">
                    <div className="request-detail-line">
                      <span className="req-label">Target Record:</span>
                      <strong className="req-val">
                        Record #{q.recordId} ({byId.get(q.recordId)?.category || "Record"})
                      </strong>
                    </div>

                    <div className="request-detail-line">
                      <span className="req-label">Stated Purpose:</span>
                      <blockquote className="req-purpose-quote">
                        {q.purpose ? `"${q.purpose}"` : "General clinical review"}
                      </blockquote>
                    </div>

                    <div className="request-detail-line">
                      <span className="req-label">Adjust Duration:</span>
                      <select
                        className="input-select-sm"
                        value={durations[q.requestId] ?? q.durationSeconds}
                        onChange={(e) =>
                          setDurations((d) => ({
                            ...d,
                            [q.requestId]: Number(e.target.value),
                          }))
                        }
                      >
                        {[
                          ...new Set([
                            q.durationSeconds,
                            ...DURATIONS.map((d) => d.seconds),
                          ]),
                        ]
                          .sort((a, b) => a - b)
                          .map((s) => (
                            <option key={s} value={s}>
                              {durationLabel(s)}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  <div className="request-action-buttons">
                    <Button
                      busy={approving}
                      icon="✓"
                      variant="primary"
                      onClick={() => approve(q)}
                    >
                      Approve & Share Key
                    </Button>
                    <Button
                      variant="quiet"
                      busy={rejecting}
                      onClick={() => reject(q)}
                    >
                      Decline
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {past.length ? (
        <Panel title="Historical Requests" icon="📜">
          <div className="history-table">
            {past.map((q) => (
              <div key={q.requestId} className="history-row">
                <div className="history-main">
                  <strong>
                    {who(q.requester)?.name || short(q.requester)} requested Record #{q.recordId}
                  </strong>
                  <span className="history-sub">
                    {when(q.createdAt)} • {durationLabel(q.durationSeconds)}
                    {q.purpose ? ` • "${q.purpose}"` : ""}
                  </span>
                </div>
                <Pill
                  tone={
                    q.status === 2
                      ? "ok"
                      : q.status === 3
                      ? "danger"
                      : "neutral"
                  }
                >
                  {RequestStatus[q.status]}
                </Pill>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- activity
function Activity() {
  const { exchange, claim, address, provider } = useSession();
  const who = useParticipants(exchange);
  const [raw, reload] = useLoad(async () => {
    const q = (name, ...args) => events(exchange, name, ...args);
    const [
      added,
      requested,
      rejected,
      granted,
      revoked,
      emergencyCfg,
      emergencyUsed,
      accessed,
      verified,
      cancelled,
      deactivated,
    ] = await Promise.all([
      q("RecordAdded", null, address),
      q("AccessRequested", null, null, address),
      q("RequestRejected", null, null, address),
      q("AccessGranted", null, address),
      q("AccessRevoked", null, address),
      q("EmergencyAccessConfigured", null, address),
      q("EmergencyAccessUsed", null, address),
      q("RecordAccessed", null, address),
      events(claim, "ClaimVerified", null, address),
      q("RequestCancelled", null, null, address),
      q("RecordDeactivated", null, address),
    ]);
    const all = [
      ...added.map((e) => ({ e, kind: "added" })),
      ...requested.map((e) => ({ e, kind: "requested" })),
      ...rejected.map((e) => ({ e, kind: "rejected" })),
      ...granted.map((e) => ({ e, kind: "granted" })),
      ...revoked.map((e) => ({ e, kind: "revoked" })),
      ...emergencyCfg.map((e) => ({ e, kind: "emergencyCfg" })),
      ...emergencyUsed.map((e) => ({ e, kind: "emergencyUsed" })),
      ...accessed.map((e) => ({ e, kind: "accessed" })),
      ...verified.map((e) => ({ e, kind: "verified" })),
      ...cancelled.map((e) => ({ e, kind: "cancelled" })),
      ...deactivated.map((e) => ({ e, kind: "deactivated" })),
    ];
    const blocks = new Map();
    await Promise.all(
      [...new Set(all.map((x) => x.e.blockNumber))].map(async (n) =>
        blocks.set(n, (await provider.getBlock(n)).timestamp)
      )
    );
    return all
      .map((x) => ({ ...x, ts: blocks.get(x.e.blockNumber) }))
      .sort((a, b) => b.e.blockNumber - a.e.blockNumber || b.e.index - a.e.index);
  }, [address]);

  const entries = raw?.map(({ e, kind, ts }) => {
    const a = e.args;
    const name = (x) => who(x)?.name || short(x);
    const rec = a.recordId !== undefined ? `record #${a.recordId}` : "";
    switch (kind) {
      case "cancelled":
        return {
          ts,
          tone: "neutral",
          title: `${name(a.requester)} cancelled their request for ${rec}`,
        };
      case "deactivated":
        return { ts, tone: "neutral", title: `You deactivated ${rec}` };
      case "added":
        return {
          ts,
          tone: "neutral",
          title: `You added ${rec}`,
          detail: `Category: ${a.category}`,
        };
      case "requested":
        return {
          ts,
          tone: "pending",
          title: `${name(a.requester)} requested ${rec}`,
          detail: `For ${durationLabel(a.durationSeconds)}. ${a.purpose || ""}`,
        };
      case "rejected":
        return {
          ts,
          tone: "neutral",
          title: `You rejected ${name(a.requester)}'s request for ${rec}`,
        };
      case "granted":
        return a.emergency
          ? {
              ts,
              tone: "danger",
              title: `Emergency access opened ${rec} to ${name(a.grantee)}`,
            }
          : {
              ts,
              tone: "ok",
              title: `You gave ${name(a.grantee)} access to ${rec}`,
              detail: `Until ${new Date(Number(a.expiresAt) * 1000).toLocaleString()}`,
            };
      case "revoked":
        return {
          ts,
          tone: "neutral",
          title: `You revoked ${name(a.grantee)}'s access to ${rec}`,
        };
      case "emergencyCfg":
        return {
          ts,
          tone: "neutral",
          title: `You ${a.allowed ? "allowed" : "turned off"} emergency access for ${name(
            a.hospital
          )} on ${rec}`,
        };
      case "emergencyUsed":
        return {
          ts,
          tone: "danger",
          title: `${name(a.hospital)} used emergency access on ${rec}`,
          detail: `Reason given: ${a.reason}`,
        };
      case "accessed":
        return { ts, tone: "access", title: `${name(a.accessor)} opened ${rec}` };
      case "verified":
        return {
          ts,
          tone: "zk",
          title: `${name(a.verifiedBy)} verified a claim about you`,
          detail: `Age ${a.minAge}+${
            a.requireVaccinated ? " and vaccinated" : ""
          }. Credential from ${name(a.issuer)}. No other details were shared.`,
        };
      default:
        return null;
    }
  });

  return (
    <Panel
      title="Immutable Audit Ledger"
      subtitle="Cryptographically verified events queried directly from Ethereum smart contracts"
      icon="⚡"
      aside={<button className="btn-link" onClick={reload}>🔄 Refresh</button>}
    >
      <Ledger entries={entries} />
    </Panel>
  );
}

// ------------------------------------------------------------------ proofs
function Proofs() {
  const { claim, exchange } = useSession();
  const confirm = useConfirm();
  const who = useParticipants(exchange);
  const [creds] = useLoad(() => api.myCredentials(), []);
  const [sent, reloadSent] = useLoad(() => api.proofsSent(), []);
  const [year] = useLoad(async () => Number(await claim.currentYear()), []);
  const [credId, setCredId] = useState("");
  const [minAge, setMinAge] = useState(18);
  const [requireVaccinated, setRequireVaccinated] = useState(false);
  const [result, setResult] = useState(null);
  const [recipient, setRecipient] = useState("");
  const [label, setLabel] = useState("");

  const cred = (creds || []).find((c) => c._id === credId) || (creds || [])[0];

  const [prove, proving] = useAction(async () => {
    setResult(null);
    const r = await proveClaim(cred, { minAge, requireVaccinated, currentYear: year });
    if (!(await verifyLocal(r.proof, r.publicSignals)))
      throw new Error("The proof failed its own check. Try again.");
    setResult(r);
    setLabel(`Age ${minAge}+${requireVaccinated ? " and vaccinated" : ""}`);
  }, "Zero-knowledge proof generated and verified locally in browser!");

  const [send, sending] = useAction(async () => {
    const p = await readParticipant(exchange, recipient);
    if ((p.role !== Role.Doctor && p.role !== Role.Hospital) || !p.verified)
      throw new Error("Send proofs to a verified doctor or hospital.");
    await api.shareProof({ to: recipient, label, ...result });
    setRecipient("");
    reloadSent();
  }, "Proof sent securely to recipient.");

  const [withdraw, withdrawing] = useAction(async (p) => {
    if (
      !(await confirm({
        title: "Withdraw this proof?",
        body: "Removes this proof from recipient's inbox. Existing on-chain verifications remain immutable.",
        confirmLabel: "Withdraw",
      }))
    )
      return CANCELLED;
    await api.deleteProof(p._id);
    reloadSent();
  }, "Proof withdrawn.");

  const download = () => {
    const blob = new Blob([JSON.stringify({ label, ...result }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "medzk-proof.json";
    a.click();
  };

  return (
    <div className="view-section">
      <Panel
        title="Hospital-Signed Credentials"
        subtitle="Cryptographic facts signed by trusted issuers using EdDSA Baby Jubjub keys"
        icon="🏥"
      >
        {!creds ? (
          <div className="loading-state">Loading credentials...</div>
        ) : creds.length === 0 ? (
          <Empty icon="📜" title="No credentials issued to your wallet">
            Ask a registered hospital to issue a credential (such as birth year & vaccination
            status) to your address.
          </Empty>
        ) : (
          <div className="credentials-cards-grid">
            {creds.map((c) => (
              <div key={c._id} className="credential-card">
                <div className="credential-badge">Verified Credential</div>
                <strong className="credential-issuer">
                  {c.issuerName || who(c.issuer)?.name || short(c.issuer)}
                </strong>
                <div className="credential-details">
                  <span>📅 Birth Year: <strong>{c.birthYear}</strong></span>
                  <span>💉 Vaccination: <strong>{c.vaccinated ? "Vaccinated" : "No"}</strong></span>
                  <span>Issued: {new Date(c.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {creds?.length ? (
        <Panel
          title="Generate Zero-Knowledge Proof (Groth16)"
          subtitle="Mathematically proves facts without revealing your birth year or private records"
          icon="🛡️"
        >
          <div className="zk-proof-studio">
            <div className="zk-studio-form">
              <Field label="Source Credential">
                <select
                  className="input-select"
                  value={cred?._id}
                  onChange={(e) => setCredId(e.target.value)}
                >
                  {creds.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.issuerName || short(c.issuer)} (Issued{" "}
                      {new Date(c.createdAt).toLocaleDateString()})
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Claim to Prove Mathematically">
                <select
                  className="input-select"
                  value={minAge}
                  onChange={(e) => setMinAge(Number(e.target.value))}
                >
                  {[12, 16, 18, 21, 45, 60, 65].map((a) => (
                    <option key={a} value={a}>
                      Patient is at least {a} years old
                    </option>
                  ))}
                </select>
              </Field>

              <label className="checkbox-control">
                <input
                  type="checkbox"
                  checked={requireVaccinated}
                  onChange={(e) => setRequireVaccinated(e.target.checked)}
                />
                <span>Also prove vaccination status is verified</span>
              </label>
            </div>

            <div className="zk-generator-actions">
              <Button
                busy={proving}
                disabled={!year}
                variant="primary"
                icon="⚡"
                onClick={prove}
              >
                {proving ? "Solving Circom Constraints (~3s)..." : "Generate zk-SNARK Proof"}
              </Button>
              <span className="zk-guarantee-note">
                🔒 Proved locally in browser via snarkjs. Your birth year is never disclosed.
              </span>
            </div>

            {result ? (
              <div className="zk-result-box">
                <div className="zk-seal">
                  <span className="seal-icon">🛡️</span>
                  <div>
                    <h4 className="seal-title">Zero-Knowledge Proof Generated & Verified</h4>
                    <p className="seal-desc">
                      Valid Groth16 zk-SNARK proof. Proves age ≥ {minAge} in {year}
                      {requireVaccinated ? " and vaccinated" : ""}.
                    </p>
                  </div>
                </div>

                <div className="zk-send-form">
                  <input
                    className="input-text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value.trim())}
                    placeholder="Doctor or hospital address (0x...)"
                  />
                  <Button
                    busy={sending}
                    disabled={!/^0x[0-9a-fA-F]{40}$/.test(recipient)}
                    onClick={send}
                    variant="primary"
                  >
                    Send to Doctor
                  </Button>
                  <Button variant="outline" onClick={download}>
                    Download Proof JSON
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}

      <Panel
        title="Transmitted Proofs"
        subtitle="Proofs sent to doctors and hospitals for verification"
        icon="📤"
        aside={<button className="btn-link" onClick={reloadSent}>🔄 Refresh</button>}
      >
        {!sent ? (
          <div className="loading-state">Loading sent proofs...</div>
        ) : sent.length === 0 ? (
          <Empty icon="🛡️" title="No proofs sent yet">
            Generate a proof above and transmit it to a doctor to verify claims without sharing your
            underlying identity documents.
          </Empty>
        ) : (
          <div className="sent-proofs-list">
            {sent.map((p) => {
              const sig = describeSignals(p.publicSignals);
              return (
                <div key={p._id} className="sent-proof-item">
                  <div className="sent-proof-info">
                    <strong>{p.label || "Health Claim"}</strong>
                    <span className="sent-proof-meta">
                      Recipient: <Address value={p.to} name={who(p.to)?.name} /> • Sent{" "}
                      {new Date(p.createdAt).toLocaleString()}
                    </span>
                    <span className="sent-proof-statement">
                      Zero-Knowledge: Age {sig.minAge}+
                      {sig.requireVaccinated ? " & Vaccinated" : ""} for {sig.currentYear}
                    </span>
                  </div>
                  <Button
                    variant="quiet"
                    busy={withdrawing}
                    onClick={() => withdraw(p)}
                  >
                    Withdraw
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
