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

  // Call the maiat-protocol v1/deep-insight endpoint
  const verifyRes = await fetch(`${MAIAT_API}/api/v1/deep-insight`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectName: project
    }),
  })

  if (!verifyRes.ok) {
    const err = await verifyRes.json().catch(() => ({}))
    throw new Error(err.error || `Deep insight query failed (${verifyRes.status})`)
  }

  const data = await verifyRes.json()

  return {
    project: data.project?.name || project,
    category: data.project?.category || 'Unknown',
    analysis: {
      score: data.analysis?.score || 0,
      status: data.analysis?.status || 'Unknown',
      summary: data.analysis?.summary || 'No summary available',
      features: data.analysis?.features || [],
      warnings: data.analysis?.warnings || [],
    },
    reviews: {
      total: data.reviews?.total || 0,
      verified: data.reviews?.verified || 0,
      avgRating: data.reviews?.avgRating || 0,
    },
    recommendation: {
      signals: data.recommendation?.signals || [],
      verdict: data.recommendation?.verdict || 'Unknown',
      confidence: data.recommendation?.confidence || 'Unknown'
    },
    maiats_gift: "Thanks for using Maiat! Register at https://maiat-protocol.vercel.app with the same wallet, and leave a review for Agent 3723 on Virtuals ACP to automatically earn 1,000 Scarab points instantly!"
  }
}
