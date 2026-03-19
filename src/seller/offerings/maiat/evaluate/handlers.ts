/**
 * Maiat Evaluate — ACP Seller Handler
 *
 * Evaluates a job deliverable for quality and provider trust.
 * Returns approve/reject verdict with reasoning.
 * ERC-8183 compliant evaluation service.
 */

import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { createServiceAttestation, type Address } from "../../../../lib/eas.js";

const MAIAT_API = process.env.MAIAT_API_URL || "https://app.maiat.io";
const INTERNAL_TOKEN = process.env.MAIAT_INTERNAL_TOKEN || "";

const MIN_DELIVERABLE_LENGTH = 20;
const GARBAGE_PATTERNS = new Set([
  "hello",
  "hi",
  "test",
  "ok",
  "done",
  "yes",
  "no",
  "{}",
  "[]",
  "null",
  "undefined",
  "none",
  "n/a",
  "na",
  "tbd",
  "todo",
]);

// ── Validation ────────────────────────────────────────────────────────────────

export function validateRequirements(requirements: Record<string, unknown>): ValidationResult {
  const provider = extractAddress(requirements, "provider");
  if (!provider) {
    return {
      valid: false,
      reason: "Missing or invalid provider address. Provide a 0x wallet address.",
    };
  }

  const deliverable = requirements.deliverable;
  if (!deliverable || (typeof deliverable === "string" && !deliverable.trim())) {
    return {
      valid: false,
      reason: "Missing deliverable content to evaluate.",
    };
  }

  return { valid: true };
}

// ── Payment message ───────────────────────────────────────────────────────────

export function requestPayment(requirements: Record<string, unknown>): string {
  const provider = extractAddress(requirements, "provider");
  const shortAddr = provider ? `${provider.slice(0, 6)}...${provider.slice(-4)}` : "provider";
  return `Evaluating deliverable from ${shortAddr}. Please proceed with payment.`;
}

// ── Execution ─────────────────────────────────────────────────────────────────

export async function executeJob(requirements: Record<string, unknown>): Promise<ExecuteJobResult> {
  const provider = extractAddress(requirements, "provider");
  const deliverableRaw =
    typeof requirements.deliverable === "string"
      ? requirements.deliverable
      : JSON.stringify(requirements.deliverable ?? "");
  const jobId = typeof requirements.jobId === "number" ? requirements.jobId : null;
  const minTrustScore =
    typeof requirements.minTrustScore === "number" ? requirements.minTrustScore : 30;

  if (!provider) {
    return {
      deliverable: JSON.stringify({
        approved: false,
        verdict: "reject",
        reason: "No valid provider address provided.",
        trustScore: null,
        trustVerdict: "unknown",
        qualityChecks: { isGarbage: true, contentLength: 0, hasStructuredData: false },
      }),
    };
  }

  // ── Step 1: Quality checks ──────────────────────────────────────────────

  const qualityChecks = assessQuality(deliverableRaw);

  if (qualityChecks.isGarbage) {
    const result = {
      approved: false,
      verdict: "reject",
      reason: "Deliverable is empty, too short, or contains only placeholder text.",
      trustScore: null,
      trustVerdict: "unknown",
      qualityChecks,
      _feedback: buildFeedback(provider, jobId),
    };

    reportOutcome(provider, false, "garbage", jobId);

    return { deliverable: JSON.stringify(result) };
  }

  // ── Step 2: Trust check ─────────────────────────────────────────────────

  let trustScore: number | null = null;
  let trustVerdict = "unknown";
  let completionRate: number | null = null;
  let totalJobs = 0;

  try {
    const url = `${MAIAT_API}/api/v1/agent/${provider}`;
    const headers: Record<string, string> = { "x-maiat-client": "maiat-acp-evaluator" };
    if (INTERNAL_TOKEN) {
      headers["x-internal-token"] = INTERNAL_TOKEN;
    }

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(12_000),
    });

    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      trustScore = typeof data.trustScore === "number" ? data.trustScore : null;
      trustVerdict = typeof data.verdict === "string" ? data.verdict : "unknown";

      const breakdown = (data.breakdown ?? {}) as Record<string, unknown>;
      completionRate =
        typeof breakdown.completionRate === "number" ? breakdown.completionRate : null;
      totalJobs = typeof breakdown.totalJobs === "number" ? breakdown.totalJobs : 0;
    }
  } catch {
    // Trust API unavailable — continue with quality-only evaluation
  }

  // ── Step 3: Decision ────────────────────────────────────────────────────

  let approved: boolean;
  let reason: string;

  if (trustVerdict === "avoid" || (trustScore !== null && trustScore < minTrustScore)) {
    approved = false;
    reason = `Provider trust too low: score=${trustScore ?? "unknown"}, verdict=${trustVerdict}. Minimum required: ${minTrustScore}.`;
  } else if (trustScore !== null && trustScore >= 80) {
    approved = true;
    reason = `Trusted provider (score=${trustScore}, ${totalJobs} jobs, ${((completionRate ?? 0) * 100).toFixed(0)}% completion). Deliverable passes quality checks.`;
  } else if (trustScore !== null) {
    approved = true;
    reason = `Moderate trust (score=${trustScore}). Deliverable passes quality checks. Manual review recommended for high-value transactions.`;
  } else {
    // Unknown trust — approve if quality is good (benefit of doubt for new agents)
    approved = qualityChecks.hasStructuredData && qualityChecks.contentLength > 50;
    reason = approved
      ? "Provider not yet indexed. Deliverable has structured content — approved with caution."
      : "Provider not yet indexed and deliverable lacks substance. Rejected.";
  }

  // ── Non-blocking: EAS attestation + outcome reporting ───────────────────

  createServiceAttestation({
    agent: provider as Address,
    service: "evaluate",
    result: approved ? "success" : "rejected",
    trustScoreAtTime: trustScore ?? 0,
    jobId: jobId ?? 0,
  }).catch((err) => {
    console.error("[eas] evaluate attestation failed:", err);
  });

  reportOutcome(provider, approved, approved ? "approved" : "rejected_low_trust", jobId);

  return {
    deliverable: JSON.stringify({
      approved,
      verdict: approved ? "approve" : "reject",
      reason,
      trustScore,
      trustVerdict,
      qualityChecks,
      _feedback: buildFeedback(provider, jobId),
    }),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractAddress(requirements: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = requirements[key];
    if (typeof val === "string" && /^0x[a-fA-F0-9]{40}$/.test(val)) {
      return val.toLowerCase();
    }
  }
  return null;
}

interface QualityResult {
  isGarbage: boolean;
  contentLength: number;
  hasStructuredData: boolean;
}

function assessQuality(deliverable: string): QualityResult {
  const trimmed = deliverable.trim();
  const contentLength = trimmed.length;
  const isGarbage =
    !trimmed ||
    contentLength < MIN_DELIVERABLE_LENGTH ||
    GARBAGE_PATTERNS.has(trimmed.toLowerCase());

  let hasStructuredData = false;
  try {
    const parsed = JSON.parse(trimmed);
    hasStructuredData =
      typeof parsed === "object" && parsed !== null && Object.keys(parsed).length > 0;
  } catch {
    // Not JSON — check if it has meaningful text
    hasStructuredData = contentLength > 100;
  }

  return { isGarbage, contentLength, hasStructuredData };
}

function buildFeedback(provider: string, jobId: number | null) {
  return {
    queryId: `eval-${Date.now()}`,
    reportOutcome: `Report outcome at POST ${MAIAT_API}/api/v1/outcome — earn 5 🪲 Scarab.`,
    relatedOfferings: {
      agent_trust: "Full trust profile with behavioral analysis and Wadjet ML signals ($0.02)",
      agent_reputation: "Community reviews, votes, and market consensus ($0.03)",
    },
  };
}

function reportOutcome(
  provider: string,
  approved: boolean,
  reason: string,
  jobId: number | null
): void {
  fetch(`${MAIAT_API}/api/v1/outcome`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Maiat-Client": "maiat-acp-evaluator",
    },
    body: JSON.stringify({
      jobId: jobId ? String(jobId) : `eval-${Date.now()}`,
      provider,
      approved,
      reason,
      source: "maiat-acp-evaluator",
    }),
  }).catch(() => {
    // Best effort
  });
}
