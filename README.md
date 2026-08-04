# Aegis -- A Verifiable, Confidential, AI-Managed Cross-Chain Treasury and Autonomous Risk Layer for XRP-Native Institutions on Flare

> **Thesis:** Institutional XRP treasuries need three things no Flare product offers today -- confidentiality, verifiable solvency, and autonomous cross-chain risk management. Aegis delivers all three using Flare's newest primitives -- FCC, PMW, and FDC -- together.

## Why This Wins

- **Uses all five Flare primitives in a load-bearing way** -- FAssets, FTSO, FDC, FCC, and PMW are each structurally required; remove any one and the product cannot exist.
- **Institutional ICP** -- Targets corporate XRP treasuries (VivoPower committed USD 100M), a real and growing category no current Flare product serves.
- **Verifiable-confidential pattern** -- The confidentiality-to-verifiability transformation is the emotional core of the Flare 2.0 thesis; Aegis is the reference implementation.

## Architecture

Aegis is structured as a five-layer system:

```
+---------------------------------------------------------------------+
|  LAYER 5 -- VERIFICATION & AUDIT                                     |
|  FDC attestation | Solvency proof oracle | Auditor dashboard         |
+---------------------------------------------------------------------+
|  attests                                                            |
+---------------------------------------------------------------------+
|  LAYER 4 -- CROSS-CHAIN EXECUTION (PMW)                              |
|  XRPL wallet ops | Base OFT transfers | Hyperliquid hedging          |
+---------------------------------------------------------------------+
|  executes                                                           |
+---------------------------------------------------------------------+
|  LAYER 3 -- CONFIDENTIAL COMPUTE (FCC)                               |
|  PositionComputer | AI risk agent | Policy enforcement               |
|  (all inside TEEs, attested via FCC)                                |
+---------------------------------------------------------------------+
|  reads/writes                                                       |
+---------------------------------------------------------------------+
|  LAYER 2 -- ON-CHAIN VAULT CONTRACTS (Flare C-Chain)                 |
|  VaultCore | PolicyRegistry | SolvencyRoot | InstructionSender       |
|  VerifierRole | FDCAttestor | PMWInstructionRelay                   |
+---------------------------------------------------------------------+
|  holds                                                              |
+---------------------------------------------------------------------+
|  LAYER 1 -- ASSET ONBOARDING                                         |
|  Flare Smart Accounts | FAssets (FXRP) | Liquid staking (sFLR)       |
+---------------------------------------------------------------------+
```

## How Flare Is Used

| Flare Primitive | Load-Bearing Role in Aegis | What Breaks If Removed |
|---|---|---|
| **FAssets (FXRP)** | Core asset deposited into vaults; 1:1 pegged to XRP via FAssets protocol | No asset to manage |
| **FTSO V2** | Price feeds for risk scoring and policy thresholds; XRP/USD ~$1.07 on Coston2 | Risk agent cannot detect drawdowns |
| **FDC** | Attests external chain state (XRPL payments via XRPPayment type, address validity) for position computation | TEE cannot rebuild cross-chain state verifiably |
| **FCC** | TEE-based position computation and AI risk inference; publishes solvency roots | No confidentiality; no verifiable solvency |
| **PMW** | Cross-chain execution (XRPL settlement via FlareTeeManager diamond, Base OFT, Hyperliquid hedging) | No autonomous cross-chain rebalancing |
| **Smart Accounts** | Onboards XRP holders from XRPL wallets with a single signature | Onboarding friction returns |

## Deployed Contracts (Coston2)

### Aegis Contracts

| Contract | Address | Code Size |
|---|---|---|
| VaultCore | `0xcb08be1cc86d3f94c54c64682372e32f669134bc` | 5,103 bytes |
| VerifierRole | `0xb513516d02d88be754c5204e132defbb0f4156e6` | 3,104 bytes |
| PolicyRegistry | `0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5` | 5,133 bytes |
| SolvencyRoot | `0xf52c1fd632d853ee46a48a82064d3f5d390f057d` | 4,277 bytes |
| InstructionSender | `0xb175f16e1cea66360e354db4b178c04c69363c06` | 6,733 bytes |
| FDCAttestor | `0x266a9537eaa76264c926541a77c2705f659ba4f1` | 3,411 bytes |
| PMWInstructionRelay | `0xce23e1a26c41eaa305f69d9150d9ac82d8b30743` | 4,931 bytes |

### Flare System Contracts

| Contract | Address | Purpose |
|---|---|---|
| FtsoV2 | `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d` | XRP/USD price feeds |
| FdcHub | `0x48aC463d7975828989331F4De43341627b9c5f1D` | FDC v1 attestation requests |
| FdcVerification | `0x906507E0B64bcD494Db73bd0459d1C667e14B933` | FDC v1 proof verification |
| FdcRequestFeeConfigs | `0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e` | FDC request fee calculation |
| FlareSystemsManager | `0xA90Db6D10F856799b10ef2A77EBCbF460aC71e52` | Voting epoch management |
| FlareTeeManager | `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE` | PMW Diamond (18 facets) |
| Fdc2Hub | `0x04dd3Ba33aC798d400bEc42A26F82f9812A421dc` | FDC v2 hub (not used by Aegis) |
| Fdc2Verification | `0xA34Ff9be42b2C7782786270a51d33b1baC0462Cd` | FDC v2 verification (proxy) |

## Current Vault State (Live on Coston2)

| Metric | Value |
|---|---|
| Total FXRP Deposited | 0 |
| Active Positions | 0 |
| XRP/USD Price (FTSO V2) | ~$1.07 (refreshed every ~90s) |
| Collateral Ratio | 140% (14,000 bps) |
| Min Threshold | 150% (15,000 bps) |
| Solvency Status | WARNING (ratio below threshold) |
| Policy Count | 3 (Conservative, Balanced, Aggressive) |
| Instruction Count | 13 |
| Current Voting Round | ~1,415,258 |

The vault is currently in WARNING state: `isSolvent()` returns `(false, 14000)`, meaning the collateral ratio of 140% is below the 150% minimum threshold. This demonstrates the audit verification flow where an auditor can verify the WARNING condition on-chain without seeing any individual positions.

## Test Results

| Component | Result |
|---|---|
| Foundry (Solidity) | 143 tests pass, 0 failures |
| Go extension | 13 packages pass |
| TypeScript SDK | Compiles with `tsc --noEmit` |
| Frontend | Next.js 16.3.0 builds with 10 API routes, TypeScript clean, ESLint clean |
| M4 checkpoint | 97/97 checks pass (demo rehearsal 6.80s) |

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

Dashboard URL: https://aegis.vercel.app

## TypeScript SDK

The SDK provides typed access to all Aegis contracts. Install with `npm install @aegis/sdk`.

```typescript
import { AegisSDK } from '@aegis/sdk';

// Create SDK instance (defaults to Coston2 testnet)
const sdk = new AegisSDK();

// Vault operations
const price = await sdk.vault.getXrpUsdPrice();           // ~1.07e18
const deposited = await sdk.vault.getTotalDeposited();     // 0 FXRP
const positions = await sdk.vault.getActivePositionCount(); // 0

// Solvency check
const { isSolvent, collateralRatio } = await sdk.audit.isSolvent();
// Currently: isSolvent=false, collateralRatio=14000 (140%)

// Policy operations
const policies = await sdk.policy.listPolicies();          // 3 policies
const check = await sdk.policy.checkAction(1, 2, 100);    // check deposit action

// Audit operations
const proof = await sdk.audit.getCurrentProof();
const result = await sdk.audit.verifyProof(proof.merkleRoot);
```

## How to Verify

Anyone can verify the Aegis deployment on Coston2 using cast (Foundry CLI):

```bash
# Set RPC URL
export RPC=https://coston2-api.flare.network/ext/C/rpc

# Check VaultCore is deployed (code size > 0)
cast codesize 0xcb08be1cc86d3f94c54c64682372e32f669134bc --rpc-url $RPC

# Check solvency state: isSolvent() returns (bool, uint256)
cast call 0xf52c1fd632d853ee46a48a82064d3f5d390f057d "isSolvent()" --rpc-url $RPC
# Expected: (false, 14000) -- WARNING state

# Check policy count
cast call 0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5 "getPolicyCount()" --rpc-url $RPC
# Expected: 3

# Check instruction count
cast call 0xb175f16e1cea66360e354db4b178c04c69363c06 "getInstructionCount()" --rpc-url $RPC
# Expected: 13

# Check FDCAttestor voting round
cast call 0x266a9537eaa76264c926541a77c2705f659ba4f1 "getCurrentVotingRound()" --rpc-url $RPC
# Expected: ~1415258

# Verify all contract code sizes
for addr in 0xcb08be1cc86d3f94c54c64682372e32f669134bc 0xb513516d02d88be754c5204e132defbb0f4156e6 0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5 0xf52c1fd632d853ee46a48a82064d3f5d390f057d 0xb175f16e1cea66360e354db4b178c04c69363c06 0x266a9537eaa76264c926541a77c2705f659ba4f1 0xce23e1a26c41eaa305f69d9150d9ac82d8b30743; do
  echo "$addr: $(cast codesize $addr --rpc-url $RPC) bytes"
done

# Run Foundry tests
cd contracts && forge test --summary

# Run Go extension tests
cd extension && go test ./...

# Run M4 checkpoint
python3 scripts/m4_checkpoint.py
```

## Repository Structure

```
aegis/
+-- README.md                    # This file
+-- LICENSE                      # MIT
+-- CONTRIBUTING.md
+-- CODE_OF_CONDUCT.md
+-- docs/
|   +-- architecture.md          # Five-layer architecture, deployment status, diagrams
|   +-- deployment.md            # Coston2 / Songbird / Mainnet deployment, verification checklist
|   +-- security.md              # Threat model, mitigations, audit status
|   +-- api.md                   # Contract + extension API reference (all interfaces)
|   +-- demo-script.md           # The five-minute demo script
+-- contracts/                   # Foundry project
|   +-- foundry.toml
|   +-- src/
|   |   +-- VaultCore.sol
|   |   +-- PolicyRegistry.sol
|   |   +-- SolvencyRoot.sol
|   |   +-- InstructionSender.sol
|   |   +-- VerifierRole.sol
|   |   +-- FDCAttestor.sol        # FDC attestation request & verification
|   |   +-- PMWInstructionRelay.sol # PMW instruction relay to FCC Diamond
|   |   +-- PMWValidator.sol       # PMW validation on Coston2
|   |   +-- interfaces/
|   |       +-- vault/             # Vault contract interfaces (IVaultCore, IPolicyRegistry, etc.)
|   |       +-- fassets/           # FAssets interfaces (IAssetManager, IFlareContractRegistry, etc.)
|   |       +-- pmw/               # PMW facet interfaces
|   |       +-- fdc/               # FDC contract interfaces
|   +-- test/
|   +-- script/
|       +-- DeployCoston2.s.sol
|       +-- DeployPMWValidator.s.sol
|       +-- DeployFDCAttestor.s.sol
|       +-- DeployVaultContracts.s.sol
+-- scripts/                    # Python validation & checkpoint scripts
|   +-- pmw_validate.py          # PMW validation on Coston2
|   +-- fdc_validate.py          # FDC attestation validation on Coston2
|   +-- vault_validate.py        # Vault contracts & FAssets integration validation
|   +-- position_validate.py     # PositionComputer & SolvencyAttestor validation
|   +-- m1_checkpoint.py         # M1 checkpoint
+-- extension/                   # FCC extension (Go, in TEE)
|   +-- go.mod
|   +-- cmd/server/main.go
|   +-- internal/
|   |   +-- position/            # PositionComputer (Layer 3 core)
|   |   +-- attestation/         # SolvencyAttestor (Layer 3+5)
|   |   +-- risk/                # RiskAgent (XGBoost)
|   |   +-- policy/              # Policy Engine
|   |   +-- attester/            # FDC Attestor (Layer 5)
|   |   +-- executor/            # ActionExecutor (PMW)
|   +-- Dockerfile
|   +-- deployment/              # FCC deployment configs
+-- sdk/                         # TypeScript SDK
|   +-- src/
|   |   +-- vault-client.ts
|   |   +-- policy-client.ts
|   |   +-- audit-client.ts
|   |   +-- config.ts
|   |   +-- provider.ts
|   +-- test/
|   +-- package.json
+-- frontend/                    # Next.js dashboard
|   +-- app/
|   |   +-- treasury/
|   |   +-- policy/
|   |   +-- audit/
|   +-- components/
+-- examples/
|   +-- deposit-flow.ts
|   +-- audit-verify.ts
+-- config/                      # Network configs
|   +-- coston2/
|   +-- proxy/
+-- .github/workflows/
|   +-- ci.yml
+-- docker-compose.coston2.yaml
```

## M4 Checkpoint Status

- **M4 SIGN-OFF**: GRANTED (97/97 checks pass)
- **Demo rehearsal timing**: 6.80s (limit: 300s) -- well under 5 minutes
- **All previous milestones (M1, M2, M3)**: Verified
- **Demo path proven end-to-end**: deposit -> risk event -> PMW rebalance -> solvency attestation
- **SDK builds and compiles**: TypeScript SDK @aegis/sdk v1.0.0
- **Foundry tests pass**: 143 tests, 0 failures
- **Go tests pass**: 13 packages
- **Contracts deployed on Coston2**: 7 Aegis contracts + 8 system contracts verified
- **FTSO V2 price feeds**: XRP/USD ~$1.07 via VaultCore, refreshed every ~90s
- **FDC verification infrastructure**: FdcHub, FdcVerification, FdcRequestFeeConfigs, Fdc2Hub, Fdc2Verification
- **PMW Diamond accessible**: FlareTeeManager on Coston2 (18 facets)
- **Frontend routes verified**: 10 API routes, 3 hooks, 2 libs
- **CI pipeline**: GitHub Actions (forge test, tsc, eslint, next build, secret scan)
- **ESLint**: 0 errors, 0 warnings
- **TypeScript**: strict mode, no errors
- **Production build**: 13 routes (3 static + 10 dynamic), compiles in <5s
- **Vault solvency state**: `isSolvent()` = `(false, 14000)` -- WARNING (140% < 150% threshold)
- **VerifierRole status**: Deployed (3,104 bytes code)

## Roadmap

| Phase | Timeline | Milestone |
|---|---|---|
| Hackathon MVP | Weeks 1-6 | Coston2 deployment, demo, DoraHacks submission |
| Post-hackathon | Month 1-2 | External audit, Songbird deployment, institutional pilot |
| Mainnet launch | Month 3 | Mainnet deployment, first institutional customer |
| Scale | Month 4-6 | Multi-vault, additional asset support, SaaS tier |

## License

MIT

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

*Built for the [Flare Summer Signal Hackathon](https://dorahacks.io/hackathon/flaresummersignal/detail) on DoraHacks.*
