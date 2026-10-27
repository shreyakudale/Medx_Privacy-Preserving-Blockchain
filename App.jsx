import { useEffect, useState } from "react";
import { connectWallet, readParticipant, RoleName, Role, deployment } from "./lib/chain.js";
import { api, setToken, setUnauthorizedHandler } from "./lib/api.js";
import {
  SessionContext,
  useSession,
  Button,
  useAction,
  Address,
  DemoAccountsDrawer,
  DEMO_ACCOUNTS,
} from "./components/ui.jsx";
import { RealtimeProvider, useRealtime, LiveActivityDrawer } from "./lib/realtime.jsx";
import Onboarding from "./views/Onboarding.jsx";
import KeyGuard from "./views/KeyGuard.jsx";
import Patient from "./views/Patient.jsx";
import Doctor from "./views/Doctor.jsx";
import Hospital from "./views/Hospital.jsx";
import Admin from "./views/Admin.jsx";

export default function App() {
  const [session, setSession] = useState(null);
  const [adminMode, setAdminMode] = useState(false);
  const [notice, setNotice] = useState("");
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [showActivityDrawer, setShowActivityDrawer] = useState(false);

  const endSession = (message = "") => {
    setToken(null);
    setSession(null);
    setAdminMode(false);
    setNotice(message);
  };

  // The server tells us when the token expired or was revoked: return to the sign-in screen with a reason.
  useEffect(() => {
    setUnauthorizedHandler((msg) => endSession(msg));
    return () => setUnauthorizedHandler(null);
  }, []);

  // A different MetaMask account or network means a different identity: end the session instead of silently mixing them.
  const signedInAs = session?.address;
  useEffect(() => {
    if (!signedInAs || !window.ethereum?.on) return undefined;
    const changed = () => {
      api.logout().catch(() => {});
      endSession("Your wallet account or network changed. Sign in again.");
    };
    window.ethereum.on("accountsChanged", changed);
    window.ethereum.on("chainChanged", changed);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", changed);
      window.ethereum.removeListener?.("chainChanged", changed);
    };
  }, [signedInAs]);

  const [signOut, signingOut] = useAction(async () => {
    try {
      await api.logout();
    } catch {
      /* the local session still ends */
    }
    endSession("You have signed out.");
  });

  const [signIn, busy] = useAction(async () => {
    setNotice("");
    const wallet = await connectWallet();
    const { message } = await api.nonce(wallet.address);
    const signature = await wallet.signer.signMessage(message);
    const { token } = await api.verify(wallet.address, signature);
    setToken(token);
    const [participant, admin] = await Promise.all([
      readParticipant(wallet.exchange, wallet.address),
      wallet.exchange.admin(),
    ]);
    const isAdmin = admin.toLowerCase() === wallet.address.toLowerCase();
    setSession({ ...wallet, participant, isAdmin });
    setAdminMode(isAdmin && participant.role === Role.None);
  });

  const refreshParticipant = async () => {
    if (!session) return;
    const participant = await readParticipant(session.exchange, session.address);
    setSession((s) => ({ ...s, participant }));
  };

  if (!session) {
    return (
      <Landing
        onSignIn={signIn}
        busy={busy}
        notice={notice}
        onOpenDemoModal={() => setShowDemoModal(true)}
      >
        <DemoAccountsDrawer
          isOpen={showDemoModal}
          onClose={() => setShowDemoModal(false)}
        />
      </Landing>
    );
  }

  const { participant, isAdmin } = session;
  let body;
  if (adminMode) body = <Admin />;
  else if (participant.role === Role.None)
    body = <Onboarding onRegistered={refreshParticipant} />;
  else {
    const View = {
      [Role.Patient]: Patient,
      [Role.Doctor]: Doctor,
      [Role.Hospital]: Hospital,
    }[participant.role];
    body = (
      <KeyGuard onChanged={refreshParticipant}>
        <View />
      </KeyGuard>
    );
  }

  return (
    <SessionContext.Provider value={{ ...session, refreshParticipant }}>
      <RealtimeProvider>
        <AppLayout
          adminMode={adminMode}
          setAdminMode={setAdminMode}
          signOut={signOut}
          signingOut={signingOut}
          onOpenDemoModal={() => setShowDemoModal(true)}
          onOpenActivityDrawer={() => setShowActivityDrawer(true)}
        >
          {body}
        </AppLayout>

        <DemoAccountsDrawer
          isOpen={showDemoModal}
          onClose={() => setShowDemoModal(false)}
          currentAddress={session.address}
        />

        <LiveActivityDrawer
          isOpen={showActivityDrawer}
          onClose={() => setShowActivityDrawer(false)}
        />
      </RealtimeProvider>
    </SessionContext.Provider>
  );
}

function AppLayout({
  children,
  adminMode,
  setAdminMode,
  signOut,
  signingOut,
  onOpenDemoModal,
  onOpenActivityDrawer,
}) {
  const session = useSession();
  const { blockNumber, isLive, unreadCount } = useRealtime();
  const { participant, isAdmin } = session;

  const roleRoleClass = adminMode
    ? "role-tag-admin"
    : participant.role === Role.Doctor
    ? "role-tag-doctor"
    : participant.role === Role.Hospital
    ? "role-tag-hospital"
    : "role-tag-patient";

  return (
    <div className="shell">
      {/* Modern Sidebar Rail */}
      <aside className="rail">
        <div className="brand">
          <Mark />
          <div className="brand-text-group">
            <span className="brand-title">MedZK</span>
            <span className="brand-badge">PRO PRIVACY</span>
          </div>
        </div>

        {/* User Card */}
        <div className="who-card">
          <div className="who-header">
            <span className={`who-role-tag ${roleRoleClass}`}>
              {adminMode ? "Admin Console" : RoleName[participant.role]}
            </span>
            {participant.verified ? (
              <span className="who-verified-badge" title="Verified Account">✓ Verified</span>
            ) : null}
          </div>

          <strong className="who-name">
            {participant.name || (isAdmin ? "System Administrator" : "New Account")}
          </strong>

          <div className="who-address-box">
            <Address value={session.address} />
          </div>

          {participant.role === Role.Doctor && !participant.verified ? (
            <div className="who-status-alert who-status-warn">
              <span className="status-dot-warn" />
              <span>Pending hospital verification</span>
            </div>
          ) : null}

          {participant.role === Role.Hospital && !participant.verified ? (
            <div className="who-status-alert who-status-error">
              <span className="status-dot-err" />
              <span>Suspended by admin</span>
            </div>
          ) : null}
        </div>

        {/* Sidebar Nav Buttons */}
        <div className="rail-actions">
          {isAdmin && participant.role !== Role.None ? (
            <button
              className="rail-btn rail-btn-accent"
              onClick={() => setAdminMode((m) => !m)}
            >
              {adminMode
                ? `← Return to ${RoleName[participant.role]}`
                : "⚙️ Admin Control Panel"}
            </button>
          ) : null}

          <button className="rail-btn" onClick={onOpenDemoModal}>
            🧪 Demo Accounts & Guide
          </button>

          <button
            className="rail-btn rail-btn-signout"
            onClick={signOut}
            disabled={signingOut}
          >
            ↪ Sign Out
          </button>
        </div>

        {/* Realtime Footer */}
        <div className="rail-footer">
          <div className="realtime-status-pill">
            <span className={`live-dot ${isLive ? "live-dot-active" : "live-dot-off"}`} />
            <div className="realtime-text">
              <span className="realtime-title">
                {isLive ? "Real-time Connected" : "Connecting..."}
              </span>
              <span className="realtime-block">
                Block #{blockNumber || "..."} • {deployment.network}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="main-wrapper">
        {/* Top Header Bar */}
        <header className="topbar">
          <div className="topbar-left">
            <div className="network-badge">
              <span className="network-indicator" />
              <span>{deployment.network}</span>
              <span className="network-chain">({deployment.chainId})</span>
            </div>

            <div className="realtime-heartbeat" title="Live block height">
              <span className="heartbeat-pulse" />
              <span className="heartbeat-text">Live Sync • Block #{blockNumber}</span>
            </div>
          </div>

          <div className="topbar-right">
            <button
              className="topbar-btn demo-btn"
              onClick={onOpenDemoModal}
              title="View Hardhat Demo Account Keys"
            >
              <span className="btn-icon">🔑</span>
              <span>Demo Roles</span>
            </button>

            <button
              className="topbar-btn bell-btn"
              onClick={onOpenActivityDrawer}
              title="Real-Time Event Notifications"
            >
              <span className="btn-icon">⚡</span>
              <span>Live Events</span>
              {unreadCount > 0 ? (
                <span className="bell-badge">{unreadCount}</span>
              ) : null}
            </button>

            <div className="topbar-divider" />

            <div className="topbar-user">
              <span className="user-avatar-bubble">
                {participant.name ? participant.name.charAt(0).toUpperCase() : "U"}
              </span>
              <span className="user-name-short">
                {participant.name || (isAdmin ? "Admin" : "Account")}
              </span>
            </div>
          </div>
        </header>

        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}

function Landing({ onSignIn, busy, notice, onOpenDemoModal, children }) {
  const [copiedKey, setCopiedKey] = useState("");

  const copy = (text, label) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedKey(label);
      setTimeout(() => setCopiedKey(""), 2000);
    });
  };

  return (
    <div className="landing-screen">
      {/* Background glowing decorations */}
      <div className="glow-mesh glow-mesh-top" />
      <div className="glow-mesh glow-mesh-bottom" />

      {/* Navigation */}
      <header className="landing-nav">
        <div className="brand brand-landing">
          <Mark />
          <span className="brand-title">MedZK</span>
          <span className="landing-tag">Decentralized Medical Vault</span>
        </div>
        <div className="landing-nav-actions">
          <button className="landing-ghost-btn" onClick={onOpenDemoModal}>
            🧪 Test Accounts Guide
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <main className="landing-hero">
        <div className="hero-content">
          <div className="hero-badge">
            <span className="badge-sparkle">✨</span>
            <span>Zero-Knowledge Proofs + AES-256 Client-Side Encryption</span>
          </div>

          <h1 className="hero-title">
            Your Medical Data.
            <br />
            <span className="hero-gradient-text">Encrypted by You. Owned by You.</span>
          </h1>

          <p className="hero-lede">
            Experience truly private, blockchain-verified healthcare exchange. Records are
            encrypted in your browser before upload. Doctors get time-limited grants,
            emergencies are audited on-chain, and zero-knowledge proofs let you prove eligibility
            without disclosing private diagnoses or birth dates.
          </p>

          {notice ? (
            <div className="landing-notice" role="status">
              <span className="notice-icon">ℹ️</span>
              <span>{notice}</span>
            </div>
          ) : null}

          <div className="hero-cta-group">
            <Button
              busy={busy}
              onClick={onSignIn}
              variant="primary"
              className="btn-hero-cta"
            >
              🦊 Connect MetaMask & Sign In
            </Button>
            <button className="btn-hero-secondary" onClick={onOpenDemoModal}>
              Explore Demo Roles & Keys
            </button>
          </div>

          <p className="hero-fine">
            Gas-free cryptographic authentication. Signing in asks MetaMask for an off-chain
            EIP-191 signature.
          </p>
        </div>

        {/* Live Feature Matrix */}
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon-box box-teal">🔐</div>
            <h3>Browser-Native Encryption</h3>
            <p>
              Each file is encrypted client-side using AES-256-GCM and wrapped with RSA-OAEP keys.
              The server never sees unencrypted health records.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-box box-blue">⏱️</div>
            <h3>Time-Limited Consent</h3>
            <p>
              Patients grant doctors access for specific durations (1 hour to 30 days). Access
              revokes instantly on-chain when the timer expires.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-box box-purple">🛡️</div>
            <h3>Zero-Knowledge Proofs</h3>
            <p>
              Prove you meet age (18+) or vaccination criteria via Groth16 zk-SNARKs signed by
              hospitals, without revealing your actual date of birth.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-box box-amber">⚡</div>
            <h3>Immutable Real-Time Auditing</h3>
            <p>
              Every access request, grant, and gateway file download is recorded directly on the
              Ethereum ledger with real-time notifications.
            </p>
          </div>
        </div>

        {/* Demo Roles Cheat-Sheet */}
        <section className="landing-demo-section">
          <div className="demo-section-header">
            <div>
              <span className="section-eyebrow">Interactive Testing</span>
              <h2 className="section-title">Hardhat Local Test Accounts</h2>
            </div>
            <p className="section-desc">
              Import these accounts into MetaMask to experience different role perspectives:
            </p>
          </div>

          <div className="demo-cards-row">
            {DEMO_ACCOUNTS.map((acc) => (
              <div key={acc.address} className="demo-preview-card">
                <div className="demo-preview-top">
                  <span className={`pill-badge pill-${acc.roleTone}`}>
                    {acc.accountNum} {acc.role}
                  </span>
                </div>
                <p className="demo-preview-desc">{acc.description}</p>
                <div className="demo-preview-actions">
                  <button
                    className="btn-tiny"
                    onClick={() => copy(acc.privateKey, `${acc.role} private key`)}
                  >
                    {copiedKey === `${acc.role} private key` ? "✓ Copied Key" : "Copy Private Key"}
                  </button>
                  <button
                    className="btn-tiny btn-tiny-ghost"
                    onClick={() => copy(acc.address, `${acc.role} address`)}
                  >
                    {copiedKey === `${acc.role} address` ? "✓ Copied" : "Copy Address"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {children}
    </div>
  );
}

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="markGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0d9488" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="url(#markGrad)" />
      <path d="M13 7h6v6h6v6h-6v6h-6v-6H7v-6h6z" fill="#ffffff" />
      <circle cx="16" cy="16" r="2.8" fill="#0f172a" />
    </svg>
  );
}
