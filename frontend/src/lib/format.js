export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export function when(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts) * 1000);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function remaining(expiresAt) {
  const s = Number(expiresAt) - Math.floor(Date.now() / 1000);
  if (s <= 0) return "expired";
  if (s < 3600) return `${Math.ceil(s / 60)} min left`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min left`;
  return `${Math.floor(s / 86400)} days left`;
}

export const DURATIONS = [
  { label: "1 hour", seconds: 3600 },
  { label: "24 hours", seconds: 86400 },
  { label: "3 days", seconds: 3 * 86400 },
  { label: "7 days", seconds: 7 * 86400 },
  { label: "30 days", seconds: 30 * 86400 },
];

export function durationLabel(seconds) {
  const d = DURATIONS.find((x) => x.seconds === Number(seconds));
  if (d) return d.label;
  const h = Number(seconds) / 3600;
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} days`;
}

export const CATEGORIES = ["Lab report", "Prescription", "Diagnosis", "Imaging", "Discharge summary", "Vaccination", "Other"];
