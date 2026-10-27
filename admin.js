import express from "express";
import mongoose from "mongoose";
import { ethers } from "ethers";
import { config } from "../config.js";
import { requireAuth } from "../auth.js";
import { RecordMeta, SharedProof, Credential } from "../models.js";
import { exchange, claimVerifier, provider, gatewayAddress, deploymentInfo, Role } from "../chain.js";
import { asyncRoute, rateLimit } from "../security.js";
import { sweepPending } from "./records.js";

export const adminRouter = express.Router();
adminRouter.use(requireAuth);
adminRouter.use(rateLimit({ windowMs: 60_000, max: 60, byUser: true }));

// Authorisation is the contract's admin() address, not a flag stored in the backend.
adminRouter.use(
  asyncRoute(async (req, res, next) => {
    const admin = await exchange.admin();
    if (admin.toLowerCase() !== req.user) return res.status(403).json({ error: "Only the network admin can use this." });
    next();
  })
);

const DB_STATES = ["disconnected", "connected", "connecting", "disconnecting"];

/** Operational snapshot for the admin dashboard. Contains no patient data, only counts and addresses. */
adminRouter.get(
  "/status",
  asyncRoute(async (_req, res) => {
    const [gw, onChainGateway, block, network] = await Promise.all([
      gatewayAddress(),
      exchange.gateway(),
      provider.getBlockNumber(),
      provider.getNetwork(),
    ]);
    const balanceWei = await provider.getBalance(gw);
    const balanceEth = Number(ethers.formatEther(balanceWei));

    const regs = await exchange.queryFilter(exchange.filters.ParticipantRegistered(), deploymentInfo.deployBlock);
    const counts = { patients: 0, doctors: 0, hospitals: 0 };
    for (const e of regs) {
      const r = Number(e.args.role);
      if (r === Role.Patient) counts.patients += 1;
      else if (r === Role.Doctor) counts.doctors += 1;
      else if (r === Role.Hospital) counts.hospitals += 1;
    }

    const [recordCount, requestCount, verificationCount, pendingUploads, issuedCredentials, sharedProofs] = await Promise.all([
      exchange.recordCount(),
      exchange.requestCount(),
      claimVerifier.verificationCount(),
      RecordMeta.countDocuments({ status: "pending" }),
      Credential.countDocuments({}),
      SharedProof.countDocuments({}),
    ]);

    const matches = onChainGateway.toLowerCase() === gw.toLowerCase();
    const warnings = [];
    if (!matches) warnings.push("The backend wallet is not the gateway set on the contract. Access logging will fail until you change the gateway to the backend wallet address.");
    if (balanceEth < config.lowGatewayBalanceEth) warnings.push(`The gateway wallet balance is low (${balanceEth.toFixed(4)} ETH). Each record access costs gas.`);
    if (mongoose.connection.readyState !== 1) warnings.push("The database is not connected.");

    res.json({
      api: { ok: true, uptimeSeconds: Math.round(process.uptime()), production: config.isProd },
      database: { state: DB_STATES[mongoose.connection.readyState] || "unknown" },
      chain: { network: deploymentInfo.network, chainId: Number(network.chainId), blockNumber: block },
      contracts: { exchange: deploymentInfo.exchange, claimVerifier: deploymentInfo.claimVerifier },
      gateway: { onChain: onChainGateway, backend: gw, matches, balanceEth },
      participants: counts,
      totals: {
        records: Number(recordCount),
        accessRequests: Number(requestCount),
        verifications: Number(verificationCount),
        pendingUploads,
        issuedCredentials,
        sharedProofs,
      },
      warnings,
    });
  })
);

/** Manually run the cleanup of uploads that never reached the chain. */
adminRouter.post(
  "/sweep-pending",
  asyncRoute(async (_req, res) => {
    res.json({ removed: await sweepPending() });
  })
);
