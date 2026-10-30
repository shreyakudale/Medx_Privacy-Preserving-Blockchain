import { config } from "./config.js";

/** Wraps an async route so rejected promises reach the error handler. */
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Conservative response headers for a healthcare JSON API. */
export function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  // Medical records, ciphertexts, and wrapped keys must never be cached by intermediaries
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  next();
}

/**
 * In-memory fixed-window rate limiter for sensitive endpoints.
 * Keyed by user wallet address when authenticated, or client IP otherwise.
 */
export function rateLimit({ windowMs = 60_000, max = 100, byUser = false, message = "Too many requests. Please wait a moment and try again." } = {}) {
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

export const isBase64 = (v, { min = 1, max = 4096 } = {}) =>
  typeof v === "string" && v.length >= min && v.length <= max && /^[A-Za-z0-9+/]+={0,2}$/.test(v) && v.length % 4 === 0;

export const isDecimalString = (v, maxLen = 80) => typeof v === "string" && /^\d+$/.test(v) && v.length <= maxLen;

export function toRecordId(v) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
