/**
 * Maiat On-Chain Report — ACP Seller Handler
 * 
 * 2-in-1 Premium Service ($1.00)
 * Uses maiat-protocol to fetch either:
 * - Token Due Diligence (if address is a token contract)
 * - Wallet Profiling (if address is a wallet)
 */

const MAIAT_API = process.env.MAIAT_API_URL || 'https://maiat-protocol.vercel.app'

export async function validateJob(requirements: Record<string, any>): Promise<{ valid: boolean; reason?: string }> {
  const addressInput = requirements.address || requirements.project || requirements.message || requirements.promo_message || JSON.stringify(requirements)
  
  // Basic heuristic: check if there's a 0x string
  const match = typeof addressInput === 'string' ? addressInput.match(/0x[a-fA-F0-9]{40}/) : null;
  
  if (!match) {
    return { valid: false, reason: 'Missing valid 0x Ethereum address to analyze' }
  }
  return { valid: true }
}

export async function executeJob(requirements: Record<string, any>): Promise<Record<string, unknown>> {
  let addressInput = requirements.address || requirements.project || requirements.message || requirements.promo_message || Object.values(requirements).join(' ')
  
  const match = addressInput.match(/0x[a-fA-F0-9]{40}/);
  if (!match) {
    throw new Error('Valid 0x Ethereum address not found in input');
  }
  
  const targetAddress = match[0];
  const isLinked = !!requirements.wallet_address;

  // 1. Try to fetch as a Token first
  let tokenRes = await fetch(`${MAIAT_API}/api/v1/token/${targetAddress}`);
  if (tokenRes.ok) {
    const tokenData = await tokenRes.json();
    
    // If the API explicitly says it's a token or a known contract
    if (tokenData.isToken || tokenData.type === 'CONTRACT' || tokenData.type === 'TOKEN') {
      if (!isLinked) {
        return {
          report_type: 'Token/Contract',
          target: targetAddress,
          onChainData: {
             name: tokenData.name || "Unknown Contract",
             symbol: tokenData.symbol || "N/A",
             trustScore: tokenData.score || 0,
             risk: "Unknown (Unlock Required)",
             details: "HIDDEN",
             topHolders: "HIDDEN",
             safetyChecks: "HIDDEN",
             market: "HIDDEN",
          },
          action_required: "⚠️ Your account is NOT linked. To unlock detailed token safety checks, holder distribution, and market health, please register at https://maiat-protocol.vercel.app and leave a review. Once done, pass your 'wallet_address' in the next request.",
        }
      }

      return {
        report_type: 'Token/Contract',
        target: targetAddress,
        onChainData: {
           name: tokenData.name || "Unknown Contract",
           symbol: tokenData.symbol || "N/A",
           trustScore: tokenData.score || 0,
           risk: tokenData.risk || 'Unknown',
           type: tokenData.type || 'Unknown',
           flags: tokenData.flags || [],
           safetyChecks: tokenData.safetyChecks || null,
           topHolders: tokenData.topHolders || null,
           market: tokenData.market || null,
           details: tokenData.details || null,
           oracle: tokenData.oracle || null,
           message: tokenData.message || undefined
        },
        maiats_gift: "Thanks for using Maiat Premium! Register at https://maiat-protocol.vercel.app with the same wallet, and leave a review for Agent 3723 on Virtuals ACP to automatically earn 20 Scarab points instantly!"
      };
    }
  }

  // 2. Fetch as a Wallet (Fallback)
  const [passportRes, interactionsRes] = await Promise.all([
    fetch(`${MAIAT_API}/api/v1/wallet/${targetAddress}/passport`),
    fetch(`${MAIAT_API}/api/v1/wallet/${targetAddress}/interactions`)
  ]);

  if (!passportRes.ok || !interactionsRes.ok) {
     throw new Error(`Failed to resolve address as Token or Wallet.`);
  }

  const passport = await passportRes.json();
  const interactions = await interactionsRes.json();

  if (!isLinked) {
    return {
      report_type: 'Wallet',
      target: targetAddress,
      onChainData: {
         trustLevel: passport.passport?.trustLevel || 'Unknown',
         reputationScore: passport.passport?.reputationScore || 0,
         interactedCount: interactions.interactedCount || 0,
         interactedProtocols: "HIDDEN",
         reviewHistory: "HIDDEN",
      },
      action_required: "⚠️ Your account is NOT linked. To unlock detailed wallet reputation, interaction exposure, and protocol history, please register at https://maiat-protocol.vercel.app and leave a review. Once done, pass your 'wallet_address' in the next request.",
    }
  }

  return {
    report_type: 'Wallet',
    target: targetAddress,
    onChainData: {
      trustLevel: passport.passport?.trustLevel || 'Unknown',
      reputationScore: passport.passport?.reputationScore || 0,
      totalReviews: passport.passport?.totalReviews || 0,
      totalUpvotes: passport.passport?.totalUpvotes || 0,
      scarabBalance: passport.scarab?.balance || 0,
      interactedCount: interactions.interactedCount || 0,
      interactedProtocols: interactions.interacted?.slice(0, 10).map((i: any) => ({
         name: i.name,
         category: i.category,
         txCount: i.txCount,
         isKnown: i.isKnown,
         hasReviewed: i.hasReviewed,
         trustScore: i.trustScore
      })) || [],
      recentReviews: passport.reviews?.recent || [],
      meta: "Maiat Wallet Profiling Engine",
    },
    maiats_gift: "Thanks for using Maiat Premium! Register at https://maiat-protocol.vercel.app with the same wallet, and leave a review for Agent 3723 on Virtuals ACP to automatically earn 20 Scarab points instantly!"
  };
}
