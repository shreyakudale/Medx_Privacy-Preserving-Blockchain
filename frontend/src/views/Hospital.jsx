import { useState } from "react";
import { useSession, useAction, Button, Field, Panel, Empty, Pill, Address, Tabs } from "../components/ui.jsx";
import { SharedRecords, VerifyProofs } from "../components/shared.jsx";
import { api } from "../lib/api.js";
import { events, readParticipant, Role } from "../lib/chain.js";
import { useLoad, useParticipants } from "../lib/hooks.js";
import { when } from "../lib/format.js";

export default function Hospital() {
  const [tab, setTab] = useState("doctors");
  const [shareTick, setShareTick] = useState(0);

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Hospital Administration</h1>
        <p>Verify affiliated doctors, issue signed credentials to patients, and exercise emergency access when authorized.</p>
      </header>

      <div className="metrics-grid">
        <div className="metric-card">
          <span className="metric-title">Hospital Node</span>
          <span className="metric-value" style={{ color: "var(--teal)" }}>Online</span>
          <span className="metric-sub">Ethereum Ledger Verified</span>
        </div>
        <div className="metric-card">
          <span className="metric-title">Issuer Key</span>
          <span className="metric-value" style={{ color: "var(--violet)" }}>Active</span>
          <span className="metric-sub">BabyJubJub Curve (EdDSA)</span>
        </div>
        <div className="metric-card">
          <span className="metric-title">Emergency Privileges</span>
          <span className="metric-value" style={{ color: "var(--amber)" }}>Authorized</span>
          <span className="metric-sub">Audit-Logged On-Chain</span>
        </div>
        <div className="metric-card">
          <span className="metric-title">ZK Gateway</span>
          <span className="metric-value">Active</span>
          <span className="metric-sub">MongoDB Encrypted Storage</span>
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "doctors", label: "Doctors" },
          { id: "credentials", label: "Issue credentials" },
          { id: "emergency", label: "Emergency access" },
          { id: "shared", label: "Shared with hospital" },
          { id: "proofs", label: "Verify proofs" },
        ]}
      />
      {tab === "doctors" ? <Doctors /> : null}
      {tab === "credentials" ? <Credentials /> : null}
      {tab === "emergency" ? <Emergency onUsed={() => { setShareTick((t) => t + 1); setTab("shared"); }} /> : null}
      {tab === "shared" ? <SharedRecords reloadKey={shareTick} /> : null}
      {tab === "proofs" ? <VerifyProofs /> : null}
    </div>
  );
}

function Doctors() {
  const { exchange, address } = useSession();
  const [list, reload] = useLoad(async () => {
    const evs = await events(exchange, "ParticipantRegistered");
    const doctors = evs.filter((e) => Number(e.args.role) === Role.Doctor).map((e) => e.args.account);
    const ps = await Promise.all([...new Set(doctors)].map((a) => readParticipant(exchange, a)));
    return ps.filter((p) => p.hospital.toLowerCase() === address.toLowerCase());
  }, []);

  const [verify, verifying] = useAction(async (docAddress) => {
    const tx = await exchange.verifyDoctor(docAddress);
    await tx.wait();
    reload();
  }, "Doctor verified on-chain.");

  return (
    <Panel title="Affiliated Doctors">
      {!list ? (
        <p className="muted">Loading...</p>
      ) : !list.length ? (
        <Empty>No doctors have registered under your hospital address yet.</Empty>
      ) : (
        <ul className="list">
          {list.map((d) => (
            <li key={d.address} className="item">
              <div className="item-main">
                <strong>{d.name || "Doctor"}</strong>
                <span className="muted"><Address value={d.address} /></span>
              </div>
              <div className="item-side">
                {d.verified ? (
                  <Pill tone="ok">Verified</Pill>
                ) : (
                  <Button busy={verifying} onClick={() => verify(d.address)}>Verify Doctor</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Credentials() {
  const { address } = useSession();
  const [subject, setSubject] = useState("");
  const [birthYear, setBirthYear] = useState("1995");
  const [vaccinated, setVaccinated] = useState("1");

  const [issue, issuing] = useAction(async () => {
    if (!subject.trim()) throw new Error("Enter patient wallet address.");
    await api.issueCredential({
      subject: subject.trim(),
      birthYear: Number(birthYear),
      vaccinated: Number(vaccinated),
    });
    setSubject("");
  }, "Credential signed and issued to patient.");

  return (
    <Panel title="Issue BabyJubJub Signed Credential">
      <p className="muted">Signs an verifiable statement using the hospital's private key. The patient can use this to generate ZK proofs.</p>
      <form className="form" onSubmit={(e) => { e.preventDefault(); issue(); }}>
        <div className="form-grid">
          <Field label="Patient Wallet Address">
            <input type="text" placeholder="0x..." value={subject} onChange={(e) => setSubject(e.target.value.trim())} />
          </Field>
          <Field label="Birth Year">
            <input type="number" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} />
          </Field>
          <Field label="Vaccinated Against COVID-19">
            <select value={vaccinated} onChange={(e) => setVaccinated(e.target.value)}>
              <option value="1">Yes (Vaccinated)</option>
              <option value="0">No (Unvaccinated)</option>
            </select>
          </Field>
        </div>
        <div className="row row-end" style={{ marginTop: "1rem" }}>
          <Button busy={issuing} type="submit">Sign & Issue Credential</Button>
        </div>
      </form>
    </Panel>
  );
}

function Emergency({ onUsed }) {
  const { exchange, address } = useSession();
  const [patient, setPatient] = useState("");
  const [recordId, setRecordId] = useState("1");
  const [reason, setReason] = useState("");

  const [useEmerg, usingEmerg] = useAction(async () => {
    if (!patient || !reason.trim()) throw new Error("Enter patient address and reason.");
    const tx = await exchange.useEmergencyAccess(Number(recordId), patient, reason.trim());
    await tx.wait();
    onUsed();
  }, "Emergency access exercised. Recorded in audit trail.");

  return (
    <Panel title="Exercise Emergency Access">
      <p className="muted font-warning">Emergency access will write an irreversible alert on-chain for the patient.</p>
      <form className="form" onSubmit={(e) => { e.preventDefault(); useEmerg(); }}>
        <div className="form-grid">
          <Field label="Patient Address">
            <input type="text" placeholder="0x..." value={patient} onChange={(e) => setPatient(e.target.value.trim())} />
          </Field>
          <Field label="Target Record ID">
            <input type="number" value={recordId} onChange={(e) => setRecordId(e.target.value)} />
          </Field>
          <Field label="Clinical Emergency Reason">
            <input type="text" placeholder="e.g. ICU ER trauma admission" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <div className="row row-end" style={{ marginTop: "1rem" }}>
          <Button variant="danger" busy={usingEmerg} type="submit">Execute Emergency Access</Button>
        </div>
      </form>
    </Panel>
  );
}
