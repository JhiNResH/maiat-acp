#!/usr/bin/env npx tsx
// =============================================================================
// Seller runtime — main entrypoint.
//
// Usage:
//   npx tsx src/seller/runtime/seller.ts
//   (or)  acp serve start
// =============================================================================

import { connectAcpSocket } from "./acpSocket.js";
import { acceptOrRejectJob, requestPayment, deliverJob } from "./sellerApi.js";
import { loadOffering, listOfferings } from "./offerings.js";
import { AcpJobPhase, type AcpJobEventData } from "./types.js";
import type { ExecuteJobResult } from "./offeringTypes.js";
import { getMyAgentInfo } from "../../lib/wallet.js";
import {
  createAttestation,
  isEasEnabled,
  updateOracle,
  isOracleEnabled,
  type AttestationData,
} from "../../lib/eas.js";

const MAIAT_REVIEW_URL =
  process.env.MAIAT_REVIEW_URL || "https://maiat-protocol.vercel.app/api/v1/review";

/**
 * Post an automated behavioral review after successfully completing a job.
 * The buyer (clientAddress) gets reviewed by Maiat (our wallet).
 */
async function postAutoReview(
  clientAddress: string,
  maiatWallet: string,
  offeringName: string,
  jobId: number
) {
  const rating = 7; // Default positive rating for completed jobs
  const comment = `Automated review: ${offeringName} job #${jobId} completed successfully.`;

  const res = await fetch(MAIAT_REVIEW_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: clientAddress,
      rating,
      comment,
      reviewer: maiatWallet,
      source: "agent",
      tags: ["acp", offeringName, "auto"],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Review API ${res.status}: ${text}`);
  }

  console.log(`[seller] Auto-review posted for ${clientAddress} (job ${jobId}, ${offeringName})`);
}
import {
  checkForExistingProcess,
  writePidToConfig,
  removePidFromConfig,
  sanitizeAgentName,
} from "../../lib/config.js";

function setupCleanupHandlers(): void {
  const cleanup = () => {
    removePidFromConfig();
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("uncaughtException", (err) => {
    console.error("[seller] Uncaught exception:", err);
    cleanup();
    process.exit(1);
  });
  process.on("unhandledRejection", (reason, promise) => {
    console.error("[seller] Unhandled rejection at:", promise, "reason:", reason);
    cleanup();
    process.exit(1);
  });
}

// -- Config --

const ACP_URL = process.env.ACP_SOCKET_URL || "https://acpx.virtuals.io";
let agentDirName: string = "";
let sellerWalletAddress: string = "";

// -- Job handling --

function resolveOfferingName(data: AcpJobEventData): string | undefined {
  try {
    const negotiationMemo = data.memos.find((m) => m.nextPhase === AcpJobPhase.NEGOTIATION);
    if (negotiationMemo) {
      return JSON.parse(negotiationMemo.content).name;
    }
  } catch {
    return undefined;
  }
}

function resolveServiceRequirements(data: AcpJobEventData): Record<string, any> {
  const negotiationMemo = data.memos.find((m) => m.nextPhase === AcpJobPhase.NEGOTIATION);
  if (negotiationMemo) {
    try {
      return JSON.parse(negotiationMemo.content).requirement;
    } catch {
      return {};
    }
  }
  return {};
}

async function handleNewTask(data: AcpJobEventData): Promise<void> {
  const jobId = data.id;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`[seller] New task  jobId=${jobId}  phase=${AcpJobPhase[data.phase] ?? data.phase}`);
  console.log(`         client=${data.clientAddress}  price=${data.price}`);
  console.log(`         context=${JSON.stringify(data.context)}`);
  console.log(`${"=".repeat(60)}`);

  // Step 1: Accept / reject
  if (data.phase === AcpJobPhase.REQUEST) {
    if (!data.memoToSign) {
      return;
    }

    const negotiationMemo = data.memos.find((m) => m.id == Number(data.memoToSign));

    if (negotiationMemo?.nextPhase !== AcpJobPhase.NEGOTIATION) {
      return;
    }

    const offeringName = resolveOfferingName(data);
    const requirements = resolveServiceRequirements(data);

    if (!offeringName) {
      await acceptOrRejectJob(jobId, {
        accept: false,
        reason: "Invalid offering name",
      });
      return;
    }

    try {
      const { config, handlers } = await loadOffering(offeringName, agentDirName);

      if (handlers.validateRequirements) {
        const validationResult = handlers.validateRequirements(requirements);

        let isValid: boolean;
        let reason: string | undefined;

        if (typeof validationResult === "boolean") {
          isValid = validationResult;
          reason = isValid ? undefined : "Validation failed";
        } else {
          isValid = validationResult.valid;
          reason = validationResult.reason;
        }

        if (!isValid) {
          const rejectionReason = reason || "Validation failed";
          console.log(
            `[seller] Validation failed for offering "${offeringName}" — rejecting: ${rejectionReason}`
          );
          await acceptOrRejectJob(jobId, {
            accept: false,
            reason: rejectionReason,
          });
          return;
        }
      }

      await acceptOrRejectJob(jobId, {
        accept: true,
        reason: "Job accepted",
      });

      const funds =
        config.requiredFunds && handlers.requestAdditionalFunds
          ? handlers.requestAdditionalFunds(requirements)
          : undefined;

      const paymentReason = handlers.requestPayment
        ? handlers.requestPayment(requirements)
        : (funds?.content ?? "Request accepted");

      await requestPayment(jobId, {
        content: paymentReason,
        payableDetail: funds
          ? {
              amount: funds.amount,
              tokenAddress: funds.tokenAddress,
              recipient: funds.recipient,
            }
          : undefined,
      });
    } catch (err) {
      console.error(`[seller] Error processing job ${jobId}:`, err);
    }
  }

  // Handle TRANSACTION (deliver)
  if (data.phase === AcpJobPhase.TRANSACTION) {
    const offeringName = resolveOfferingName(data);
    const requirements = resolveServiceRequirements(data);

    if (offeringName) {
      try {
        const { handlers } = await loadOffering(offeringName, agentDirName);
        console.log(
          `[seller] Executing offering "${offeringName}" for job ${jobId} (TRANSACTION phase)...`
        );
        // Inject client wallet into requirements so handlers (e.g. trust_swap) can auto-use it
        const enrichedRequirements = {
          ...requirements,
          _clientAddress: data.clientAddress,
          swapper: requirements.swapper || data.clientAddress,
        };
        const result: ExecuteJobResult = await handlers.executeJob(enrichedRequirements);

        await deliverJob(jobId, {
          deliverable: result.deliverable,
          payableDetail: result.payableDetail,
        });
        console.log(`[seller] Job ${jobId} — delivered.`);

        // Auto-post behavioral review to Maiat Protocol
        postAutoReview(data.clientAddress, sellerWalletAddress, offeringName, jobId).catch((err) =>
          console.error(`[seller] Auto-review failed for job ${jobId}:`, err.message)
        );
        // Update on-chain EAS and Oracle sequentially (non-blocking to main thread)
        (async () => {
          if (isEasEnabled()) {
            await tryCreateAttestation(
              result.deliverable,
              data.clientAddress,
              offeringName,
              jobId
            ).catch((err) =>
              console.error(`[seller] EAS attestation failed for job ${jobId}:`, err.message)
            );
          }
          if (isOracleEnabled()) {
            await tryUpdateOracle(
              result.deliverable,
              data.clientAddress,
              offeringName,
              jobId
            ).catch((err) =>
              console.error(`[seller] Oracle update failed for job ${jobId}:`, err.message)
            );
          }
        })();
      } catch (err) {
        console.error(`[seller] Error delivering job ${jobId}:`, err);
      }
    } else {
      console.log(`[seller] Job ${jobId} in TRANSACTION but no offering resolved — skipping`);
    }
    return;
  }

  console.log(
    `[seller] Job ${jobId} in phase ${AcpJobPhase[data.phase] ?? data.phase} — no action needed`
  );
}

// -- EAS helper --

/**
 * Attempt to create an EAS attestation from the job deliverable.
 * Parses the deliverable JSON for score/verdict/riskSummary fields.
 */
async function tryCreateAttestation(
  deliverable: string | { type: string; value: unknown },
  clientAddress: string,
  offeringName: string,
  jobId: number
): Promise<void> {
  try {
    const parsed = typeof deliverable === "string" ? JSON.parse(deliverable) : deliverable;

    const score =
      typeof parsed.score === "number"
        ? parsed.score
        : typeof parsed.trustScore === "number"
          ? parsed.trustScore
          : null;

    if (score === null) return; // No score to attest

    const attestData: AttestationData = {
      agent: clientAddress as `0x${string}`,
      score: Math.min(255, Math.max(0, Math.round(score))),
      verdict: parsed.verdict || "unknown",
      offering: offeringName,
      jobId,
      riskSummary: parsed.riskSummary || "",
    };

    await createAttestation(attestData);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[eas] Failed to parse deliverable for attestation: ${msg}`);
  }
}

/**
 * Attempt to update the MaiatOracle from the job deliverable.
 */
async function tryUpdateOracle(
  deliverable: string | { type: string; value: unknown },
  clientAddress: string,
  offeringName: string,
  jobId: number
): Promise<void> {
  try {
    const parsed = typeof deliverable === "string" ? JSON.parse(deliverable) : deliverable;

    const score =
      typeof parsed.score === "number"
        ? parsed.score
        : typeof parsed.trustScore === "number"
          ? parsed.trustScore
          : null;

    if (score === null) return;

    await updateOracle({
      agent: clientAddress as `0x${string}`,
      score: Math.min(255, Math.max(0, Math.round(score))),
      verdict: parsed.verdict || "unknown",
      offering: offeringName,
      jobId,
      riskSummary: parsed.riskSummary || "",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[oracle] Failed to parse deliverable for oracle update: ${msg}`);
  }
}

// -- Main --

async function main() {
  checkForExistingProcess();

  writePidToConfig(process.pid);

  setupCleanupHandlers();

  let walletAddress: string;
  try {
    const agentData = await getMyAgentInfo();
    walletAddress = agentData.walletAddress;
    sellerWalletAddress = walletAddress;
    agentDirName = sanitizeAgentName(agentData.name);
    console.log(`[seller] Agent: ${agentData.name} (dir: ${agentDirName})`);
  } catch (err) {
    console.error("[seller] Failed to resolve agent info:", err);
    process.exit(1);
  }

  const offerings = listOfferings(agentDirName);
  console.log(
    `[seller] Available offerings: ${offerings.length > 0 ? offerings.join(", ") : "(none)"}`
  );

  connectAcpSocket({
    acpUrl: ACP_URL,
    walletAddress,
    callbacks: {
      onNewTask: (data) => {
        handleNewTask(data).catch((err) =>
          console.error("[seller] Unhandled error in handleNewTask:", err)
        );
      },
      onEvaluate: (data) => {
        console.log(
          `[seller] onEvaluate received for job ${data.id} — no action (evaluation handled externally)`
        );
      },
    },
  });

  console.log("[seller] Seller runtime is running. Waiting for jobs...\n");
}

main().catch((err) => {
  console.error("[seller] Fatal error:", err);
  process.exit(1);
});
