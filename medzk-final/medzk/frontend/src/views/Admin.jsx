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
  StatCard,
} from "../components/ui.jsx";
import { useLoad, listHospitals } from "../lib/hooks.js";
import { api } from "../lib/api.js";
import { deployment } from "../lib/chain.js";

const isAddr = (v) => /^0x[0-9a-fA-F]{40}$/.test(v);

export default function Admin() {
  const { exchange } = useSession();
  const confirm = useConfirm();
  const [hospitals, reload] = useLoad(async () => {
    const hs = await listHospitals(exchange);
    return Promise.all(
      hs.map(async (h) => ({
        ...h,
        issuerKey: await exchange.hospitalIssuerKey(h.address),
      }))
    );
  }, []);
  const [status, reloadStatus, statusError] = useLoad(() => api.adminStatus(), []);
  const [form, setForm] = useState({ address: "", name: "", ax: "", ay: "" });
  const [newGateway, setNewGateway] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value.trim() }));
  const refreshAll = () => {
    reload();
    reloadStatus();
  };

  const [register, registering] = useAction(async () => {
    await (
      await exchange.registerHospital(form.address, form.name.trim(), form.ax, form.ay)
    ).wait();
    setForm({ address: "", name: "", ax: "", ay: "" });
    refreshAll();
  }, "Hospital registered on-chain and its signing key trusted.");

  const [updateKey, updatingKey] = useAction(async () => {
    await (await exchange.setIssuerKey(form.address, form.ax, form.ay)).wait();
    reload();
  }, "Signing key updated on-chain.");

  const [revoke, revoking] = useAction(async (h) => {
    if (
      !(await confirm({
        title: `Revoke ${h.name}'s Signing Key?`,
        body: "Credentials signed by this key will stop verifying, including proofs patients already created. Register a new key to restore trust.",
        confirmLabel: "Revoke Key",
        danger: true,
      }))
    )
      return CANCELLED;
    await (await exchange.revokeIssuerKey(h.address)).wait();
    reload();
  }, "Signing key revoked on-chain.");

  const [toggleActive, toggling] = useAction(async (h) => {
    const next = !h.verified;
    if (
      !next &&
      !(await confirm({
        title: `Suspend ${h.name}?`,
        body: "It will not be able to verify doctors, use emergency access or open records, and credentials it signed will stop verifying until you reactivate it.",
        confirmLabel: "Suspend Hospital",
        danger: true,
      }))
    )
      return CANCELLED;
    await (await exchange.setHospitalActive(h.address, next)).wait();
    refreshAll();
  }, "Hospital status updated.");

  const [setGw, settingGw] = useAction(async (address) => {
    if (
      !(await confirm({
        title: "Change the Access Gateway?",
        body: `Only ${address} will be able to write access entries. If it is the wrong wallet, nobody can open shared records until you change it back.`,
        confirmLabel: "Change Gateway",
      }))
    )
      return CANCELLED;
    await (await exchange.setGateway(address)).wait();
    setNewGateway("");
    refreshAll();
  }, "Gateway updated on-chain.");

  const [sweep, sweeping] = useAction(
    async () => {
      const { removed } = await api.sweepPending();
      reloadStatus();
      return removed;
    },
    (n) => `Removed ${n} abandoned upload(s).`
  );

  const valid = isAddr(form.address) && /^\d+$/.test(form.ax) && /^\d+$/.test(form.ay);

  return (
    <div className="view-stack">
      <div className="dashboard-hero">
        <div className="dashboard-hero-text">
          <span className="hero-eyebrow">SYSTEM ROOT • NETWORK GOVERNANCE</span>
          <h1 className="hero-headline">Network Administration</h1>
          <p className="hero-subtext">
            Register hospital authorities, configure Baby Jubjub credential signing keys, monitor
            backend gateway balance, and enforce privacy policies.
          </p>
        </div>
      </div>

      <SystemStatus
        status={status}
        error={statusError}
        onRefresh={reloadStatus}
        onFixGateway={setGw}
        fixing={settingGw}
        onSweep={sweep}
        sweeping={sweeping}
      />

      <Panel
        title="Register New Hospital Authority"
        subtitle="Hospitals supply their wallet address and EdDSA Baby Jubjub public key (Ax, Ay)"
        icon="🏥"
      >
        <div className="admin-form-grid">
          <Field label="Hospital Wallet Address" required>
            <input
              className="input-text"
              value={form.address}
              onChange={set("address")}
              placeholder="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC..."
            />
          </Field>

          <Field label="Hospital Legal / Display Name" required>
            <input
              className="input-text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. St. Jude General Hospital"
              maxLength={80}
            />
          </Field>

          <Field label="Signing Key Ax (Poseidon Curve)" required>
            <input
              className="input-text"
              value={form.ax}
              onChange={set("ax")}
              placeholder="Decimal integer"
            />
          </Field>

          <Field label="Signing Key Ay (Poseidon Curve)" required>
            <input
              className="input-text"
              value={form.ay}
              onChange={set("ay")}
              placeholder="Decimal integer"
            />
          </Field>
        </div>

        <div className="panel-actions-row">
          <Button
            busy={registering}
            disabled={!valid || !form.name.trim()}
            onClick={register}
            variant="primary"
            icon="✓"
          >
            Register Hospital On-Chain
          </Button>

          <Button
            variant="outline"
            busy={updatingKey}
            disabled={!valid}
            onClick={updateKey}
          >
            Replace Key for Existing Hospital
          </Button>
        </div>
      </Panel>

      <Panel
        title="Registered Hospital Authorities"
        subtitle="Hospitals authorized to verify doctors and issue ZK credentials"
        icon="🏛️"
        aside={<button className="btn-link" onClick={refreshAll}>🔄 Refresh</button>}
      >
        {!hospitals ? (
          <div className="loading-state">Loading registered hospitals...</div>
        ) : hospitals.length === 0 ? (
          <Empty icon="🏥" title="No hospitals registered yet">
            Register your first hospital using the form above.
          </Empty>
        ) : (
          <div className="hospitals-registry-list">
            {hospitals.map((h) => {
              const keyTrusted = h.issuerKey !== "0x" + "0".repeat(64);
              return (
                <div key={h.address} className="hospital-card">
                  <div className="hospital-card-top">
                    <strong className="hospital-card-title">{h.name}</strong>
                    <Address value={h.address} />
                  </div>

                  <div className="hospital-card-badges">
                    <Pill tone={h.verified ? "ok" : "danger"}>
                      {h.verified ? "Active Status" : "Suspended"}
                    </Pill>
                    <Pill tone={keyTrusted ? "purple" : "danger"}>
                      {keyTrusted ? "Signing Key Trusted" : "Key Revoked"}
                    </Pill>
                    {!h.encryptionPublicKey ? (
                      <Pill tone="amber">Encryption Key Pending</Pill>
                    ) : null}
                  </div>

                  <div className="hospital-card-actions">
                    <Button
                      variant={h.verified ? "danger" : "primary"}
                      busy={toggling}
                      onClick={() => toggleActive(h)}
                    >
                      {h.verified ? "Suspend Authority" : "Reactivate"}
                    </Button>
                    {keyTrusted ? (
                      <Button
                        variant="outline"
                        busy={revoking}
                        onClick={() => revoke(h)}
                      >
                        Revoke Key
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel
        title="Access Gateway Configuration"
        subtitle="The backend signer that writes RecordAccessed events on-chain before file delivery"
        icon="⚙️"
      >
        <div className="search-form-row">
          <div className="flex-1">
            <Field label="Authorized Gateway Address">
              <input
                className="input-text"
                value={newGateway}
                onChange={(e) => setNewGateway(e.target.value.trim())}
                placeholder="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
              />
            </Field>
          </div>
          <div className="search-btn-col">
            <Button
              variant="outline"
              busy={settingGw}
              disabled={!isAddr(newGateway)}
              onClick={() => setGw(newGateway)}
            >
              Update Gateway Signer
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function SystemStatus({
  status,
  error,
  onRefresh,
  onFixGateway,
  fixing,
  onSweep,
  sweeping,
}) {
  return (
    <Panel
      title="System Health & Infrastructure"
      subtitle="Real-time diagnostics across MongoDB, Ethereum node, and gateway wallet"
      icon="⚡"
      aside={<button className="btn-link" onClick={onRefresh}>🔄 Refresh</button>}
    >
      {error ? (
        <div className="alert-banner alert-banner-danger">
          Could not fetch backend health: {error}
        </div>
      ) : null}

      {!status && !error ? <div className="loading-state">Loading health metrics...</div> : null}

      {status ? (
        <div className="system-health-body">
          {status.warnings.length ? (
            <div className="alert-banner alert-banner-danger" role="alert">
              <div className="alert-icon">⚠️</div>
              <div className="alert-content">
                <strong>Attention Required:</strong>
                {status.warnings.map((w, idx) => (
                  <p key={idx}>{w}</p>
                ))}
                {!status.gateway.matches ? (
                  <div className="row" style={{ marginTop: "0.75rem" }}>
                    <Button
                      variant="primary"
                      busy={fixing}
                      onClick={() => onFixGateway(status.gateway.backend)}
                    >
                      Sync Contract to Backend Gateway Wallet
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="health-all-clear">
              <span className="live-dot live-dot-active" />
              <span>All cryptographic and infrastructure checks operating nominally</span>
            </div>
          )}

          <div className="stats-row">
            <StatCard
              title="Registered Patients"
              value={status.participants.patients}
              icon="👤"
              tone="teal"
            />
            <StatCard
              title="Verified Doctors"
              value={status.participants.doctors}
              icon="🩺"
              tone="blue"
            />
            <StatCard
              title="Hospitals"
              value={status.participants.hospitals}
              icon="🏥"
              tone="purple"
            />
            <StatCard
              title="Records Stored"
              value={status.totals.records}
              icon="📁"
              tone="neutral"
            />
            <StatCard
              title="Access Requests"
              value={status.totals.accessRequests}
              icon="📬"
              tone="amber"
            />
            <StatCard
              title="ZK Verifications"
              value={status.totals.verifications}
              icon="🛡️"
              tone="purple"
            />
          </div>

          <div className="diagnostics-table">
            <div className="diag-row">
              <span className="diag-key">Backend Gateway Balance:</span>
              <span className="diag-val">
                <strong>{status.gateway.balanceEth.toFixed(4)} ETH</strong> (Wallet:{" "}
                <Address value={status.gateway.backend} />)
              </span>
            </div>
            <div className="diag-row">
              <span className="diag-key">Blockchain Network:</span>
              <span className="diag-val">
                {status.chain.network} (Chain ID {status.chain.chainId}) • Latest Block #
                {status.chain.blockNumber}
              </span>
            </div>
            <div className="diag-row">
              <span className="diag-key">MongoDB State:</span>
              <span className="diag-val">
                <Pill
                  tone={status.database.state === "connected" ? "ok" : "danger"}
                  icon="●"
                >
                  {status.database.state}
                </Pill>
              </span>
            </div>
            <div className="diag-row">
              <span className="diag-key">Records Contract:</span>
              <span className="diag-val">
                <Address value={status.contracts.exchange} />
              </span>
            </div>
            <div className="diag-row">
              <span className="diag-key">ZK ClaimVerifier Contract:</span>
              <span className="diag-val">
                <Address value={status.contracts.claimVerifier} />
              </span>
            </div>
          </div>

          {status.totals.pendingUploads ? (
            <div className="panel-actions-row">
              <Button variant="outline" busy={sweeping} onClick={onSweep}>
                Sweep {status.totals.pendingUploads} Abandoned Pending Upload(s)
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
