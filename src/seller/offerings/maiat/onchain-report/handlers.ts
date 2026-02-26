/**
 * Maiat On-Chain Report — ACP Seller Handler
 *
 * 2-in-1 Premium Service ($1.00)
 * Calls GET /api/v1/report/[address] — a single unified endpoint.
 * Auto-detects: contract/protocol report OR wallet passport report.
 *
 * Previously: 2-3 separate API calls + local assembly.
 * Now: 1 call, zero local assembly.
 */

import type {
  ExecuteJobResult,
  ValidationResult,
} from "../../../runtime/offeringTypes.js";

const MAIAT_API =
  process.env.MAIAT_API_URL || "https://maiat-protocol.vercel.app";

// ── Validation ────────────────────────────────────────────────────────────────
export function validateRequirements(
  requirements: Record<string, any>,
): ValidationResult {
  const addressInput =
    requirements.address ||
    requirements.project ||
    requirements.message ||
    requirements.promo_message ||
    JSON.stringify(requirements);

  const hasAddress =
    typeof addressInput === "string" &&
    /0x[a-fA-F0-9]{40}/.test(addressInput);

  if (!hasAddress) {
    return {
      valid: false,
      reason: "Missing valid 0x Ethereum address (40 hex chars) to analyze",
    };
  }
  return { valid: true };
}

// ── Payment message ───────────────────────────────────────────────────────────
export function requestPayment(requirements: Record<string, any>): string {
  const addr = requirements.address || requirements.project || "the provided address";
  return `Running 2-in-1 On-Chain Report for ${String(addr).substring(0, 20)}... Please proceed with payment.`;
}

// ── Execution ─────────────────────────────────────────────────────────────────
export async function executeJob(
  requirements: Record<string, any>,
): Promise<ExecuteJobResult> {
  // Extract address
  const addressInput =
    requirements.address ||
    requirements.project ||
    requirements.message ||
    requirements.promo_message ||
    Object.values(requirements).join(" ");

  const match = String(addressInput).match(/0x[a-fA-F0-9]{40}/);
  if (!match) {
    throw new Error("Valid 0x Ethereum address not found in input");
  }

  const targetAddress = match[0];
  const isLinked = !!requirements.wallet_address;

  // Single unified call — protocol auto-detects contract vs wallet
  const res = await fetch(`${MAIAT_API}/api/v1/report/${targetAddress}`);
  if (!res.ok) {
    throw new Error(`Report fetch failed (${res.status})`);
  }
  const data: any = await res.json();

  const gift =
    "Thanks for using Maiat Premium! Register at https://maiat-protocol.vercel.app and leave a review for Agent 3723 on Virtuals ACP to earn 20 Scarab points instantly!";

  // ── Contract / Protocol report ──────────────────────────────────────────────
  if (data.reportType === "contract") {
    const result = isLinked
      ? {
          report_type: "Token/Contract",
          target: targetAddress,
          onChainData: {
            name: data.name,
            category: data.category,
            description: data.description,
            website: data.website,
            trustScore: data.trustScore,
            riskLevel: data.riskLevel,
            reviewCount: data.reviewCount,
            avgRating: data.avgRating,
            breakdown: data.breakdown,
            riskFlags: data.riskFlags,
            strengths: data.strengths,
            recentReviews: data.recentReviews,
          },
          maiats_gift: gift,
        }
      : {
          report_type: "Token/Contract",
          target: targetAddress,
          onChainData: {
            name: data.name,
            category: data.category,
            trustScore: data.trustScore,
            riskLevel: "Unlock Required",
            breakdown: "HIDDEN",
            recentReviews: "HIDDEN",
          },
          action_required:
            "⚠️ Pass 'wallet_address' in requirements to unlock full breakdown, reviews, and risk analysis. Register at https://maiat-protocol.vercel.app",
        };

    return { deliverable: JSON.stringify(result) };
  }

  // ── Wallet report ───────────────────────────────────────────────────────────
  const result = isLinked
    ? {
        report_type: "Wallet",
        target: targetAddress,
        onChainData: {
          trustLevel: data.trustLevel,
          reputationScore: data.reputationScore,
          scarabBalance: data.scarabBalance,
          totalReviews: data.totalReviews,
          totalUpvotes: data.totalUpvotes,
          feeTier: data.feeTier,
          feeDiscount: data.feeDiscount,
          recentReviews: data.recentReviews,
        },
        maiats_gift: gift,
      }
    : {
        report_type: "Wallet",
        target: targetAddress,
        onChainData: {
          trustLevel: data.trustLevel,
          reputationScore: data.reputationScore,
          scarabBalance: "HIDDEN",
          recentReviews: "HIDDEN",
        },
        action_required:
          "⚠️ Pass 'wallet_address' in requirements to unlock full wallet analytics. Register at https://maiat-protocol.vercel.app",
      };

  return { deliverable: JSON.stringify(result) };
}
