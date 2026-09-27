import { createContext, useCallback, useContext, useState } from "react";
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
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === "error" ? 8000 : 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Wraps an async action with busy state and error reporting.
 * Returns [run, busy]; run(...args) resolves to the action result or undefined on failure.
 */
export function useAction(fn, successText) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (...args) => {
    setBusy(true);
    try {
      const r = await fn(...args);
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

// ---------------------------------------------------------------- bits
export function Button({ busy, children, variant = "primary", ...rest }) {
  return (
    <button className={`btn btn-${variant}`} disabled={busy || rest.disabled} {...rest}>
      {busy ? <span className="spinner" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Address({ value, name }) {
  const toast = useToast();
  if (!value) return null;
  return (
    <button
      type="button"
      className="addr"
      title={`${value} (click to copy)`}
      onClick={() => navigator.clipboard?.writeText(value).then(() => toast("Address copied"))}
    >
      {name ? <span className="addr-name">{name}</span> : null}
      <code>{short(value)}</code>
    </button>
  );
}

export function Empty({ children }) {
  return <p className="empty">{children}</p>;
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <nav className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          className={active === t.id ? "tab tab-on" : "tab"}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count ? <span className="tab-count">{t.count}</span> : null}
        </button>
      ))}
    </nav>
  );
}

export function Panel({ title, aside, children }) {
  return (
    <section className="panel">
      {title ? (
        <header className="panel-head">
          <h2>{title}</h2>
          {aside}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Pill({ tone = "neutral", children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}
