/**
 * Maiat Trust Score — ACP Seller Handler
 * 
 * When another agent buys this service, executeJob is called.
 * We query our own /api/trust-score and return the result.
 */

const MAIAT_API = process.env.MAIAT_API_URL || 'https://maiat.vercel.app'

export async function validateJob(requirements: { project: string }): Promise<{ valid: boolean; reason?: string }> {
  if (!requirements.project || requirements.project.trim().length === 0) {
    return { valid: false, reason: 'Missing project name or address' }
  }
  return { valid: true }
}

export async function executeJob(requirements: { project: string }): Promise<Record<string, unknown>> {
  const { project } = requirements

  // Query Maiat's trust score API
  const url = `${MAIAT_API}/api/trust-score?project=${encodeURIComponent(project)}`
  const res = await fetch(url)

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Trust score query failed (${res.status})`)
  }

  const data = await res.json()

  return {
    trustScore: data.trustScore,
    riskLevel: data.riskLevel,
    reviewCount: data.reviewCount,
    avgRating: data.avgRating,
    sentiment: data.sentiment,
    recommendation: data.recommendation,
    strengths: data.strengths,
    concerns: data.concerns,
    chain: data.chain,
    category: data.category,
    dataSource: data.dataSource,
  }
}
