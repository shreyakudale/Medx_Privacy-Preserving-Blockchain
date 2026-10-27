import { useState } from "react";
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
  StatCard,
} from "../components/ui.jsx";
import { SharedRecords, VerifyProofs } from "../components/shared.jsx";
import { api } from "../lib/api.js";
import { events, readParticipant, Role } from "../lib/chain.js";
import { useLoad, useParticipants } from "../lib/hooks.js";
import { when, short } from "../lib/format.js";

export default function Hospital() {
  const { participant } = useSession();
  const [tab, setTab] = useState("doctors");
  const [shareTick, setShareTick] = useState(0);

  return (
    <div className="view-stack">
      <div className="dashboard-hero">
        <div className="dashboard-hero-text">
          <span className="hero-eyebrow">INSTITUTIONAL ADMINISTRATION</span>
          <h1 className="hero-headline">{participant.name || "Hospital Authority Console"}</h1>
          <p className="hero-subtext">
            Verify clinical staff, issue Baby Jubjub-signed ZK credentials to patients, and exercise
            break-glass emergency access under immutable audit logging.
          </p>
        </div>
      </div>

      {!participant.verified ? (
        <div className="alert-banner alert-banner-danger" role="alert">
          <div className="alert-icon">⚠️</div>
          <div className="alert-content">
            <h3 className="alert-title">Hospital Authority Suspended</h3>
            <p>
              The network admin has paused this hospital. Doctor verification, emergency access, and
              credentials signed by your key will not be accepted until reactivated.
            </p>
          </div>
        </div>
      ) : null}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "doctors", label: "Doctor Roster", icon: "🩺" },
          { id: "credentials", label: "Issue Credentials", icon: "📜" },
          { id: "emergency", label: "Emergency Break-Glass", icon: "🚨" },
          { id: "shared", label: "Shared Records", icon: "📂" },
          { id: "proofs", label: "Verify Proofs", icon: "🛡️" },
        ]}
      />

      {tab === "doctors" ? <Doctors /> : null}
      {tab === "credentials" ? <Credentials /> : null}
      {tab === "emergency" ? (
        <Emergency
          onUsed={() => {
            setShareTick((t) => t + 1);
            setTab("shared");
          }}
        />
      ) : null}
      {tab === "shared" ? <SharedRecords reloadKey={shareTick} /> : null}
      {tab === "proofs" ? <VerifyProofs /> : null}
    </div>
  );
}

function Doctors() {
  const { exchange, address } = useSession();
  const confirm = useConfirm();
  const [list, reload] = useLoad(async () => {
    const evs = await events(exchange, "ParticipantRegistered");
    const doctors = evs
      .filter((e) => Number(e.args.role) === Role.Doctor)
      .map((e) => e.args.account);
    const ps = await Promise.all(
      [...new Set(doctors)].map((a) => readParticipant(exchange, a))
    );
    return ps.filter((p) => p.hospital.toLowerCase() === address.toLowerCase());
  }, []);

  const [verify, verifying] = useAction(async (doc) => {
    await (await exchange.verifyDoctor(doc)).wait();
    reload();
  }, "Doctor verified. They can now request patient records.");

  const [revoke, revoking] = useAction(async (d) => {
    if (
      !(await confirm({
        title: `Revoke ${d.name}?`,
        body: "They lose access to every record immediately, even grants that haven't expired. You can verify them again later.",
        confirmLabel: "Revoke Doctor",
        danger: true,
      }))
    )
      return CANCELLED;
    await (await exchange.revokeDoctor(d.address)).wait();
    reload();
  }, "Doctor revoked. Their access has ended.");

  const pending = (list || []).filter((d) => !d.verified);
  const verified = (list || []).filter((d) => d.verified);

  return (
    <div className="view-section">
      <Panel
        title="Pending Doctor Authorizations"
        subtitle="Doctors registered under your hospital awaiting verified practitioner status"
        icon="⏳"
        aside={<button className="btn-link" onClick={reload}>🔄 Refresh</button>}
      >
        {!list ? (
          <div className="loading-state">Loading doctors roster...</div>
        ) : pending.length === 0 ? (
          <Empty icon="🩺" title="No doctors awaiting verification">
            Doctors will appear here when they register in MedZK and select your hospital.
          </Empty>
        ) : (
          <div className="doctors-list">
            {pending.map((d) => (
              <div key={d.address} className="doctor-roster-card">
                <div className="doctor-roster-info">
                  <strong className="doctor-name">{d.name}</strong>
                  <Address value={d.address} />
                </div>
                <Button
                  busy={verifying}
                  variant="primary"
                  icon="✓"
                  onClick={() => verify(d.address)}
                >
                  Verify Doctor
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {verified.length ? (
        <Panel
          title="Verified Clinical Staff"
          subtitle="Currently authorized to request patient records under hospital aegis"
          icon="✓"
        >
          <div className="doctors-list">
            {verified.map((d) => (
              <div key={d.address} className="doctor-roster-card">
                <div className="doctor-roster-info">
                  <strong className="doctor-name">{d.name}</strong>
                  <Address value={d.address} />
                </div>
                <div className="doctor-roster-actions">
                  <Pill tone="ok" icon="✓">Verified Practitioner</Pill>
                  <Button
                    variant="danger"
                    busy={revoking}
                    onClick={() => revoke(d)}
                  >
                    Revoke
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function Credentials() {
  const { exchange } = useSession();
  const confirm = useConfirm();
  const who = useParticipants(exchange);
  const [key, reloadKey] = useLoad(() => api.issuerKey(), []);
  const [history, reloadHistory] = useLoad(() => api.issuedCredentials(), []);
  const [subject, setSubject] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [vaccinated, setVaccinated] = useState(false);

  const [issue, issuing] = useAction(async () => {
    const p = await readParticipant(exchange, subject);
    if (p.role !== Role.Patient) throw new Error("That address is not registered as a patient.");
    await api.issueCredential({
      subject,
      birthYear: Number(birthYear),
      vaccinated: vaccinated ? 1 : 0,
    });
    reloadHistory();
    setSubject("");
    setBirthYear("");
    setVaccinated(false);
  }, "Credential issued! The patient can now generate zero-knowledge proofs from it.");

  const [rotate, rotating] = useAction(async () => {
    if (
      !(await confirm({
        title: "Create a new signing key?",
        body: "The current key is destroyed. You cannot issue credentials until the network admin registers the new key.",
        confirmLabel: "Create New Key",
        danger: true,
      }))
    )
      return CANCELLED;
    await api.rotateIssuerKey();
    reloadKey();
  }, "New signing key created. Send it to the admin to register.");

  return (
    <div className="view-section">
      <Panel
        title="Baby Jubjub Credential Signing Key"
        subtitle="Used for EdDSA Poseidon signatures compatible with the MedZK Circom circuit"
        icon="🔑"
      >
        {!key ? (
          <div className="loading-state">Loading signing key...</div>
        ) : key.registered ? (
          <div className="key-status-box key-status-active">
            <div className="key-status-top">
              <Pill tone="ok" icon="✓">Trusted On-Chain by ClaimVerifier</Pill>
            </div>
            <p className="key-status-text">
              Proofs constructed from credentials signed by your hospital will be accepted by smart
              contracts.
            </p>
          </div>
        ) : (
          <div className="key-status-box key-status-unregistered">
            <div className="key-status-top">
              <Pill tone="danger" icon="⚠️">Key Not Registered On-Chain</Pill>
            </div>
            <p className="key-status-text">
              Copy these values and submit them to the network admin to register your signing key:
            </p>
            <div className="key-vals-grid">
              <div>
                <span className="key-val-label">Public Key Ax:</span>
                <code className="key-val-code">{key.ax}</code>
              </div>
              <div>
                <span className="key-val-label">Public Key Ay:</span>
                <code className="key-val-code">{key.ay}</code>
              </div>
            </div>
          </div>
        )}

        <div className="panel-actions-row">
          <Button variant="outline" busy={rotating} onClick={rotate}>
            Replace / Rotate Signing Key
          </Button>
        </div>
      </Panel>

      <Panel
        title="Issue Zero-Knowledge Credential"
        subtitle="Signs verified facts with hospital EdDSA key. Patient keeps credential to prove facts without disclosure."
        icon="✍️"
      >
        <div className="credential-form-grid">
          <Field label="Patient Wallet Address" required>
            <input
              className="input-text"
              value={subject}
              onChange={(e) => setSubject(e.target.value.trim())}
              placeholder="0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"
            />
          </Field>

          <Field label="Verified Birth Year" hint="From verified hospital records" required>
            <input
              className="input-text"
              type="number"
              min="1900"
              max={new Date().getFullYear()}
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value)}
              placeholder="e.g. 2000"
            />
          </Field>

          <label className="checkbox-control">
            <input
              type="checkbox"
              checked={vaccinated}
              onChange={(e) => setVaccinated(e.target.checked)}
            />
            <span>Vaccination records verified & authenticated</span>
          </label>
        </div>

        <div className="panel-actions-row">
          <Button
            busy={issuing}
            disabled={!key?.registered || !/^0x[0-9a-fA-F]{40}$/.test(subject) || !birthYear}
            onClick={issue}
            variant="primary"
            icon="🔏"
          >
            Sign & Issue Credential
          </Button>
        </div>
      </Panel>

      <Panel
        title="Issued Credentials Log"
        subtitle="Recent credentials authenticated by your hospital"
        icon="📜"
        aside={<button className="btn-link" onClick={reloadHistory}>🔄 Refresh</button>}
      >
        {!history ? (
          <div className="loading-state">Loading history...</div>
        ) : history.length === 0 ? (
          <Empty icon="📜" title="No credentials issued yet">
            Issue credentials to patients above to enable zero-knowledge proofs.
          </Empty>
        ) : (
          <div className="history-table">
            {history.map((c) => (
              <div key={c.id} className="history-row">
                <div className="history-main">
                  <strong>
                    Issued to <Address value={c.subject} name={who(c.subject)?.name} />
                  </strong>
                  <span className="history-sub">
                    Issued: {new Date(c.issuedAt).toLocaleString()} • Attribute values kept
                    private
                  </span>
                </div>
                <Pill tone="ok" icon="✓">Signed EdDSA</Pill>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Emergency({ onUsed }) {
  const { exchange, address, participant } = useSession();
  const confirm = useConfirm();
  const who = useParticipants(exchange);
  const [recordId, setRecordId] = useState("");
  const [reason, setReason] = useState("");
  const [past, reload] = useLoad(
    () => events(exchange, "EmergencyAccessUsed", null, null, address),
    []
  );

  const [breakGlass, breaking] = useAction(async () => {
    if (reason.trim().length < 10)
      throw new Error("Describe the clinical emergency in detail (at least 10 characters).");
    if (
      !(await confirm({
        title: "Activate Break-Glass Emergency Access?",
        body: `This unlocks Record #${recordId} for 6 hours. It writes a permanent, unerasable audit entry to the Ethereum blockchain with your stated reason.`,
        confirmLabel: "Break Glass & Open Record",
        danger: true,
      }))
    )
      return CANCELLED;
    await (await exchange.breakGlass(Number(recordId), reason.trim())).wait();
    setRecordId("");
    setReason("");
    reload();
    onUsed();
  }, "Emergency access granted for 6 hours. Audit logged on-chain.");

  return (
    <div className="view-section">
      <Panel
        title="Break-Glass Emergency Protocol"
        subtitle="Strict life-or-death access protocol with immutable public ledger auditing"
        icon="🚨"
      >
        <div className="alert-banner alert-banner-danger">
          <div className="alert-icon">🚨</div>
          <div className="alert-content">
            <strong>Warning: Strictly For Non-Responsive Clinical Emergencies</strong>
            <p>
              Access lasts exactly 6 hours, writes an immutable Ethereum audit event, and alerts
              the patient immediately. It operates only on records where the patient has explicitly
              opted-in for {participant.name}.
            </p>
          </div>
        </div>

        <div className="emergency-form-grid">
          <Field label="Target Record Number" required>
            <input
              className="input-text"
              type="number"
              min="1"
              value={recordId}
              onChange={(e) => setRecordId(e.target.value)}
              placeholder="e.g. 1"
            />
          </Field>

          <Field label="Emergency Clinical Justification" required>
            <input
              className="input-text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              placeholder="Patient trauma / unconscious on arrival; immediate transfusion check"
            />
          </Field>
        </div>

        <div className="panel-actions-row">
          <Button
            variant="danger"
            busy={breaking}
            disabled={!recordId}
            onClick={breakGlass}
            icon="🚨"
          >
            Break Glass: Open Record
          </Button>
        </div>
      </Panel>

      <Panel title="Emergency Audit Trail" icon="📜">
        {!past ? (
          <div className="loading-state">Loading emergency history...</div>
        ) : past.length === 0 ? (
          <Empty icon="🛡️" title="No emergency access events recorded">
            Your hospital has never activated break-glass access.
          </Empty>
        ) : (
          <div className="history-table">
            {[...past].reverse().map((e, i) => (
              <div key={i} className="history-row">
                <div className="history-main">
                  <strong>
                    Record #{String(e.args.recordId)} of{" "}
                    {who(e.args.owner)?.name || short(e.args.owner)}
                  </strong>
                  <span className="history-sub">
                    Justification: "{e.args.reason}" • Granted until {when(e.args.expiresAt)}
                  </span>
                </div>
                <Pill tone="danger">Emergency Used</Pill>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
