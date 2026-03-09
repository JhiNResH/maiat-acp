import { createServiceAttestation, type Address } from "../src/lib/eas.js";

async function main() {
  console.log("Testing EAS attestation on Base Sepolia...\n");

  const result = await createServiceAttestation({
    agent: "0x1234567890abcdef1234567890abcdef12345678" as Address,
    service: "agent_trust",
    result: "success",
    trustScoreAtTime: 85,
    jobId: 1,
  });

  if (result) {
    console.log(`\n✅ Attestation created! UID: ${result}`);
    console.log(`View: https://base-sepolia.easscan.org/attestation/view/${result}`);
  } else {
    console.log("\n❌ Attestation failed or EAS not configured");
  }
}

main().catch(console.error);
