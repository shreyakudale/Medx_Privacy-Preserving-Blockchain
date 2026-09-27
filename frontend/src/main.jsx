import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { ToastProvider } from "./components/ui.jsx";
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
    console.error("React Error Boundary caught error:", error, errorInfo);
  }

  resetApp = () => {
    localStorage.clear();
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", background: "#080b11", color: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
          <div style={{ maxWidth: "500px", padding: "2rem", background: "#0f1523", border: "1px solid rgba(0, 229, 255, 0.3)", borderRadius: "16px", textAlign: "center", boxShadow: "0 20px 50px rgba(0,0,0,0.6)" }}>
            <h2 style={{ color: "#00e5ff", marginBottom: "0.8rem" }}>🛡️ MedZK Session Recovery</h2>
            <p style={{ fontSize: "0.9rem", color: "#94a3b8", marginBottom: "1.2rem" }}>
              A temporary session error occurred. Click below to clear stored cache and restart.
            </p>
            <div style={{ padding: "0.8rem", background: "rgba(239,68,68,0.1)", border: "1px solid #ef4444", borderRadius: "8px", fontSize: "0.78rem", color: "#ef4444", marginBottom: "1.5rem", wordBreak: "break-all" }}>
              {String(this.state.error?.message || this.state.error || "Unknown Error")}
            </div>
            <button onClick={this.resetApp} style={{ padding: "0.8rem 1.5rem", background: "linear-gradient(135deg, #00e5ff 0%, #00b4d8 100%)", color: "#040914", fontWeight: "700", border: "none", borderRadius: "10px", cursor: "pointer" }}>
              Clear Cache & Reset Session
            </button>
          </div>
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
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
