/**
 * Maiat Deep Insight — ACP Seller Handler
 *
 * Premium service ($0.10): Full trust analysis powered by Qwen3.5-Flash.
 * - Trust score from Maiat API
 * - AI deep analysis via Qwen3.5-Flash (1M context, OpenAI-compatible)
 * - Graceful fallback if Qwen key not set
 *
 * Set QWEN_API_KEY in Railway env to enable AI analysis.
 * Get free key: https://dashscope.aliyuncs.com (1M tokens/month free)
 */

import type {
  ExecuteJobResult,
  ValidationResult,
} from "../../../runtime/offeringTypes.js";

const MAIAT_API =
  process.env.MAIAT_API_URL || "https://maiat-protocol.vercel.app";
const QWEN_API_KEY = process.env.QWEN_API_KEY || "";
const QWEN_BASE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

// ── Validation ────────────────────────────────────────────────────────────────
export function validateRequirements(
  requirements: Record<string, any>,
): ValidationResult {
  // Accept anything — executeJob handles empty inputs gracefully
  return { valid: true };
}

// ── Payment message ───────────────────────────────────────────────────────────
export function requestPayment(requirements: Record<string, any>): string {
  const project = requirements.project || requirements.address || "your project";
  return `Running Deep Insight Report for "${String(project).substring(0, 60)}" with Qwen3.5 AI analysis. Please proceed with payment.`;
}

// ── Qwen AI Analysis ──────────────────────────────────────────────────────────
async function runQwenAnalysis(
  project: string,
  trustData: any,
): Promise<string | null> {
  if (!QWEN_API_KEY) return null;

  const prompt = `You are Maiat, a crypto trust analyst. Analyze this project and give a concise, actionable deep insight report.

Project: ${project}
Trust Score: ${trustData?.trustScore ?? "unknown"}/100
Risk Level: ${trustData?.riskLevel ?? "unknown"}
Reviews: ${trustData?.reviewCount ?? 0}
Avg Rating: ${trustData?.avgRating ?? "N/A"}
Strengths: ${JSON.stringify(trustData?.strengths ?? [])}
Concerns: ${JSON.stringify(trustData?.concerns ?? [])}

Provide:
1. One-sentence verdict (buy/use/avoid signal)
2. Top 2 red flags (if any)
3. Top 2 green flags (if any)
4. Confidence level: Low/Medium/High

Keep it under 150 words. Be direct, not diplomatic.`;

  try {
    const res = await fetch(QWEN_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${QWEN_API_KEY}`,
      },
      body: JSON.stringify({
        model: "qwen3.5-flash",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

// ── Execution ─────────────────────────────────────────────────────────────────
export async function executeJob(
  requirements: Record<string, any>,
): Promise<ExecuteJobResult> {
  // Extract project from any field buyers might use
  let project =
    requirements.project ||
    requirements.address ||
    requirements.message ||
    requirements.promo_message;
  const rawText = project || Object.values(requirements).join(" ");

  if (!project && rawText) {
    const addressMatch = rawText.match(/(0x[a-fA-F0-9]{40})/);
    if (addressMatch) {
      project = addressMatch[1];
    } else {
      project = rawText.split(/\s+/)[0] || rawText;
    }
  }

  // Graceful fallback for empty requirements
  if (!project || String(project).trim() === "" || String(project).trim() === "undefined") {
    const result = {
      trustScore: null,
      riskLevel: "Unknown",
      recommendation: "Please provide a project name or 0x contract address.",
      usage: 'Pass { project: "AIXBT" } or { project: "0x..." } as requirements.',
      aiAnalysis: null,
      poweredBy: "Maiat Protocol + Qwen3.5-Flash",
    };
    return { deliverable: JSON.stringify(result) };
  }

  const depth = requirements.depth || "deep";

  // 1. Get trust score from Maiat API
  let trustData: any = null;
  try {
    const scoreRes = await fetch(
      `${MAIAT_API}/api/trust-score?slug=${encodeURIComponent(String(project).substring(0, 100))}`,
    );
    if (scoreRes.ok) {
      trustData = await scoreRes.json();
    }
  } catch {
    // Non-fatal — proceed with AI analysis even without score
  }

  // 2. Run Qwen3.5-Flash AI analysis (replaces 0G stub)
  const aiAnalysis = await runQwenAnalysis(String(project), trustData);

  const score = trustData?.trustScore ?? trustData?.data?.score ?? null;
  const riskLevel =
    trustData?.riskLevel ??
    (score === null ? "Unknown" : score >= 70 ? "Low" : score >= 40 ? "Medium" : "High");

  const result = {
    project,
    trustScore: score,
    riskLevel,
    reviewCount: trustData?.reviewCount ?? trustData?.data?.metadata?.totalReviews ?? 0,
    avgRating: trustData?.avgRating ?? trustData?.data?.metadata?.avgRating ?? null,
    sentiment: trustData?.sentiment ?? null,
    strengths: trustData?.strengths ?? [],
    concerns: trustData?.concerns ?? [],
    aiAnalysis: aiAnalysis ?? {
      note: "AI analysis not available — set QWEN_API_KEY in Railway env to enable.",
      getKey: "https://dashscope.aliyuncs.com (1M tokens/month free)",
    },
    analysisDepth: depth,
    poweredBy: QWEN_API_KEY
      ? "Maiat Protocol + Qwen3.5-Flash (Alibaba)"
      : "Maiat Protocol (AI analysis disabled)",
    dataSource: "Community reviews + on-chain analysis",
    learnMore: "https://maiat-protocol.vercel.app",
  };

  return { deliverable: JSON.stringify(result) };
}
