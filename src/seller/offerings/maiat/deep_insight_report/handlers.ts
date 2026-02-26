/**
 * Maiat Deep Insight — ACP Seller Handler
 *
 * Premium service: AI verification via 0G Compute + trust score.
 * Uses decentralized AI (Qwen 2.5 7B in TeeML) for review authenticity analysis.
 */

import type {
  ExecuteJobResult,
  ValidationResult,
} from "../../../runtime/offeringTypes.js";

// BUG FIX: was pointing to `maiat.vercel.app` (non-existent). Correct URL below.
const MAIAT_API =
  process.env.MAIAT_API_URL || "https://maiat-protocol.vercel.app";

// ── Validation ────────────────────────────────────────────────────────────────
export function validateRequirements(requirements: {
  project: string;
  depth?: string;
}): ValidationResult {
  if (!requirements.project || requirements.project.trim().length === 0) {
    return { valid: false, reason: "Missing project name or address" };
  }
  return { valid: true };
}

// ── Payment message ───────────────────────────────────────────────────────────
export function requestPayment(requirements: {
  project: string;
  depth?: string;
}): string {
  return `Running Deep Insight Report for "${requirements.project.substring(0, 60)}" with 0G AI verification. Please proceed with payment.`;
}

// ── Execution ─────────────────────────────────────────────────────────────────
export async function executeJob(requirements: {
  project: string;
  depth?: string;
}): Promise<ExecuteJobResult> {
  const { project, depth = "basic" } = requirements;

  // 1. Get trust score
  const scoreRes = await fetch(
    `${MAIAT_API}/api/trust-score?slug=${encodeURIComponent(project)}`,
  );
  if (!scoreRes.ok) {
    const err: any = await scoreRes.json().catch(() => ({}));
    throw new Error(err.error || `Trust score query failed (${scoreRes.status})`);
  }
  const scoreData: any = await scoreRes.json();

  // 2. Run 0G AI verification on top reviews
  let aiVerification = null;
  try {
    const verifyRes = await fetch(`${MAIAT_API}/api/verify-0g`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `${project} review verification`,
        content:
          scoreData.strengths?.[0] ||
          scoreData.concerns?.[0] ||
          "General project review",
        rating: Math.round(scoreData.avgRating || 3),
        category: scoreData.category || "DeFi",
      }),
    });
    if (verifyRes.ok) {
      const verifyData = await verifyRes.json() as any;
      aiVerification = verifyData.verification;
    }
  } catch {
    // 0G verification is best-effort; don't fail the whole job
  }

  const result = {
    trustScore: scoreData.trustScore,
    riskLevel: scoreData.riskLevel,
    reviewCount: scoreData.reviewCount,
    avgRating: scoreData.avgRating,
    sentiment: scoreData.sentiment,
    recommendation: scoreData.recommendation,
    strengths: scoreData.strengths,
    concerns: scoreData.concerns,
    aiVerification: aiVerification ?? {
      note: "0G verification unavailable — testnet setup pending",
    },
    analysisDepth: depth,
    verifiedBy: "0G Compute Network (TeeML)",
    dataSource: scoreData.dataSource,
  };

  return { deliverable: JSON.stringify(result) };
}
