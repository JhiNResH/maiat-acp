import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import * as dotenv from "dotenv";
dotenv.config();

// ── Config ──────────────────────────────────────────────────────────────────
const raw = process.env.MAIAT_PRIVATE_KEY ?? "";
const OLD_PRIVATE_KEY = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
const NEW_WALLET = "0xB1e504aE1ce359B4C2a6DC5d63aE6199a415f312" as const;

const ORACLE_ADDRESS = "0xdd046b037084e0aa23cfd2182318db28ca4b83a0" as const;
const RESOLVER_ADDRESS = "0x601063661174bc7cfab4b2622ccc3ed41db0dd09" as const;

const ORACLE_ABI = parseAbi([
  "function setOperator(address _newOperator) external",
  "function transferOwnership(address _newOwner) external",
  "function operator() view returns (address)",
  "function owner() view returns (address)",
]);

const RESOLVER_ABI = parseAbi([
  "function setAttester(address _newAttester) external",
  "function transferOwnership(address _newOwner) external",
  "function maiatAttester() view returns (address)",
  "function owner() view returns (address)",
]);

async function main() {
  if (!OLD_PRIVATE_KEY) {
    console.error("❌ MAIAT_PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  const account = privateKeyToAccount(OLD_PRIVATE_KEY);
  console.log(`\n🔑 Using owner wallet: ${account.address}`);
  console.log(`🎯 New wallet: ${NEW_WALLET}\n`);

  const publicClient = createPublicClient({ chain: base, transport: http() });
  const walletClient = createWalletClient({ account, chain: base, transport: http() });

  // Check current state
  const [currentOperator, oracleOwner, currentAttester, resolverOwner] = await Promise.all([
    publicClient.readContract({
      address: ORACLE_ADDRESS,
      abi: ORACLE_ABI,
      functionName: "operator",
    }),
    publicClient.readContract({ address: ORACLE_ADDRESS, abi: ORACLE_ABI, functionName: "owner" }),
    publicClient.readContract({
      address: RESOLVER_ADDRESS,
      abi: RESOLVER_ABI,
      functionName: "maiatAttester",
    }),
    publicClient.readContract({
      address: RESOLVER_ADDRESS,
      abi: RESOLVER_ABI,
      functionName: "owner",
    }),
  ]);

  console.log("📋 Current State:");
  console.log(`  MaiatOracle owner:    ${oracleOwner}`);
  console.log(`  MaiatOracle operator: ${currentOperator}`);
  console.log(`  Resolver owner:       ${resolverOwner}`);
  console.log(`  Resolver attester:    ${currentAttester}\n`);

  // Step 1: Update operator on MaiatOracle
  console.log("⚡ Step 1: Setting new operator on MaiatOracle...");
  const tx1 = await walletClient.writeContract({
    address: ORACLE_ADDRESS,
    abi: ORACLE_ABI,
    functionName: "setOperator",
    args: [NEW_WALLET],
  });
  console.log(`  ✅ tx: ${tx1}`);
  await publicClient.waitForTransactionReceipt({ hash: tx1 });

  // Step 2: Update attester on MaiatReceiptResolver
  console.log("⚡ Step 2: Setting new attester on MaiatReceiptResolver...");
  const tx2 = await walletClient.writeContract({
    address: RESOLVER_ADDRESS,
    abi: RESOLVER_ABI,
    functionName: "setAttester",
    args: [NEW_WALLET],
  });
  console.log(`  ✅ tx: ${tx2}`);
  await publicClient.waitForTransactionReceipt({ hash: tx2 });

  // Step 3: Transfer Oracle ownership
  console.log("⚡ Step 3: Transferring MaiatOracle ownership...");
  const tx3 = await walletClient.writeContract({
    address: ORACLE_ADDRESS,
    abi: ORACLE_ABI,
    functionName: "transferOwnership",
    args: [NEW_WALLET],
  });
  console.log(`  ✅ tx: ${tx3}`);
  await publicClient.waitForTransactionReceipt({ hash: tx3 });

  // Step 4: Transfer Resolver ownership
  console.log("⚡ Step 4: Transferring MaiatReceiptResolver ownership...");
  const tx4 = await walletClient.writeContract({
    address: RESOLVER_ADDRESS,
    abi: RESOLVER_ABI,
    functionName: "transferOwnership",
    args: [NEW_WALLET],
  });
  console.log(`  ✅ tx: ${tx4}`);
  await publicClient.waitForTransactionReceipt({ hash: tx4 });

  console.log("\n🎉 Migration complete!");
  console.log(`  New operator/attester/owner: ${NEW_WALLET}`);
  console.log("  You can now safely delete the old private key from .env");
}

main().catch(console.error);
