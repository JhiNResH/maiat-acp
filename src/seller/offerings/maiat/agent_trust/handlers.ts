/**
 * Maiat Agent Trust — ACP Seller Handler
 *
 * Returns trust score for any ACP agent wallet based on on-chain job history.
 */

import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

const MAIAT_API = process.env.MAIAT_API_URL || "https://maiat-protocol.vercel.app";
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
    const url = `${MAIAT_API}/api/v1/agent/${agent}`;
    const headers: Record<string, string> = {};
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

    const score = typeof data.trustScore === "number" ? data.trustScore : null;
    const completionRate =
      typeof breakdown.completionRate === "number" ? breakdown.completionRate : null;
    const paymentRate = typeof breakdown.paymentRate === "number" ? breakdown.paymentRate : null;
    const totalJobs = typeof breakdown.totalJobs === "number" ? breakdown.totalJobs : 0;
    const ageWeeks = typeof breakdown.ageWeeks === "number" ? breakdown.ageWeeks : null;
    const lastUpdated = typeof data.lastUpdated === "string" ? data.lastUpdated : null;
    // Use API verdict if available
    const apiVerdict = typeof data.verdict === "string" ? data.verdict : null;

    // Determine verdict — prefer API verdict, fall back to threshold logic
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

    return {
      deliverable: JSON.stringify({
        score,
        verdict,
        completionRate,
        paymentRate,
        totalJobs,
        ageWeeks,
        riskSummary,
        lastUpdated,
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
