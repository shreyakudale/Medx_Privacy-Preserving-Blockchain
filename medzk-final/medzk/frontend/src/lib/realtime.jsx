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
      toast(`${eventObj.title}: ${eventObj.message}`, eventObj.tone || "info");
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

    const lower = (x) => String(x || "").toLowerCase();
    const mine = (x) => lower(x) === lower(address);

    // A smaller block number than before means the local node was reset, so stored ids no longer match.
    const noteBlock = (b) => {
      if (!active) return;
      if (lastBlockRef.current > 2 && b < lastBlockRef.current) {
        addEvent({
          icon: "⚠️",
          title: "Blockchain reset detected",
          message: "The local Hardhat node was restarted. Redeploy the contracts (npm run deploy:local), restart the backend and refresh this page.",
          tone: "warn",
        });
      }
      setIsLive(true);
      // Only a new block can have changed anything, so only then ask the data loaders to refresh.
      if (b !== lastBlockRef.current) {
        lastBlockRef.current = b;
        setBlockNumber(b);
        bumpTick();
      }
    };

    const onBlock = (b) => noteBlock(Number(b));
    try {
      const res = provider?.on?.("block", onBlock);
      if (res && typeof res.catch === "function") res.catch(() => {});
    } catch (e) {
      console.warn("Could not bind block listener:", e);
    }

    // Handlers receive the event arguments in the order the contract declares them (see the ABI),
    // and only tell a person about events that involve their own account.
    const exchangeHandlers = {
      // RecordAdded(recordId, owner, contentHash, category)
      RecordAdded: (recordId, owner) => {
        if (!mine(owner)) return;
        addEvent({ icon: "📁", title: "Record stored on-chain", message: `Record #${recordId} was registered for you.`, tone: "ok" });
      },
      // AccessRequested(requestId, recordId, owner, requester, durationSeconds, purpose)
      AccessRequested: (requestId, recordId, owner, requester) => {
        if (mine(owner)) {
          addEvent({ icon: "⏳", title: "Access requested", message: `${short(requester)} asked to open your record #${recordId}. Review it under Requests.`, tone: "warn" });
        } else if (mine(requester)) {
          addEvent({ icon: "📨", title: "Request sent", message: `Your request #${requestId} for record #${recordId} is waiting for the patient.`, tone: "info" });
        }
      },
      // RequestRejected(requestId, recordId, owner, requester)
      RequestRejected: (requestId, recordId, owner, requester) => {
        if (mine(requester)) addEvent({ icon: "⛔", title: "Request declined", message: `The patient declined your request for record #${recordId}.`, tone: "warn" });
      },
      // AccessGranted(recordId, owner, grantee, expiresAt, emergency)
      AccessGranted: (recordId, owner, grantee, expiresAt, emergency) => {
        if (mine(grantee) && !emergency) {
          addEvent({ icon: "✅", title: "Access granted", message: `You can now open record #${recordId} until ${new Date(Number(expiresAt) * 1000).toLocaleString()}.`, tone: "ok" });
        }
      },
      // AccessRevoked(recordId, owner, grantee)
      AccessRevoked: (recordId, owner, grantee) => {
        if (mine(grantee)) addEvent({ icon: "🚫", title: "Access revoked", message: `Your access to record #${recordId} has ended.`, tone: "error" });
      },
      // RecordAccessed(recordId, owner, accessor, timestamp)
      RecordAccessed: (recordId, owner, accessor) => {
        if (mine(owner) && !mine(accessor)) {
          addEvent({ icon: "👁️", title: "Your record was opened", message: `${short(accessor)} opened record #${recordId}. The access is logged on-chain.`, tone: "info" });
        }
      },
      // EmergencyAccessUsed(recordId, owner, hospital, reason, expiresAt)
      EmergencyAccessUsed: (recordId, owner, hospital, reason) => {
        if (mine(owner)) {
          addEvent({ icon: "🚨", title: "Emergency access used", message: `Hospital ${short(hospital)} opened record #${recordId}. Reason given: ${reason}`, tone: "error" });
        }
      },
      // DoctorVerified(doctor, hospital)
      DoctorVerified: (doctor, hospital) => {
        if (mine(doctor)) addEvent({ icon: "🩺", title: "You are verified", message: "Your hospital verified your account. You can now request records.", tone: "ok" });
      },
      // DoctorRevoked(doctor, hospital)
      DoctorRevoked: (doctor) => {
        if (mine(doctor)) addEvent({ icon: "❌", title: "Verification withdrawn", message: "Your hospital withdrew your verification. Your record access has ended.", tone: "error" });
      },
      // HospitalStatusChanged(hospital, active)
      HospitalStatusChanged: (hospital, active) => {
        if (mine(hospital)) {
          addEvent({ icon: "🏥", title: active ? "Hospital reactivated" : "Hospital suspended", message: active ? "The network admin reactivated your hospital." : "The network admin suspended your hospital.", tone: active ? "ok" : "error" });
        }
      },
    };
    const claimHandlers = {
      // ClaimVerified(verificationId, patient, verifiedBy, issuer, minAge, requireVaccinated, year)
      ClaimVerified: (verificationId, patient, verifiedBy, issuer, minAge, requireVaccinated) => {
        if (mine(patient)) {
          addEvent({ icon: "🛡️", title: "Your proof was verified", message: `${short(verifiedBy)} verified your proof (age ${Number(minAge)}+${requireVaccinated ? ", vaccinated" : ""}) on-chain. No private details were shared.`, tone: "purple" });
        }
      },
    };

    const bind = (contract, table) => {
      if (!contract) return;
      for (const [name, fn] of Object.entries(table)) {
        try {
          const res = contract.on(name, fn);
          if (res && typeof res.catch === "function") res.catch(() => {});
        } catch (err) {
          console.warn(`Could not bind listener for ${name}:`, err);
        }
      }
    };
    const unbind = (contract, table) => {
      if (!contract) return;
      for (const [name, fn] of Object.entries(table)) {
        try {
          const res = contract.off?.(name, fn);
          if (res && typeof res.catch === "function") res.catch(() => {});
        } catch { /* already gone */ }
      }
    };
    bind(exchange, exchangeHandlers);
    bind(claim, claimHandlers);

    // Heartbeat so other tabs and nodes that don't push block events are still noticed. It does NOT force a
    // refresh by itself: noteBlock() only refreshes data when the block number actually changed.
    const interval = setInterval(() => {
      provider.getBlockNumber().then((b) => noteBlock(b)).catch(() => {
        if (active) setIsLive(false);
      });
    }, 4000);

    return () => {
      active = false;
      clearInterval(interval);
      try { provider?.off?.("block", onBlock); } catch { /* already gone */ }
      unbind(exchange, exchangeHandlers);
      unbind(claim, claimHandlers);
    };
    // The session object is rebuilt on every App render, so depend on its stable parts to avoid rebinding listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.provider, session?.exchange, session?.claim, session?.address, addEvent, bumpTick]);

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
