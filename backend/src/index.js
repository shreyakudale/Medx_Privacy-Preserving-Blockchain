import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { config } from "./config.js";
import { storage } from "./storage.js";
import { authRouter } from "./auth.js";
import { checkGatewayConfig, exchange } from "./chain.js";
import { recordsRouter } from "./routes/records.js";
import { credentialsRouter } from "./routes/credentials.js";

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", async (_req, res) => {
  res.json({ ok: true, contract: await exchange.getAddress() });
});

app.use("/api/auth", authRouter);
app.use("/api/records", recordsRouter);
app.use("/api/credentials", credentialsRouter);

// Errors: never leak internals, but keep contract revert reasons readable.
app.use((err, _req, res, _next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `File too large. Maximum is ${config.maxUploadBytes / 1024 / 1024} MB.` });
  }
  const reason = err?.revert?.name || err?.shortMessage;
  console.error("[error]", reason || err);
  res.status(500).json({ error: reason ? `Blockchain call failed: ${reason}` : "Server error." });
});

async function main() {
  await storage.init();
  await mongoose.connect(config.mongoUri);
  console.log("[db] connected");
  const gw = await checkGatewayConfig();
  console.log(`[chain] gateway wallet ${gw}`);
  app.listen(config.port, () => console.log(`[api] listening on http://localhost:${config.port}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
