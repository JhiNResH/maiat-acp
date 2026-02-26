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

  // Single unified call — protocol auto-detects contract vs wallet
  const res = await fetch(`${MAIAT_API}/api/v1/report/${targetAddress}`);
  if (!res.ok) {
    throw new Error(`Report fetch failed (${res.status})`);
  }
  const data: any = await res.json();

  const gift =
    "Thanks for using Maiat! Leave a review at https://maiat-protocol.vercel.app to earn 20 Scarab points.";

  const reviewUrl = data.slug
    ? `https://maiat-protocol.vercel.app/agent/${data.slug}`
    : `https://maiat-protocol.vercel.app/explore`;
  const review_prompt = data.reportType === "contract" ? {
    message: `Help improve ${data.name ?? targetAddress}'s trust score — write a review and earn Scarab`,
    url: reviewUrl,
    reward: "Earn 3-10 Scarab points based on review quality",
  } : null;

  // ── Contract / Protocol report ──────────────────────────────────────────────
  if (data.reportType === "contract") {
    const riskEmoji = data.riskLevel === "Low" ? "🟢" : data.riskLevel === "Medium" ? "🟡" : data.riskLevel === "High" ? "🔴" : "⚪";
    const breakdownSection = data.breakdown
      ? `\n## Score Breakdown\n${Object.entries(data.breakdown).map(([k, v]) => `- **${k}**: ${v}`).join("\n")}` : "";
    const flagsSection = data.riskFlags?.length
      ? `\n## Risk Flags\n${data.riskFlags.map((f: string) => `- ⚠️ ${f}`).join("\n")}` : "";
    const strengthsSection = data.strengths?.length
      ? `\n## Strengths\n${data.strengths.map((s: string) => `- ✅ ${s}`).join("\n")}` : "";
    const reviewsSection = data.recentReviews?.length
      ? `\n## Recent Reviews\n${data.recentReviews.slice(0,3).map((r: any) => `- ${"⭐".repeat(r.rating ?? 0)} "${r.comment ?? ""}"`).join("\n")}` : "";

    const markdown = `# On-Chain Report: ${data.name ?? targetAddress}

## Overview
- **Address**: \`${targetAddress}\`
- **Category**: ${data.category ?? "Unknown"}
- **Trust Score**: ${data.trustScore ?? "N/A"}/100 ${riskEmoji}
- **Risk Level**: ${data.riskLevel ?? "Unknown"}
- **Reviews**: ${data.reviewCount ?? 0}${data.avgRating ? ` (avg ${data.avgRating}/5 ⭐)` : ""}
${data.website ? `- **Website**: ${data.website}` : ""}
${breakdownSection}${flagsSection}${strengthsSection}${reviewsSection}

---
${review_prompt ? `📝 **${review_prompt.message}**\n🔗 ${review_prompt.url}\n🪲 ${review_prompt.reward}\n\n` : ""}${gift}
*Powered by [Maiat Protocol](https://maiat-protocol.vercel.app)*`;

    return { deliverable: markdown };
  }

  // ── Wallet report ───────────────────────────────────────────────────────────
  const levelEmoji: Record<string, string> = { guardian: "🛡️", verified: "✅", trusted: "🔵", basic: "⚪" };
  const markdown = `# Wallet Reputation Report

## Overview
- **Address**: \`${targetAddress}\`
- **Trust Level**: ${levelEmoji[data.trustLevel] ?? "⚪"} ${data.trustLevel ?? "Unknown"}
- **Reputation Score**: ${data.reputationScore ?? "N/A"}
- **Scarab Balance**: 🪲 ${data.scarabBalance ?? 0}
- **Reviews Given**: ${data.totalReviews ?? 0}
- **Upvotes Received**: ${data.totalUpvotes ?? 0}
${data.feeTier ? `- **Fee Tier**: ${data.feeTier}${data.feeDiscount ? ` (${data.feeDiscount}% discount)` : ""}` : ""}

---
${gift}
*Powered by [Maiat Protocol](https://maiat-protocol.vercel.app)*`;

  return { deliverable: markdown };
}
