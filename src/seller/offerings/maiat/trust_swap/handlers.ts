/**
 * Maiat Trust Swap — ACP Seller Handler
 *
 * Trust-verified token swap: checks token for rug risk before returning Uniswap calldata.
 */

import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

const MAIAT_API = process.env.MAIAT_API_URL || "https://maiat-protocol.vercel.app";
const INTERNAL_TOKEN = process.env.MAIAT_INTERNAL_TOKEN || "";

interface TrustResult {
  trustScore: number | null;
  verdict: "safe" | "caution" | "risky" | "blocked";
  riskFlags: string[];
  riskSummary: string;
}

interface QuoteResult {
  quote: Record<string, unknown>;
  calldata: string;
  to: string;
  value: string;
}

// ── Validation ────────────────────────────────────────────────────────────────
export function validateRequirements(requirements: Record<string, unknown>): ValidationResult {
  const { tokenIn, tokenOut, amount, swapper } = requirements;

  if (!isValidAddress(tokenIn)) {
    return { valid: false, reason: "Invalid tokenIn address. Must be a 0x address." };
  }
  if (!isValidAddress(tokenOut)) {
    return { valid: false, reason: "Invalid tokenOut address. Must be a 0x address." };
  }
  if (!amount || typeof amount !== "string" || !/^\d+$/.test(amount)) {
    return { valid: false, reason: "Invalid amount. Must be a string of digits (wei)." };
  }
  if (!isValidAddress(swapper)) {
    return { valid: false, reason: "Invalid swapper address. Must be a 0x address." };
  }

  return { valid: true };
}

// ── Payment message ───────────────────────────────────────────────────────────
export function requestPayment(requirements: Record<string, unknown>): string {
  const tokenOut = requirements.tokenOut as string;
  const shortAddr = tokenOut ? `${tokenOut.slice(0, 6)}...${tokenOut.slice(-4)}` : "token";
  return `Checking trust score for ${shortAddr} and preparing swap quote. Please proceed with payment.`;
}

// ── Execution ─────────────────────────────────────────────────────────────────
export async function executeJob(requirements: Record<string, unknown>): Promise<ExecuteJobResult> {
  const tokenIn = (requirements.tokenIn as string)?.toLowerCase();
  const tokenOut = (requirements.tokenOut as string)?.toLowerCase();
  const amount = requirements.amount as string;
  const swapper = (requirements.swapper as string)?.toLowerCase();
  const chainId = typeof requirements.chainId === "number" ? requirements.chainId : 8453;
  const slippage = typeof requirements.slippage === "number" ? requirements.slippage : 0.005;

  // Validate inputs
  if (
    !isValidAddress(tokenIn) ||
    !isValidAddress(tokenOut) ||
    !amount ||
    !isValidAddress(swapper)
  ) {
    return {
      deliverable: JSON.stringify({
        error:
          "Invalid parameters. Required: tokenIn, tokenOut, amount (wei string), swapper (0x address)",
      }),
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (INTERNAL_TOKEN) {
    headers["x-internal-token"] = INTERNAL_TOKEN;
  }

  try {
    // Step 1: Check token trust
    const trustResult = await checkTokenTrust(tokenOut, headers);

    // If blocked, return early with no calldata
    if (trustResult.verdict === "blocked") {
      return {
        deliverable: JSON.stringify({
          trustScore: trustResult.trustScore,
          verdict: "blocked",
          riskFlags: trustResult.riskFlags,
          riskSummary: trustResult.riskSummary,
          error: "Token blocked due to high rug risk. Swap not available.",
        }),
      };
    }

    // Step 2: Get Uniswap quote + calldata
    const quoteResult = await getSwapQuote(
      { tokenIn, tokenOut, amount, swapper, chainId, slippage },
      headers
    );

    // Step 3: Build response
    const response: Record<string, unknown> = {
      trustScore: trustResult.trustScore,
      verdict: trustResult.verdict,
      riskFlags: trustResult.riskFlags,
      riskSummary: trustResult.riskSummary,
      quote: quoteResult.quote,
      calldata: quoteResult.calldata,
      to: quoteResult.to,
      value: quoteResult.value,
    };

    // Add warning for non-safe verdicts
    if (trustResult.verdict === "caution") {
      response.warning = "Token has some risk flags. Review before swapping.";
    } else if (trustResult.verdict === "risky") {
      response.warning = "High risk token. Proceed with extreme caution. You may lose funds.";
    }

    return { deliverable: JSON.stringify(response) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      deliverable: JSON.stringify({
        error: `Trust swap failed: ${message}`,
      }),
    };
  }
}

// ── API Helpers ───────────────────────────────────────────────────────────────

async function checkTokenTrust(
  tokenOut: string,
  headers: Record<string, string>
): Promise<TrustResult> {
  const url = `${MAIAT_API}/api/v1/token/${tokenOut}/trust`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    // If trust check fails, return cautious default
    return {
      trustScore: null,
      verdict: "caution",
      riskFlags: ["trust_check_failed"],
      riskSummary: "Could not verify token trust. Proceed with caution.",
    };
  }

  const data = (await res.json()) as Record<string, unknown>;

  return {
    trustScore: typeof data.trustScore === "number" ? data.trustScore : null,
    verdict: (data.verdict as TrustResult["verdict"]) || "caution",
    riskFlags: Array.isArray(data.riskFlags) ? data.riskFlags : [],
    riskSummary: typeof data.riskSummary === "string" ? data.riskSummary : "Unknown risk level",
  };
}

async function getSwapQuote(
  params: {
    tokenIn: string;
    tokenOut: string;
    amount: string;
    swapper: string;
    chainId: number;
    slippage: number;
  },
  headers: Record<string, string>
): Promise<QuoteResult> {
  const url = `${MAIAT_API}/api/v1/swap/quote`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((err.error as string) || `Swap quote failed (${res.status})`);
  }

  const data = (await res.json()) as Record<string, unknown>;

  return {
    quote: (data.quote as Record<string, unknown>) || {},
    calldata: (data.calldata as string) || "",
    to: (data.to as string) || "",
    value: (data.value as string) || "0",
  };
}

// ── Validation Helper ─────────────────────────────────────────────────────────

function isValidAddress(addr: unknown): addr is string {
  return typeof addr === "string" && /^0x[a-fA-F0-9]{40}$/.test(addr);
}
