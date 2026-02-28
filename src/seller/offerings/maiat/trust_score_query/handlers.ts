/**
 * Maiat Trust Score — ACP Seller Handler
 *
 * When another agent buys this service, executeJob is called.
 * We query our own /api/trust-score and return the result.
 */

import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { hasERC8004Identity } from "../../../../lib/erc8004.js";

const MAIAT_API = process.env.MAIAT_API_URL || "https://maiat-protocol.vercel.app";

// ── Validation ────────────────────────────────────────────────────────────────
// NOTE: must be named `validateRequirements` — the seller runtime looks for this exact export name.
export function validateRequirements(requirements: Record<string, any>): ValidationResult {
  // Accept everything — even empty requirements.
  // executeJob handles gracefully with a helpful response.
  return { valid: true };
}

// ── Payment message ───────────────────────────────────────────────────────────
export function requestPayment(requirements: Record<string, any>): string {
  const project =
    requirements.project ||
    requirements.query ||
    requirements.symbol ||
    requirements.token ||
    requirements.name ||
    requirements.message ||
    "your request";
  return `Querying Maiat trust score for "${String(project).substring(0, 60)}". Please proceed with payment.`;
}

// ── Execution ─────────────────────────────────────────────────────────────────
export async function executeJob(requirements: Record<string, any>): Promise<ExecuteJobResult> {
  // Support common field names: project, query, symbol, name, address, token
  let project =
    requirements.project ||
    requirements.query ||
    requirements.symbol ||
    requirements.token ||
    requirements.name ||
    requirements.address;

  // Resolve project identifier from raw text only when no structured field found
  if (!project) {
    const rawText = requirements.message || requirements.promo_message || null;

    if (rawText && rawText.length > 30) {
      const addressMatch = rawText.match(/(0x[a-fA-F0-9]{40})/);
      if (addressMatch?.[1]) {
        project = addressMatch[1];
      } else {
        const match = rawText.match(/^([A-Za-z0-9]+)(?:\s+(?:—|-|\|)|\s+)/);
        project = match?.[1] ?? rawText.split(" ")[0] ?? rawText;
      }
    } else if (rawText) {
      project = rawText;
    }
  }

  // Graceful fallback — don't throw, return a helpful response so job completes
  if (!project || String(project).trim() === "" || String(project).trim() === "undefined") {
    const result = {
      trustScore: null,
      riskLevel: "Unknown",
      reviewCount: 0,
      recommendation: "Please provide a project name or 0x contract address.",
      usage: 'Pass { project: "AIXBT" } or { project: "0x..." } as requirements.',
      maiats_gift:
        "Maiat scores 10,000+ DeFi protocols and AI agents. Try: AIXBT, Virtuals, HeyAnon, Brian AI, Ethy, Wayfinder.",
    };
    return { deliverable: JSON.stringify(result) };
  }

  // Use /api/v1/project/[slug]?realtime=1 — live DeFiLlama + DEXScreener + Basescan score,
  // auto write-back to DB so downstream trust-check stays fresh.
  const url = `${MAIAT_API}/api/v1/project/${encodeURIComponent(String(project).substring(0, 100))}?realtime=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });

  if (!res.ok) {
    if (res.status === 404) {
      // Fall back to fuzzy search via explore API
      try {
        const searchRes = await fetch(`${MAIAT_API}/api/v1/explore`);
        if (searchRes.ok) {
          const data: any = await searchRes.json();
          const projects = data.projects || [];
          const query = String(project).toLowerCase().trim();
          // 1. Exact slug match
          // 2. Exact symbol match (p.symbol)
          // 3. Name includes full query string
          // 4. Query includes full project name (not just first word — prevents "virtual base" matching "Base USDC")
          const match = projects.find(
            (p: any) =>
              p.slug?.toLowerCase() === query ||
              p.symbol?.toLowerCase() === query ||
              p.name?.toLowerCase() === query ||
              p.name?.toLowerCase().includes(query) ||
              (p.name && query.includes(p.name.toLowerCase()))
          );
          if (match) {
            // match.trustScore is 0-10 from explore API, multiply by 10 for 0-100
            const score = Math.round((match.trustScore || 0) * 10);
            const riskLevel = score >= 70 ? "Low" : score >= 40 ? "Medium" : "High";
            const reviewCount = match.reviewCount ?? 0;
            const avgRating = match.avgRating ?? null;
            const projectSlug = match.slug ?? match.name?.toLowerCase().replace(/\s+/g, "-");
            const reviewUrl = projectSlug
              ? `https://maiat-protocol.vercel.app/agent/${projectSlug}`
              : `https://maiat-protocol.vercel.app/explore`;
            const review_prompt = {
              message: `Help improve ${match.name}'s trust score — write a review and earn Scarab`,
              url: reviewUrl,
              reward: "Earn 3-10 Scarab points based on review quality",
            };

            const riskEmoji = riskLevel === "Low" ? "🟢" : riskLevel === "Medium" ? "🟡" : "🔴";
            const recommendation =
              score >= 70
                ? "Low risk — strong trust signals."
                : score >= 40
                  ? "Medium risk — use caution."
                  : "High risk — proceed carefully.";

            const markdown = `# Trust Score Report: ${match.name}

## Summary
- **Trust Score**: ${score}/100 ${riskEmoji}
- **Risk Level**: ${riskLevel}
- **Community Reviews**: ${reviewCount}${avgRating ? ` (avg ${avgRating}/5 ⭐)` : ""}
- **Recommendation**: ${recommendation}

## Score Details
- **Chain**: ${match.chain ?? "Base"}
- **Category**: ${match.category ?? "Unknown"}

## Review & Improve
${review_prompt.message}
🔗 ${review_prompt.url}
🪲 ${review_prompt.reward}

*Powered by [Maiat Protocol](https://maiat-protocol.vercel.app) — Trust infrastructure for agentic commerce*`;

            return { deliverable: markdown };
          }
        }
      } catch {
        // Fuzzy search failed, continue to 404 response
      }

      // Queue for indexing and return helpful response
      fetch(`${MAIAT_API}/api/v1/project/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: String(project), source: "trust_score_query" }),
      }).catch(() => {
        /* fire-and-forget */
      });

      const result = {
        trustScore: null,
        riskLevel: "Unknown",
        reviewCount: 0,
        recommendation: `'${project}' is not yet indexed on Maiat. Be the first to review it and earn Scarab points.`,
        review_prompt: {
          message: "Help build the first trust score for this project",
          url: `https://maiat-protocol.vercel.app/explore`,
          reward: "Earn 5 Scarab points for the first review",
        },
      };
      return { deliverable: JSON.stringify(result) };
    }
    const err: any = await res.json().catch(() => ({}));
    throw new Error(err.error || `Trust score query failed (${res.status})`);
  }

  const raw: any = await res.json();
  // ?realtime=1 → { project: { trustScore, ... }, realtime: { score, grade, riskLevel, breakdown, signals, flags } }
  const p = raw?.project ?? raw;
  const rt = raw?.realtime; // RealtimeTrustResult — present when live fetch succeeded
  const score = p?.trustScore ?? null;
  // Prefer realtime riskLevel (computed from live data); fall back to simple threshold bands
  const riskLevel =
    rt?.riskLevel ??
    (score === null ? "Unknown" : score >= 70 ? "Low" : score >= 40 ? "Medium" : "High");
  const grade: string | null = rt?.grade ?? null;
  const reviewCount = p?.reviewCount ?? 0;
  const avgRating = p?.avgRating ?? null;
  const projectSlug = p?.slug ?? null;
  const reviewUrl = projectSlug
    ? `https://maiat-protocol.vercel.app/agent/${projectSlug}`
    : `https://maiat-protocol.vercel.app/explore`;
  const review_prompt = {
    message: `Help improve ${String(project)}'s trust score — write a review and earn Scarab`,
    url: reviewUrl,
    reward: "Earn 3-10 Scarab points based on review quality",
  };

  // Check ERC-8004 identity for the seller wallet if available
  let erc8004Verified = false;
  const sellerWallet = requirements.seller_wallet || requirements.wallet_address;
  if (sellerWallet && typeof sellerWallet === "string" && sellerWallet.startsWith("0x")) {
    try {
      erc8004Verified = await hasERC8004Identity(sellerWallet);
    } catch {
      // Silently fail - ERC-8004 check is supplementary
    }
  }

  const riskEmoji =
    riskLevel === "Low" ? "🟢" : riskLevel === "Medium" ? "🟡" : riskLevel === "High" ? "🔴" : "⚪";
  const recommendation =
    score === null
      ? "Project not indexed yet."
      : score >= 70
        ? "Low risk — strong trust signals."
        : score >= 40
          ? "Medium risk — use caution."
          : "High risk — proceed carefully.";

  const chain = p?.chain ?? "Base";
  const gradeDisplay = grade ? ` · Grade **${grade}**` : "";

  // Build enriched breakdown section from realtime data when available
  const signals = rt?.signals;
  const breakdown = rt?.breakdown;
  const tvlStr = signals?.tvl != null ? `$${(signals.tvl / 1_000_000).toFixed(1)}M` : null;
  const volStr = signals?.volume24h != null ? `$${(signals.volume24h / 1_000).toFixed(0)}K` : null;
  const auditStr =
    signals?.audited === true
      ? `✅ Audited${signals.auditFirms?.length ? " by " + signals.auditFirms.join(", ") : ""}`
      : signals?.audited === false
        ? "❌ Not audited"
        : null;
  const flagStr = rt?.flags?.length ? rt.flags.join(", ") : null;

  const breakdownSection =
    score !== null
      ? [
          `\n## Score Breakdown${breakdown ? " (Live Data)" : ""}`,
          `- **Chain**: ${chain} · **Category**: ${p?.category ?? "Unknown"}`,
          breakdown
            ? [
                `- TVL/Liquidity:     ${breakdown.tvlLiquidity}/100`,
                `- Audit/Code:        ${breakdown.auditCodeQuality}/100`,
                `- Contract Safety:   ${breakdown.contractSafety}/100`,
                `- Market Activity:   ${breakdown.marketActivity}/100`,
                `- Community Reviews: ${breakdown.communityReviews}/100`,
              ].join("\n")
            : "",
          tvlStr ? `- **TVL**: ${tvlStr}` : "",
          volStr ? `- **24h Volume**: ${volStr}` : "",
          auditStr ? `- **Audit**: ${auditStr}` : "",
          flagStr ? `\n⚠️ **Risk Flags**: ${flagStr}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";

  const erc8004Section = erc8004Verified
    ? `\n## On-Chain Identity\n- **ERC-8004 Verified**: ✅ Yes`
    : "";

  const markdown = `# Trust Score Report: ${String(project).substring(0, 40)}

## Summary
- **Trust Score**: ${score ?? "N/A"}/100 ${riskEmoji}${gradeDisplay}
- **Risk Level**: ${riskLevel}
- **Community Reviews**: ${reviewCount}${avgRating ? ` (avg ${avgRating}/5 ⭐)` : ""}
- **Recommendation**: ${recommendation}
${breakdownSection}${erc8004Section}

## Review & Improve
${review_prompt.message}
🔗 ${review_prompt.url}
🪲 ${review_prompt.reward}

*Powered by [Maiat Protocol](https://maiat-protocol.vercel.app) — Trust infrastructure for agentic commerce*`;

  return { deliverable: markdown };
}
