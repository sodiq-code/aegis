<div align="center">

# Aegis

**A verifiable, confidential, AI-managed cross-chain treasury protocol for XRP-native institutions on Flare.**

[![Flare](https://img.shields.io/badge/Flare-Coston2-ff4d2e?style=flat-square&logo=flare)](https://flare.network)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](./LICENSE)
[![Foundry Tests](https://img.shields.io/badge/Foundry-143%20passing-success?style=flat-square)](./contracts)
[![Live Dashboard](https://img.shields.io/badge/Dashboard-Live-brightgreen?style=flat-square)](https://aegis-mantle-deploy-s-projects.vercel.app)

</div>

---

> Institutional XRP treasuries are forming now — and they need a way to hold, hedge, and prove solvency without exposing positions. Aegis is the only product that makes this possible, by running an AI risk agent inside a Flare TEE and publishing a verifiable solvency proof — so an auditor can confirm a treasury is solvent **without ever seeing a single position**.

---

## Key features

- **All five Flare primitives are load-bearing.** FAssets, FTSO, FDC, FCC, and PMW are each structurally required — remove any one and the product cannot exist. Aegis uses all five together in non-trivial ways.
- **Built for institutional treasury management.** Targets corporate XRP treasuries and large FLR holders — a segment publicly validated by Flare's VivoPower and BitGo partnerships, with no dedicated product surface on Flare today.
- **Verifiable-confidential pattern.** Positions are computed inside a TEE and published as a Merkle root, so an auditor can verify solvency cryptographically **without ever seeing an individual position**.

---

## How Flare is used

> This table makes the *“remove Flare and the product cannot exist”* argument visible at a glance.

| Flare primitive | Load-bearing role in Aegis | What breaks if removed |
|---|---|---|
| **FAssets (FXRP)** | Core asset deposited into vaults; 1:1 pegged to XRP via the FAssets protocol. | No asset to manage. |
| **FTSO V2** | Price feeds for risk scoring and policy thresholds (XRP/USD ~$1.07 on Coston2). | Risk agent cannot detect drawdowns. |
| **FDC** | Attests external-chain state (XRPL payments via `XRPPayment`, address validity) for position computation. | TEE cannot rebuild cross-chain state verifiably. |
| **FCC** | TEE-based position computation and AI risk inference; publishes solvency roots. | No confidentiality; no verifiable solvency. |
| **PMW** | Cross-chain execution (XRPL settlement via the `FlareTeeManager` diamond, Base OFT, Hyperliquid hedging). | No autonomous cross-chain rebalancing. |
| **Smart Accounts** | Onboards XRP holders from XRPL wallets with a single signature. | Onboarding friction returns. |

---

## Architecture

Aegis is a five-layer system. Each layer depends on a specific Flare primitive and exposes a clean interface to the layer above.

```
+---------------------------------------------------------------------+
|  LAYER 5 — VERIFICATION & AUDIT                                     |
|  FDC attestation · Solvency proof oracle · Auditor dashboard        |
+---------------------------------------------------------------------+
|                              attests                                 |
+---------------------------------------------------------------------+
|  LAYER 4 — CROSS-CHAIN EXECUTION (PMW)                              |
|  XRPL wallet ops · Base OFT transfers · Hyperliquid hedging          |
+---------------------------------------------------------------------+
|                              executes                                |
+---------------------------------------------------------------------+
|  LAYER 3 — CONFIDENTIAL COMPUTE (FCC)                               |
|  PositionComputer · AI risk agent · Policy enforcement               |
|  (all inside TEEs, attested via FCC)                                |
+---------------------------------------------------------------------+
|                           reads / writes                            |
+---------------------------------------------------------------------+
|  LAYER 2 — ON-CHAIN VAULT CONTRACTS (Flare C-Chain)                 |
|  VaultCore · PolicyRegistry · SolvencyRoot · InstructionSender      |
|  VerifierRole · FDCAttestor · PMWInstructionRelay                   |
+---------------------------------------------------------------------+
|                               holds                                 |
+---------------------------------------------------------------------+
|  LAYER 1 — ASSET ONBOARDING                                         |
|  Flare Smart Accounts · FAssets (FXRP) · Liquid staking (sFLR)      |
+---------------------------------------------------------------------+
```

The core verifiability invariant: **given the on-chain data (SolvencyRoot proof, FDC attestations, vault events), any auditor can reconstruct and verify the vault's solvency without trusting any party.** The TEE provides confidentiality; FCC attestation proves the correct code ran; FDC anchors external state; the on-chain contracts make everything publicly verifiable. Positions are confidential, solvency is verifiable.

Full architecture, data-flow and sequence diagrams: [`docs/architecture.md`](./docs/architecture.md).

---

## Deployed contracts (Coston2)

All seven Aegis contracts are deployed and verifiable on the Coston2 testnet. Every address below is clickable on the explorer.

### Aegis contracts

| Contract | Address | Explorer |
|---|---|---|
| VaultCore | `0xcb08be1cc86d3f94c54c64682372e32f669134bc` | [view ↗](https://coston2-explorer.flare.network/address/0xcb08be1cc86d3f94c54c64682372e32f669134bc) |
| VerifierRole | `0xb513516d02d88be754c5204e132defbb0f4156e6` | [view ↗](https://coston2-explorer.flare.network/address/0xb513516d02d88be754c5204e132defbb0f4156e6) |
| PolicyRegistry | `0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5` | [view ↗](https://coston2-explorer.flare.network/address/0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5) |
| SolvencyRoot | `0xf52c1fd632d853ee46a48a82064d3f5d390f057d` | [view ↗](https://coston2-explorer.flare.network/address/0xf52c1fd632d853ee46a48a82064d3f5d390f057d) |
| InstructionSender | `0xb175f16e1cea66360e354db4b178c04c69363c06` | [view ↗](https://coston2-explorer.flare.network/address/0xb175f16e1cea66360e354db4b178c04c69363c06) |
| FDCAttestor | `0x266a9537eaa76264c926541a77c2705f659ba4f1` | [view ↗](https://coston2-explorer.flare.network/address/0x266a9537eaa76264c926541a77c2705f659ba4f1) |
| PMWInstructionRelay | `0xce23e1a26c41eaa305f69d9150d9ac82d8b30743` | [view ↗](https://coston2-explorer.flare.network/address/0xce23e1a26c41eaa305f69d9150d9ac82d8b30743) |

### Flare system contracts consumed

| Contract | Address | Purpose |
|---|---|---|
| FtsoV2 | `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d` | XRP/USD price feeds |
| FdcHub | `0x48aC463d7975828989331F4De43341627b9c5f1D` | FDC v1 attestation requests |
| FdcVerification | `0x906507E0B64bcD494Db73bd0459d1C667e14B933` | FDC v1 proof verification |
| FdcRequestFeeConfigs | `0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e` | FDC request fee calculation |
| FlareSystemsManager | `0xA90Db6D10F856799b10ef2A77EBCbF460aC71e52` | Voting epoch management |
| FlareTeeManager | `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE` | PMW diamond (18 facets) |

---

## Live vault state (verifiable on-chain)

The vault is live on Coston2 in the state below — any value can be re-checked with the `cast` commands in [How to verify](#how-to-verify).

| Metric | Value |
|---|---|
| Network | Flare Coston2 (chain ID `114`) |
| XRP/USD price (FTSO V2) | ~$1.07, refreshed every ~90s |
| Collateral ratio | 140% (14,000 bps) |
| Minimum threshold | 150% (15,000 bps) |
| Solvency status | **WARNING** — `isSolvent()` returns `(false, 14000)` |
| Policy count | 3 — Conservative · Balanced · Aggressive |
| Instruction count | 13 |
| Current voting round | ~1,415,258 |

The WARNING state is intentional for the demo: it exercises the audit-verification flow in which an auditor verifies the on-chain WARNING condition **without seeing any individual positions**.

---

## Quickstart

Deploy the full stack on Coston2 in under 10 minutes.

### Prerequisites

- [Foundry](https://book.getfoundry.sh/) (`forge`, `cast`)
- [Go 1.22+](https://go.dev/dl/)
- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- [Node.js 18+](https://nodejs.org/)
- Coston2 CFLR for gas — [faucet](https://coston2-faucet.towolabs.com/)

### Deploy & run

```bash
# Clone
git clone https://github.com/sodiq-code/aegis.git
cd aegis

# 1. Deploy contracts to Coston2
cd contracts
forge build
cp .env.example .env        # edit with your private key
forge script script/DeployVaultContracts.s.sol   --rpc-url coston2 --broadcast
forge script script/DeployFDCAttestor.s.sol       --rpc-url coston2 --broadcast
forge script script/DeployPMWInstructionRelay.s.sol --rpc-url coston2 --broadcast

# 2. Start the FCC extension (TEE + proxy + redis)
cd ../extension
cp ../.env.example .env     # edit with deployed contract addresses
docker compose -f ../docker-compose.coston2.yaml up --build

# 3. Start the institutional dashboard
cd ../frontend
npm install && npm run dev
```

The dashboard is also hosted live at **https://aegis-mantle-deploy-s-projects.vercel.app**.

---

## TypeScript SDK

Typed access to every Aegis contract. Install with `npm install @aegis/sdk`.

```typescript
import { AegisSDK } from '@aegis/sdk';

const sdk = new AegisSDK();              // defaults to Coston2

// Vault + FTSO
const price      = await sdk.vault.getXrpUsdPrice();        // ~1.07e18
const deposited  = await sdk.vault.getTotalDeposited();     // FXRP total
const positions  = await sdk.vault.getActivePositionCount();

// Solvency / audit (verifiable without seeing positions)
const { isSolvent, collateralRatio } = await sdk.audit.isSolvent();
// Currently: isSolvent=false, collateralRatio=14000 (140%) — WARNING

// Policy
const policies = await sdk.policy.listPolicies();          // 3 policies
const ok       = await sdk.policy.checkAction(1, 2, 100);  // deposit check

// Proof verification
const proof  = await sdk.audit.getCurrentProof();
const result = await sdk.audit.verifyProof(proof.merkleRoot);
```

---

## How to verify

Anyone can re-verify the entire deployment on Coston2 using only [`cast`](https://book.getfoundry.sh/):

```bash
export RPC=https://coston2-api.flare.network/ext/C/rpc

# 1. Confirm VaultCore is deployed (code size > 0)
cast codesize 0xcb08be1cc86d3f94c54c64682372e32f669134bc --rpc-url $RPC   # 5103

# 2. Read solvency state — isSolvent() returns (bool, uint256)
cast call 0xf52c1fd632d853ee46a48a82064d3f5d390f057d "isSolvent()" --rpc-url $RPC
#   → (false, 14000)  ← WARNING state (140% < 150% threshold)

# 3. Policy + instruction counts
cast call 0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5 "getPolicyCount()"      --rpc-url $RPC   # 3
cast call 0xb175f16e1cea66360e354db4b178c04c69363c06 "getInstructionCount()" --rpc-url $RPC   # 13

# 4. FDC voting round
cast call 0x266a9537eaa76264c926541a77c2705f659ba4f1 "getCurrentVotingRound()" --rpc-url $RPC

# 5. Verify every contract has non-zero code
for addr in 0xcb08be1cc86d3f94c54c64682372e32f669134bc 0xb513516d02d88be754c5204e132defbb0f4156e6 \
            0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5 0xf52c1fd632d853ee46a48a82064d3f5d390f057d \
            0xb175f16e1cea66360e354db4b178c04c69363c06 0x266a9537eaa76264c926541a77c2705f659ba4f1 \
            0xce23e1a26c41eaa305f69d9150d9ac82d8b30743; do
  echo "$addr: $(cast codesize $addr --rpc-url $RPC) bytes"
done

# 6. Full automated verification (build + RPC + contracts + APIs)
bash scripts/verify-aegis.sh

# 7. Run the test suites
cd contracts  && forge test --summary          # 143 tests, 0 failures
cd extension  && go test ./...                  # 13 packages
cd frontend   && npx tsc --noEmit && npm run build
```

---

## Implementation

Aegis is an original implementation built from scratch. Every core component was built for this project:

| Component | Description |
|---|---|
| **Vault contracts** (Solidity 0.8.27) | `VaultCore`, `PolicyRegistry`, `SolvencyRoot`, `InstructionSender`, `VerifierRole`, `FDCAttestor`, `PMWInstructionRelay` + interfaces — 143 Foundry tests incl. fuzz & invariant tests. |
| **FCC extension** (Go, in TEE) | `PositionComputer`, `RiskAgent` (XGBoost, 200 trees), `Policy` engine, `SolvencyAttestor`, `ActionExecutor`, FDC + PMW clients — 13 tested packages. |
| **TypeScript SDK** | `vault-client`, `policy-client`, `audit-client`, provider + config — compiles clean. |
| **Institutional dashboard** (Next.js 16) | Treasury / Policy / Audit views, 10 API routes reading live Coston2 state, deployed to Vercel. |
| **Deployment** | Full Coston2 deployment of all 7 contracts + integration with Flare system contracts (FtsoV2, FdcHub, FdcVerification, FlareTeeManager). |
| **Docs** | `architecture.md`, `deployment.md`, `security.md`, `api.md` + this README. |

---

## Repository structure

```
aegis/
├── README.md                       # This file
├── LICENSE                         # MIT
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── docs/
│   ├── architecture.md             # Five-layer architecture, data flow, sequence diagrams
│   ├── deployment.md               # Coston2 / Songbird / Mainnet deployment guide
│   ├── security.md                 # Threat model, mitigations, audit status
│   └── api.md                      # Contract + extension + SDK API reference
├── contracts/                      # Foundry project (Solidity 0.8.27)
│   ├── foundry.toml
│   ├── src/                        # 7 vault contracts + interfaces (vault, fassets, pmw, fdc)
│   ├── test/                       # 143 tests incl. fuzz, invariant, fork
│   └── script/                     # Deploy scripts (Vault, FDCAttestor, PMWInstructionRelay, …)
├── extension/                      # FCC extension (Go, runs inside TEE)
│   ├── cmd/
│   └── internal/                   # position · risk · policy · attestation · attester · executor · fdc · pmw
├── sdk/                            # TypeScript SDK
│   ├── src/                        # vault-client · policy-client · audit-client · provider · config
│   └── examples/                   # deposit-flow.ts · audit-verify.ts
├── frontend/                       # Next.js 16 institutional dashboard (Treasury / Policy / Audit)
├── scripts/                        # fdc_validate.py · vault_validate.py · position_validate.py · verify-aegis.sh
├── config/                         # Coston2 deployed addresses + proxy Dockerfile
├── testdata/                       # FCC extension conformance fixtures
├── docker-compose.yaml · docker-compose.coston2.yaml · docker-compose.coston.yaml · docker-compose.siblings.yaml
└── .github/workflows/ci.yml        # Foundry + Go + TypeScript CI
```

---

## Test results

| Component | Result |
|---|---|
| Foundry (Solidity) | **143 tests pass**, 0 failures (incl. fuzz, invariant, and Coston2 fork tests) |
| Go extension | **13 packages pass** (`go test ./...`) |
| TypeScript SDK | Compiles clean (`tsc --noEmit`) |
| Frontend | Next.js 16.3 build, 10 API routes, TypeScript + ESLint clean |
| CI | GitHub Actions on every push and PR |

---

## Roadmap

| Phase | Milestone | Status |
|---|---|---|
| **Coston2 deployment** | Contracts live, demo path proven end-to-end | ✅ Done |
| **External audit** | Trail of Bits (or equivalent) security audit | Next |
| **Songbird deployment** | Canary-network deployment after governance approval | Planned |
| **Mainnet launch** | Mainnet deployment with first institutional customer | Planned |
| **Scale** | Multi-vault, additional asset support (FDOGE, FBTC), institutional SaaS tier | Planned |

---

## License

[MIT](./LICENSE) — permissive to maximise adoption.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines. All contributions are welcome via pull request with passing CI.
