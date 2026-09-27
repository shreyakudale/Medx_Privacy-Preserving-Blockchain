import { useCallback, useEffect, useRef, useState } from "react";
import { readParticipant, events, Role } from "./chain.js";
import { api } from "./api.js";
import { openDownload } from "./crypto.js";

/** Cached participant lookups */
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

/** Re-runs loader whenever `deps` change or refresh() is called. */
export function useLoad(loader, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    loader()
      .then((d) => live && setData(d))
      .catch((e) => {
        console.error(e);
        if (live) setError(e.message || String(e));
      });
    return () => { live = false; };
  }, [...deps, tick]);
  return [data, () => setTick((t) => t + 1), error];
}

export async function listHospitals(exchange) {
  const [regEvs, keyEvs] = await Promise.all([
    events(exchange, "ParticipantRegistered").catch(() => []),
    events(exchange, "IssuerKeySet").catch(() => []),
  ]);

  const regHospitals = regEvs.filter((e) => Number(e.args.role) === Role.Hospital).map((e) => e.args.account);
  const keyHospitals = keyEvs.map((e) => e.args.hospital);

  const fallback = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
  const unique = [...new Set([...regHospitals, ...keyHospitals, fallback])];

  const results = await Promise.all(
    unique.map(async (a) => {
      const p = await readParticipant(exchange, a).catch(() => null);
      return p && p.name ? p : { address: a, name: "City General Hospital", role: Role.Hospital, verified: true };
    })
  );

  return results.filter(Boolean);
}

/** Download via the gateway, decrypt locally, and open in a new tab. */
export async function openRecord(address, recordId) {
  const payload = await api.download(recordId);
  const { blob, meta, hash } = await openDownload(address, payload);
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
  return { meta, auditTx: payload.auditTx, contentHash: payload.contentHash, computedHash: hash };
}
