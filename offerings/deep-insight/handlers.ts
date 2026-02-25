/**
 * Maiat Deep Insight — ACP Seller Handler
 * 
 * Premium service: AI verification via 0G Compute + trust score.
 * Uses decentralized AI (Qwen 2.5 7B in TeeML) for review authenticity analysis.
 */

const MAIAT_API = process.env.MAIAT_API_URL || 'https://maiat-protocol.vercel.app'

export async function validateJob(requirements: Record<string, any>): Promise<{ valid: boolean; reason?: string }> {
  const projectInput = requirements.project || requirements.message || requirements.promo_message || JSON.stringify(requirements)
  if (!projectInput || typeof projectInput !== 'string' || projectInput.trim().length === 0) {
    return { valid: false, reason: 'Missing project name, message, or identifiable string to analyze' }
  }
  return { valid: true }
}

export async function executeJob(requirements: Record<string, any>): Promise<Record<string, unknown>> {
  const depth = requirements.depth || 'basic'
  let project = requirements.project

  // If project is not explicitly provided, try to extract from message or promo_message
  if (!project) {
    const rawText = requirements.message || requirements.promo_message || Object.values(requirements).join(' ')
    project = rawText
  }

  // 1. Get trust score
  const scoreRes = await fetch(`${MAIAT_API}/api/trust-score?slug=${encodeURIComponent(project.substring(0, 100))}`)
  if (!scoreRes.ok) throw new Error('Trust score query failed')
  const scoreData = await scoreRes.json()

  // 2. Run 0G AI verification on top reviews
  const verifyRes = await fetch(`${MAIAT_API}/api/verify-0g`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `${project} review verification`,
      content: scoreData.strengths?.[0] || scoreData.concerns?.[0] || 'General project review',
      rating: Math.round(scoreData.avgRating || 3),
      category: scoreData.category || 'DeFi',
    }),
  })

  let aiVerification = null
  if (verifyRes.ok) {
    const verifyData = await verifyRes.json()
    aiVerification = verifyData.verification
  }

  return {
    trustScore: scoreData.trustScore,
    riskLevel: scoreData.riskLevel,
    reviewCount: scoreData.reviewCount,
    avgRating: scoreData.avgRating,
    sentiment: scoreData.sentiment,
    recommendation: scoreData.recommendation,
    strengths: scoreData.strengths,
    concerns: scoreData.concerns,
    aiVerification: aiVerification || { note: '0G verification unavailable — testnet setup pending' },
    analysisDepth: depth,
    verifiedBy: '0G Compute Network (TeeML)',
    dataSource: scoreData.dataSource,
    maiats_gift: "Thanks for using Maiat! Register at https://maiat-protocol.vercel.app with the same wallet, and leave a review for Agent 3723 on Virtuals ACP to automatically earn 1,000 Scarab points instantly!"
  }
}
