<p align="center">
  <img src="https://raw.githubusercontent.com/JhiNResH/maiat-protocol/master/public/maiat-logo.jpg" width="120" alt="Maiat" />
</p>

<h1 align="center">Maiat Agent (Virtuals ACP)</h1>

<p align="center">
  <strong>The Maiat Agent runtime for the Virtuals Agent Commerce Protocol (ACP).</strong>
</p>

---

## Overview

This repository contains the Virtuals ACP seller runtime for the **Maiat Agent**. Maiat provides actionable trust intelligence for AI agents, scoring their on-chain behavior and evaluating their performance to provide trust metrics.

When Maiat delivers an evaluation job, it does two things simultaneously on the Base network:

1. **Creates a "Maiat Receipt"** (an Ethereum Attestation Service - EAS attestation).
2. **Updates the `MaiatOracle`** smart contract on-chain.

## Offerings

The agent exposes the following offerings on the Virtuals ACP:

| Offering           | Fee           | Description                                                                              |
| ------------------ | ------------- | ---------------------------------------------------------------------------------------- |
| `token_check`      | $0.01         | Honeypot detection, tax analysis, and smart contract risk flags for standard ERC20.      |
| `agent_trust`      | $0.02         | Simple behavioral trust score derived from a target agent's on-chain job history.        |
| `agent_deep_check` | $0.10         | Comprehensive percentile rank, risk flags, tier, and recommendation for an agent.        |
| `trust_swap`       | $0.05 + 0.15% | Trust-gated Uniswap swap execution (calldata is withheld if the target token is unsafe). |

---

## Smart Contracts & Integrations (Base Mainnet)

We developed smart contracts using **Foundry** to secure the output of the agent and make it composable for other DeFi protocols.

| Component                | Address / Identifier                         | Description                                                                                                                                                                   |
| ------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MaiatOracle**          | `0xc6cf2d59ff2e4ee64bbfceaad8dcb9aa3f13c6da` | On-chain trust score Oracle. Only the Maiat wallet can update scores via `updateScore()`. Any smart contract or user can dynamically read trust scores via `getTrustScore()`. |
| **MaiatReceiptResolver** | `0xda696009655825124bcbfdd5755c0657d6d841c0` | An EAS Schema Resolver contract. It enforces that only the Maiat Attester wallet can create attestations against our schema, guaranteeing authenticity.                       |
| **EAS Schema UID**       | `0xff334be5...8358d2`                        | The registered schema structure for Maiat Receipts on Base Mainnet.                                                                                                           |
| **EAS Contract**         | `0x4200000000000000000000000000000000000021` | The core Ethereum Attestation Service contract on Base.                                                                                                                       |

The contracts and tests are located in `contracts/` and `test/` respectively.

---

## Getting Started

### Install Dependencies

```bash
npm install
```

### Configure Environment Weights

Copy the `.env.example` file to `.env` and fill out the necessary variables (like `MAIAT_PRIVATE_KEY` for EAS/Oracle integration, `VIRTUALS_API_KEY`, etc.).

### Start the Runtime

```bash
npx acp serve start
```

You can view logs for the runtime by running:

```bash
npx acp serve logs
```

## Running Smart Contract Tests

This project includes 58 Foundry tests (Unit + Fuzz) for the `MaiatOracle` and `MaiatReceiptResolver` contracts.

```bash
forge test
```
