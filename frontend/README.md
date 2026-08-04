# Aegis Dashboard — Frontend

> The institutional treasury layer for XRP-native DeFi on Flare.

## Tech Stack

- **Framework**: Next.js 16.3 (App Router, Turbopack)
- **React**: 19
- **Styling**: Tailwind CSS 4, shadcn/ui, Framer Motion
- **State**: Zustand 5
- **Charts**: Recharts 2
- **Network**: Flare Coston2 testnet (chain ID 114)

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## API Routes

All routes connect to real Flare Coston2 RPC data.

| Route | Method | Description |
|-------|--------|-------------|
| `/api/vault-state` | GET | VaultCore state (deposits, valuation, positions, FTSO price) |
| `/api/solvency` | GET | Current solvency proof from SolvencyRoot + FCC proxy |
| `/api/solvency-proofs` | GET | Proof history via SolvencyProofPublished events |
| `/api/vault-events` | GET | Recent on-chain events (deposits, revaluations, proofs) |
| `/api/verify-proof` | POST | On-chain proof verification (Merkle, FDC attestation) |
| `/api/fdc-attestation-status` | GET | FDC voting round, Merkle root, contract deployment status |
| `/api/fcc-extension` | GET/POST | FCC extension proxy (TEE attestation/position/risk) |
| `/api/policy-state` | GET | Read all policies from PolicyRegistry |
| `/api/policy-update` | POST | Update policy parameters on-chain |
| `/api/flare-rpc` | POST | Generic Flare RPC proxy (CORS bypass) |

## Views

| View | Role | Features |
|------|------|----------|
| **Treasury** | Depositor | Vault balances, deposit flow, risk score, solvency chart, FDC panel |
| **Policy** | Depositor | Risk parameter configuration, policy thresholds |
| **Audit** | Auditor | Solvency proofs, verification tooling, proof history |

## Quality Checks

```bash
# TypeScript
npx tsc --noEmit

# ESLint
npx eslint src/

# Production build
npx next build
```

All checks should pass with 0 errors.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_FCC_PROXY_URL` | No | `http://localhost:8080` | FCC extension proxy URL |

## Deployed

Production: [https://aegis-mantle-deploy-s-projects.vercel.app](https://aegis-mantle-deploy-s-projects.vercel.app)
