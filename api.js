const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

let token = null;
let onUnauthorized = null;
export function setToken(t) { token = t; }
/** App registers a callback that runs when the server says the session is over (expired or signed out). */
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function request(path, { method = "GET", body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: payload });
  } catch {
    throw new Error("Can't reach the MedZK server. Check that the backend is running.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && path !== "/auth/logout") {
    // The token is no longer valid: end the session instead of showing a raw error on every screen.
    token = null;
    if (onUnauthorized) onUnauthorized(data.error || "Your session ended. Sign in again.");
  }
  if (res.status === 429) throw new Error(data.error || "Too many requests. Please wait a moment.");
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

export const api = {
  nonce: (address) => request(`/auth/nonce?address=${address}`),
  verify: (address, signature) => request("/auth/verify", { method: "POST", body: { address, signature } }),
  logout: () => request("/auth/logout", { method: "POST" }),

  uploadRecord: (form) => request("/records", { method: "POST", form }),
  confirmRecord: (storageRef, recordId) => request("/records/confirm", { method: "POST", body: { storageRef, recordId } }),
  myRecords: () => request("/records/mine"),
  recordsByOwner: (address) => request(`/records/by-owner/${address}`),
  sharedWithMe: () => request("/records/shared-with-me"),
  myKey: (recordId) => request(`/records/${recordId}/key`),
  shareKey: (recordId, grantee, wrappedKey) => request(`/records/${recordId}/keys`, { method: "POST", body: { grantee, wrappedKey } }),
  purgeRecord: (recordId) => request(`/records/${recordId}`, { method: "DELETE" }),
  removeKey: (recordId, grantee) => request(`/records/${recordId}/keys/${grantee}`, { method: "DELETE" }),
  download: (recordId) => request(`/records/${recordId}/content`),

  issuerKey: () => request("/credentials/issuer-key"),
  rotateIssuerKey: () => request("/credentials/issuer-key/rotate", { method: "POST" }),
  issueCredential: (body) => request("/credentials/issue", { method: "POST", body }),
  issuedCredentials: () => request("/credentials/issued"),
  myCredentials: () => request("/credentials/mine"),
  shareProof: (body) => request("/credentials/proofs", { method: "POST", body }),
  proofInbox: () => request("/credentials/proofs/inbox"),
  proofsSent: () => request("/credentials/proofs/sent"),
  deleteProof: (id) => request(`/credentials/proofs/${id}`, { method: "DELETE" }),

  adminStatus: () => request("/admin/status"),
  sweepPending: () => request("/admin/sweep-pending", { method: "POST" }),
};
