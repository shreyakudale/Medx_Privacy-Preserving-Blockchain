import { useEffect, useState } from "react";
import { useSession, useAction, Button, Field, Panel, useToast } from "../components/ui.jsx";
import { generateKeyPair } from "../lib/crypto.js";
import { useLoad, listHospitals } from "../lib/hooks.js";
import { api } from "../lib/api.js";

export default function Onboarding({ onRegistered }) {
  const { exchange, address } = useSession();
  const toast = useToast();
  const [role, setRole] = useState("patient");
  const [name, setName] = useState("");
  const [hospital, setHospital] = useState("");
  const [hospitals] = useLoad(() => listHospitals(exchange), [exchange]);
  const [issuer, setIssuer] = useState(null);

  // If the account was already registered on-chain, automatically transition to role dashboard
  useEffect(() => {
    let active = true;
    exchange.participants(address).then((p) => {
      if (active && Number(p.role) !== 0) {
        onRegistered();
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [exchange, address, onRegistered]);

  const [register, busy] = useAction(async () => {
    const current = await exchange.participants(address);
    if (Number(current.role) !== 0) {
      toast("This account is already registered on-chain! Opening your dashboard...", "ok");
      await onRegistered();
      return;
    }

    if (!name.trim())
      throw new Error(
        role === "patient" ? "Enter a display pseudonym or alias." : "Enter your full legal name."
      );
    const publicKey = await generateKeyPair(address);
    try {
      const tx =
        role === "patient"
          ? await exchange.registerPatient(name.trim(), publicKey)
          : await exchange.registerDoctor(name.trim(), publicKey, hospital);
      await tx.wait();
    } catch (err) {
      if (err?.revert?.name === "AlreadyRegistered" || /already registered/i.test(err?.message || "")) {
        toast("This account is already registered on-chain. Loading your dashboard...", "ok");
        await onRegistered();
        return;
      }
      throw err;
    }
    await onRegistered();
  }, "Registered successfully! Your encryption keypair was generated locally.");

  const [getIssuerKey, issuerBusy] = useAction(async () => setIssuer(await api.issuerKey()));

  return (
    <div className="view-stack">
      <div className="dashboard-hero">
        <div className="dashboard-hero-text">
          <span className="hero-eyebrow">IDENTITY INITIALIZATION</span>
          <h1 className="hero-headline">Create Your MedZK Identity</h1>
          <p className="hero-subtext">
            Choose your network role. Your public key is registered on the blockchain to enable
            client-side key exchange, while your private key never leaves this browser.
          </p>
        </div>
      </div>

      <div className="onboarding-role-grid">
        {[
          {
            id: "patient",
            title: "Patient",
            icon: "👤",
            badge: "Full Data Ownership",
            desc: "Store and encrypt medical records in your browser. Grant time-limited access and generate zero-knowledge proofs.",
          },
          {
            id: "doctor",
            title: "Doctor",
            icon: "🩺",
            badge: "Clinical Access",
            desc: "Request time-limited consent to view patient records. Affiliated and verified by your registered hospital.",
          },
          {
            id: "hospital",
            title: "Hospital",
            icon: "🏥",
            badge: "Institutional Authority",
            desc: "Authorize doctors, issue EdDSA ZK credentials, and activate break-glass emergency access under audit.",
          },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            className={`role-select-card ${role === item.id ? "role-card-selected" : ""}`}
            onClick={() => setRole(item.id)}
          >
            <div className="role-card-header">
              <span className="role-card-icon">{item.icon}</span>
              <span className="role-card-badge">{item.badge}</span>
            </div>
            <strong className="role-card-title">{item.title}</strong>
            <p className="role-card-desc">{item.desc}</p>
          </button>
        ))}
      </div>

      {role === "hospital" ? (
        <Panel
          title="Hospital Institutional Enrollment"
          subtitle="Hospitals are vetted and registered on-chain by the network administrator"
          icon="🏥"
        >
          <p className="panel-sub">
            To register your hospital, create a credential-signing key below and provide the
            resulting public key parameters (Ax, Ay) along with your wallet address to the network
            admin.
          </p>

          {issuer ? (
            <div className="hospital-keys-result">
              <h4 className="subhead-small">Your Generated Signing Key (Submit to Admin):</h4>
              <div className="key-vals-grid">
                <div>
                  <span className="key-val-label">Wallet Address:</span>
                  <code className="key-val-code">{address}</code>
                </div>
                <div>
                  <span className="key-val-label">Signing Key Ax:</span>
                  <code className="key-val-code">{issuer.ax}</code>
                </div>
                <div>
                  <span className="key-val-label">Signing Key Ay:</span>
                  <code className="key-val-code">{issuer.ay}</code>
                </div>
              </div>
            </div>
          ) : (
            <div className="panel-actions-row">
              <Button busy={issuerBusy} onClick={getIssuerKey} variant="primary" icon="🔑">
                Generate Credential-Signing Key
              </Button>
            </div>
          )}
        </Panel>
      ) : (
        <Panel
          title={`Register as ${role === "patient" ? "Patient" : "Doctor"}`}
          subtitle="Generates an RSA-OAEP 2048-bit encryption keypair inside your browser"
          icon="🔒"
        >
          <div className="onboarding-form">
            <Field
              label={role === "patient" ? "Display Pseudonym / Alias" : "Legal Practitioner Name"}
              hint={
                role === "patient"
                  ? "Recorded publicly on Ethereum. A pseudonym protects your identity from surveillance."
                  : "Must match your hospital credential records."
              }
              required
            >
              <input
                className="input-text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={role === "patient" ? "e.g. Satoshi-Health-21" : "e.g. Dr. Jane Doe"}
                maxLength={60}
              />
            </Field>

            {role === "doctor" ? (
              <Field
                label="Affiliated Hospital"
                hint="Your hospital administrator must verify your account before you can request records."
                required
              >
                <select
                  className="input-select"
                  value={hospital}
                  onChange={(e) => setHospital(e.target.value)}
                >
                  <option value="">Select a registered hospital...</option>
                  {(hospitals || []).map((h) => (
                    <option key={h.address} value={h.address}>
                      {h.name} ({h.address.slice(0, 8)}...)
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            <div className="onboarding-security-note">
              <span className="note-icon">🛡️</span>
              <p>
                A high-entropy RSA-OAEP encryption keypair will be created directly on this device.
                Only the public key is broadcasted to the contract.
              </p>
            </div>

            <div className="panel-actions-row">
              <Button
                busy={busy}
                disabled={role === "doctor" && !hospital}
                onClick={register}
                variant="primary"
                icon="🚀"
              >
                Complete Registration on Blockchain
              </Button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
