import { useState, useEffect } from "react";
import { useSession, useAction, Button, Field, Panel, Address, useToast } from "../components/ui.jsx";
import { generateKeyPair } from "../lib/crypto.js";
import { useLoad, listHospitals } from "../lib/hooks.js";
import { api } from "../lib/api.js";
import { readParticipant, Role, RoleName, fundAccount } from "../lib/chain.js";
import { ethers } from "ethers";

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
  const { exchange, address, provider } = useSession();
  const [role, setRole] = useState("patient");
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState(DOCTOR_SPECIALTIES[0]);
  const [hospitalType, setHospitalType] = useState(HOSPITAL_TYPES[0]);
  const [hospital, setHospital] = useState("");
  const [hospitals] = useLoad(() => listHospitals(exchange), [exchange]);
  const [issuer, setIssuer] = useState(null);
  const [balance, setBalance] = useState(null);
  const toast = useToast();

  const checkBalance = async () => {
    if (!address) return;
    try {
      if (provider) {
        const bal = await provider.getBalance(address);
        setBalance(Number(ethers.formatEther(bal)));
      } else {
        const p = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
        const bal = await p.getBalance(address);
        setBalance(Number(ethers.formatEther(bal)));
      }
    } catch (e) {
      console.warn("Could not fetch balance:", e);
    }
  };

  useEffect(() => {
    checkBalance();
    const timer = setInterval(checkBalance, 5000);
    return () => clearInterval(timer);
  }, [address, provider]);

  const topUpTestEth = async () => {
    if (!address) return;
    try {
      await fundAccount(address);
      await checkBalance();
      toast("🚰 Added 100 Test ETH to your wallet for gas fees!");
    } catch (e) {
      toast("Could not fund account: " + (e.message || String(e)), "error");
    }
  };

  const [register, busy] = useAction(async () => {
    if (!name.trim()) throw new Error(role === "patient" ? "Enter a display name or pseudonym." : "Enter your full name.");
    
    // Auto-topup if balance is 0 or less than 0.1 ETH to prevent gas error
    if (balance !== null && balance < 0.1) {
      await fundAccount(address);
    }

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

      <div style={{ display: 'flex', gap: '1.25rem', justifyContent: 'center', margin: '1.5rem 0', flexWrap: 'wrap' }} role="radiogroup" aria-label="Account type">
        {[
          ["patient", "Patient", "Upload records and control granular access grants."],
          ["doctor", "Doctor", "Request access based on medical specialty role."],
          ["hospital", "Hospital", "Verify doctors, department credentials & emergency access."],
        ].map(([id, label, text]) => (
          <button
            key={id}
            role="radio"
            aria-checked={role === id}
            style={{
              flex: '1', minWidth: '220px', padding: '1.8rem 1.4rem', borderRadius: 'var(--r-md)',
              border: role === id ? '2px solid var(--accent-cyan)' : '1px solid var(--line)',
              background: role === id ? '#f0f9ff' : '#ffffff',
              color: 'var(--ink)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem',
              boxShadow: role === id ? '0 4px 15px rgba(2, 132, 199, 0.15)' : 'var(--shadow-sm)',
              transition: 'all 0.2s ease', cursor: 'pointer', textAlign: 'center'
            }}
            onClick={() => setRole(id)}
          >
            <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: role === id ? '#e0f2fe' : '#f1f5f9', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '1.8rem' }}>
              {id === 'patient' ? '👤' : id === 'doctor' ? '🩺' : '🏥'}
            </div>
            <strong style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' }}>{label}</strong>
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.4 }}>{text}</span>
            <div style={{ marginTop: 'auto', color: role === id ? 'var(--accent-cyan)' : 'var(--muted)', fontSize: '1.1rem', fontWeight: 'bold' }}>➔</div>
          </button>
        ))}
      </div>

      {/* Gas balance notice & auto-funder */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.85rem 1.2rem", background: "#ffffff", borderRadius: "var(--r-sm)", border: "1px solid var(--line)", boxShadow: "var(--shadow-sm)" }}>
        <div>
          <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", fontWeight: "700", letterSpacing: "0.8px" }}>Wallet Balance (Hardhat Local)</span>
          <div style={{ fontSize: "1.05rem", fontWeight: "700", color: balance !== null && balance < 0.1 ? "var(--accent-red)" : "var(--accent-teal)" }}>
            {balance !== null ? `${balance.toFixed(4)} ETH` : "Checking balance..."}
          </div>
        </div>
        <Button variant="quiet" onClick={topUpTestEth} style={{ fontSize: "0.84rem", padding: "0.45rem 0.95rem", borderColor: "var(--accent-cyan)", color: "var(--accent-cyan)" }}>
          🚰 Top Up 100 Test ETH
        </Button>
      </div>

      {role === "hospital" ? (
        <Panel title="Hospital Node Registration">
          <p className="muted">Hospitals are registered on-chain by the Network Admin. Generate your EdDSA signing keys below and select your hospital organization type.</p>
          
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
              <div style={{ padding: "1.2rem", background: "#f0fdfa", borderRadius: "var(--r-sm)", border: "1px solid #99f6e4", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ color: "var(--accent-teal)" }}>✅ Generated EdDSA Credential Signing Key</strong>
                  <Button variant="quiet" onClick={copyHospitalDetails}>📋 Copy Registration Data</Button>
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--ink)", display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.4rem" }}>
                  <div><strong>Hospital:</strong> {name || "City General Hospital"} ({hospitalType})</div>
                  <div><strong>Wallet:</strong> <code>{address}</code></div>
                  <div><strong>Signing Key Ax:</strong> <code style={{ wordBreak: "break-all" }}>{issuer.ax}</code></div>
                  <div><strong>Signing Key Ay:</strong> <code style={{ wordBreak: "break-all" }}>{issuer.ay}</code></div>
                </div>
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
