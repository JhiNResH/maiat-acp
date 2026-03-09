/**
 * Maiat Agent Reputation — ACP Seller Handler
 *
 * "What the community says" — reviews, votes, sentiment, market consensus.
 * This is Maiat's unique data moat. No one else has this.
 */

import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { createServiceAttestation, type Address } from "../../../../lib/eas.js";

const MAIAT_API = process.env.MAIAT_API_URL || "https://app.maiat.io";
const INTERNAL_TOKEN = process.env.MAIAT_INTERNAL_TOKEN || "";

// ── Validation ────────────────────────────────────────────────────────────────
export function validateRequirements(requirements: Record<string, unknown>): ValidationResult {
  const agent = extractAgentAddress(requirements);
  if (!agent) {
    return { valid: false, reason: "Missing or invalid agent address." };
  }
  return { valid: true };
}

// ── Payment message ───────────────────────────────────────────────────────────
export function requestPayment(requirements: Record<string, unknown>): string {
  const agent = extractAgentAddress(requirements);
  const short = agent ? `${agent.slice(0, 6)}...${agent.slice(-4)}` : "agent";
  return `Fetching community reputation for ${short}. Please proceed with payment.`;
}

// ── Execution ─────────────────────────────────────────────────────────────────
export async function executeJob(requirements: Record<string, unknown>): Promise<ExecuteJobResult> {
  const agent = extractAgentAddress(requirements);
  if (!agent) {
    return { deliverable: JSON.stringify({ error: "No valid agent address." }) };
  }

  const limit = Math.min(typeof requirements.limit === "number" ? requirements.limit : 5, 20);
  const headers: Record<string, string> = { "X-Maiat-Client": "acp-reputation" };
  if (INTERNAL_TOKEN) headers["x-internal-token"] = INTERNAL_TOKEN;

  try {
    // Fetch reviews
    const reviewRes = await fetch(`${MAIAT_API}/api/v1/review?address=${agent}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const reviewData = reviewRes.ok
      ? ((await reviewRes.json()) as Record<string, unknown>)
      : { reviews: [], count: 0, averageRating: 0 };

    const reviews = Array.isArray(reviewData.reviews) ? reviewData.reviews : [];
    const count = typeof reviewData.count === "number" ? reviewData.count : 0;
    const avgRating = typeof reviewData.averageRating === "number" ? reviewData.averageRating : 0;

    // Sentiment analysis
    let positive = 0,
      negative = 0,
      neutral = 0;
    for (const r of reviews as Array<Record<string, unknown>>) {
      const rating = typeof r.rating === "number" ? r.rating : 3;
      if (rating >= 4) positive++;
      else if (rating <= 2) negative++;
      else neutral++;
    }

    // Community verdict
    let communityVerdict: string;
    if (count === 0) {
      communityVerdict = "unreviewed";
    } else if (avgRating >= 4 && positive > negative * 2) {
      communityVerdict = "trusted";
    } else if (avgRating <= 2.5 || negative > positive) {
      communityVerdict = "untrusted";
    } else {
      communityVerdict = "mixed";
    }

    // Top reviews (quality-sorted, limited)
    const sorted = (reviews as Array<Record<string, unknown>>)
      .sort((a, b) => ((b.qualityScore as number) ?? 0) - ((a.qualityScore as number) ?? 0))
      .slice(0, limit);

    const topReviews = sorted.map((r) => ({
      rating: r.rating,
      comment: typeof r.comment === "string" ? r.comment.slice(0, 200) : "",
      qualityScore: r.qualityScore ?? null,
      interactionTier: r.interactionTier ?? "none",
      source: r.source ?? "human",
      upvotes: r.upvotes ?? 0,
      downvotes: r.downvotes ?? 0,
      date: r.timestamp ?? null,
    }));

    // Fetch market positions for this agent
    let marketConsensus = "No market data";
    let totalScarabStaked = 0;
    try {
      const marketsRes = await fetch(`${MAIAT_API}/api/v1/markets`, {
        headers,
        signal: AbortSignal.timeout(5_000),
      });
      if (marketsRes.ok) {
        const marketsData = (await marketsRes.json()) as Record<string, unknown>;
        const markets = Array.isArray(marketsData.markets) ? marketsData.markets : [];
        for (const m of markets as Array<Record<string, unknown>>) {
          const standings = Array.isArray(m.projectStandings) ? m.projectStandings : [];
          for (const s of standings as Array<Record<string, unknown>>) {
            if (
              typeof s.projectId === "string" &&
              s.projectId.toLowerCase() === agent.toLowerCase()
            ) {
              const stake = typeof s.totalStake === "number" ? s.totalStake : 0;
              totalScarabStaked += stake;
              const rank = standings.indexOf(s) + 1;
              marketConsensus = `Ranked #${rank} in "${m.title}" with ${stake} 🪲 staked`;
            }
          }
        }
      }
    } catch {
      // Market data optional
    }

    // Non-blocking EAS attestation
    createServiceAttestation({
      agent: agent as Address,
      service: "agent_reputation",
      result: "success",
      trustScoreAtTime: Math.round(avgRating * 20), // Convert 0-5 to 0-100
      jobId: 0,
    }).catch((err) => {
      console.error("[eas] agent_reputation attestation failed:", err);
    });

    return {
      deliverable: JSON.stringify({
        avgRating,
        reviewCount: count,
        sentiment: { positive, negative, neutral },
        communityVerdict,
        topReviews,
        marketConsensus,
        totalScarabStaked,
        _feedback: {
          queryId: `rep-${Date.now()}`,
          reportOutcome: `After interacting with this agent, report outcome at POST ${MAIAT_API}/api/v1/outcome — you'll earn 5 🪲 Scarab and improve your own trust score.`,
        },
      }),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return { deliverable: JSON.stringify({ error: `Reputation query failed: ${msg}` }) };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractAgentAddress(req: Record<string, unknown>): string | null {
  for (const key of ["agent", "wallet", "address", "walletAddress"]) {
    const val = req[key];
    if (typeof val === "string" && /^0x[a-fA-F0-9]{40}$/.test(val)) return val.toLowerCase();
  }
  const allText = Object.values(req)
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  const match = allText.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0].toLowerCase() : null;
}
