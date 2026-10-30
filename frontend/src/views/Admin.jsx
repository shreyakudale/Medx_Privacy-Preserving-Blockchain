import { useState } from "react";
import { ethers } from "ethers";
import { useSession, useAction, Button, Field, Panel, Empty, Pill, Address, useToast } from "../components/ui.jsx";
import { useLoad, listHospitals } from "../lib/hooks.js";
import { deployment } from "../lib/chain.js";
import { api } from "../lib/api.js";

export default function Admin() {
  const { exchange } = useSession();
  const toast = useToast();
  const [hospitals, reload] = useLoad(async () => {
    const hs = await listHospitals(exchange);
    return Promise.all(hs.map(async (h) => ({ ...h, issuerKey: await exchange.hospitalIssuerKey(h.address) })));
  }, []);
  const [gateway, reloadGateway] = useLoad(() => exchange.gateway(), []);
  const [systemStatus, reloadStatus] = useLoad(() => api.adminStatus().catch(() => null), []);
  const [form, setForm] = useState({ address: "", name: "", ax: "", ay: "" });
  const [newGateway, setNewGateway] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value.trim() }));

  const autofillDemoHospital = () => {
    setForm({
      address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
      name: "City General Hospital",
      ax: "5976787833345688406011467393978316450970937938661523568145160620800090585081",
      ay: "12391355364387553119300753264852232839569616736365099487113787892246083915674",
    });
    toast("Auto-filled City General Hospital credentials & EdDSA keys!");
  };

  const [register, registering] = useAction(async () => {
    if (!form.address || !form.name || !form.ax || !form.ay) {
      throw new Error("Enter Hospital Address, Name, Ax, and Ay keys.");
    }
    if (!ethers.isAddress(form.address)) {
      throw new Error("Invalid Hospital Wallet Address. Must be a valid 42-character Ethereum address (e.g. 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65).");
    }
    const tx = await exchange.registerHospital(form.address, form.name, form.ax, form.ay);
    await tx.wait();
    setForm({ address: "", name: "", ax: "", ay: "" });
    reload();
    reloadStatus();
  }, "Hospital registered on-chain & EdDSA key trusted!");

  const [revoke, revoking] = useAction(async (h) => {
    if (!confirm(`Stop trusting credentials signed by ${h.name}?`)) return;
    const tx = await exchange.revokeIssuerKey(h.address);
    await tx.wait();
    reload();
    reloadStatus();
  }, "Signing key revoked.");

  const [setGw, settingGw] = useAction(async () => {
    const tx = await exchange.setGateway(newGateway);
    await tx.wait();
    setNewGateway("");
    reloadGateway();
    reloadStatus();
  }, "Gateway updated.");

  const [sweep, sweeping] = useAction(async () => {
    const res = await api.sweepPending();
    toast(`🧹 Cleaned up ${res.removedCount || 0} orphaned uploads.`);
    reloadStatus();
  });

  return (
    <div className="stack">
      <header className="page-head">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h1>Network Administration</h1>
            <p>Manage trusted hospitals, register EdDSA BabyJubJub signing keys, and configure gateway addresses.</p>
          </div>
          <Button variant="quiet" busy={sweeping} onClick={sweep} style={{ fontSize: "0.85rem" }}>
            🧹 Sweep Orphaned Uploads
          </Button>
        </div>
      </header>

      <div className="metrics-grid">
        <div className="metric-card">
          <span className="metric-title">Registered Hospitals</span>
          <span className="metric-value">{hospitals?.length ?? 0}</span>
          <span className="metric-sub">On-Chain Whitelisted</span>
        </div>
        <div className="metric-card">
          <span className="metric-title">Gateway Balance</span>
          <span className="metric-value" style={{ fontSize: "1.4rem", color: systemStatus?.gateway?.balanceEth < 0.1 ? "var(--accent-red)" : "var(--accent-teal)" }}>
            {systemStatus?.gateway?.balanceEth !== undefined ? `${systemStatus.gateway.balanceEth.toFixed(3)} ETH` : "Checking..."}
          </span>
          <span className="metric-sub">{systemStatus?.gateway?.matches ? "🟢 Gateway Synced" : "Relay Wallet"}</span>
        </div>
        <div className="metric-card">
          <span className="metric-title">Smart Contract</span>
          <span className="metric-value" style={{ color: "var(--accent-teal)" }}>MedicalDataExchange</span>
          <span className="metric-sub">Solidity v0.8.24</span>
        </div>
        <div className="metric-card">
          <span className="metric-title">Network Block</span>
          <span className="metric-value" style={{ color: "var(--accent-violet)" }}>#{systemStatus?.chain?.blockNumber ?? deployment.chainId}</span>
          <span className="metric-sub">Chain ID {deployment.chainId}</span>
        </div>
      </div>

      {systemStatus ? (
        <Panel title="Live Operational & Cluster Metrics">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))", gap: "1rem" }}>
            <div style={{ padding: "1rem", background: "#f8fafc", borderRadius: "var(--r-sm)", border: "1px solid var(--line)" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", fontWeight: "700" }}>Platform Participants</span>
              <div style={{ marginTop: "0.4rem", fontSize: "0.9rem", color: "var(--ink)", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                <div>👤 Patients: <strong>{systemStatus.participants.patients}</strong></div>
                <div>🩺 Doctors: <strong>{systemStatus.participants.doctors}</strong></div>
                <div>🏥 Hospitals: <strong>{systemStatus.participants.hospitals}</strong></div>
              </div>
            </div>

            <div style={{ padding: "1rem", background: "#f8fafc", borderRadius: "var(--r-sm)", border: "1px solid var(--line)" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", fontWeight: "700" }}>Audit Totals</span>
              <div style={{ marginTop: "0.4rem", fontSize: "0.9rem", color: "var(--ink)", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                <div>📁 Encrypted Records: <strong>{systemStatus.totals.records}</strong></div>
                <div>🔑 Active Access Requests: <strong>{systemStatus.totals.accessRequests}</strong></div>
                <div>🛡️ ZK Proofs Verified: <strong>{systemStatus.totals.verifications}</strong></div>
              </div>
            </div>

            <div style={{ padding: "1rem", background: "#f8fafc", borderRadius: "var(--r-sm)", border: "1px solid var(--line)" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", fontWeight: "700" }}>System Health</span>
              <div style={{ marginTop: "0.4rem", fontSize: "0.9rem", color: "var(--ink)", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                <div>🗄️ Database: <strong style={{ color: "var(--accent-teal)" }}>Connected</strong></div>
                <div>⚡ Backend Uptime: <strong>{Math.floor(systemStatus.api.uptimeSeconds / 60)} min</strong></div>
                <div>🧠 Memory: <strong>{systemStatus.api.memoryMb} MB</strong></div>
              </div>
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel title="Register New Hospital">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <p className="muted" style={{ margin: 0 }}>Register a hospital's wallet address and EdDSA BabyJubJub signing key on the blockchain.</p>
          <Button variant="quiet" onClick={autofillDemoHospital} style={{ borderColor: "var(--accent-teal)", color: "var(--accent-teal)" }}>
            ⚡ 1-Click Auto-Fill Demo Hospital
          </Button>
        </div>

        <form className="form" onSubmit={(e) => { e.preventDefault(); register(); }}>
          <div className="form-grid">
            <Field label="Hospital Wallet Address">
              <input type="text" placeholder="0x..." value={form.address} onChange={set("address")} />
            </Field>
            <Field label="Hospital Display Name">
              <input type="text" placeholder="e.g. City General Hospital" value={form.name} onChange={set("name")} />
            </Field>
            <Field label="Signing Key Ax (EdDSA)">
              <input type="text" placeholder="59767..." value={form.ax} onChange={set("ax")} />
            </Field>
            <Field label="Signing Key Ay (EdDSA)">
              <input type="text" placeholder="12391..." value={form.ay} onChange={set("ay")} />
            </Field>
          </div>
          <div className="row row-end" style={{ marginTop: "1rem" }}>
            <Button busy={registering} type="submit">Register Hospital & Key On-Chain</Button>
          </div>
        </form>
      </Panel>

      <Panel title={`Trusted Hospitals (${hospitals?.length || 0})`}>
        {!hospitals ? (
          <p className="muted">Loading hospitals...</p>
        ) : !hospitals.length ? (
          <Empty>No hospitals registered on-chain yet. Click '1-Click Auto-Fill Demo Hospital' above to register your first hospital!</Empty>
        ) : (
          <ul className="list">
            {hospitals.map((h) => (
              <li key={h.address} className="item">
                <div className="item-main">
                  <strong>{h.name}</strong>
                  <span className="muted"><Address value={h.address} /></span>
                </div>
                <div className="item-side">
                  <Pill tone="ok">Trusted Issuer</Pill>
                  <Button variant="danger" busy={revoking} onClick={() => revoke(h)}>Revoke</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="System Gateway Configuration">
        <div className="form-inline">
          <Field label="Current Gateway">
            <input type="text" value={gateway || ""} readOnly />
          </Field>
          <Field label="New Gateway Address">
            <input type="text" placeholder="0x..." value={newGateway} onChange={(e) => setNewGateway(e.target.value.trim())} />
          </Field>
          <Button busy={settingGw} onClick={setGw}>Update Gateway</Button>
        </div>
      </Panel>
    </div>
  );
}
