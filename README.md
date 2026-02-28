# Scales — Maiat Protocol's ACP Agent

**Scales** is the AI agent commercial layer for [Maiat Protocol](https://maiat-protocol.vercel.app) — the trust infrastructure for agentic commerce.

When another AI agent needs to verify a DeFi protocol or AI project before transacting, it hires Scales on the [ACP marketplace](https://app.virtuals.io/acp). Scales queries the Maiat trust engine and returns a structured trust report in seconds.

```
Other Agent  →  hire Scales (ACP)  →  Maiat Protocol API  →  Trust Report
                    pay USDC                                   (score, grade, risk flags)
```

---

## Offerings

| Offering              | Price | Description                                                                 |
| --------------------- | ----- | --------------------------------------------------------------------------- |
| `trust_score_query`   | $0.01 | Trust score (0–100), grade (A–F), risk level for any project                |
| `trust_gate`          | $0.02 | Binary pass/fail gate — should your agent proceed with this counterparty?   |
| `deep_insight_report` | $0.10 | Full analysis: breakdown, audit status, TVL, volume, community reviews      |
| `onchain_report`      | $0.50 | Live on-chain data: verified source code, contract age, holder distribution |

**Agent wallet:** `0xAf1aE6F344c60c7Fe56CB53d1809f2c0B997a2b9` (Base)

---

## Architecture

```
maiat-protocol            ← trust data source
├── DB (Supabase)         ← 100+ indexed projects
├── Realtime engine       ← DeFiLlama + DEXScreener + Basescan
├── Gemini AI             ← sentiment + review quality scoring
└── REST API              ← /api/v1/project/[slug]?realtime=1

scales (maiat-acp)        ← ACP commercial layer
├── trust_score_query     ← calls /api/v1/project/:slug
├── trust_gate            ← calls /api/v1/trust-check
├── deep_insight_report   ← calls /api/v1/project/:slug?realtime=1
└── onchain_report        ← calls score + on-chain data
```

Scales earns USDC per job. Revenue flows to the Maiat Protocol treasury.

---

## Setup (local dev)

```bash
git clone https://github.com/JhiNResH/maiat-acp
cd maiat-acp
npm install
```

Create a `.env` file:

```env
LITE_AGENT_API_KEY=acp-your-key-here      # from app.virtuals.io/acp
MAIAT_API_URL=https://maiat-protocol.vercel.app
GEMINI_API_KEY=your-gemini-key
MAIAT_INTERNAL_TOKEN=your-internal-token
```

Start the seller runtime:

```bash
npm run serve
# or: npx tsx src/seller/runtime/seller.ts
```

---

## Deploy (Railway)

This repo auto-deploys to Railway on push to `main`.

Required Railway environment variables:

| Variable               | Description                            |
| ---------------------- | -------------------------------------- |
| `LITE_AGENT_API_KEY`   | Virtuals ACP API key                   |
| `MAIAT_API_URL`        | `https://maiat-protocol.vercel.app`    |
| `GEMINI_API_KEY`       | Google Gemini API key                  |
| `MAIAT_INTERNAL_TOKEN` | Internal auth token for maiat-protocol |

---

## Adding / Editing Offerings

Each offering lives in `src/seller/offerings/maiat/<name>/`:

```
trust_score_query/
├── offering.json    ← name, description, price, requirements schema
└── handlers.ts      ← validateRequirements, requestPayment, executeJob
```

After editing:

1. Update `offering.json`
2. Update `handlers.ts`
3. Push to `main` → Railway auto-deploys

---

## Relationship to Maiat Protocol

| Layer     | Repo                    | Role                                          |
| --------- | ----------------------- | --------------------------------------------- |
| Protocol  | `maiat-protocol`        | Trust data, scoring engine, Web UI, contracts |
| ACP Agent | `maiat-acp` (this repo) | Commercial window on Virtuals ACP marketplace |
| SDK       | `maiat-viem-guard`      | npm package for dApp/agent developers         |

**Scales does not have its own token.** It is a commercial brand name for the maiat-protocol ACP presence. Protocol value accrues to `$MAIAT` token holders (planned).

---

## Links

- **Maiat Protocol:** https://maiat-protocol.vercel.app
- **Scales on ACP:** https://app.virtuals.io/acp/agent-details/3723
- **Agent wallet:** `0xAf1aE6F344c60c7Fe56CB53d1809f2c0B997a2b9`
- **Twitter:** [@0xmaiat](https://twitter.com/0xmaiat)
