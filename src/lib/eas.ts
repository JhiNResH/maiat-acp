/**
 * EAS (Ethereum Attestation Service) — On-chain Attestations on Base
 *
 * Creates trust attestations after completed ACP jobs.
 * Requires MAIAT_PRIVATE_KEY env var. If not set, attestations are silently skipped.
 *
 * EAS contracts on Base Mainnet:
 * - EAS:             0x4200000000000000000000000000000000000021
 * - SchemaRegistry:  0x4200000000000000000000000000000000000020
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodePacked,
  encodeAbiParameters,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// -- Constants ----------------------------------------------------------------

const BASE_RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";

export const EAS_CONTRACT_ADDRESS: Address = "0x4200000000000000000000000000000000000021";
export const SCHEMA_REGISTRY_ADDRESS: Address = "0x4200000000000000000000000000000000000020";

/**
 * Maiat Trust Attestation Schema.
 * Fields: agent (address), score (uint8), verdict (string), offering (string),
 *         jobId (uint256), riskSummary (string)
 *
 * Set after schema registration via `scripts/eas-register-schema.ts`.
 * Override with EAS_SCHEMA_UID env var.
 */
export const DEFAULT_SCHEMA_UID: Hex =
  (process.env.EAS_SCHEMA_UID as Hex) ||
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const SCHEMA_STRING =
  "address agent,uint8 score,string verdict,string offering,uint256 jobId,string riskSummary";

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

const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC),
});

function getWalletClient() {
  const pk = process.env.MAIAT_PRIVATE_KEY as Hex | undefined;
  if (!pk) return null;

  const account = privateKeyToAccount(pk);
  return createWalletClient({
    account,
    chain: base,
    transport: http(BASE_RPC),
  });
}

// -- Public API ---------------------------------------------------------------

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
  return !!(
    process.env.MAIAT_PRIVATE_KEY &&
    DEFAULT_SCHEMA_UID !== "0x0000000000000000000000000000000000000000000000000000000000000000"
  );
}

/**
 * Create an on-chain EAS attestation for a trust check result.
 * Returns the attestation UID, or null if EAS is not configured.
 */
export async function createAttestation(data: AttestationData): Promise<Hex | null> {
  if (!isEasEnabled()) {
    return null;
  }

  const walletClient = getWalletClient();
  if (!walletClient) {
    console.log("[eas] No MAIAT_PRIVATE_KEY — skipping attestation");
    return null;
  }

  // Encode attestation data
  const encodedData = encodeAbiParameters(
    parseAbiParameters(
      "address agent, uint8 score, string verdict, string offering, uint256 jobId, string riskSummary"
    ),
    [data.agent, data.score, data.verdict, data.offering, BigInt(data.jobId), data.riskSummary]
  );

  const ZERO_BYTES32: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

  try {
    const txHash = await walletClient.writeContract({
      address: EAS_CONTRACT_ADDRESS,
      abi: EAS_ABI,
      functionName: "attest",
      args: [
        {
          schema: DEFAULT_SCHEMA_UID,
          data: {
            recipient: data.agent,
            expirationTime: 0n, // No expiration
            revocable: false,
            refUID: ZERO_BYTES32,
            data: encodedData,
            value: 0n,
          },
        },
      ],
    });

    // Wait for transaction receipt to get attestation UID
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    // The attestation UID is in the first log's first topic (Attested event)
    const attestedLog = receipt.logs.find(
      (log) =>
        log.address.toLowerCase() === EAS_CONTRACT_ADDRESS.toLowerCase() && log.topics.length > 0
    );

    const uid = attestedLog?.data ? (attestedLog.data.slice(0, 66) as Hex) : txHash;

    console.log(`[eas] Attestation created — UID: ${uid} tx: ${txHash}`);
    return uid;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[eas] Attestation failed: ${msg}`);
    return null;
  }
}

/**
 * Query an attestation by UID.
 */
export async function getAttestation(uid: Hex) {
  try {
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

/**
 * Register the Maiat trust schema on EAS.
 * Should only be called once — returns the schema UID.
 */
export async function registerSchema(): Promise<Hex | null> {
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
        SCHEMA_STRING,
        "0x0000000000000000000000000000000000000000" as Address, // No resolver
        false, // Not revocable
      ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    // Schema UID is in the Registered event
    const registeredLog = receipt.logs.find(
      (log) => log.address.toLowerCase() === SCHEMA_REGISTRY_ADDRESS.toLowerCase()
    );

    const schemaUID = registeredLog?.topics?.[1] as Hex | undefined;

    console.log(`[eas] Schema registered — UID: ${schemaUID} tx: ${txHash}`);
    return schemaUID ?? null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[eas] Schema registration failed: ${msg}`);
    return null;
  }
}

/**
 * Get the schema string used for attestations.
 */
export function getSchemaString(): string {
  return SCHEMA_STRING;
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
