#!/usr/bin/env npx tsx
/**
 * Register all Maiat attestation schemas on Base EAS.
 *
 * Usage:
 *   MAIAT_PRIVATE_KEY=0x... npx tsx scripts/eas-register-schemas.ts
 *
 * Schemas registered:
 *   1. MaiatServiceAttestation — emitted when an offering completes
 *   2. MaiatReviewAttestation  — emitted when a review/vote is submitted
 *   3. MaiatTrustQuery         — emitted when trust is queried via API
 *
 * After registration, copy the schema UIDs and set them in your .env file.
 */

import dotenv from "dotenv";
dotenv.config();

import {
  registerSchema,
  getChainInfo,
  SCHEMA_REGISTRY_ADDRESS,
  SERVICE_SCHEMA_STRING,
  REVIEW_SCHEMA_STRING,
  QUERY_SCHEMA_STRING,
} from "../src/lib/eas.js";

interface SchemaDefinition {
  name: string;
  envVar: string;
  schema: string;
}

const SCHEMAS: SchemaDefinition[] = [
  {
    name: "MaiatServiceAttestation",
    envVar: "EAS_SERVICE_SCHEMA_UID",
    schema: SERVICE_SCHEMA_STRING,
  },
  {
    name: "MaiatReviewAttestation",
    envVar: "EAS_REVIEW_SCHEMA_UID",
    schema: REVIEW_SCHEMA_STRING,
  },
  {
    name: "MaiatTrustQuery",
    envVar: "EAS_QUERY_SCHEMA_UID",
    schema: QUERY_SCHEMA_STRING,
  },
];

async function main() {
  const chainInfo = getChainInfo();

  console.log("\n  EAS Schema Registration — Maiat Attestations");
  console.log("  " + "=".repeat(55));
  console.log(`  Schema Registry: ${SCHEMA_REGISTRY_ADDRESS}`);
  console.log(`  Chain:           Base ${chainInfo.chain} (${chainInfo.chainId})`);
  console.log(`  RPC:             ${chainInfo.rpc}\n`);

  if (!process.env.MAIAT_PRIVATE_KEY) {
    console.error("  ❌ MAIAT_PRIVATE_KEY environment variable is required");
    console.error("     Usage: MAIAT_PRIVATE_KEY=0x... npx tsx scripts/eas-register-schemas.ts\n");
    process.exit(1);
  }

  const results: Array<{ name: string; envVar: string; uid: string | null }> = [];

  for (const schema of SCHEMAS) {
    console.log(`  📝 Registering ${schema.name}...`);
    console.log(`     Schema: ${schema.schema}`);

    try {
      const uid = await registerSchema(schema.schema);
      results.push({ name: schema.name, envVar: schema.envVar, uid });

      if (uid) {
        console.log(`     ✅ UID: ${uid}\n`);
      } else {
        console.log(`     ❌ Registration failed\n`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`     ❌ Error: ${msg}\n`);
      results.push({ name: schema.name, envVar: schema.envVar, uid: null });
    }
  }

  // Summary
  console.log("\n  " + "=".repeat(55));
  console.log("  Registration Summary\n");

  const successful = results.filter((r) => r.uid !== null);
  const failed = results.filter((r) => r.uid === null);

  if (successful.length > 0) {
    console.log("  Add to your .env file:\n");
    for (const r of successful) {
      console.log(`    ${r.envVar}=${r.uid}`);
    }
    console.log();
  }

  if (failed.length > 0) {
    console.log(`  ⚠️  ${failed.length} schema(s) failed to register:`);
    for (const r of failed) {
      console.log(`     - ${r.name}`);
    }
    console.log();
  }

  console.log(`  ✅ ${successful.length}/${results.length} schemas registered successfully\n`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
