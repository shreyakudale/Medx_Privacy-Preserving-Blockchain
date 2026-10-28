import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { explain } from "../lib/chain.js";
import { short } from "../lib/format.js";

// ---------------------------------------------------------------- session
export const SessionContext = createContext(null);
export const useSession = () => useContext(SessionContext);

// ---------------------------------------------------------------- toasts
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);

  const push = useCallback((text, tone = "ok") => {
    const id = Math.random().toString(36).slice(2) + Date.now();
    const icon =
      tone === "error"
        ? "⚠️"
        : tone === "warn"
        ? "🔔"
        : tone === "purple"
        ? "🛡️"
        : tone === "info"
        ? "ℹ️"
        : "✅";
    setItems((x) => [...x, { id, text, tone, icon }]);
    setTimeout(() => {
      setItems((x) => x.filter((i) => i.id !== id));
    }, tone === "error" ? 7500 : 4500);
  }, []);

  const remove = (id) => {
    setItems((x) => x.filter((i) => i.id !== id));
  };

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts-container" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast-card toast-${t.tone}`}>
            <span className="toast-icon">{t.icon}</span>
            <div className="toast-content">{t.text}</div>
            <button
              className="toast-close"
              onClick={() => remove(t.id)}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------- confirm dialog
export const CANCELLED = Symbol("cancelled");
const ConfirmContext = createContext(() => Promise.resolve(false));
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const okRef = useRef(null);

  const ask = useCallback(
    (opts) => new Promise((resolve) => setDialog({ ...opts, resolve })),
    []
  );

  const close = (answer) => {
    dialog?.resolve(answer);
    setDialog(null);
  };

  useEffect(() => {
    if (!dialog) return undefined;
    okRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {dialog ? (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <div className="modal-dialog" role="alertdialog" aria-modal="true">
            <div className={`modal-header-icon ${dialog.danger ? "modal-icon-danger" : "modal-icon-primary"}`}>
              {dialog.danger ? "⚠️" : "🛡️"}
            </div>
            <div className="modal-body">
              <h2>{dialog.title || "Confirm Action"}</h2>
              <p>{dialog.body}</p>
            </div>
            <div className="modal-actions">
              <button className="btn btn-quiet" onClick={() => close(false)}>
                Cancel
              </button>
              <button
                ref={okRef}
                className={`btn ${dialog.danger ? "btn-danger" : "btn-primary"}`}
                onClick={() => close(true)}
              >
                {dialog.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

/**
 * Wraps an async action with busy state and error reporting.
 */
export function useAction(fn, successText) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (...args) => {
    setBusy(true);
    try {
      const r = await fn(...args);
      if (r === CANCELLED) return undefined;
      if (r && typeof r === "object" && "status" in r && r.status === 0) {
        throw new Error("Transaction execution failed on-chain (receipt reverted).");
      }
      if (successText) toast(typeof successText === "function" ? successText(r) : successText);
      return r;
    } catch (e) {
      console.error(e);
      toast(explain(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return [run, busy];
}

// ---------------------------------------------------------------- Core UI components
export function Button({ busy, children, variant = "primary", icon, className = "", ...rest }) {
  return (
    <button className={`btn btn-${variant} ${className}`} disabled={busy || rest.disabled} {...rest}>
      {busy ? (
        <span className="spinner-dot" aria-hidden />
      ) : icon ? (
        <span className="btn-icon" aria-hidden>{icon}</span>
      ) : null}
      <span className="btn-text">{children}</span>
    </button>
  );
}

export function Field({ label, hint, error, required, children }) {
  return (
    <label className="field-group">
      <div className="field-top">
        <span className="field-label">
          {label} {required ? <span className="field-req">*</span> : null}
        </span>
        {hint ? <span className="field-hint">{hint}</span> : null}
      </div>
      <div className="field-control">{children}</div>
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  );
}

export function Address({ value, name, showFull = false }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  if (!value) return null;

  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      toast("Address copied to clipboard", "ok");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      type="button"
      className="addr-chip"
      title={`${value} (Click to copy)`}
      onClick={copy}
    >
      <span className="addr-dot" />
      {name ? <span className="addr-name">{name}</span> : null}
      <code className="addr-hash">{showFull ? value : short(value)}</code>
      <span className="addr-copy-icon">{copied ? "✓" : "📋"}</span>
    </button>
  );
}

export function Empty({ icon = "📭", title = "Nothing here yet", children }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h4 className="empty-title">{title}</h4>
      {children ? <p className="empty-text">{children}</p> : null}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <nav className="tab-bar" role="tablist">
      {tabs.map((t) => {
        const isSelected = active === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isSelected}
            className={`tab-item ${isSelected ? "tab-active" : ""}`}
            onClick={() => onChange(t.id)}
          >
            {t.icon ? <span className="tab-icon">{t.icon}</span> : null}
            <span className="tab-label">{t.label}</span>
            {t.count !== undefined && t.count !== null && (
              <span className={`tab-badge ${isSelected ? "badge-active" : ""}`}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

export function Panel({ title, icon, aside, subtitle, className = "", children }) {
  return (
    <section className={`panel-card ${className}`}>
      {title ? (
        <header className="panel-header">
          <div className="panel-title-group">
            {icon ? <span className="panel-icon">{icon}</span> : null}
            <div>
              <h2 className="panel-heading">{title}</h2>
              {subtitle ? <p className="panel-sub">{subtitle}</p> : null}
            </div>
          </div>
          {aside ? <div className="panel-aside">{aside}</div> : null}
        </header>
      ) : null}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Pill({ tone = "neutral", children, icon, pulse = false }) {
  return (
    <span className={`pill-badge pill-${tone}`}>
      {pulse ? <span className="pill-dot-pulse" /> : null}
      {icon ? <span className="pill-icon">{icon}</span> : null}
      {children}
    </span>
  );
}

export function StatCard({ title, value, subtitle, icon, tone = "primary" }) {
  return (
    <div className={`stat-card stat-${tone}`}>
      <div className="stat-icon-wrap">{icon}</div>
      <div className="stat-info">
        <span className="stat-title">{title}</span>
        <div className="stat-value">{value}</div>
        {subtitle ? <span className="stat-sub">{subtitle}</span> : null}
      </div>
    </div>
  );
}

/** Live real-time countdown badge that ticks every 1 second */
export function CountdownBadge({ expiresAt }) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Number(expiresAt) - Math.floor(Date.now() / 1000))
  );

  useEffect(() => {
    const update = () => {
      const diff = Math.max(0, Number(expiresAt) - Math.floor(Date.now() / 1000));
      setSecondsLeft(diff);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (secondsLeft <= 0) {
    return <Pill tone="danger" icon="⌛">Expired</Pill>;
  }

  const hours = Math.floor(secondsLeft / 3600);
  const mins = Math.floor((secondsLeft % 3600) / 60);
  const secs = secondsLeft % 60;

  let text = "";
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    text = `${days}d ${hours % 24}h left`;
  } else if (hours > 0) {
    text = `${hours}h ${mins}m left`;
  } else {
    text = `${mins}m ${secs < 10 ? "0" : ""}${secs}s left`;
  }

  const tone = secondsLeft < 600 ? "danger" : secondsLeft < 3600 ? "warn" : "ok";
  return (
    <Pill tone={tone} icon="⏱️" pulse={secondsLeft < 1800}>
      {text}
    </Pill>
  );
}

// ---------------------------------------------------------------- Demo Accounts Drawer
// Hardhat's publicly known TEST keys. They exist only in `npm run dev`; a production build (import.meta.env.DEV is
// false) contains none of them, so no key ever ships to real users. Never send real funds to these addresses.
export const DEMO_ACCOUNTS = !import.meta.env.DEV ? [] : [
  {
    role: "Admin (Deployer)",
    accountNum: "#0",
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    roleTone: "amber",
    description: "Registers hospitals, updates signing keys, manages gateway.",
  },
  {
    role: "Hospital",
    accountNum: "#2",
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    roleTone: "purple",
    description: "Verifies doctors, issues signed ZK credentials, emergency access.",
  },
  {
    role: "Doctor",
    accountNum: "#3",
    address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    privateKey: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    roleTone: "blue",
    description: "Requests records, decrypts records, verifies ZK proofs.",
  },
  {
    role: "Patient",
    accountNum: "#4",
    address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    privateKey: "0x47e179ec197488593b1002f79304ef2441af49b0770c5d14e2303cb80a61ecc5",
    roleTone: "ok",
    description: "Client-side encrypted uploads, approves requests, generates ZK proofs.",
  },
];

export function DemoAccountsDrawer({ isOpen, onClose, currentAddress }) {
  const toast = useToast();
  if (!isOpen) return null;

  const copy = (val, label) => {
    navigator.clipboard?.writeText(val).then(() => {
      toast(`${label} copied to clipboard!`, "ok");
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="drawer-tag">Local Testnet (Chain ID 31337)</div>
            <h2 className="drawer-title">Demo Roles & Accounts</h2>
          </div>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>

        <p className="drawer-desc">
          To test different perspectives, switch accounts in MetaMask. You can import these private keys directly:
        </p>

        <div className="demo-accounts-list">
          {DEMO_ACCOUNTS.map((acc) => {
            const isConnected =
              currentAddress &&
              currentAddress.toLowerCase() === acc.address.toLowerCase();

            return (
              <div
                key={acc.address}
                className={`demo-acc-card ${isConnected ? "demo-acc-active" : ""}`}
              >
                <div className="demo-acc-top">
                  <span className={`demo-role-badge demo-role-${acc.roleTone}`}>
                    {acc.accountNum} {acc.role}
                  </span>
                  {isConnected && (
                    <span className="demo-connected-pill">● Connected</span>
                  )}
                </div>

                <p className="demo-acc-desc">{acc.description}</p>

                <div className="demo-field-row">
                  <span className="demo-field-label">Address:</span>
                  <code className="demo-code">{short(acc.address)}</code>
                  <button
                    className="demo-copy-btn"
                    onClick={() => copy(acc.address, `${acc.role} address`)}
                  >
                    Copy
                  </button>
                </div>

                <div className="demo-field-row">
                  <span className="demo-field-label">Private Key:</span>
                  <code className="demo-code">{short(acc.privateKey)}</code>
                  <button
                    className="demo-copy-btn"
                    onClick={() => copy(acc.privateKey, `${acc.role} private key`)}
                  >
                    Copy Key
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="demo-quick-steps">
          <h4>🧪 Quick Demo Walkthrough</h4>
          <ol>
            <li><strong>Hospital (#2):</strong> Connect, sign in & click "Create credential-signing key".</li>
            <li><strong>Admin (#0):</strong> Connect, register Hospital with its address and Ax/Ay keys.</li>
            <li><strong>Hospital (#2):</strong> Sign in and publish its encryption key.</li>
            <li><strong>Doctor (#3):</strong> Connect and register under Hospital.</li>
            <li><strong>Hospital (#2):</strong> Go to Doctors tab and click "Verify doctor".</li>
            <li><strong>Patient (#4):</strong> Register, upload record, approve Doctor requests, and create ZK proofs!</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
