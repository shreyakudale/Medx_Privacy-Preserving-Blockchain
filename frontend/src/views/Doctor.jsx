import { useState } from "react";
import { useSession, useAction, Button, Field, Panel, Empty, Pill, Tabs } from "../components/ui.jsx";
import { SharedRecords, VerifyProofs } from "../components/shared.jsx";
import { api } from "../lib/api.js";
import { events, RequestStatus, readParticipant, Role } from "../lib/chain.js";
import { useLoad, useParticipants } from "../lib/hooks.js";
import { DURATIONS, durationLabel, short } from "../lib/format.js";

export default function Doctor() {
  const { participant } = useSession();
  const [tab, setTab] = useState("find");

  if (!participant.verified) {
    return (
      <div className="stack">
        <header className="page-head">
          <h1>Waiting for Verification</h1>
          <p>Your hospital needs to verify your account before you can request patient records. Ask your hospital administrator to approve you in MedZK, then refresh this page.</p>
        </header>
      </div>
    );
  }

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Doctor Clinical Dashboard</h1>
        <p>Request access to patient records, view active health grants, and verify zero-knowledge proofs.</p>
      </header>

      <div className="metrics-grid">
        <div className="metric-card">
          <span className="metric-title">Verification Status</span>
          <span className="metric-value" style={{ color: "var(--teal)" }}>Verified</span>
          <span className="metric-sub">Hospital Trusted Doctor</span>
        </div>
        <div className="metric-card">
          <span className="metric-title">Hospital Affiliate</span>
          <span className="metric-value" style={{ fontSize: "1.2rem", color: "#fff" }}>{participant.hospital ? short(participant.hospital) : "Independent"}</span>
          <span className="metric-sub">On-Chain Registered</span>
        </div>
        <div className="metric-card">
          <span className="metric-title">Active Requests</span>
          <span className="metric-value">Active</span>
          <span className="metric-sub">Access Permissions</span>
        </div>
        <div className="metric-card">
          <span className="metric-title">ZK Prover</span>
          <span className="metric-value" style={{ color: "var(--violet)" }}>Groth16</span>
          <span className="metric-sub">Circom Verifier</span>
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "find", label: "Request a record" },
          { id: "requests", label: "My requests" },
          { id: "shared", label: "Shared with me" },
          { id: "proofs", label: "Verify proofs" },
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
  const [duration, setDuration] = useState("86400");
  const [purpose, setPurpose] = useState("");

  const [search, searching] = useAction(async () => {
    const p = await readParticipant(exchange, patient);
    if (p.role !== Role.Patient) throw new Error("That address isn't a registered patient.");
    setFound({ patient: p, records: await api.recordsByOwner(patient) });
    setSelected(null);
  });

  const [request, requesting] = useAction(async () => {
    if (!selected) throw new Error("Pick a record first.");
    const tx = await exchange.requestAccess(selected.recordId || 1, patient, Number(duration), purpose.trim());
    await tx.wait();
    onRequested();
  }, "Request sent to patient. They will see it in their MedZK dashboard.");

  return (
    <div className="stack">
      <Panel title="Find Patient & Request Access">
        <form className="form" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <div className="form-inline">
            <Field label="Patient Wallet Address">
              <input type="text" placeholder="0x..." value={patient} onChange={(e) => setPatient(e.target.value.trim())} />
            </Field>
            <Button busy={searching} type="submit">Find Patient Vault</Button>
          </div>
        </form>
      </Panel>

      {found ? (
        <Panel title={`Records for Patient ${found.patient.name || short(found.patient.address)}`}>
          {!found.records.length ? (
            <Empty>This patient hasn't uploaded any records yet.</Empty>
          ) : (
            <div className="stack">
              <ul className="list">
                {found.records.map((r) => (
                  <li key={r.storageRef} className={selected?.storageRef === r.storageRef ? "item item-picked" : "item"}>
                    <div className="item-main">
                      <strong>Record #{r.recordId || r.storageRef.slice(0, 8)}: {r.category}</strong>
                      <span className="muted">Added {new Date(r.createdAt).toLocaleDateString()}</span>
                    </div>
                    <Button variant="quiet" onClick={() => setSelected(r)}>
                      {selected?.storageRef === r.storageRef ? "Selected" : "Select"}
                    </Button>
                  </li>
                ))}
              </ul>

              {selected ? (
                <div style={{ marginTop: "1rem", padding: "1.2rem", background: "rgba(0, 240, 255, 0.03)", borderRadius: "var(--r-sm)", border: "1px solid rgba(0, 240, 255, 0.15)" }}>
                  <h4 style={{ color: "var(--teal)", margin: "0 0 1rem" }}>Request Permission</h4>
                  <div className="form-grid">
                    <Field label="Access Duration">
                      <select value={duration} onChange={(e) => setDuration(e.target.value)}>
                        {Object.entries(DURATIONS).map(([sec, label]) => (
                          <option key={sec} value={sec}>{label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Reason / Clinical Purpose">
                      <input type="text" placeholder="e.g. Annual health checkup review" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
                    </Field>
                  </div>
                  <div className="row row-end" style={{ marginTop: "1rem" }}>
                    <Button busy={requesting} onClick={request}>Submit Request to Patient</Button>
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
  const [list] = useLoad(async () => {
    const evs = await events(exchange, "AccessRequested");
    const myEvs = evs.filter((e) => e.args.doctor.toLowerCase() === address.toLowerCase());
    return Promise.all(
      myEvs.map(async (e) => {
        const req = await exchange.requests(e.args.requestId);
        return {
          id: String(e.args.requestId),
          patient: req.patient,
          recordId: String(req.recordId),
          duration: Number(req.duration),
          status: Number(req.status),
          reason: e.args.reason || "",
        };
      })
    );
  }, []);

  return (
    <Panel title="My Access Requests">
      {!list ? (
        <p className="muted">Loading...</p>
      ) : !list.length ? (
        <Empty>You haven't requested access to any records yet.</Empty>
      ) : (
        <ul className="list">
          {list.map((r) => (
            <li key={r.id} className="item">
              <div className="item-main">
                <strong>Request #{r.id} to Patient {short(r.patient)}</strong>
                <span className="muted">Target Record #{r.recordId} • Requested: {durationLabel(r.duration)}</span>
                {r.reason ? <blockquote className="muted">"{r.reason}"</blockquote> : null}
              </div>
              <div className="item-side">
                <Pill tone={r.status === 1 ? "pending" : r.status === 2 ? "ok" : "danger"}>
                  {r.status === 1 ? "Pending Patient Approval" : r.status === 2 ? "Approved" : "Denied"}
                </Pill>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
