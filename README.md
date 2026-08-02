# Aegis — A Verifiable, Confidential, AI-Managed Cross-Chain Treasury and Autonomous Risk Layer for XRP-Native Institutions on Flare

> **Thesis:** Institutional XRP treasuries need three things no Flare product offers today — confidentiality, verifiable solvency, and autonomous cross-chain risk management. Aegis delivers all three using Flare's newest primitives — FCC, PMW, and FDC — together.

## Why This Wins

- **Uses all five Flare primitives in a load-bearing way** — FAssets, FTSO, FDC, FCC, and PMW are each structurally required; remove any one and the product cannot exist.
- **Institutional ICP** — Targets corporate XRP treasuries (VivoPower committed USD 100M), a real and growing category no current Flare product serves.
- **Verifiable-confidential pattern** — The confidentiality-to-verifiability transformation is the emotional core of the Flare 2.0 thesis; Aegis is the reference implementation.

## Architecture

Aegis is structured as a five-layer system:

```
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 5 — VERIFICATION & AUDIT                                     │
│  FDC attestation │ Solvency proof oracle │ Auditor dashboard         │
├─────────────────────────────────────────────────────────────────────┤
│  attests                                                            │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 4 — CROSS-CHAIN EXECUTION (PMW)                              │
│  XRPL wallet ops │ Base OFT transfers │ Hyperliquid hedging          │
├─────────────────────────────────────────────────────────────────────┤
│  executes                                                           │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 3 — CONFIDENTIAL COMPUTE (FCC)                               │
│  PositionComputer │ AI risk agent │ Policy enforcement               │
│  (all inside TEEs, attested via FCC)                                │
├─────────────────────────────────────────────────────────────────────┤
│  reads/writes                                                       │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 2 — ON-CHAIN VAULT CONTRACTS (Flare C-Chain)                 │
│  VaultCore │ PolicyRegistry │ SolvencyRoot │ InstructionSender       │
├─────────────────────────────────────────────────────────────────────┤
│  holds                                                              │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 1 — ASSET ONBOARDING                                         │
│  Flare Smart Accounts │ FAssets (FXRP) │ Liquid staking (sFLR)       │
└─────────────────────────────────────────────────────────────────────┘
```

## How Flare Is Used

| Flare Primitive | Load-Bearing Role in Aegis | What Breaks If Removed |
|---|---|---|
| **FAssets (FXRP)** | Core asset deposited into vaults | No asset to manage |
| **FTSO** | Price feeds for risk scoring and policy thresholds | Risk agent cannot detect drawdowns |
| **FDC** | Attests external chain state (XRPL payments, address validity) for position computation | TEE cannot rebuild cross-chain state verifiably |
| **FCC** | TEE-based position computation and AI risk inference; publishes solvency roots | No confidentiality; no verifiable solvency |
| **PMW** | Cross-chain execution (XRPL settlement, Base OFT, Hyperliquid hedging) | No autonomous cross-chain rebalancing |
| **Smart Accounts** | Onboards XRP holders from XRPL wallets with a single signature | Onboarding friction returns |

## Quickstart

### Prerequisites

- [Foundry](https://book.getfoundry.sh/) (forge, cast)
- [Go 1.22+](https://go.dev/dl/)
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Node.js 18+](https://nodejs.org/) (for frontend & SDK)

### Deploy on Coston2

```bash
# Clone the repo
git clone https://github.com/sodiq-code/aegis.git
cd aegis

# 1. Deploy contracts to Coston2
cd contracts
forge build
cp .env.example .env  # Edit with your private key
forge script script/DeployCoston2.s.sol --rpc-url coston2 --broadcast

# 2. Start the FCC extension (TEE + proxy + redis)
cd ../extension
cp ../.env.example .env  # Edit with deployed contract addresses
docker compose -f ../docker-compose.coston2.yaml up --build

# 3. Start the frontend dashboard
cd ../frontend
npm install
npm run dev
```

## Repository Structure

```
aegis/
├── README.md                    # This file
├── LICENSE                      # MIT
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── docs/
│   ├── architecture.md          # Five-layer architecture, diagrams
│   ├── deployment.md            # Coston2 / Songbird / Mainnet deployment
│   ├── security.md              # Threat model, mitigations, audit status
│   ├── api.md                   # Contract + extension API reference
│   └── demo-script.md           # The five-minute demo script
├── contracts/                   # Foundry project
│   ├── foundry.toml
│   ├── src/
│   │   ├── VaultCore.sol
│   │   ├── PolicyRegistry.sol
│   │   ├── SolvencyRoot.sol
│   │   ├── InstructionSender.sol
│   │   └── VerifierRole.sol
│   ├── interfaces/
│   ├── test/
│   └── script/
│       ├── Deploy.s.sol
│       └── DeployCoston2.s.sol
├── extension/                   # FCC extension (Go, in TEE)
│   ├── go.mod
│   ├── cmd/server/main.go
│   ├── internal/
│   │   ├── position/            # PositionComputer
│   │   ├── risk/                # RiskAgent (XGBoost)
│   │   ├── policy/              # Policy Engine
│   │   ├── attestation/         # SolvencyAttestor
│   │   └── executor/            # ActionExecutor (PMW)
│   ├── Dockerfile
│   └── deployment/              # FCC deployment configs
├── sdk/                         # TypeScript SDK
│   ├── src/
│   │   ├── vault-client.ts
│   │   ├── policy-client.ts
│   │   └── audit-client.ts
│   ├── test/
│   └── package.json
├── frontend/                    # Next.js dashboard
│   ├── app/
│   │   ├── treasury/
│   │   ├── policy/
│   │   └── audit/
│   └── components/
├── examples/
│   ├── deposit-flow.ts
│   └── audit-verify.ts
├── config/                      # Network configs
│   ├── coston2/
│   └── proxy/
├── .github/workflows/
│   └── ci.yml
└── docker-compose.coston2.yaml
```

## Roadmap

| Phase | Timeline | Milestone |
|---|---|---|
| Hackathon MVP | Weeks 1–6 | Coston2 deployment, demo, DoraHacks submission |
| Post-hackathon | Month 1–2 | External audit, Songbird deployment, institutional pilot |
| Mainnet launch | Month 3 | Mainnet deployment, first institutional customer |
| Scale | Month 4–6 | Multi-vault, additional asset support, SaaS tier |

## License

MIT

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

*Built for the [Flare Summer Signal Hackathon](https://dorahacks.io/hackathon/flaresummersignal/detail) on DoraHacks.*
