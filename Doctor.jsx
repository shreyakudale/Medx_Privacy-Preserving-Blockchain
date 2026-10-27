import { useState } from "react";
import {
  useSession,
  useAction,
  Button,
  Field,
  Panel,
  Empty,
  Pill,
  Tabs,
  StatCard,
  CountdownBadge,
  Address,
} from "../components/ui.jsx";
import { SharedRecords, VerifyProofs } from "../components/shared.jsx";
import { api } from "../lib/api.js";
import { events, RequestStatus, readParticipant, Role } from "../lib/chain.js";
import { useLoad, useParticipants } from "../lib/hooks.js";
import { DURATIONS, durationLabel, short, when, remaining } from "../lib/format.js";

export default function Doctor() {
  const { participant } = useSession();
  const [tab, setTab] = useState("find");

  if (!participant.verified) {
    return (
      <div className="view-stack">
        <div className="alert-banner alert-banner-danger">
          <div className="alert-icon">🩺</div>
          <div className="alert-content">
            <h2 className="alert-title">Hospital Verification Pending</h2>
            <p>
              Your account has registered as a Doctor, but your affiliated hospital has not verified
              your credentials yet. You cannot request or open patient records until your hospital
              administrator clicks "Verify Doctor".
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view-stack">
      <div className="dashboard-hero">
        <div className="dashboard-hero-text">
          <span className="hero-eyebrow">CLINICAL CONSOLE • VERIFIED PRACTITIONER</span>
          <h1 className="hero-headline">Doctor Clinical Portal</h1>
          <p className="hero-subtext">
            Request time-limited consent to view patient records. Each access is audited on-chain,
            and files are decrypted in-memory on your device.
          </p>
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "find", label: "Request Record", icon: "🔍" },
          { id: "requests", label: "My Requests", icon: "⏳" },
          { id: "shared", label: "Shared With Me", icon: "📂" },
          { id: "proofs", label: "Verify ZK Proofs", icon: "🛡️" },
        ]}
      />

      {tab === "find" ? <FindRecords onRequested={() => setTab("requests")} /> : null}
      {tab === "requests" ? <MyRequests /> : null}
      {tab === "shared" ? <SharedRecords /> : null}
      {tab === "proofs" ? <VerifyProofs /> : null}
    </div>
  );
}

function FindRecords({ onRequested }) {
  const { exchange } = useSession();
  const [patient, setPatient] = useState("");
  const [found, setFound] = useState(null);
  const [selected, setSelected] = useState(null);
  const [duration, setDuration] = useState(DURATIONS[1].seconds);
  const [purpose, setPurpose] = useState("");

  const [search, searching] = useAction(async () => {
    const p = await readParticipant(exchange, patient);
    if (p.role !== Role.Patient)
      throw new Error("That address is not registered as a patient in MedZK.");
    setFound({ patient: p, records: await api.recordsByOwner(patient) });
    setSelected(null);
  });

  const [request, requesting] = useAction(async () => {
    if (!purpose.trim()) throw new Error("State the clinical reason for this access request.");
    await (await exchange.requestAccess(selected, duration, purpose.trim())).wait();
    setPurpose("");
    onRequested();
  }, "Request broadcasted to patient! They can approve it from their dashboard.");

  return (
    <div className="view-section">
      <Panel
        title="Search Patient Records"
        subtitle="Lookup patient vault by wallet address to view available categories"
        icon="🔍"
      >
        <div className="search-form-row">
          <div className="flex-1">
            <Field label="Patient Wallet Address" hint="Patients can copy this from their dashboard">
              <input
                className="input-text"
                value={patient}
                onChange={(e) => setPatient(e.target.value.trim())}
                placeholder="0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65..."
              />
            </Field>
          </div>
          <div className="search-btn-col">
            <Button
              busy={searching}
              disabled={!/^0x[0-9a-fA-F]{40}$/.test(patient)}
              onClick={search}
              icon="🔎"
            >
              Lookup Vault
            </Button>
          </div>
        </div>
      </Panel>

      {found ? (
        <Panel
          title={`Available Vault for ${found.patient.name}`}
          subtitle="Record titles remain encrypted until granted; select a record to request access"
          icon="📁"
        >
          {found.records.length === 0 ? (
            <Empty icon="📭" title="No records in this patient's vault">
              This patient has not uploaded any medical records yet.
            </Empty>
          ) : (
            <div className="patient-records-picker">
              <div className="records-radio-list">
                {found.records.map((r) => (
                  <label
                    key={r.recordId}
                    className={`record-pick-card ${
                      selected === r.recordId ? "record-pick-active" : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name="record"
                      checked={selected === r.recordId}
                      onChange={() => setSelected(r.recordId)}
                    />
                    <div className="pick-card-content">
                      <div className="pick-card-top">
                        <strong className="pick-title">
                          Record #{r.recordId} • {r.category}
                        </strong>
                        <span className="pick-date">
                          Added {new Date(r.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <span className="pick-sub">
                        Encrypted payload off-chain • Hash anchored on Ethereum
                      </span>
                    </div>
                  </label>
                ))}
              </div>

              {selected ? (
                <div className="request-composer-box">
                  <h4 className="composer-title">Compose Access Request</h4>
                  <div className="composer-form">
                    <Field label="Requested Grant Duration">
                      <select
                        className="input-select"
                        value={duration}
                        onChange={(e) => setDuration(Number(e.target.value))}
                      >
                        {DURATIONS.map((d) => (
                          <option key={d.seconds} value={d.seconds}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field
                      label="Clinical Purpose / Reason"
                      hint="Stored on-chain and visible to the patient for consent"
                      required
                    >
                      <input
                        className="input-text"
                        value={purpose}
                        onChange={(e) => setPurpose(e.target.value)}
                        maxLength={140}
                        placeholder="e.g., Pre-operative consultation review or allergy assessment"
                      />
                    </Field>

                    <Button
                      busy={requesting}
                      onClick={request}
                      variant="primary"
                      icon="📤"
                    >
                      Send On-Chain Access Request
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

function MyRequests() {
  const { exchange, address } = useSession();
  const who = useParticipants(exchange);
  const [list, reload] = useLoad(async () => {
    const evs = await events(exchange, "AccessRequested");
    const mine = evs.filter((e) => e.args.requester.toLowerCase() === address.toLowerCase());
    const rows = await Promise.all(
      mine.map(async (e) => {
        const q = await exchange.getRequest(e.args.requestId);
        const status = Number(q.status);
        let expiresAt = 0;
        if (status === 2) {
          expiresAt = Number(
            (await exchange.grants(Number(q.recordId), address)).expiresAt
          );
        }
        return {
          requestId: Number(e.args.requestId),
          recordId: Number(q.recordId),
          owner: e.args.owner,
          status,
          duration: Number(q.durationSeconds),
          purpose: q.purpose,
          createdAt: Number(q.createdAt),
          expiresAt,
        };
      })
    );
    return rows.sort((a, b) => b.requestId - a.requestId);
  }, []);

  const [cancel, cancelling] = useAction(async (id) => {
    await (await exchange.cancelRequest(id)).wait();
    reload();
  }, "Request cancelled.");

  const statusTone = { 1: "amber", 2: "ok", 3: "danger", 4: "neutral" };

  return (
    <Panel
      title="Sent Access Requests"
      subtitle="Track patient approvals and active time grants in real time"
      icon="⏳"
      aside={<button className="btn-link" onClick={reload}>🔄 Refresh</button>}
    >
      {!list ? (
        <div className="loading-state">Loading your requests...</div>
      ) : list.length === 0 ? (
        <Empty icon="📬" title="No requests sent yet">
          Look up a patient vault in the "Request Record" tab to request access to their records.
        </Empty>
      ) : (
        <div className="my-requests-list">
          {list.map((q) => (
            <div key={q.requestId} className="my-request-card">
              <div className="my-request-main">
                <div className="my-request-head">
                  <strong className="my-request-title">
                    Record #{q.recordId} from {who(q.owner)?.name || short(q.owner)}
                  </strong>
                  <Pill tone={statusTone[q.status] || "neutral"}>
                    {RequestStatus[q.status]}
                  </Pill>
                </div>
                <span className="my-request-sub">
                  Requested {when(q.createdAt)} for {durationLabel(q.duration)}
                  {q.purpose ? ` • "${q.purpose}"` : ""}
                </span>
              </div>

              <div className="my-request-actions">
                {q.status === 2 ? (
                  <CountdownBadge expiresAt={q.expiresAt} />
                ) : null}

                {q.status === 1 ? (
                  <Button
                    variant="quiet"
                    busy={cancelling}
                    onClick={() => cancel(q.requestId)}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
