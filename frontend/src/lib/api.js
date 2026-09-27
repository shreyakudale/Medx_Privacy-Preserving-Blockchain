const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

let token = localStorage.getItem("medzk_token") || null;
export function setToken(t) { 
  token = t; 
  if (t) localStorage.setItem("medzk_token", t);
  else localStorage.removeItem("medzk_token");
}

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
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  nonce: (address) => request(`/auth/nonce?address=${address}`),
  verify: (address, signature) => request("/auth/verify", { method: "POST", body: { address, signature } }),

  uploadRecord: (form) => request("/records", { method: "POST", form }),
  confirmRecord: (storageRef, recordId) => request("/records/confirm", { method: "POST", body: { storageRef, recordId } }),
  myRecords: () => request("/records/mine"),
  recordsByOwner: (address) => request(`/records/by-owner/${address}`),
  sharedWithMe: () => request("/records/shared-with-me"),
  myKey: (recordId) => request(`/records/${recordId}/key`),
  shareKey: (recordId, grantee, wrappedKey) => request(`/records/${recordId}/keys`, { method: "POST", body: { grantee, wrappedKey } }),
  removeKey: (recordId, grantee) => request(`/records/${recordId}/keys/${grantee}`, { method: "DELETE" }),
  download: (recordId) => request(`/records/${recordId}/content`),
  scanRecordWithAI: (body) => request("/records/ai-scan", { method: "POST", body }),

  issuerKey: () => request("/credentials/issuer-key"),
  issueCredential: (body) => request("/credentials/issue", { method: "POST", body }),
  myCredentials: () => request("/credentials/mine"),
  shareProof: (body) => request("/credentials/proofs", { method: "POST", body }),
  proofInbox: () => request("/credentials/proofs/inbox"),
};
