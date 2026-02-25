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

  // If project is not explicitly provided or is a long promotional text, try to extract the core identifier
  const rawText = project || requirements.message || requirements.promo_message || Object.values(requirements).join(" ");
  
  if (rawText && rawText.length > 30) {
    // Attempt to extract the first word or everything before a dash as the project name
    const match = rawText.match(/^([A-Za-z0-9]+)(?:\s+(?:—|-|\|)|\s+)/);
    if (match && match[1]) {
      project = match[1];
    } else {
      // Fallback: just take the first word
      project = rawText.split(" ")[0] || rawText;
    }
  } else if (!project && rawText) {
    project = rawText;
  }

  // Query Maiat's trust score API
  const url = `${MAIAT_API}/api/trust-score?slug=${encodeURIComponent(project.substring(0, 100))}`;
  const res = await fetch(url);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (err.error === "Project not found" || res.status === 404) {
      throw new Error(`Project '${project}' is not indexed in Maiat. To instantly generate a Trust Score for an unknown token, you MUST provide its exact 0x contract address.`);
    }
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
