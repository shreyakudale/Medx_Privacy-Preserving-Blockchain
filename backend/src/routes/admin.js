import express from "express";
import mongoose from "mongoose";
import { ethers } from "ethers";
import { config } from "../config.js";
import { requireAuth } from "../auth.js";
import { RecordMeta, SharedProof, Credential } from "../models.js";
import { exchange, claimVerifier, provider, gatewayAddress, deploymentInfo, Role } from "../chain.js";
import { asyncRoute, rateLimit } from "../security.js";

export const adminRouter = express.Router();
adminRouter.use(requireAuth);
adminRouter.use(rateLimit({ windowMs: 60_000, max: 60, byUser: true }));

// Authorization requires the wallet to match the on-chain admin address
adminRouter.use(
  asyncRoute(async (req, res, next) => {
    const admin = await exchange.admin();
    if (admin.toLowerCase() !== req.user.toLowerCase()) {
      return res.status(403).json({ error: "Only the system deployer / network admin can access this endpoint." });
    }
    next();
  })
);

const DB_STATES = ["disconnected", "connected", "connecting", "disconnecting"];

/** Operational status snapshot for Admin dashboard */
adminRouter.get(
  "/status",
  asyncRoute(async (_req, res) => {
    const [gw, onChainGateway, block, network] = await Promise.all([
      gatewayAddress(),
      exchange.gateway().catch(() => "0x0"),
      provider.getBlockNumber().catch(() => 0),
      provider.getNetwork().catch(() => ({ chainId: 31337 })),
    ]);

    const balanceWei = await provider.getBalance(gw).catch(() => 0n);
    const balanceEth = Number(ethers.formatEther(balanceWei));

    let counts = { patients: 0, doctors: 0, hospitals: 0 };
    try {
      const regs = await exchange.queryFilter(exchange.filters.ParticipantRegistered(), deploymentInfo.deployBlock);
      for (const e of regs) {
        const r = Number(e.args.role);
        if (r === Role.Patient) counts.patients += 1;
        else if (r === Role.Doctor) counts.doctors += 1;
        else if (r === Role.Hospital) counts.hospitals += 1;
      }
    } catch (e) {
      console.warn("Could not query ParticipantRegistered events:", e);
    }

    const [recordCount, requestCount, verificationCount, pendingUploads, issuedCredentials, sharedProofs] = await Promise.all([
      exchange.recordCount().then(Number).catch(() => 0),
      exchange.requestCount().then(Number).catch(() => 0),
      claimVerifier.verificationCount().then(Number).catch(() => 0),
      RecordMeta.countDocuments({ status: "pending" }),
      Credential.countDocuments({}),
      SharedProof.countDocuments({}),
    ]);

    const matches = onChainGateway.toLowerCase() === gw.toLowerCase();
    const warnings = [];
    if (!matches) {
      warnings.push("The backend gateway wallet differs from the contract gateway. Run setGateway() in Admin dashboard to sync.");
    }
    if (balanceEth < 0.1) {
      warnings.push(`The gateway wallet balance is low (${balanceEth.toFixed(4)} ETH). Top up gateway to ensure uninterrupted record release.`);
    }

    res.json({
      api: { ok: true, uptimeSeconds: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) },
      database: { state: DB_STATES[mongoose.connection.readyState] || "unknown" },
      chain: { network: deploymentInfo.network, chainId: Number(network.chainId), blockNumber: block },
      contracts: { exchange: deploymentInfo.exchange, claimVerifier: deploymentInfo.claimVerifier },
      gateway: { onChain: onChainGateway, backend: gw, matches, balanceEth },
      participants: counts,
      totals: {
        records: recordCount,
        accessRequests: requestCount,
        verifications: verificationCount,
        pendingUploads,
        issuedCredentials,
        sharedProofs,
      },
      warnings,
    });
  })
);

/** Sweep pending uploads that were never confirmed on-chain within 1 hour */
adminRouter.post(
  "/sweep-pending",
  asyncRoute(async (_req, res) => {
    const oneHourAgo = new Date(Date.now() - 3600 * 1000);
    const result = await RecordMeta.deleteMany({ status: "pending", createdAt: { $lt: oneHourAgo } });
    res.json({ ok: true, removedCount: result.deletedCount || 0 });
  })
);
