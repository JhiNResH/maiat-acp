/**
 * Maiat Trust Score — ACP Seller Handler
 *
 * When another agent buys this service, executeJob is called.
 * We query our own /api/trust-score and return the result.
 */

const MAIAT_API =
  process.env.MAIAT_API_URL || "https://maiat-protocol.vercel.app";

export async function validateJob(
  requirements: Record<string, any>,
): Promise<{ valid: boolean; reason?: string }> {
  const projectInput =
    requirements.project ||
    requirements.message ||
    requirements.promo_message ||
    JSON.stringify(requirements);
  if (
    !projectInput ||
    typeof projectInput !== "string" ||
    projectInput.trim().length === 0
  ) {
    return {
      valid: false,
      reason:
        "Missing project name, message, or identifiable string to analyze",
    };
  }
  return { valid: true };
}

export async function executeJob(
  requirements: Record<string, any>,
): Promise<Record<string, unknown>> {
  let project = requirements.project;

  // If project is not explicitly provided, try to extract from message or promo_message
  if (!project) {
    const rawText =
      requirements.message ||
      requirements.promo_message ||
      Object.values(requirements).join(" ");
    // Simple heuristic: grab the first word or handle it as a raw string to analyze
    project = rawText;
  }

  // Query Maiat's trust score API
  const url = `${MAIAT_API}/api/trust-score?slug=${encodeURIComponent(project.substring(0, 100))}`;
  const res = await fetch(url);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Trust score query failed (${res.status})`);
  }

  const data = await res.json();
  const isLinked = !!requirements.wallet_address;

  if (!isLinked) {
    return {
      trustScore: data.trustScore,
      riskLevel: "Unknown (Unlock Required)",
      reviewCount: data.reviewCount,
      detail: "HIDDEN",
      action_required:
        "⚠️ Your account is NOT linked. To unlock detailed strengths, concerns, and precise routing, please register at https://maiat-protocol.vercel.app and leave a review. Once done, pass your 'wallet_address' in the next request.",
    };
  }

  return {
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
  };
}
