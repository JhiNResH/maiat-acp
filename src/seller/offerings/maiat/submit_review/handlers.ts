/**
 * Maiat Submit Review — ACP Seller Handler
 *
 * Submits a verified on-chain review for any ACP agent or service.
 * Calls POST https://maiat-protocol.vercel.app/api/v1/review
 * Reviews are stored permanently. Quality reviews earn Scarab points for the reviewer.
 */

import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

const MAIAT_API = process.env.MAIAT_API_URL || "https://maiat-protocol.vercel.app";

// ── Validation ────────────────────────────────────────────────────────────────
export function validateRequirements(requirements: Record<string, unknown>): ValidationResult {
  const target = extractAddress(requirements, ["target", "address", "agent"]);
  if (!target) {
    return {
      valid: false,
      reason: "Missing 'target': provide the 0x address of the agent to review.",
    };
  }

  const rating = extractRating(requirements);
  if (rating === null) {
    return {
      valid: false,
      reason: "Missing or invalid 'rating': must be a number between 1 and 5.",
    };
  }

  const comment = extractComment(requirements);
  if (!comment || comment.length < 10) {
    return {
      valid: false,
      reason: "Missing or too short 'comment': must be at least 10 characters.",
    };
  }
  if (comment.length > 500) {
    return { valid: false, reason: "Comment too long: maximum 500 characters." };
  }

  return { valid: true };
}

// ── Payment message ───────────────────────────────────────────────────────────
export function requestPayment(requirements: Record<string, unknown>): string {
  const target = extractAddress(requirements, ["target", "address", "agent"]);
  const rating = extractRating(requirements);
  const short = target ? `${target.slice(0, 6)}...${target.slice(-4)}` : "agent";
  return `Submitting a ${rating ?? "?"}★ review for ${short}. Please proceed with payment ($0.05).`;
}

// ── Execution ─────────────────────────────────────────────────────────────────
export async function executeJob(requirements: Record<string, unknown>): Promise<ExecuteJobResult> {
  const target = extractAddress(requirements, ["target", "address", "agent"]);
  const reviewer = extractAddress(requirements, ["reviewer", "wallet", "from"]);
  const rating = extractRating(requirements);
  const comment = extractComment(requirements);
  const txHash = typeof requirements.txHash === "string" ? requirements.txHash : undefined;

  // Final validation guard
  if (!target || rating === null || !comment || comment.length < 10) {
    return {
      deliverable: JSON.stringify({
        success: false,
        reviewId: null,
        target: target ?? null,
        rating: rating ?? null,
        scarabEarned: 0,
        qualityScore: null,
        message:
          "Invalid requirements: target, rating (1-5), and comment (10-500 chars) are required.",
      }),
    };
  }

  // Scale rating from 1-5 (offering) → 2-10 (API scale) by doubling
  // This maps: 1★→2, 2★→4, 3★→6, 4★→8, 5★→10
  const apiRating = Math.max(1, Math.min(10, rating * 2));

  try {
    const url = `${MAIAT_API}/api/v1/review`;

    const body: Record<string, unknown> = {
      address: target, // API field name is "address" (the target being reviewed)
      rating: apiRating,
      comment,
    };

    if (reviewer) {
      body.reviewer = reviewer;
    }

    if (txHash) {
      body.txHash = txHash;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    // Handle specific error cases
    if (res.status === 403) {
      // No interaction found
      return {
        deliverable: JSON.stringify({
          success: false,
          reviewId: null,
          target,
          rating,
          scarabEarned: 0,
          qualityScore: null,
          message: `Review rejected: no on-chain interaction found between reviewer and ${target}. Provide a txHash proving the interaction, or interact with the agent on-chain first.`,
        }),
      };
    }

    if (res.status === 402) {
      return {
        deliverable: JSON.stringify({
          success: false,
          reviewId: null,
          target,
          rating,
          scarabEarned: 0,
          qualityScore: null,
          message: "Insufficient Scarab points. Reviewer needs Scarab to submit reviews.",
        }),
      };
    }

    if (res.status === 422) {
      const reason = typeof data.reason === "string" ? data.reason : "Review quality check failed";
      return {
        deliverable: JSON.stringify({
          success: false,
          reviewId: null,
          target,
          rating,
          scarabEarned: 0,
          qualityScore: null,
          message: `Review rejected by quality filter: ${reason}`,
        }),
      };
    }

    if (!res.ok) {
      const errMsg = typeof data.error === "string" ? data.error : `API error (${res.status})`;
      throw new Error(errMsg);
    }

    // Success: 201 Created
    const review = (data.review ?? {}) as Record<string, unknown>;
    const meta = (data.meta ?? {}) as Record<string, unknown>;

    const reviewId = typeof review.id === "string" ? review.id : null;
    const scarabReward = typeof meta.scarabReward === "number" ? meta.scarabReward : 0;
    const qualityScore = typeof meta.qualityScore === "number" ? meta.qualityScore : null;

    const scarabMsg = scarabReward > 0 ? ` You earned ${scarabReward} Scarab 🪲` : "";
    const message = `Review submitted successfully for ${target.slice(0, 6)}...${target.slice(-4)}.${scarabMsg}`;

    return {
      deliverable: JSON.stringify({
        success: true,
        reviewId,
        target,
        rating,
        scarabEarned: scarabReward,
        qualityScore,
        message,
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      deliverable: JSON.stringify({
        success: false,
        reviewId: null,
        target,
        rating,
        scarabEarned: 0,
        qualityScore: null,
        message: `Error submitting review: ${message}`,
      }),
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractAddress(requirements: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
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
  return match ? match[0].toLowerCase() : null;
}

function extractRating(requirements: Record<string, unknown>): number | null {
  const val = requirements.rating;
  if (typeof val === "number" && val >= 1 && val <= 5) return val;
  if (typeof val === "string") {
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) return parsed;
  }
  return null;
}

function extractComment(requirements: Record<string, unknown>): string | null {
  const val =
    requirements.comment ?? requirements.review ?? requirements.text ?? requirements.message;
  if (typeof val === "string" && val.trim().length > 0) return val.trim();
  return null;
}

function isValidAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}
