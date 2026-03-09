/**
 * Maiat Token Forensics — ACP Seller Handler
 *
 * Deep rug pull risk analysis for ERC-20 tokens.
 * Calls /api/v1/token/[address]/forensics on app.maiat.io.
 */

import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

const MAIAT_API = process.env.MAIAT_API_URL || "https://app.maiat.io";

function isValidAddress(val: unknown): val is string {
  return typeof val === "string" && /^0x[a-fA-F0-9]{40}$/.test(val);
}

// ── Validation ────────────────────────────────────────────────────────────────
export function validateRequirements(requirements: Record<string, unknown>): ValidationResult {
  if (!isValidAddress(requirements.token)) {
    return {
      valid: false,
      reason: "Missing or invalid token address. Provide a 0x ERC-20 contract address on Base.",
    };
  }
  return { valid: true };
}

// ── Payment message ───────────────────────────────────────────────────────────
export function requestPayment(requirements: Record<string, unknown>): string {
  const token = requirements.token as string;
  const short = `${token.slice(0, 6)}...${token.slice(-4)}`;
  return `Running deep forensics analysis on ${short}. This includes contract ownership, holder concentration, liquidity depth, and rug risk scoring. Please proceed with payment.`;
}

// ── Execution ─────────────────────────────────────────────────────────────────
export async function executeJob(requirements: Record<string, unknown>): Promise<ExecuteJobResult> {
  const token = requirements.token as string;

  try {
    const res = await fetch(`${MAIAT_API}/api/v1/token/${token}/forensics`, {
      headers: {
        "Content-Type": "application/json",
        "X-Maiat-Client": "maiat-acp-seller",
      },
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) {
      return {
        deliverable: JSON.stringify({
          address: token,
          rugScore: -1,
          riskLevel: "unknown",
          riskFlags: ["API_ERROR"],
          summary: `Forensics analysis failed (HTTP ${res.status}). Proceed with extreme caution.`,
        }),
        completionMessage: "Token forensics encountered an error.",
      };
    }

    const data = (await res.json()) as {
      address?: string;
      rugScore?: number;
      riskLevel?: string;
      riskFlags?: string[];
      summary?: string;
      contract?: Record<string, unknown>;
      holders?: Record<string, unknown>;
      liquidity?: Record<string, unknown>;
    };

    const rugScore = data.rugScore ?? -1;
    const riskLevel = data.riskLevel ?? "unknown";

    let completionMessage: string;
    if (riskLevel === "critical") {
      completionMessage = `🚨 CRITICAL RUG RISK (${rugScore}/100). ${data.summary ?? "Do NOT interact with this token."}`;
    } else if (riskLevel === "high") {
      completionMessage = `⚠️ HIGH RISK (${rugScore}/100). ${data.summary ?? "Proceed with extreme caution."}`;
    } else if (riskLevel === "medium") {
      completionMessage = `⚡ MEDIUM RISK (${rugScore}/100). ${data.summary ?? "Some risk factors detected."}`;
    } else {
      completionMessage = `✅ LOW RISK (${rugScore}/100). ${data.summary ?? "No major rug indicators detected."}`;
    }

    return {
      deliverable: JSON.stringify({
        address: data.address ?? token,
        rugScore,
        riskLevel,
        riskFlags: data.riskFlags ?? [],
        summary: data.summary ?? "",
        contract: data.contract ?? null,
        holders: data.holders ?? null,
        liquidity: data.liquidity ?? null,
        _feedback: {
          queryId: `forensics-${Date.now()}`,
          reportOutcome: `POST outcome to ${MAIAT_API}/api/v1/outcome after trading — earn 5 🪲 Scarab.`,
        },
      }),
      completionMessage,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      deliverable: JSON.stringify({
        address: token,
        rugScore: -1,
        riskLevel: "unknown",
        riskFlags: ["FETCH_ERROR"],
        summary: `Could not reach Maiat API: ${msg}`,
      }),
      completionMessage: "Token forensics failed. Proceed with extreme caution.",
    };
  }
}
