/**
 * Maiat On-Chain Report — ACP Seller Handler
 *
 * 2-in-1 Premium Service ($1.00)
 * Uses maiat-protocol to fetch either:
 * - Token Due Diligence (if address is a token contract)
 * - Wallet Profiling (if address is a wallet)
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
  const addr = requirements.address || "the provided address";
  return `Running 2-in-1 On-Chain Report for ${String(addr).substring(0, 20)}... Please proceed with payment.`;
}

// ── Execution ─────────────────────────────────────────────────────────────────
export async function executeJob(
  requirements: Record<string, any>,
): Promise<ExecuteJobResult> {
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

  // 1. Try to fetch as a Token first
  const tokenRes = await fetch(`${MAIAT_API}/api/v1/token/${targetAddress}`);
  if (tokenRes.ok) {
    const tokenData = await tokenRes.json() as any;

    if (
      tokenData.isToken ||
      tokenData.type === "CONTRACT" ||
      tokenData.type === "TOKEN" ||
      tokenData.type === "PROTOCOL"
    ) {
      const result = isLinked
        ? {
            report_type: "Token/Contract",
            target: targetAddress,
            onChainData: {
              name: tokenData.name || "Unknown Contract",
              symbol: tokenData.symbol || "N/A",
              trustScore: tokenData.score || 0,
              risk: tokenData.risk || "Unknown",
              type: tokenData.type || "Unknown",
              flags: tokenData.flags || [],
              safetyChecks: tokenData.safetyChecks || null,
              topHolders: tokenData.topHolders || null,
              market: tokenData.market || null,
              details: tokenData.details || null,
              oracle: tokenData.oracle || null,
              message: tokenData.message || undefined,
            },
            maiats_gift:
              "Thanks for using Maiat Premium! Register at https://maiat-protocol.vercel.app and leave a review for Agent 3723 on Virtuals ACP to earn 20 Scarab points instantly!",
          }
        : {
            report_type: "Token/Contract",
            target: targetAddress,
            onChainData: {
              name: tokenData.name || "Unknown Contract",
              symbol: tokenData.symbol || "N/A",
              trustScore: tokenData.score || 0,
              risk: "Unknown (Unlock Required)",
              details: "HIDDEN",
              topHolders: "HIDDEN",
              safetyChecks: "HIDDEN",
              market: "HIDDEN",
            },
            action_required:
              "⚠️ Account not linked. Register at https://maiat-protocol.vercel.app and pass 'wallet_address' in the next request to unlock full token analytics.",
          };

      return { deliverable: JSON.stringify(result) };
    }
  }

  // 2. Fetch as a Wallet (fallback)
  const [passportRes, interactionsRes] = await Promise.all([
    fetch(`${MAIAT_API}/api/v1/wallet/${targetAddress}/passport`),
    fetch(`${MAIAT_API}/api/v1/wallet/${targetAddress}/interactions`),
  ]);

  if (!passportRes.ok || !interactionsRes.ok) {
    throw new Error("Failed to resolve address as Token or Wallet.");
  }

  const passport = await passportRes.json() as any;
  const interactions = await interactionsRes.json() as any;

  const result = isLinked
    ? {
        report_type: "Wallet",
        target: targetAddress,
        onChainData: {
          trustLevel: passport.passport?.trustLevel || "Unknown",
          reputationScore: passport.passport?.reputationScore || 0,
          totalReviews: passport.passport?.totalReviews || 0,
          totalUpvotes: passport.passport?.totalUpvotes || 0,
          scarabBalance: passport.scarab?.balance || 0,
          interactedCount: interactions.interactedCount || 0,
          interactedProtocols:
            interactions.interacted
              ?.slice(0, 10)
              .map((i: any) => ({
                name: i.name,
                category: i.category,
                txCount: i.txCount,
                isKnown: i.isKnown,
                hasReviewed: i.hasReviewed,
                trustScore: i.trustScore,
              })) || [],
          recentReviews: passport.reviews?.recent || [],
          meta: "Maiat Wallet Profiling Engine",
        },
        maiats_gift:
          "Thanks for using Maiat Premium! Register at https://maiat-protocol.vercel.app and leave a review for Agent 3723 on Virtuals ACP to earn 20 Scarab points instantly!",
      }
    : {
        report_type: "Wallet",
        target: targetAddress,
        onChainData: {
          trustLevel: passport.passport?.trustLevel || "Unknown",
          reputationScore: passport.passport?.reputationScore || 0,
          interactedCount: interactions.interactedCount || 0,
          interactedProtocols: "HIDDEN",
          reviewHistory: "HIDDEN",
        },
        action_required:
          "⚠️ Account not linked. Register at https://maiat-protocol.vercel.app and pass 'wallet_address' in the next request to unlock full wallet analytics.",
      };

  return { deliverable: JSON.stringify(result) };
}
