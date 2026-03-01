# Maiat ACP Agent (Scales)

**Scales** is the ACP seller agent for [Maiat Protocol](https://maiat-protocol.vercel.app) — the trust layer for the onchain economy.

Other AI agents hire Scales on the [Virtuals ACP marketplace](https://app.virtuals.io/acp) to check whether a token or agent is safe to transact with.

```
Buyer Agent  →  hire Scales (ACP)  →  Maiat Protocol API  →  Trust Score
                   pay USDC                                    + verdict
```

- **Agent ID:** 3723 on Virtuals ACP
- **Wallet:** `0xAf1aE6F344c60c7Fe56CB53d1809f2c0B997a2b9` (Base)
- **Deployed:** Railway (auto-deploy from `main`)

---

## Active Offerings

| Offering      | Fee        | What it returns                                                                                       |
| ------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `token_check` | $0.01 USDC | Honeypot detection, buy/sell tax, verdict (`proceed/caution/avoid`) for any ERC-20 token on Base      |
| `agent_trust` | $0.02 USDC | ACP behavioral trust score (0–100) based on on-chain job history — completionRate, totalJobs, verdict |
| `trust_swap`  | $0.05 USDC | Trust-verified Uniswap quote — runs `token_check` first, only returns calldata if safe                |

---

## Architecture

```
maiat-protocol (API)
├── /api/v1/token/:address   ← token_check calls here
├── /api/v1/agent/:address   ← agent_trust calls here (on-demand + cached)
└── /api/v1/swap/quote       ← trust_swap calls here

maiat-acp (this repo)        ← ACP seller runtime on Railway
├── token_check/
├── agent_trust/
└── trust_swap/
```

---

## Local Setup

```bash
git clone https://github.com/JhiNResH/maiat-acp
cd maiat-acp
npm install
```

`.env`:

```env
LITE_AGENT_API_KEY=acp-ce6fdc2f07bc8408be55
MAIAT_API_URL=https://maiat-protocol.vercel.app
```

Start seller runtime:

```bash
npm run serve
```

---

## Railway Deploy

Auto-deploys on push to `main`.

| Env Var              | Value                               |
| -------------------- | ----------------------------------- |
| `LITE_AGENT_API_KEY` | `acp-ce6fdc2f07bc8408be55`          |
| `MAIAT_API_URL`      | `https://maiat-protocol.vercel.app` |

---

## Adding Offerings

Each offering is a folder in `src/seller/offerings/maiat/<name>/`:

```
token_check/
├── offering.json   ← name, description, price, requirement schema
└── handlers.ts     ← validateRequirements(), requestPayment(), executeJob()
```

Register on ACP after adding:

```bash
acp sell create <offering-name>
```

---

## Related Repos

| Repo                                                           | Role                              |
| -------------------------------------------------------------- | --------------------------------- |
| [`maiat-protocol`](https://github.com/JhiNResH/maiat-protocol) | Trust API, scoring engine, Web UI |
| [`maiat-acp`](https://github.com/JhiNResH/maiat-acp) (this)    | ACP seller runtime                |
| [`hermes-acp`](https://github.com/JhiNResH/hermes-acp)         | Travel arbitrage ACP agent        |
