/**
 * Maiat Trust Score — ACP Seller Handler
 *
 * When another agent buys this service, executeJob is called.
 * We query our own /api/trust-score and return the result.
 */

import type {
  ExecuteJobResult,
  ValidationResult,
} from "../../../runtime/offeringTypes.js";

const MAIAT_API =
  process.env.MAIAT_API_URL || "https://maiat-protocol.vercel.app";

// ── Validation ────────────────────────────────────────────────────────────────
// NOTE: must be named `validateRequirements` — the seller runtime looks for this exact export name.
export function validateRequirements(
  requirements: Record<string, any>,
): ValidationResult {
  // Accept everything — even empty requirements.
  // executeJob handles gracefully with a helpful response.
  return { valid: true };
}

// ── Payment message ───────────────────────────────────────────────────────────
export function requestPayment(requirements: Record<string, any>): string {
  const project =
    requirements.project || requirements.message || "your request";
  return `Querying Maiat trust score for "${String(project).substring(0, 60)}". Please proceed with payment.`;
}

// ── Execution ─────────────────────────────────────────────────────────────────
export async function executeJob(
  requirements: Record<string, any>,
): Promise<ExecuteJobResult> {
  let project = requirements.project;

  // Resolve project identifier from raw text
  const rawText =
    project ||
    requirements.message ||
    requirements.promo_message ||
    Object.values(requirements).join(" ");

  if (rawText && rawText.length > 30) {
    const addressMatch = rawText.match(/(0x[a-fA-F0-9]{40})/);
    if (addressMatch?.[1]) {
      project = addressMatch[1];
    } else {
      const match = rawText.match(/^([A-Za-z0-9]+)(?:\s+(?:—|-|\|)|\s+)/);
      project = match?.[1] ?? rawText.split(" ")[0] ?? rawText;
    }
  } else if (!project && rawText) {
    project = rawText;
  }

  // Graceful fallback — don't throw, return a helpful response so job completes
  if (!project || String(project).trim() === "" || String(project).trim() === "undefined") {
    const result = {
      trustScore: null,
      riskLevel: "Unknown",
      reviewCount: 0,
      recommendation: "Please provide a project name or 0x contract address.",
      usage: 'Pass { project: "AIXBT" } or { project: "0x..." } as requirements.',
      maiats_gift: "Maiat scores 10,000+ DeFi protocols and AI agents. Try: AIXBT, Virtuals, HeyAnon, Brian AI, Ethy, Wayfinder.",
    };
    return { deliverable: JSON.stringify(result) };
  }

  const url = `${MAIAT_API}/api/trust-score?slug=${encodeURIComponent(String(project).substring(0, 100))}`;
  const res = await fetch(url);

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    if (err.error === "Project not found" || res.status === 404) {
      const result = {
        trustScore: null,
        riskLevel: "Unknown",
        reviewCount: 0,
        recommendation: `'${project}' is not yet indexed. Submit a review at https://maiat-protocol.vercel.app to build its trust profile. For unknown tokens, provide the exact 0x contract address.`,
      };
      return { deliverable: JSON.stringify(result) };
    }
    throw new Error(err.error || `Trust score query failed (${res.status})`);
  }

  const data: any = await res.json();
  const isLinked = !!requirements.wallet_address;

  const result = isLinked
    ? {
        trustScore: data.trustScore,
        riskLevel: data.riskLevel,
        reviewCount: data.reviewCount,
        avgRating: data.avgRating,
        sentiment: data.sentiment,
        recommendation: data.recommendation,
        strengths: data.strengths,
        concerns: data.concerns,
        chain: data.chain,
        category: data.category,
        dataSource: data.dataSource,
      }
    : {
        trustScore: data.trustScore,
        riskLevel: "Unknown (Unlock Required)",
        reviewCount: data.reviewCount,
        detail: "HIDDEN",
        action_required:
          "⚠️ Account not linked. Register at https://maiat-protocol.vercel.app and leave a review, then pass 'wallet_address' in the next request to unlock full details.",
      };

  return { deliverable: JSON.stringify(result) };
}
