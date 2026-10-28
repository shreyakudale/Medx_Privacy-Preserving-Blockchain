import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { ToastProvider, ConfirmProvider } from "./components/ui.jsx";
import "./styles.css";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("App Crash caught by ErrorBoundary:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "2.5rem", fontFamily: "sans-serif", background: "#fef2f2", color: "#991b1b", minHeight: "100vh" }}>
          <h2 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>⚠️ MedZK Application Error</h2>
          <p style={{ color: "#7f1d1d", marginBottom: "1rem" }}>
            A runtime error occurred in the React application:
          </p>
          <pre style={{ whiteSpace: "pre-wrap", background: "#ffffff", border: "1px solid #fecaca", padding: "1.2rem", borderRadius: "8px", fontSize: "0.875rem", color: "#b91c1c" }}>
            {this.state.error?.stack || String(this.state.error)}
          </pre>
          <button
            onClick={() => { window.localStorage.clear(); window.location.reload(); }}
            style={{ padding: "0.6rem 1.2rem", marginTop: "1.2rem", cursor: "pointer", background: "#dc2626", color: "#fff", border: "none", borderRadius: "6px", fontWeight: "600" }}
          >
            Clear Local Session & Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
