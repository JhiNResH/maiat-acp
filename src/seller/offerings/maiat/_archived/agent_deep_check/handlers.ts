/**
 * Maiat Agent Deep Check — ACP Seller Handler
 *
 * Provides enriched trust analysis for an ACP agent: percentile, tier,
 * risk flags, and recommendation — on top of the base trust score.
 */

import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

const MAIAT_API = process.env.MAIAT_API_URL || "https://app.maiat.io";
const INTERNAL_TOKEN = process.env.MAIAT_INTERNAL_TOKEN || "";

// ── Validation ────────────────────────────────────────────────────────────────

export function validateRequirements(requirements: Record<string, unknown>): ValidationResult {
  const agent = extractAgentAddress(requirements);
  if (!agent) {
    return {
      valid: false,
      reason: "Missing or invalid agent address. Provide a 0x wallet address.",
    };
  }
  return { valid: true };
}

// ── Payment message ───────────────────────────────────────────────────────────

export function requestPayment(requirements: Record<string, unknown>): string {
  const agent = extractAgentAddress(requirements);
  const shortAddr = agent ? `${agent.slice(0, 6)}...${agent.slice(-4)}` : "agent";
  return `Running deep trust analysis for ${shortAddr}. Please proceed with payment.`;
}

// ── Execution ─────────────────────────────────────────────────────────────────

export async function executeJob(requirements: Record<string, unknown>): Promise<ExecuteJobResult> {
  const agent = extractAgentAddress(requirements);

  if (!agent) {
    return {
      deliverable: JSON.stringify({
        score: null,
        verdict: "unknown",
        recommendation: "No valid agent address provided. Pass { agent: '0x...' } as requirements.",
        riskFlags: [],
      }),
    };
  }

  try {
    const url = `${MAIAT_API}/api/v1/agent/${agent}/deep`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (INTERNAL_TOKEN) {
      headers["x-internal-token"] = INTERNAL_TOKEN;
    }

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });

    if (res.status === 404) {
      return {
        deliverable: JSON.stringify({
          score: null,
          verdict: "unknown",
          completionRate: null,
          paymentRate: null,
          expireRate: null,
          totalJobs: 0,
          ageWeeks: null,
          percentile: null,
          tier: "new",
          riskFlags: ["low_job_count"],
          recommendation: "New or low-activity agent — use only for low-risk tasks",
          category: null,
          lastUpdated: null,
        }),
      };
    }

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error((err.error as string) || `Deep check failed (${res.status})`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const breakdown = (data.breakdown ?? {}) as Record<string, unknown>;
    const deep = (data.deep ?? {}) as Record<string, unknown>;

    const score = typeof data.trustScore === "number" ? data.trustScore : null;
    const verdict = typeof data.verdict === "string" ? data.verdict : "unknown";
    const completionRate =
      typeof breakdown.completionRate === "number" ? breakdown.completionRate : null;
    const paymentRate = typeof breakdown.paymentRate === "number" ? breakdown.paymentRate : null;
    const expireRate = typeof breakdown.expireRate === "number" ? breakdown.expireRate : null;
    const totalJobs = typeof breakdown.totalJobs === "number" ? breakdown.totalJobs : 0;
    const ageWeeks = typeof breakdown.ageWeeks === "number" ? breakdown.ageWeeks : null;
    const lastUpdated = typeof data.lastUpdated === "string" ? data.lastUpdated : null;

    const percentile = typeof deep.percentile === "number" ? deep.percentile : null;
    const tier = typeof deep.tier === "string" ? deep.tier : "new";
    const riskFlags = Array.isArray(deep.riskFlags) ? deep.riskFlags : [];
    const recommendation =
      typeof deep.recommendation === "string" ? deep.recommendation : "Unknown";
    const category = typeof deep.category === "string" ? deep.category : null;

    return {
      deliverable: JSON.stringify({
        score,
        verdict,
        completionRate,
        paymentRate,
        expireRate,
        totalJobs,
        ageWeeks,
        percentile,
        tier,
        riskFlags,
        recommendation,
        category,
        lastUpdated,
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      deliverable: JSON.stringify({
        score: null,
        verdict: "unknown",
        riskFlags: [],
        recommendation: `Error querying deep check: ${message}`,
      }),
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractAgentAddress(requirements: Record<string, unknown>): string | null {
  for (const key of ["agent", "wallet", "address", "walletAddress"]) {
    const val = requirements[key];
    if (typeof val === "string" && isValidAddress(val)) {
      return val.toLowerCase();
    }
  }

  // Scan all string values for any 0x address
  const allText = Object.values(requirements)
    .filter((v): v is string => typeof v === "string")
    .join(" ");

  const match = allText.match(/0x[a-fA-F0-9]{40}/);
  if (match) return match[0].toLowerCase();

  return null;
}

function isValidAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}
