/**
 * Maiat Trust Gate — ACP Seller Handler
 *
 * Pre-payment trust check for x402 agent commerce. ($0.05)
 * Designed to sit before an x402 payment — Agent A checks Agent B
 * before committing USDC.
 *
 * Calls maiat-protocol's /api/v1/trust-check with internal token bypass
 * (no circular x402 payment needed — revenue comes from ACP fee).
 *
 * Returns machine-readable verdict: proceed | caution | block
 */

import type {
  ExecuteJobResult,
  ValidationResult,
} from "../../../runtime/offeringTypes.js";

const MAIAT_API =
  process.env.MAIAT_API_URL || "https://maiat-protocol.vercel.app";
const INTERNAL_TOKEN = process.env.MAIAT_INTERNAL_TOKEN || "";

// ── Validation ────────────────────────────────────────────────────────────────
export function validateRequirements(
  requirements: Record<string, any>,
): ValidationResult {
  const agent =
    requirements.agent ||
    requirements.address ||
    requirements.message ||
    Object.values(requirements).join(" ");

  const hasAddress = typeof agent === "string" && /0x[a-fA-F0-9]{40}/.test(agent);

  if (!hasAddress) {
    return {
      valid: false,
      reason: "Provide 'agent' as a valid 0x EVM address to check trust before paying",
    };
  }
  return { valid: true };
}

// ── Payment message ───────────────────────────────────────────────────────────
export function requestPayment(requirements: Record<string, any>): string {
  const agent = requirements.agent || requirements.address || "the agent";
  const amount = requirements.payment_amount;
  const amountStr = amount ? ` before sending $${amount} USDC` : "";
  return `Running trust gate check on ${String(agent).substring(0, 20)}${amountStr}. Proceed with payment.`;
}

// ── Execution ─────────────────────────────────────────────────────────────────
export async function executeJob(
  requirements: Record<string, any>,
): Promise<ExecuteJobResult> {
  // Extract 0x address
  const input =
    requirements.agent ||
    requirements.address ||
    requirements.message ||
    Object.values(requirements).join(" ");

  const match = String(input).match(/0x[a-fA-F0-9]{40}/);
  if (!match) {
    throw new Error("No valid 0x address found in 'agent' field");
  }

  const agentAddress = match[0];
  const threshold = requirements.threshold ?? 60;
  const paymentAmount = requirements.payment_amount
    ? parseFloat(requirements.payment_amount)
    : null;

  // Adjust threshold for large payments (be more conservative)
  let effectiveThreshold = threshold;
  if (paymentAmount !== null && paymentAmount >= 10) {
    effectiveThreshold = Math.max(threshold, 70); // Raise bar for $10+
  }

  // Call maiat-protocol trust-check with internal token bypass
  const url = `${MAIAT_API}/api/v1/trust-check?agent=${agentAddress}&threshold=${effectiveThreshold}`;

  let trustData: any = null;
  try {
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(INTERNAL_TOKEN ? { "X-Internal-Token": INTERNAL_TOKEN } : {}),
        // Fallback: pass a dummy payment header so it doesn't 402
        // (internal token preferred, payment header as safety net)
        "X-Payment": "internal-acp-call",
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (res.ok) {
      trustData = await res.json();
    } else if (res.status === 404) {
      // Address not in Maiat registry — return caution with helpful message
      return {
        deliverable: JSON.stringify({
          verdict: "caution",
          score: null,
          error: "Address not found in Maiat registry — no prior interaction data",
          action: "New or unverified agent. Proceed with caution or request collateral.",
          suggestion: "Submit a review at maiat-protocol.vercel.app to add this agent.",
        }),
      };
    } else if (res.status === 402) {
      // Internal token not configured — call failed
      // Degrade gracefully: return unknown verdict
      return {
        deliverable: JSON.stringify({
          verdict: "unknown",
          score: null,
          error: "Trust gate internal token not configured — contact Maiat operator",
          action: "Proceed with caution or skip this payment",
        }),
      };
    }
  } catch (e: any) {
    return {
      deliverable: JSON.stringify({
        verdict: "unknown",
        score: null,
        error: `Trust check failed: ${e.message}`,
        action: "Proceed with caution — trust data unavailable",
      }),
    };
  }

  if (!trustData) {
    return {
      deliverable: JSON.stringify({
        verdict: "unknown",
        score: null,
        error: "No trust data returned",
      }),
    };
  }

  // Build risk summary
  const { verdict, score, x402_checks, outcome_score, dispute_rate, review_count, avg_rating } = trustData;

  let riskSummary: string;
  if (verdict === "proceed") {
    riskSummary = score >= 80
      ? `Strong trust signal (${score}/100). ${x402_checks ?? 0} prior checks, ${outcome_score !== null ? `${outcome_score}/100 outcome score` : "no outcome data yet"}.`
      : `Acceptable trust (${score}/100). Proceed with standard caution.`;
  } else if (verdict === "caution") {
    riskSummary = `Below threshold (${score}/100 vs threshold ${effectiveThreshold}). Consider asking for collateral or reducing payment amount.`;
  } else {
    riskSummary = `Low trust (${score}/100). ${dispute_rate !== null ? `${dispute_rate}% dispute rate. ` : ""}Block or demand escrow.`;
  }

  // Outcome-based override: if dispute_rate > 20%, escalate to block
  if (dispute_rate !== null && dispute_rate > 20 && verdict !== "block") {
    riskSummary = `⚠️ Override: High dispute rate (${dispute_rate}%). Escalating verdict to block.`;
  }
  const finalVerdict =
    dispute_rate !== null && dispute_rate > 20 ? "block" : verdict;

  const result = {
    // ── Core verdict ──
    verdict: finalVerdict,
    score: score ?? null,
    threshold: effectiveThreshold,

    // ── Agent-only signals ──
    x402_checks: x402_checks ?? 0,
    outcome_score: outcome_score ?? null,
    dispute_rate: dispute_rate ?? null,
    outcome_count: trustData.outcome_count ?? 0,

    // ── Context ──
    review_count: review_count ?? 0,
    avg_rating: avg_rating ?? null,
    risk_summary: riskSummary,

    // ── Metadata ──
    checked_agent: agentAddress,
    payment_amount_usd: paymentAmount,
    powered_by: "Maiat Trust Gate",

    // ── Close the flywheel: report outcome after job completes ──
    outcome_report: finalVerdict === "proceed" ? {
      please_report: "POST https://maiat-protocol.vercel.app/api/v1/outcome",
      when: "After the job completes, report the result to update this agent's trust score",
      payload: {
        sellerAddress: agentAddress,
        buyerAddress: "<your_wallet_address>",
        result: "success | failed | dispute",
        paymentTxHash: "<tx_hash_of_your_payment>",
      },
      why: "Your outcome report improves trust scores for the entire agent ecosystem",
    } : null,
  };

  return { deliverable: JSON.stringify(result) };
}
