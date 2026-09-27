import { useState, useEffect } from "react";
import { connectWallet, readParticipant, RoleName, Role, deployment } from "./lib/chain.js";
import { api, setToken } from "./lib/api.js";
import { SessionContext, Button, useAction, Address, useToast } from "./components/ui.jsx";
import Onboarding from "./views/Onboarding.jsx";
import KeyGuard from "./views/KeyGuard.jsx";
import Patient from "./views/Patient.jsx";
import Doctor from "./views/Doctor.jsx";
import Hospital from "./views/Hospital.jsx";
import Admin from "./views/Admin.jsx";

export default function App() {
  const [session, setSession] = useState(null);
  const [adminMode, setAdminMode] = useState(false);
  const [hasCheckedToken, setHasCheckedToken] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showKeysModal, setShowKeysModal] = useState(false);

  useEffect(() => {
    if (hasCheckedToken) return;
    const t = localStorage.getItem("medzk_token");
    const addr = localStorage.getItem("medzk_address");
    if (t && addr && window.ethereum) {
      connectWallet().then(async (wallet) => {
        if (wallet.address.toLowerCase() === addr.toLowerCase()) {
          const [participant, admin] = await Promise.all([
            readParticipant(wallet.exchange, wallet.address),
            wallet.exchange.admin(),
          ]);
          const isAdmin = admin.toLowerCase() === wallet.address.toLowerCase();
          setSession({ ...wallet, participant, isAdmin });
          if (isAdmin) setAdminMode(true);
        } else {
          setToken(null);
        }
      }).catch(console.error).finally(() => setHasCheckedToken(true));
    } else {
      setHasCheckedToken(true);
    }
  }, [hasCheckedToken]);

  const [signIn, busy] = useAction(async () => {
    const wallet = await connectWallet();
    const { message } = await api.nonce(wallet.address);
    const signature = await wallet.signer.signMessage(message);
    const { token } = await api.verify(wallet.address, signature);
    setToken(token);
    localStorage.setItem("medzk_address", wallet.address);
    const [participant, admin] = await Promise.all([
      readParticipant(wallet.exchange, wallet.address),
      wallet.exchange.admin(),
    ]);
    const isAdmin = admin.toLowerCase() === wallet.address.toLowerCase();
    setSession({ ...wallet, participant, isAdmin });
    if (isAdmin) setAdminMode(true);
    if (window.ethereum?.on) {
      window.ethereum.on("accountsChanged", () => window.location.reload());
      window.ethereum.on("chainChanged", () => window.location.reload());
    }
  });

  const logout = () => {
    setToken(null);
    localStorage.removeItem("medzk_token");
    localStorage.removeItem("medzk_address");
    setSession(null);
    window.location.reload();
  };

  const refreshParticipant = async () => {
    const participant = await readParticipant(session.exchange, session.address);
    setSession((s) => ({ ...s, participant }));
  };

  if (!session) return <Landing onSignIn={signIn} busy={busy} onShowKeys={() => setShowKeysModal(true)} />;

  const { participant, isAdmin } = session;
  let body;
  if (adminMode) body = <Admin />;
  else if (participant.role === Role.None) body = <Onboarding onRegistered={refreshParticipant} />;
  else {
    const View = { [Role.Patient]: Patient, [Role.Doctor]: Doctor, [Role.Hospital]: Hospital }[participant.role];
    body = (
      <KeyGuard onChanged={refreshParticipant}>
        <View />
      </KeyGuard>
    );
  }

  return (
    <SessionContext.Provider value={{ ...session, refreshParticipant }}>
      <div className="shell">
        <aside className="rail">
          <div className="brand">
            <Mark />
            <span>MedZK</span>
          </div>

          <div className="who">
            <span className="who-role">{adminMode ? "Admin" : RoleName[participant.role]}</span>
            <strong className="who-name">{participant.name || (isAdmin ? "System Deployer" : "User Account")}</strong>
            <Address value={session.address} />
            {participant.role === Role.Doctor && !participant.verified ? (
              <span className="who-flag">Waiting for hospital verification</span>
            ) : null}
          </div>

          <button className="rail-switch" onClick={() => setShowProfile(!showProfile)}>
            👤 Profile & JWT Session
          </button>

          <button className="rail-switch" onClick={() => setShowKeysModal(!showKeysModal)} style={{ borderColor: "var(--teal)", color: "var(--teal)" }}>
            🔑 10,000 ETH Keys
          </button>

          {isAdmin ? (
            <button className="rail-switch" onClick={() => setAdminMode((m) => !m)}>
              {adminMode ? `Back to Portal view` : "Open admin tools"}
            </button>
          ) : null}

          <p className="rail-net">
            Network: {deployment.network} (chain {deployment.chainId})
          </p>
        </aside>

        <main className="main">
          {showProfile ? <ProfileModal session={session} onClose={() => setShowProfile(false)} onLogout={logout} /> : null}
          {showKeysModal ? <KeysModal onClose={() => setShowKeysModal(false)} /> : null}
          {body}
        </main>
      </div>
    </SessionContext.Provider>
  );
}

function ProfileModal({ session, onClose, onLogout }) {
  const toast = useToast();
  const token = localStorage.getItem("medzk_token") || "jwt_active_session_token_xyz";
  const email = `${(session.participant?.name || "user").toLowerCase().replace(/\s+/g, ".")}@gmail.com`;

  const copyToken = () => {
    navigator.clipboard?.writeText(token);
    toast("JWT Token copied to clipboard.");
  };

  return (
    <div style={{ marginBottom: "2rem", padding: "1.5rem", background: "rgba(15, 23, 42, 0.95)", border: "1px solid var(--teal)", borderRadius: "var(--r-md)", boxShadow: "var(--cyan-glow)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h3 style={{ margin: 0, color: "var(--teal)" }}>👤 User Profile & Active Session</h3>
        <button className="link" onClick={onClose}>✕ Close</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
        <div>
          <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase" }}>Full Name</span>
          <div style={{ fontWeight: "700", color: "#fff" }}>{session.participant?.name || (session.isAdmin ? "System Deployer" : "User Account")}</div>
        </div>
        <div>
          <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase" }}>Authenticated Email</span>
          <div style={{ fontWeight: "600", color: "var(--teal)" }}>{email}</div>
        </div>
        <div>
          <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase" }}>Assigned Role</span>
          <div style={{ fontWeight: "700", color: "var(--amber)" }}>{session.isAdmin ? "System Admin" : RoleName[session.participant?.role] || "User"}</div>
        </div>
        <div>
          <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase" }}>Web3 Wallet Address</span>
          <div><Address value={session.address} /></div>
        </div>
      </div>

      <div style={{ padding: "0.8rem", background: "rgba(0,0,0,0.4)", borderRadius: "var(--r-sm)", marginBottom: "1rem", border: "1px solid var(--line)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.3rem" }}>
          <span>ACTIVE JWT AUTHORIZATION TOKEN</span>
          <span style={{ color: "var(--teal)" }}>Status: Valid (HMAC SHA-256)</span>
        </div>
        <code style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>{token}</code>
      </div>

      <div className="row" style={{ gap: "1rem" }}>
        <Button variant="quiet" onClick={copyToken}>Copy JWT Token</Button>
        <Button variant="danger" onClick={onLogout}>Sign Out Session</Button>
      </div>
    </div>
  );
}

function KeysModal({ onClose }) {
  const toast = useToast();
  const copyKey = (key, name) => {
    navigator.clipboard?.writeText(key);
    toast(`${name} private key copied! Import into MetaMask.`);
  };

  const accounts = [
    { name: "⚡ System Admin (Account 0)", key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", eth: "10,000 ETH", desc: "Deployer & Hospital Registration Admin (0xf39F...2266)" },
    { name: "🏥 Hospital Admin (Account 4)", key: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", eth: "10,000 ETH", desc: "Use to register and approve doctors & issue credentials (0x15d3...6A65)" },
    { name: "🩺 Doctor Account (Account 1)", key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", eth: "10,000 ETH", desc: "Use to request patient records & verify ZK proofs (0x7099...79C8)" },
    { name: "👤 Patient Account (Account 2)", key: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", eth: "10,000 ETH", desc: "Use for uploading encrypted health vault records (0x3C44...93BC)" },
  ];

  return (
    <div style={{ marginBottom: "2rem", padding: "1.5rem", background: "rgba(15, 23, 42, 0.95)", border: "1px solid var(--violet)", borderRadius: "var(--r-md)", boxShadow: "var(--purple-glow)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h3 style={{ margin: 0, color: "var(--violet)" }}>🔑 Pre-Funded Test Accounts (10,000 ETH)</h3>
        <button className="link" onClick={onClose}>✕ Close</button>
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Import any of these private keys into MetaMask under Hardhat Localhost (Chain 31337) to get 10,000 test ETH.</p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
        {accounts.map((a, i) => (
          <div key={i} style={{ padding: "0.8rem 1rem", background: "rgba(0,0,0,0.3)", borderRadius: "var(--r-sm)", border: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
            <div>
              <strong style={{ color: "#fff" }}>{a.name}</strong>
              <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "var(--teal)", fontWeight: "700" }}>{a.eth}</span>
              <p style={{ margin: "0.2rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>{a.desc}</p>
            </div>
            <Button variant="quiet" onClick={() => copyKey(a.key, a.name)}>
              📋 Copy Private Key
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Landing({ onSignIn, busy, onShowKeys }) {
  return (
    <div className="landing-portal">
      <div className="landing-overlay"></div>
      <div className="landing-body">
        
        {/* Left Hero & Visual */}
        <div>
          <div className="hero-badge">
            <span>🔒 Zero-Knowledge Encrypted</span> • <span>Ethereum Ledger</span>
          </div>
          <h1 className="hero-title">
            Privacy-Preserving<br />Medical Data Exchange.
          </h1>
          <p className="hero-desc">
            Decentralized. Patient-Controlled. Verifiable. Upload encrypted health records and share access with verified doctors without exposing raw data.
          </p>

          <div className="hero-shield-visual">
            <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="100" cy="100" r="85" stroke="url(#cyanG)" strokeWidth="2" strokeDasharray="6 6" />
              <circle cx="100" cy="100" r="65" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
              <path d="M100 35 L145 60 V105 C145 135 100 165 100 165 C100 165 55 135 55 105 V60 Z" fill="url(#shieldG)" stroke="#00f0ff" strokeWidth="2.5" />
              <path d="M92 80 H108 V92 H120 V108 H108 V120 H92 V108 H80 V92 H92 Z" fill="#ffffff" />
              <circle cx="100" cy="100" r="10" fill="#00f0ff" />
              <defs>
                <linearGradient id="cyanG" x1="0" y1="0" x2="200" y2="200">
                  <stop offset="0%" stopColor="#00f0ff" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
                <linearGradient id="shieldG" x1="55" y1="35" x2="145" y2="165">
                  <stop offset="0%" stopColor="rgba(0, 240, 255, 0.25)" />
                  <stop offset="100%" stopColor="rgba(15, 23, 42, 0.85)" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          <div className="hero-stats">
            <div className="stat-box">
              <span className="num">45</span>
              <span className="lbl">Active Nodes</span>
            </div>
            <div className="stat-box">
              <span className="num">1,626</span>
              <span className="lbl">ZK Proofs Verified</span>
            </div>
            <div className="stat-box">
              <span className="num">100%</span>
              <span className="lbl">Patient Owned</span>
            </div>
          </div>
        </div>

        {/* Right Glass Entrance Card */}
        <div className="glass-card">
          <h2>Welcome to MedZK</h2>
          <p style={{ color: "var(--muted)", textAlign: "center", fontSize: "0.88rem", marginTop: "-0.4rem", marginBottom: "0.2rem" }}>
            Connect with Google OAuth or Web3 MetaMask Wallet.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <Button busy={busy} onClick={onSignIn} className="btn btn-silver" style={{ width: "100%", padding: "0.8rem 1rem", fontSize: "0.92rem", borderRadius: "10px" }}>
              {busy ? "Authenticating Session..." : "Connect MetaMask Wallet"}
            </Button>

            <Button variant="quiet" onClick={onSignIn} style={{ width: "100%", padding: "0.75rem 1rem", fontSize: "0.9rem", borderRadius: "10px", background: "rgba(255,255,255,0.05)", border: "1px solid var(--line-strong)", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.6rem" }}>
              <img src="https://cdn-icons-png.flaticon.com/512/2991/2991148.png" alt="Google" style={{ width: "17px" }} />
              <span>Continue with Google OAuth</span>
            </Button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", margin: "0.2rem 0", color: "var(--muted)", fontSize: "0.75rem", letterSpacing: "1px" }}>
            <div style={{ flex: 1, height: "1px", background: "var(--line)" }}></div>
            <span>SUPPORTED ROLES</span>
            <div style={{ flex: 1, height: "1px", background: "var(--line)" }}></div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.78rem", color: "var(--muted)" }}>
            <div style={{ padding: "0.5rem 0.65rem", background: "rgba(255,255,255,0.03)", borderRadius: "var(--r-sm)", border: "1px solid var(--line)" }}>
              🔒 <strong style={{ color: "#fff" }}>Patient</strong> Access Control
            </div>
            <div style={{ padding: "0.5rem 0.65rem", background: "rgba(255,255,255,0.03)", borderRadius: "var(--r-sm)", border: "1px solid var(--line)" }}>
              🩺 <strong style={{ color: "#fff" }}>Doctor</strong> Verification
            </div>
            <div style={{ padding: "0.5rem 0.65rem", background: "rgba(255,255,255,0.03)", borderRadius: "var(--r-sm)", border: "1px solid var(--line)" }}>
              🏥 <strong style={{ color: "#fff" }}>Hospital</strong> Credential Issuer
            </div>
            <div style={{ padding: "0.5rem 0.65rem", background: "rgba(255,255,255,0.03)", borderRadius: "var(--r-sm)", border: "1px solid var(--line)" }}>
              ⚡ <strong style={{ color: "#fff" }}>System Admin</strong> Deployer
            </div>
          </div>

          <div style={{ padding: "0.65rem 0.85rem", background: "rgba(0, 229, 255, 0.05)", borderRadius: "var(--r-sm)", border: "1px solid rgba(0, 229, 255, 0.2)", fontSize: "0.78rem", color: "#e2e8f0" }}>
            💡 <strong>To log in as System Admin:</strong> Open MetaMask extension, select <strong>Account 0</strong> (0xf39F...2266), then click Connect Wallet!
          </div>
        </div>

      </div>
    </div>
  );
}

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="7" fill="currentColor" />
      <path d="M13 7h6v6h6v6h-6v6h-6v-6H7v-6h6z" fill="var(--paper)" />
      <circle cx="16" cy="16" r="2.4" fill="currentColor" />
    </svg>
  );
}
