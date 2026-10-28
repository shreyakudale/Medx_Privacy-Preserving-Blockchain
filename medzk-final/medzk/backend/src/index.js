import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { config } from "./config.js";
import { storage } from "./storage.js";
import { authRouter } from "./auth.js";
import { checkGatewayConfig, exchange, provider } from "./chain.js";
import { recordsRouter, sweepPending, validateAgainstChain } from "./routes/records.js";
import { RecordMeta } from "./models.js";
import { credentialsRouter } from "./routes/credentials.js";
import { adminRouter } from "./routes/admin.js";
import { securityHeaders, rateLimit } from "./security.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", config.isProd ? 1 : false);
app.use(securityHeaders);
app.use(
  cors({
    origin(origin, cb) {
      // Same-origin tools (curl, health checks) send no Origin header.
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      cb(new Error("CORS_BLOCKED"));
    },
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  })
);
app.use(express.json({ limit: "1mb" }));

/** Liveness plus real dependency checks, so "healthy" actually means the app can serve. */
app.get("/api/health", async (_req, res) => {
  const checks = { database: mongoose.connection.readyState === 1, chain: false, contract: false };
  try {
    await provider.getBlockNumber();
    checks.chain = true;
    await exchange.gateway();
    checks.contract = true;
  } catch { /* reported below */ }
  const ok = Object.values(checks).every(Boolean);
  res.status(ok ? 200 : 503).json({ ok, checks, contract: await exchange.getAddress() });
});

// Brute-force protection on the sign-in endpoints.
app.use("/api/auth", rateLimit({ windowMs: 60_000, max: 30, message: "Too many sign-in attempts. Please wait a minute." }), authRouter);
app.use("/api/records", recordsRouter);
app.use("/api/credentials", credentialsRouter);
app.use("/api/admin", adminRouter);

app.use((_req, res) => res.status(404).json({ error: "Not found." }));

// Contract revert names we turn into clear, correctly-coded responses.
const REVERTS = {
  NoAccess: [403, "Access ended before it could be logged. It may have just expired or been revoked."],
  NotGateway: [503, "The server's wallet is not authorised on the contract. Ask the admin to set the gateway address."],
  NotAdmin: [403, "Only the network admin can do this."],
};

// Errors: never leak internals, but keep contract revert reasons readable.
app.use((err, _req, res, _next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `File too large. Maximum is ${config.maxUploadBytes / 1024 / 1024} MB.` });
  }
  if (err?.name === "MulterError") return res.status(400).json({ error: "The upload was not understood." });
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Request body too large." });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON." });
  if (err?.message === "CORS_BLOCKED") return res.status(403).json({ error: "This origin is not allowed." });
  const revert = err?.revert?.name;
  if (revert && REVERTS[revert]) return res.status(REVERTS[revert][0]).json({ error: REVERTS[revert][1] });
  // Log the reason only. Request bodies and wallet data are never logged.
  console.error("[error]", revert || err?.shortMessage || err?.message || "unknown");
  res.status(500).json({ error: revert ? `Blockchain call failed: ${revert}` : "Server error." });
});

async function main() {
  await storage.init();
  await mongoose.connect(config.mongoUri);
  console.log("[db] connected");
  const gw = await checkGatewayConfig();
  console.log(`[chain] gateway wallet ${gw}`);

  // Local development resets the chain on every Hardhat restart. Retire stored records that no longer match
  // it BEFORE the unique index is (re)built, so old duplicates cannot block uploads.
  try {
    const n = await validateAgainstChain();
    if (n) console.warn(`[records] ${n} stored record(s) belonged to a previous blockchain and were archived.`);
  } catch (e) {
    console.warn("[records] could not check stored records against the chain:", e?.shortMessage || e?.message);
  }
  try {
    await RecordMeta.syncIndexes();
  } catch (e) {
    console.warn("[db] index sync problem (uploads still work, duplicate protection may be off):", e?.message);
  }
  const server = app.listen(config.port, () => console.log(`[api] listening on http://localhost:${config.port}`));

  // Housekeeping: discard uploads that never made it on-chain.
  const sweep = () =>
    sweepPending()
      .then((n) => n && console.log(`[sweep] removed ${n} abandoned upload(s)`))
      .then(() => validateAgainstChain())
      .catch((e) => console.error("[sweep]", e?.message));
  setInterval(sweep, 15 * 60 * 1000).unref();

  const shutdown = () => {
    server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
