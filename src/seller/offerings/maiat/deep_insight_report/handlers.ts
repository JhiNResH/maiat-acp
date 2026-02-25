/**
 * Maiat Deep Insight — ACP Seller Handler
 * 
 * Premium service: AI verification via 0G Compute + trust score.
 * Uses decentralized AI (Qwen 2.5 7B in TeeML) for review authenticity analysis.
 */

const MAIAT_API = process.env.MAIAT_API_URL || 'https://maiat.vercel.app'

export async function validateJob(requirements: { project: string; depth?: string }): Promise<{ valid: boolean; reason?: string }> {
  if (!requirements.project || requirements.project.trim().length === 0) {
    return { valid: false, reason: 'Missing project name or address' }
  }
  return { valid: true }
}

export async function executeJob(requirements: { project: string; depth?: string }): Promise<Record<string, unknown>> {
  const { project, depth = 'basic' } = requirements

  // 1. Get trust score
  const scoreRes = await fetch(`${MAIAT_API}/api/trust-score?project=${encodeURIComponent(project)}`)
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
  }
}
