/**
 * Maiat Agent Trust — ACP Seller Handler
 *
 * Returns trust score for any ACP agent wallet based on on-chain job history.
 */

import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { createServiceAttestation, type Address } from "../../../../lib/eas.js";

const MAIAT_API = process.env.MAIAT_API_URL || "https://app.maiat.io";
const INTERNAL_TOKEN = process.env.MAIAT_INTERNAL_TOKEN || "";

// ── Validation ────────────────────────────────────────────────────────────────
export function validateRequirements(requirements: Record<string, unknown>): ValidationResult {
  const agent = extractAgentAddress(requirements);
  if (!agent) {
    return {
      valid: false,
      reason: "Missing or invalid agent address. Provide a 0x wallet address.",
    };
  }
  return { valid: true };
}

// ── Payment message ───────────────────────────────────────────────────────────
export function requestPayment(requirements: Record<string, unknown>): string {
  const agent = extractAgentAddress(requirements);
  const shortAddr = agent ? `${agent.slice(0, 6)}...${agent.slice(-4)}` : "agent";
  return `Checking trust score for ${shortAddr}. Please proceed with payment.`;
}

// ── Execution ─────────────────────────────────────────────────────────────────
export async function executeJob(requirements: Record<string, unknown>): Promise<ExecuteJobResult> {
  const agent = extractAgentAddress(requirements);

  if (!agent) {
    return {
      deliverable: JSON.stringify({
        score: null,
        verdict: "unknown",
        riskSummary: "No valid agent address provided. Pass { agent: '0x...' } as requirements.",
      }),
    };
  }

  const threshold = typeof requirements.threshold === "number" ? requirements.threshold : 60;

  try {
    // Use /deep endpoint to get all data in one call
    const url = `${MAIAT_API}/api/v1/agent/${agent}/deep`;
    const headers: Record<string, string> = { "x-maiat-client": "maiat-acp" };
    if (INTERNAL_TOKEN) {
      headers["x-internal-token"] = INTERNAL_TOKEN;
    }

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 404) {
      return {
        deliverable: JSON.stringify({
          score: null,
          verdict: "unknown",
          completionRate: null,
          paymentRate: null,
          totalJobs: 0,
          ageWeeks: null,
          riskSummary: "Agent not yet indexed — no ACP job history found",
          lastUpdated: null,
        }),
      };
    }

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error((err.error as string) || `Agent trust query failed (${res.status})`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const breakdown = (data.breakdown ?? {}) as Record<string, unknown>;
    const deep = (data.deep ?? {}) as Record<string, unknown>;

    const score = typeof data.trustScore === "number" ? data.trustScore : null;
    const completionRate =
      typeof breakdown.completionRate === "number" ? breakdown.completionRate : null;
    const paymentRate = typeof breakdown.paymentRate === "number" ? breakdown.paymentRate : null;
    const expireRate = typeof breakdown.expireRate === "number" ? breakdown.expireRate : null;
    const totalJobs = typeof breakdown.totalJobs === "number" ? breakdown.totalJobs : 0;
    const ageWeeks = typeof breakdown.ageWeeks === "number" ? breakdown.ageWeeks : null;
    const lastUpdated = typeof data.lastUpdated === "string" ? data.lastUpdated : null;
    const apiVerdict = typeof data.verdict === "string" ? data.verdict : null;

    // Deep fields
    const percentile = typeof deep.percentile === "number" ? deep.percentile : null;
    const tier = typeof deep.tier === "string" ? deep.tier : "new";
    const riskFlags = Array.isArray(deep.riskFlags) ? deep.riskFlags : [];
    const category = typeof deep.category === "string" ? deep.category : null;

    // Determine verdict
    let verdict: string;
    if (apiVerdict && apiVerdict !== "unknown") {
      verdict = apiVerdict;
    } else if (score === null) {
      verdict = "unknown";
    } else if (score >= threshold) {
      verdict = "proceed";
    } else if (score >= 40) {
      verdict = "caution";
    } else {
      verdict = "avoid";
    }

    // Build risk summary
    let riskSummary: string;
    if (score === null) {
      riskSummary = "No score available — insufficient job history";
    } else if (verdict === "proceed") {
      riskSummary = `Score ${score}/100 — reliable agent with ${totalJobs} completed jobs`;
    } else if (verdict === "caution") {
      riskSummary = `Score ${score}/100 — some concerns, review completion/payment rates`;
    } else {
      riskSummary = `Score ${score}/100 — high risk, low completion or payment rate`;
    }

    // Non-blocking EAS attestation
    createServiceAttestation({
      agent: agent as Address,
      service: "agent_trust",
      result: "success",
      trustScoreAtTime: score ?? 0,
      jobId: 0, // No job ID available in query context
    }).catch((err) => {
      console.error("[eas] agent_trust attestation failed:", err);
    });

    return {
      deliverable: JSON.stringify({
        score,
        verdict,
        completionRate,
        paymentRate,
        expireRate,
        totalJobs,
        ageWeeks,
        percentile,
        tier,
        riskFlags,
        category,
        riskSummary,
        lastUpdated,
        _feedback: {
          queryId: `trust-${Date.now()}`,
          reportOutcome: `After interacting with this agent, POST outcome to ${MAIAT_API}/api/v1/outcome — earn 5 🪲 Scarab and boost your own trust score.`,
          deeperInsight: `Want community opinions? Buy agent_reputation ($0.03) for reviews, votes, and market consensus.`,
        },
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      deliverable: JSON.stringify({
        score: null,
        verdict: "unknown",
        riskSummary: `Error querying agent trust: ${message}`,
      }),
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract agent address from requirements with flexible parsing.
 * Checks requirements.agent, requirements.address, or scans for 0x address in values.
 */
function extractAgentAddress(requirements: Record<string, unknown>): string | null {
  // Direct field access
  for (const key of ["agent", "wallet", "address", "walletAddress"]) {
    const val = requirements[key];
    if (typeof val === "string" && isValidAddress(val)) {
      return val.toLowerCase();
    }
  }

  // Scan all string values for a 0x address
  const allText = Object.values(requirements)
    .filter((v): v is string => typeof v === "string")
    .join(" ");

  const match = allText.match(/0x[a-fA-F0-9]{40}/);
  if (match) {
    return match[0].toLowerCase();
  }

  return null;
}

function isValidAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}
