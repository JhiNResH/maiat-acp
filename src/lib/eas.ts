/**
 * EAS (Ethereum Attestation Service) — On-chain Attestations on Base
 *
 * Creates trust attestations after completed ACP jobs.
 * Requires MAIAT_PRIVATE_KEY env var. If not set, attestations are silently skipped.
 *
 * EAS contracts (OP Stack predeployed):
 * - EAS:             0x4200000000000000000000000000000000000021
 * - SchemaRegistry:  0x4200000000000000000000000000000000000020
 *
 * Supports Base Sepolia (default) and Base Mainnet via EAS_CHAIN env var.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeAbiParameters,
  parseAbiParameters,
  type Address as ViemAddress,
  type Hex,
  type Chain,
} from "viem";

// Re-export Address for consumers
export type Address = ViemAddress;
import { base, baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// -- Chain Configuration ------------------------------------------------------

type SupportedChain = "sepolia" | "mainnet";

const EAS_CHAIN: SupportedChain = (process.env.EAS_CHAIN as SupportedChain) || "sepolia";

const CHAIN_CONFIG: Record<SupportedChain, { chain: Chain; rpc: string }> = {
  sepolia: {
    chain: baseSepolia,
    rpc: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
  },
  mainnet: {
    chain: base,
    rpc: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  },
};

const { chain: ACTIVE_CHAIN, rpc: ACTIVE_RPC } = CHAIN_CONFIG[EAS_CHAIN];

// -- Constants ----------------------------------------------------------------

export const EAS_CONTRACT_ADDRESS: Address = "0x4200000000000000000000000000000000000021";
export const SCHEMA_REGISTRY_ADDRESS: Address = "0x4200000000000000000000000000000000000020";

/**
 * Legacy Maiat Trust Attestation Schema (backward compatible).
 * Fields: agent (address), score (uint8), verdict (string), offering (string),
 *         jobId (uint256), riskSummary (string)
 */
export const DEFAULT_SCHEMA_UID: Hex =
  (process.env.EAS_SCHEMA_UID as Hex) ||
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const LEGACY_SCHEMA_STRING =
  "address agent,uint8 score,string verdict,string offering,uint256 jobId,string riskSummary";

// -- New Schema Definitions ---------------------------------------------------

/**
 * MaiatServiceAttestation — emitted when an offering completes.
 */
export const SERVICE_SCHEMA_UID: Hex =
  (process.env.EAS_SERVICE_SCHEMA_UID as Hex) ||
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export const SERVICE_SCHEMA_STRING =
  "address agent,string service,string result,uint8 trust_score_at_time,uint64 timestamp,uint256 job_id";

/**
 * MaiatReviewAttestation — emitted when a review/vote is submitted.
 */
export const REVIEW_SCHEMA_UID: Hex =
  (process.env.EAS_REVIEW_SCHEMA_UID as Hex) ||
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export const REVIEW_SCHEMA_STRING =
  "address reviewer,address reviewed_agent,string review_type,uint8 rating,uint64 timestamp";

/**
 * MaiatTrustQuery — emitted when trust is queried via API.
 */
export const QUERY_SCHEMA_UID: Hex =
  (process.env.EAS_QUERY_SCHEMA_UID as Hex) ||
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export const QUERY_SCHEMA_STRING =
  "address queried_agent,uint8 trust_score,string dimensions,address queried_by,uint64 timestamp";

// -- ABI (minimal) ------------------------------------------------------------

const EAS_ABI = [
  {
    name: "attest",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "schema", type: "bytes32" },
          {
            name: "data",
            type: "tuple",
            components: [
              { name: "recipient", type: "address" },
              { name: "expirationTime", type: "uint64" },
              { name: "revocable", type: "bool" },
              { name: "refUID", type: "bytes32" },
              { name: "data", type: "bytes" },
              { name: "value", type: "uint256" },
            ],
          },
        ],
      },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "getAttestation",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "uid", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "uid", type: "bytes32" },
          { name: "schema", type: "bytes32" },
          { name: "time", type: "uint64" },
          { name: "expirationTime", type: "uint64" },
          { name: "revocationTime", type: "uint64" },
          { name: "refUID", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "attester", type: "address" },
          { name: "revocable", type: "bool" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
  },
] as const;

const SCHEMA_REGISTRY_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "schema", type: "string" },
      { name: "resolver", type: "address" },
      { name: "revocable", type: "bool" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

// -- Clients ------------------------------------------------------------------

function getPublicClient() {
  return createPublicClient({
    chain: ACTIVE_CHAIN,
    transport: http(ACTIVE_RPC),
  });
}

function getWalletClient() {
  const pk = process.env.MAIAT_PRIVATE_KEY as Hex | undefined;
  if (!pk) return null;

  const account = privateKeyToAccount(pk);
  return createWalletClient({
    account,
    chain: ACTIVE_CHAIN,
    transport: http(ACTIVE_RPC),
  });
}

// -- Helper -------------------------------------------------------------------

const ZERO_BYTES32: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

async function submitAttestation(
  schemaUID: Hex,
  recipient: Address,
  encodedData: Hex
): Promise<Hex | null> {
  const walletClient = getWalletClient();
  if (!walletClient) {
    console.log("[eas] No MAIAT_PRIVATE_KEY — skipping attestation");
    return null;
  }

  try {
    const txHash = await walletClient.writeContract({
      address: EAS_CONTRACT_ADDRESS,
      abi: EAS_ABI,
      functionName: "attest",
      args: [
        {
          schema: schemaUID,
          data: {
            recipient,
            expirationTime: 0n,
            revocable: false,
            refUID: ZERO_BYTES32,
            data: encodedData,
            value: 0n,
          },
        },
      ],
    });

    const publicClient = getPublicClient();
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    const attestedLog = receipt.logs.find(
      (log) =>
        log.address.toLowerCase() === EAS_CONTRACT_ADDRESS.toLowerCase() && log.topics.length > 0
    );

    const uid = attestedLog?.data ? (attestedLog.data.slice(0, 66) as Hex) : txHash;

    console.log(`[eas] Attestation created — UID: ${uid} tx: ${txHash} chain: ${EAS_CHAIN}`);
    return uid;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Common: contract revert when schema UID is invalid or not registered
    if (msg.includes("revert") || msg.includes("0xbf37b20e")) {
      console.warn(
        `[eas] Attestation reverted — schema may not be registered on ${EAS_CHAIN}. Skipping.`
      );
    } else {
      console.error(`[eas] Attestation failed: ${msg}`);
    }
    return null;
  }
}

// -- Public API: Legacy -------------------------------------------------------

export interface AttestationData {
  /** Agent wallet address being attested */
  agent: Address;
  /** Trust score 0-100 */
  score: number;
  /** proceed | caution | avoid | unknown */
  verdict: string;
  /** Offering name (e.g. agent_trust, token_check) */
  offering: string;
  /** ACP job ID */
  jobId: number;
  /** One-line risk summary */
  riskSummary: string;
}

/**
 * Check if EAS attestations are enabled (private key + schema UID configured).
 */
export function isEasEnabled(): boolean {
  return !!(process.env.MAIAT_PRIVATE_KEY && DEFAULT_SCHEMA_UID !== ZERO_BYTES32);
}

/**
 * Create an on-chain EAS attestation for a trust check result (legacy schema).
 * Returns the attestation UID, or null if EAS is not configured.
 */
export async function createAttestation(data: AttestationData): Promise<Hex | null> {
  if (!isEasEnabled()) {
    return null;
  }

  const encodedData = encodeAbiParameters(
    parseAbiParameters(
      "address agent, uint8 score, string verdict, string offering, uint256 jobId, string riskSummary"
    ),
    [data.agent, data.score, data.verdict, data.offering, BigInt(data.jobId), data.riskSummary]
  );

  return submitAttestation(DEFAULT_SCHEMA_UID, data.agent, encodedData);
}

// -- Public API: Service Attestation ------------------------------------------

export interface ServiceAttestationData {
  /** Agent wallet that called the offering */
  agent: Address;
  /** Offering name (token_check, agent_trust, etc.) */
  service: string;
  /** "success" | "failure" */
  result: string;
  /** Trust score at time of attestation (0-100) */
  trustScoreAtTime: number;
  /** Unix timestamp */
  timestamp?: number;
  /** ACP job ID */
  jobId: number;
}

/**
 * Check if service attestations are enabled.
 */
export function isServiceAttestationEnabled(): boolean {
  return !!(process.env.MAIAT_PRIVATE_KEY && SERVICE_SCHEMA_UID !== ZERO_BYTES32);
}

/**
 * Create a MaiatServiceAttestation on-chain.
 */
export async function createServiceAttestation(data: ServiceAttestationData): Promise<Hex | null> {
  if (!isServiceAttestationEnabled()) {
    return null;
  }

  const timestamp = data.timestamp ?? Math.floor(Date.now() / 1000);

  const encodedData = encodeAbiParameters(
    parseAbiParameters(
      "address agent, string service, string result, uint8 trust_score_at_time, uint64 timestamp, uint256 job_id"
    ),
    [
      data.agent,
      data.service,
      data.result,
      data.trustScoreAtTime,
      BigInt(timestamp),
      BigInt(data.jobId),
    ]
  );

  return submitAttestation(SERVICE_SCHEMA_UID, data.agent, encodedData);
}

// -- Public API: Review Attestation -------------------------------------------

export interface ReviewAttestationData {
  /** Reviewer wallet */
  reviewer: Address;
  /** Agent being reviewed */
  reviewedAgent: Address;
  /** "review" | "vote" | "helpful" */
  reviewType: string;
  /** Rating 0-100 */
  rating: number;
  /** Unix timestamp */
  timestamp?: number;
}

/**
 * Check if review attestations are enabled.
 */
export function isReviewAttestationEnabled(): boolean {
  return !!(process.env.MAIAT_PRIVATE_KEY && REVIEW_SCHEMA_UID !== ZERO_BYTES32);
}

/**
 * Create a MaiatReviewAttestation on-chain.
 */
export async function createReviewAttestation(data: ReviewAttestationData): Promise<Hex | null> {
  if (!isReviewAttestationEnabled()) {
    return null;
  }

  const timestamp = data.timestamp ?? Math.floor(Date.now() / 1000);

  const encodedData = encodeAbiParameters(
    parseAbiParameters(
      "address reviewer, address reviewed_agent, string review_type, uint8 rating, uint64 timestamp"
    ),
    [data.reviewer, data.reviewedAgent, data.reviewType, data.rating, BigInt(timestamp)]
  );

  return submitAttestation(REVIEW_SCHEMA_UID, data.reviewedAgent, encodedData);
}

// -- Public API: Query Attestation --------------------------------------------

export interface QueryAttestationData {
  /** Agent being queried */
  queriedAgent: Address;
  /** Trust score result (0-100) */
  trustScore: number;
  /** JSON string of dimension scores */
  dimensions: string;
  /** Wallet that made the query */
  queriedBy: Address;
  /** Unix timestamp */
  timestamp?: number;
}

/**
 * Check if query attestations are enabled.
 */
export function isQueryAttestationEnabled(): boolean {
  return !!(process.env.MAIAT_PRIVATE_KEY && QUERY_SCHEMA_UID !== ZERO_BYTES32);
}

/**
 * Create a MaiatTrustQuery attestation on-chain.
 */
export async function createQueryAttestation(data: QueryAttestationData): Promise<Hex | null> {
  if (!isQueryAttestationEnabled()) {
    return null;
  }

  const timestamp = data.timestamp ?? Math.floor(Date.now() / 1000);

  const encodedData = encodeAbiParameters(
    parseAbiParameters(
      "address queried_agent, uint8 trust_score, string dimensions, address queried_by, uint64 timestamp"
    ),
    [data.queriedAgent, data.trustScore, data.dimensions, data.queriedBy, BigInt(timestamp)]
  );

  return submitAttestation(QUERY_SCHEMA_UID, data.queriedAgent, encodedData);
}

// -- Query Attestation --------------------------------------------------------

/**
 * Query an attestation by UID.
 */
export async function getAttestation(uid: Hex) {
  try {
    const publicClient = getPublicClient();
    const result = await publicClient.readContract({
      address: EAS_CONTRACT_ADDRESS,
      abi: EAS_ABI,
      functionName: "getAttestation",
      args: [uid],
    });
    return result;
  } catch (error) {
    console.error("[eas] Error fetching attestation:", error);
    return null;
  }
}

// -- Schema Registration ------------------------------------------------------

/**
 * Register a schema on EAS. Returns the schema UID.
 */
export async function registerSchema(schemaString: string): Promise<Hex | null> {
  const walletClient = getWalletClient();
  if (!walletClient) {
    console.error("[eas] No MAIAT_PRIVATE_KEY — cannot register schema");
    return null;
  }

  try {
    const txHash = await walletClient.writeContract({
      address: SCHEMA_REGISTRY_ADDRESS,
      abi: SCHEMA_REGISTRY_ABI,
      functionName: "register",
      args: [
        schemaString,
        "0x0000000000000000000000000000000000000000" as Address, // No resolver
        false, // Not revocable
      ],
    });

    const publicClient = getPublicClient();
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    const registeredLog = receipt.logs.find(
      (log) => log.address.toLowerCase() === SCHEMA_REGISTRY_ADDRESS.toLowerCase()
    );

    const schemaUID = registeredLog?.topics?.[1] as Hex | undefined;

    console.log(`[eas] Schema registered — UID: ${schemaUID} tx: ${txHash} chain: ${EAS_CHAIN}`);
    return schemaUID ?? null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[eas] Schema registration failed: ${msg}`);
    return null;
  }
}

/**
 * Get the legacy schema string used for attestations.
 */
export function getSchemaString(): string {
  return LEGACY_SCHEMA_STRING;
}

/**
 * Get current chain configuration info.
 */
export function getChainInfo(): { chain: string; rpc: string; chainId: number } {
  return {
    chain: EAS_CHAIN,
    rpc: ACTIVE_RPC,
    chainId: ACTIVE_CHAIN.id,
  };
}

// -- Oracle Integration -------------------------------------------------------

const ORACLE_ADDRESS: Address | null = (process.env.MAIAT_ORACLE_ADDRESS as Address) || null;

const ORACLE_ABI = [
  {
    name: "updateScore",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agent", type: "address" },
      { name: "score", type: "uint8" },
      { name: "verdict", type: "string" },
      { name: "jobId", type: "uint256" },
      { name: "offering", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "getTrustScore",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [
      { name: "score", type: "uint8" },
      { name: "verdict", type: "string" },
      { name: "updatedAt", type: "uint64" },
    ],
  },
] as const;

/**
 * Check if the Oracle is enabled.
 */
export function isOracleEnabled(): boolean {
  return !!(process.env.MAIAT_PRIVATE_KEY && ORACLE_ADDRESS);
}

/**
 * Update the trust score on the MaiatOracle contract.
 * Non-blocking — caller should .catch() errors.
 */
export async function updateOracle(data: AttestationData): Promise<string | null> {
  if (!isOracleEnabled() || !ORACLE_ADDRESS) {
    return null;
  }

  const walletClient = getWalletClient();
  if (!walletClient) return null;

  try {
    const txHash = await walletClient.writeContract({
      address: ORACLE_ADDRESS,
      abi: ORACLE_ABI,
      functionName: "updateScore",
      args: [data.agent, data.score, data.verdict, BigInt(data.jobId), data.offering],
    });

    console.log(`[oracle] Score updated — agent: ${data.agent} score: ${data.score} tx: ${txHash}`);
    return txHash;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[oracle] Update failed: ${msg}`);
    return null;
  }
}

/**
 * Read trust score from the MaiatOracle contract.
 */
export async function readOracleScore(
  agent: Address
): Promise<{ score: number; verdict: string; updatedAt: number } | null> {
  if (!ORACLE_ADDRESS) return null;

  try {
    const publicClient = getPublicClient();
    const [score, verdict, updatedAt] = await publicClient.readContract({
      address: ORACLE_ADDRESS,
      abi: ORACLE_ABI,
      functionName: "getTrustScore",
      args: [agent],
    });
    return { score, verdict, updatedAt: Number(updatedAt) };
  } catch (error) {
    console.error("[oracle] Read failed:", error);
    return null;
  }
}
