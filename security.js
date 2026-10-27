import { config } from "./config.js";

/** Wraps an async route so rejected promises reach the error handler. */
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Conservative response headers for a JSON API. */
export function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  // Responses can contain ciphertext, wrapped keys and credentials: never cache them.
  res.setHeader("Cache-Control", "no-store");
  if (config.isProd) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}

/**
 * Small in-memory fixed-window limiter. Good enough for a single-process
 * prototype; behind several instances use a shared store (Redis) instead.
 * Keyed by IP, or by the signed-in wallet when `byUser` is set.
 */
export function rateLimit({ windowMs, max, byUser = false, message = "Too many requests. Please wait a moment and try again." }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const key = byUser && req.user ? `u:${req.user}` : `ip:${req.ip}`;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset <= now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(key, h);
    }
    h.count += 1;
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - h.count)));
    if (h.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// ---- input validation helpers -----------------------------------------
export const isBase64 = (v, { min = 1, max = 4096 } = {}) =>
  typeof v === "string" && v.length >= min && v.length <= max && /^[A-Za-z0-9+/]+={0,2}$/.test(v) && v.length % 4 === 0;

export const isDecimalString = (v, maxLen = 80) => typeof v === "string" && /^\d+$/.test(v) && v.length <= maxLen;

export const isObjectId = (v) => typeof v === "string" && /^[a-f0-9]{24}$/i.test(v);

/** Positive integer from a path/query/body value, or null. */
export function toRecordId(v) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export const CATEGORIES = ["Lab report", "Prescription", "Diagnosis", "Imaging", "Discharge summary", "Vaccination", "Other"];
