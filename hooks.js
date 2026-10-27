import { useCallback, useEffect, useRef, useState } from "react";
import { readParticipant, events, Role } from "./chain.js";
import { api } from "./api.js";
import { openDownload } from "./crypto.js";
import { useRealtime } from "./realtime.jsx";

/** Cached participant lookups: const who = useParticipants(exchange); who(addr) -> participant|undefined */
export function useParticipants(exchange) {
  const cache = useRef(new Map());
  const [, bump] = useState(0);
  const get = useCallback(
    (address) => {
      if (!address) return undefined;
      const k = address.toLowerCase();
      if (!cache.current.has(k)) {
        cache.current.set(k, null);
        readParticipant(exchange, address).then((p) => {
          cache.current.set(k, p);
          bump((n) => n + 1);
        });
      }
      return cache.current.get(k) || undefined;
    },
    [exchange]
  );
  return get;
}

/** Re-runs loader whenever `deps` change, realtime updates trigger, or refresh() is called. */
export function useLoad(loader, deps = [], options = {}) {
  const rt = useRealtime();
  const realtimeTick = rt?.realtimeTick ?? 0;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    loader()
      .then((d) => {
        if (live) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        console.error(e);
        if (live) {
          setError(e.message || String(e));
          setLoading(false);
        }
      });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, (options.realtime !== false ? realtimeTick : 0)]);

  return [data, () => setTick((t) => t + 1), error, loading];
}

export async function listHospitals(exchange) {
  const evs = await events(exchange, "ParticipantRegistered");
  const hospitals = evs.filter((e) => Number(e.args.role) === Role.Hospital).map((e) => e.args.account);
  const unique = [...new Set(hospitals)];
  return Promise.all(unique.map((a) => readParticipant(exchange, a)));
}

/** Download via the gateway, decrypt locally, and open in a new tab. */
export async function openRecord(address, recordId) {
  const payload = await api.download(recordId);
  const { blob, meta } = await openDownload(address, payload);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const viewable = /^(image\/|application\/pdf|text\/)/.test(meta.mimeType);
  if (viewable) a.target = "_blank";
  else a.download = meta.fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { meta, auditTx: payload.auditTx };
}
