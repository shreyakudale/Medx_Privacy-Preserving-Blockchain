import { useState } from "react";
import { useSession, useAction, Button, Field, Panel, Address, useToast } from "../components/ui.jsx";
import { generateKeyPair } from "../lib/crypto.js";
import { useLoad, listHospitals } from "../lib/hooks.js";
import { api } from "../lib/api.js";
import { readParticipant, Role, RoleName } from "../lib/chain.js";

const DOCTOR_SPECIALTIES = [
  "General Practitioner / Primary Care",
  "Cardiologist / Heart Specialist",
  "Radiologist & Imaging Specialist",
  "Emergency ER Physician",
  "Surgeon & Critical Care",
  "Neurologist & Brain Specialist",
];

const HOSPITAL_TYPES = [
  "General Multi-Specialty Hospital",
  "Emergency Trauma & Surgical Center",
  "Diagnostic & Clinical Research Lab",
  "Children's & Pediatric Healthcare Network",
];

export default function Onboarding({ onRegistered }) {
  const { exchange, address } = useSession();
  const [role, setRole] = useState("patient");
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState(DOCTOR_SPECIALTIES[0]);
  const [hospitalType, setHospitalType] = useState(HOSPITAL_TYPES[0]);
  const [hospital, setHospital] = useState("");
  const [hospitals] = useLoad(() => listHospitals(exchange), [exchange]);
  const [issuer, setIssuer] = useState(null);
  const toast = useToast();

  const [register, busy] = useAction(async () => {
    if (!name.trim()) throw new Error(role === "patient" ? "Enter a display name or pseudonym." : "Enter your full name.");
    
    // Check if current user is already registered on-chain
    const me = await readParticipant(exchange, address);
    if (me.role !== Role.None) {
      throw new Error(`Your wallet address is already registered on-chain as a ${RoleName[me.role]}. To register a new role, switch to a different account in MetaMask (e.g. Account 1 for Doctor, Account 2 for Patient).`);
    }

    if (role === "doctor") {
      if (!hospital) throw new Error("Please select an affiliated hospital from the dropdown.");
      const hospPart = await readParticipant(exchange, hospital);
      if (hospPart.role !== Role.Hospital) {
        throw new Error("The selected hospital has not been registered on-chain by the System Admin yet. Please switch to Account 0 (Admin) and click '1-Click Auto-Fill Demo Hospital' first!");
      }
    }

    const publicKey = await generateKeyPair(address);
    const fullNameWithRole = role === "doctor" ? `${name.trim()} (${specialty})` : name.trim();
    
    const tx =
      role === "patient"
        ? await exchange.registerPatient(fullNameWithRole, publicKey)
        : await exchange.registerDoctor(fullNameWithRole, publicKey, hospital);
    await tx.wait();

    // Save profile to MongoDB
    await api.nonce(address).catch(() => {});
    await onRegistered();
  }, "Registered. Your encryption key was created on this device.");

  const [getIssuerKey, issuerBusy] = useAction(async () => {
    if (!name.trim()) throw new Error("Enter your Hospital Name first.");
    const keyData = await api.issuerKey();
    setIssuer(keyData);
    toast("Hospital EdDSA signing keys generated & saved to MongoDB!");
  });

  const copyHospitalDetails = () => {
    if (!issuer) return;
    const text = `Hospital Name: ${name || "City General Hospital"} (${hospitalType})\nWallet Address: ${address}\nSigning Key Ax: ${issuer.ax}\nSigning Key Ay: ${issuer.ay}`;
    navigator.clipboard?.writeText(text);
    toast("Hospital registration details copied to clipboard!");
  };

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Set Up Your Account</h1>
        <p>Choose your role and medical specialty. Access permissions are granularly assigned based on your registered role.</p>
      </header>

      <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center', margin: '2rem 0', flexWrap: 'wrap' }} role="radiogroup" aria-label="Account type">
        {[
          ["patient", "Patient", "Upload records and control granular access grants.", "#0c0d12"],
          ["doctor", "Doctor", "Request access based on medical specialty role.", "#0c0d12"],
          ["hospital", "Hospital", "Verify doctors, department credentials & emergency access.", "#0c0d12"],
        ].map(([id, label, text]) => (
          <button
            key={id}
            role="radio"
            aria-checked={role === id}
            style={{
              flex: '1', minWidth: '240px', padding: '2rem 1.5rem', borderRadius: 'var(--r-md)',
              border: role === id ? `2px solid var(--accent-cyan)` : '1px solid var(--line)',
              background: role === id ? 'rgba(6, 182, 212, 0.08)' : 'var(--surface)',
              color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.8rem',
              boxShadow: role === id ? `0 0 20px rgba(6, 182, 212, 0.2)` : 'none', transition: 'all 0.2s ease', cursor: 'pointer', textAlign: 'center'
            }}
            onClick={() => setRole(id)}
          >
            <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '2rem' }}>
              {id === 'patient' ? '👤' : id === 'doctor' ? '🩺' : '🏥'}
            </div>
            <strong style={{ fontSize: '1.3rem', fontWeight: 700 }}>{label}</strong>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{text}</span>
            <div style={{ marginTop: 'auto', color: role === id ? 'var(--accent-cyan)' : 'var(--muted)', fontSize: '1.2rem' }}>➔</div>
          </button>
        ))}
      </div>

      {role === "hospital" ? (
        <Panel title="Hospital Node Registration">
          <p>Hospitals are registered on-chain by the Network Admin. Generate your EdDSA signing keys below and select your hospital organization type.</p>
          
          <div className="form" style={{ marginTop: "1rem" }}>
            <Field label="Hospital Official Name">
              <input type="text" placeholder="e.g. City General Hospital" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>

            <Field label="Hospital Department / Organization Type">
              <select value={hospitalType} onChange={(e) => setHospitalType(e.target.value)}>
                {HOSPITAL_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>

            {issuer ? (
              <div style={{ padding: "1.2rem", background: "rgba(6, 182, 212, 0.05)", borderRadius: "var(--r-sm)", border: "1px solid rgba(6, 182, 212, 0.2)", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ color: "var(--accent-cyan)" }}>✅ Generated EdDSA Credential Signing Key</strong>
                  <Button variant="quiet" onClick={copyHospitalDetails}>📋 Copy Registration Data</Button>
                </div>
                <dl className="kv" style={{ margin: "0.5rem 0 0" }}>
                  <dt>Hospital Name</dt><dd><strong style={{ color: "#fff" }}>{name || "City General Hospital"} ({hospitalType})</strong></dd>
                  <dt>Wallet Address</dt><dd><code>{address}</code></dd>
                  <dt>Signing Key Ax</dt><dd><code style={{ wordBreak: "break-all" }}>{issuer.ax}</code></dd>
                  <dt>Signing Key Ay</dt><dd><code style={{ wordBreak: "break-all" }}>{issuer.ay}</code></dd>
                </dl>
                <p className="fine" style={{ color: "var(--accent-amber)", marginTop: "0.5rem" }}>
                  Your request is saved in MongoDB. The Network Admin can now register your hospital on-chain in 1 click!
                </p>
              </div>
            ) : (
              <Button busy={issuerBusy} disabled={!name.trim()} onClick={getIssuerKey}>
                🔑 Generate Signing Keys & Request Registration
              </Button>
            )}
          </div>
        </Panel>
      ) : (
        <Panel title={`Register as ${role === "patient" ? "Patient" : "Doctor"}`}>
          <div className="form">
            <Field
              label={role === "patient" ? "Display Name / Pseudonym" : "Full Name & Title"}
              hint={role === "patient" ? "Stored on a public blockchain. A pseudonym is safer than your real name." : undefined}
            >
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={role === "patient" ? "e.g. Dhiraj Shinde" : "e.g. Dr. Sarah Smith"} />
            </Field>

            {role === "doctor" ? (
              <>
                <Field label="Medical Specialty / Doctor Access Role">
                  <select value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
                    {DOCTOR_SPECIALTIES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Select Affiliated Hospital" hint="This hospital must be registered on-chain by the Admin before you can register under it.">
                  <select value={hospital} onChange={(e) => setHospital(e.target.value)}>
                    <option value="">-- Choose Hospital --</option>
                    {(hospitals || []).map((h) => (
                      <option key={h.address} value={h.address}>{h.name} ({h.address.slice(0, 10)}...)</option>
                    ))}
                  </select>
                </Field>
              </>
            ) : null}

            <p className="fine">
              Registering creates an RSA encryption keypair in your browser. Patients grant access selectively based on doctor specialty roles.
            </p>
            
            <Button busy={busy} disabled={role === "doctor" && !hospital} onClick={register}>
              Register Account as {role}
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
