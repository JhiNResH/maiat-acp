/**
 * Maiat Token Check — ACP Seller Handler
 *
 * Checks any ERC-20 token for honeypot, tax, and trust score.
 * Calls /api/v1/token/[address] on maiat-protocol.vercel.app.
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
  return `Checking token safety for ${short}. Please proceed with payment.`;
}

// ── Execution ─────────────────────────────────────────────────────────────────
export async function executeJob(requirements: Record<string, unknown>): Promise<ExecuteJobResult> {
  const token = requirements.token as string;

  try {
    const res = await fetch(`${MAIAT_API}/api/v1/token/${token}`, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      return {
        deliverable: JSON.stringify({
          address: token,
          trustScore: 0,
          verdict: "unknown",
          riskFlags: ["API_ERROR"],
          riskSummary: `Token check failed (HTTP ${res.status}). Proceed with caution.`,
        }),
        completionMessage: "Token check encountered an error.",
      };
    }

    const data = (await res.json()) as {
      address?: string;
      tokenType?: string;
      trustScore?: number;
      verdict?: string;
      riskFlags?: string[];
      riskSummary?: string;
      honeypot?: { isHoneypot?: boolean; buyTax?: number; sellTax?: number };
    };

    const verdict = data.verdict ?? "unknown";
    const score = data.trustScore ?? 0;

    const summary =
      verdict === "proceed"
        ? `Token appears safe. Score: ${score}/100.`
        : verdict === "caution"
          ? `Proceed with caution. Score: ${score}/100. ${data.riskSummary ?? ""}`
          : `HIGH RISK — avoid this token. Score: ${score}/100. ${data.riskSummary ?? ""}`;

    return {
      deliverable: JSON.stringify({
        address: data.address ?? token,
        tokenType: data.tokenType ?? "unknown",
        trustScore: score,
        verdict,
        riskFlags: data.riskFlags ?? [],
        riskSummary: data.riskSummary ?? "",
        honeypot: data.honeypot ?? null,
      }),
      completionMessage: summary,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      deliverable: JSON.stringify({
        address: token,
        trustScore: 0,
        verdict: "unknown",
        riskFlags: ["FETCH_ERROR"],
        riskSummary: `Could not reach Maiat API: ${msg}`,
      }),
      completionMessage: "Token check failed. Proceed with extreme caution.",
    };
  }
}
