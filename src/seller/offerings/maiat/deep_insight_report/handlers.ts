/**
 * Maiat Deep Insight — ACP Seller Handler
 *
 * Premium service ($0.10): Full trust analysis powered by Google Gemini Flash.
 * - Trust score from Maiat Protocol API
 * - AI deep analysis via Gemini 2.0 Flash
 * - Graceful fallback if GEMINI_API_KEY not set
 */

import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

const MAIAT_API = process.env.MAIAT_API_URL || "https://maiat-protocol.vercel.app";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// ── Validation ────────────────────────────────────────────────────────────────
export function validateRequirements(requirements: Record<string, any>): ValidationResult {
  return { valid: true };
}

// ── Payment message ───────────────────────────────────────────────────────────
export function requestPayment(requirements: Record<string, any>): string {
  const project = requirements.project || requirements.address || "your project";
  return `Running Deep Insight Report for "${String(project).substring(0, 60)}" with Gemini AI analysis. Please proceed with payment.`;
}

// ── Gemini AI Analysis ────────────────────────────────────────────────────────
async function runGeminiAnalysis(project: string, trustData: any): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;

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
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 300,
          temperature: 0.3,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

// ── Execution ─────────────────────────────────────────────────────────────────
export async function executeJob(requirements: Record<string, any>): Promise<ExecuteJobResult> {
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

  if (!project || String(project).trim() === "" || String(project).trim() === "undefined") {
    return {
      deliverable: JSON.stringify({
        trustScore: null,
        riskLevel: "Unknown",
        recommendation: "Please provide a project name or 0x contract address.",
        usage: 'Pass { project: "AIXBT" } or { project: "0x..." } as requirements.',
        aiAnalysis: null,
        poweredBy: "Maiat Protocol + Gemini Flash",
      }),
    };
  }

  // 1. Get trust score from Maiat API — use /api/v1/project (DB-stored score, accurate)
  let projectData: any = null;
  try {
    const projectRes = await fetch(
      `${MAIAT_API}/api/v1/project/${encodeURIComponent(String(project).substring(0, 100))}`
    );
    if (projectRes.ok) {
      const raw = await projectRes.json();
      projectData = raw?.project ?? raw;
    }
  } catch {
    // Non-fatal
  }

  // Build trustData shape for Gemini prompt
  const trustData = projectData
    ? {
        trustScore: projectData.trustScore ?? null,
        riskLevel:
          projectData.trustScore == null
            ? "Unknown"
            : projectData.trustScore >= 70
              ? "Low"
              : projectData.trustScore >= 40
                ? "Medium"
                : "High",
        reviewCount: projectData.reviewCount ?? 0,
        avgRating: projectData.avgRating ?? null,
        strengths: [],
        concerns: [],
      }
    : null;

  // 2. Run Gemini AI analysis
  const aiAnalysis = await runGeminiAnalysis(String(project), trustData);

  const score = projectData?.trustScore ?? null;
  const riskLevel =
    trustData?.riskLevel ??
    (score === null ? "Unknown" : score >= 70 ? "Low" : score >= 40 ? "Medium" : "High");

  const projectSlug = (projectData?.slug ?? null) as string | null;
  const reviewUrl = projectSlug
    ? `https://maiat-protocol.vercel.app/agent/${projectSlug}`
    : `https://maiat-protocol.vercel.app/explore`;

  const result = {
    project,
    trustScore: score,
    riskLevel,
    reviewCount: projectData?.reviewCount ?? 0,
    avgRating: projectData?.avgRating ?? null,
    strengths: [],
    concerns: [],
    aiAnalysis: aiAnalysis ?? {
      note: "AI analysis unavailable — GEMINI_API_KEY not configured.",
    },
    poweredBy: GEMINI_API_KEY
      ? "Maiat Protocol + Google Gemini 2.0 Flash"
      : "Maiat Protocol (AI analysis disabled)",
    dataSource: "Community reviews + on-chain analysis",
    review_prompt: {
      message: `Improve ${String(project)}'s trust data — write a review and earn Scarab`,
      url: reviewUrl,
      reward: "Earn 3-10 Scarab points based on review quality",
    },
    learnMore: "https://maiat-protocol.vercel.app",
  };

  return { deliverable: JSON.stringify(result) };
}
