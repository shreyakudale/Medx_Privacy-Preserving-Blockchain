import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { useSession, useToast, Empty } from "../components/ui.jsx";
import { short, when } from "./format.js";

const RealtimeContext = createContext({
  blockNumber: 0,
  isLive: false,
  realtimeTick: 0,
  events: [],
  clearEvents: () => {},
  unreadCount: 0,
  markAllRead: () => {},
});

export const useRealtime = () => useContext(RealtimeContext);

export function RealtimeProvider({ children }) {
  const session = useSession();
  const toast = useToast();
  const [blockNumber, setBlockNumber] = useState(0);
  const [isLive, setIsLive] = useState(false);
  const [realtimeTick, setRealtimeTick] = useState(0);
  const [eventsList, setEventsList] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const registeredListeners = useRef(false);
  const lastBlockRef = useRef(0);

  const bumpTick = useCallback(() => {
    setRealtimeTick((t) => t + 1);
  }, []);

  const addEvent = useCallback((eventObj, showToast = true) => {
    const item = {
      id: Math.random().toString(36).slice(2) + Date.now(),
      timestamp: Date.now(),
      read: false,
      ...eventObj,
    };
    setEventsList((prev) => [item, ...prev].slice(0, 30));
    setUnreadCount((c) => c + 1);
    if (showToast && toast) {
      toast(`${eventObj.icon || "🔔"} ${eventObj.title}: ${eventObj.message}`, eventObj.tone || "info");
    }
    bumpTick();
  }, [toast, bumpTick]);

  const markAllRead = useCallback(() => {
    setEventsList((prev) => prev.map((e) => ({ ...e, read: true })));
    setUnreadCount(0);
  }, []);

  const clearEvents = useCallback(() => {
    setEventsList([]);
    setUnreadCount(0);
  }, []);

  // Listen to blocks and smart contract events
  useEffect(() => {
    if (!session?.provider || !session?.exchange) {
      setIsLive(false);
      return;
    }

    const { provider, exchange, claim, address } = session;
    let active = true;

    // Fetch initial block
    provider.getBlockNumber()
      .then((b) => {
        if (active) {
          lastBlockRef.current = b;
          setBlockNumber(b);
          setIsLive(true);
        }
      })
      .catch(() => {});

    // On new block
    const onBlock = (b) => {
      if (!active) return;
      if (lastBlockRef.current > 2 && b < lastBlockRef.current) {
        addEvent({
          icon: "⚠️",
          title: "Blockchain Reset Detected",
          message: "The local Hardhat node was restarted. Please redeploy contracts ('npm run deploy:local && npm run seed:local') and refresh.",
          tone: "warn",
        });
      }
      lastBlockRef.current = b;
      setBlockNumber(b);
      setIsLive(true);
      bumpTick();
    };

    try {
      const res = provider?.on?.("block", onBlock);
      if (res && typeof res.catch === "function") res.catch(() => {});
    } catch (e) {
      console.warn("Could not bind block listener:", e);
    }

    // Contract events
    const onRecordAdded = (recordId, owner, contentHash) => {
      const isMine = owner.toLowerCase() === address.toLowerCase();
      addEvent({
        icon: "📁",
        title: "Record Stored On-Chain",
        message: `Record #${recordId} ${isMine ? "uploaded by you" : `by ${short(owner)}`}`,
        tone: "ok",
      });
    };

    const onAccessRequested = (requestId, recordId, requester, owner) => {
      const isForMe = owner.toLowerCase() === address.toLowerCase();
      const isMine = requester.toLowerCase() === address.toLowerCase();
      addEvent({
        icon: "⏳",
        title: "Access Requested",
        message: isForMe
          ? `Doctor ${short(requester)} requested access to your Record #${recordId}`
          : isMine
          ? `Your access request #${requestId} for Record #${recordId} was sent`
          : `Request #${requestId} sent for Record #${recordId}`,
        tone: isForMe ? "warn" : "info",
      });
    };

    const onAccessGranted = (requestId, recordId, grantee, expiresAt) => {
      const isForMe = grantee.toLowerCase() === address.toLowerCase();
      addEvent({
        icon: "✅",
        title: "Access Granted",
        message: isForMe
          ? `Access to Record #${recordId} was approved for you!`
          : `Access to Record #${recordId} granted to ${short(grantee)}`,
        tone: "ok",
      });
    };

    const onAccessRevoked = (recordId, grantee, revokedBy) => {
      const isForMe = grantee.toLowerCase() === address.toLowerCase();
      addEvent({
        icon: "🚫",
        title: "Access Revoked",
        message: isForMe
          ? `Your access to Record #${recordId} was revoked`
          : `Access to Record #${recordId} for ${short(grantee)} was revoked`,
        tone: "error",
      });
    };

    const onRecordAccessed = (recordId, accessor, owner, timestamp) => {
      const isMine = owner.toLowerCase() === address.toLowerCase();
      addEvent({
        icon: "👁️",
        title: "Record Accessed",
        message: isMine
          ? `Your Record #${recordId} was opened by ${short(accessor)} (audit logged on-chain)`
          : `Record #${recordId} accessed by ${short(accessor)}`,
        tone: isMine ? "info" : "neutral",
      });
    };

    const onEmergencyAccessUsed = (recordId, hospital, owner, reason, expiresAt) => {
      const isMine = owner.toLowerCase() === address.toLowerCase();
      addEvent({
        icon: "🚨",
        title: "Emergency Break-Glass Access",
        message: isMine
          ? `EMERGENCY ACCESS used on Record #${recordId} by hospital ${short(hospital)}: "${reason}"`
          : `Emergency access activated on Record #${recordId}`,
        tone: "error",
      });
    };

    const onDoctorVerified = (doctor, hospital, verified) => {
      const isMe = doctor.toLowerCase() === address.toLowerCase();
      addEvent({
        icon: verified ? "🩺" : "❌",
        title: verified ? "Doctor Verified" : "Doctor Revoked",
        message: isMe
          ? `Your doctor credentials have been ${verified ? "verified by your hospital" : "revoked"}`
          : `Doctor ${short(doctor)} was ${verified ? "verified" : "revoked"}`,
        tone: verified ? "ok" : "warn",
      });
    };

    const onHospitalVerified = (hospital, active) => {
      addEvent({
        icon: "🏥",
        title: "Hospital Status Updated",
        message: `Hospital ${short(hospital)} is now ${active ? "active" : "suspended"}`,
        tone: active ? "ok" : "error",
      });
    };

    const onClaimVerified = (issuer, patient, verifier, currentYear, minAge, requireVaccinated) => {
      const isMe = patient.toLowerCase() === address.toLowerCase();
      addEvent({
        icon: "🛡️",
        title: "Zero-Knowledge Claim Verified",
        message: isMe
          ? `Your zero-knowledge proof (age ${minAge}+${requireVaccinated ? ", vaccinated" : ""}) was verified on-chain!`
          : `ZK proof verified on-chain for patient ${short(patient)}`,
        tone: "purple",
      });
    };

    const safeListen = (contract, event, handler) => {
      try {
        const res = contract?.on?.(event, handler);
        if (res && typeof res.catch === "function") res.catch(() => {});
      } catch (err) {
        console.warn(`Could not bind listener for ${event}:`, err);
      }
    };

    safeListen(exchange, "RecordAdded", onRecordAdded);
    safeListen(exchange, "AccessRequested", onAccessRequested);
    safeListen(exchange, "AccessGranted", onAccessGranted);
    safeListen(exchange, "AccessRevoked", onAccessRevoked);
    safeListen(exchange, "RecordAccessed", onRecordAccessed);
    safeListen(exchange, "EmergencyAccessUsed", onEmergencyAccessUsed);
    safeListen(exchange, "DoctorVerified", onDoctorVerified);
    safeListen(exchange, "HospitalVerified", onHospitalVerified);
    if (claim) safeListen(claim, "ClaimVerified", onClaimVerified);

    // Periodic sync heartbeat (every 4s) to ensure seamless updates across tabs
    const interval = setInterval(() => {
      provider.getBlockNumber().then((b) => {
        if (active) {
          setBlockNumber(b);
          setIsLive(true);
          bumpTick();
        }
      }).catch(() => {
        if (active) setIsLive(false);
      });
    }, 4000);

    return () => {
      active = false;
      clearInterval(interval);
      const safeRemove = (contract, event, handler) => {
        try { contract?.removeListener?.(event, handler); } catch {}
      };
      safeRemove(provider, "block", onBlock);
      safeRemove(exchange, "RecordAdded", onRecordAdded);
      safeRemove(exchange, "AccessRequested", onAccessRequested);
      safeRemove(exchange, "AccessGranted", onAccessGranted);
      safeRemove(exchange, "AccessRevoked", onAccessRevoked);
      safeRemove(exchange, "RecordAccessed", onRecordAccessed);
      safeRemove(exchange, "EmergencyAccessUsed", onEmergencyAccessUsed);
      safeRemove(exchange, "DoctorVerified", onDoctorVerified);
      safeRemove(exchange, "HospitalVerified", onHospitalVerified);
      if (claim) safeRemove(claim, "ClaimVerified", onClaimVerified);
    };
  }, [session, addEvent, bumpTick]);

  return (
    <RealtimeContext.Provider
      value={{
        blockNumber,
        isLive,
        realtimeTick,
        events: eventsList,
        unreadCount,
        markAllRead,
        clearEvents,
      }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}

// ---------------------------------------------------------------- Live Activity Drawer
export function LiveActivityDrawer({ isOpen, onClose }) {
  const { events, clearEvents, markAllRead } = useRealtime();
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-title-group">
            <span className="drawer-icon">⚡</span>
            <div>
              <h2 className="drawer-title">Real-Time Event Stream</h2>
              <span className="drawer-sub">Live on-chain & gateway activity</span>
            </div>
          </div>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-toolbar">
          <button className="btn-quiet-sm" onClick={markAllRead}>Mark all read</button>
          <button className="btn-quiet-sm" onClick={clearEvents}>Clear log</button>
        </div>

        <div className="activity-stream-list">
          {events.length === 0 ? (
            <Empty icon="⚡" title="No live events yet">
              Transactions and requests will appear here in real-time as they happen on-chain.
            </Empty>
          ) : (
            events.map((ev) => (
              <div key={ev.id} className={`activity-stream-item item-${ev.tone || "info"}`}>
                <div className="activity-icon-bubble">{ev.icon || "📌"}</div>
                <div className="activity-stream-body">
                  <div className="activity-stream-head">
                    <strong className="activity-stream-title">{ev.title}</strong>
                    <span className="activity-stream-time">
                      {new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  <p className="activity-stream-msg">{ev.message}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
