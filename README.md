<div align="center">

# Aegis

**The institutional treasury layer for XRP-native DeFi on Flare — confidential positions, verifiable solvency.**

[![Flare](https://img.shields.io/badge/Flare-Coston2-ff4d2e?style=flat-square&logo=flare)](https://flare.network)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](./LICENSE)
[![Foundry Tests](https://img.shields.io/badge/Foundry-360%20passing-success?style=flat-square)](./contracts)
[![Live Dashboard](https://img.shields.io/badge/Dashboard-Live-brightgreen?style=flat-square)](https://aegis-mantle-deploy-s-projects.vercel.app)
[![Demo Video](https://img.shields.io/badge/Watch-Demo-FF0000?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/38tjExCIeMc)

</div>

> **Flare Summer Signal hackathon submission — Bounty 2: Confidential Compute Apps.**

---

> **Aegis turns private institutional treasury state into publicly verifiable financial assurance.**
>
> An XRP-native treasury can prove it is solvent and policy-compliant without revealing its positions. Flare Confidential Compute performs the risk computation privately; FDC anchors external state; Flare's cross-chain infrastructure enables policy-controlled actions.

---

## Demo Video

<p align="center">
  <a href="https://youtu.be/38tjExCIeMc">
    <img src="https://img.youtube.com/vi/38tjExCIeMc/maxresdefault.jpg" alt="Aegis demo" width="720" style="border-radius: 12px; max-width: 100%;">
  </a>
</p>

<p align="center">
  <a href="https://youtu.be/38tjExCIeMc"><b>▶ Watch the demo on YouTube</b></a>
  &nbsp;·&nbsp; 5 Flare primitives load-bearing &nbsp;·&nbsp; 4 on-chain PMW instructions &nbsp;·&nbsp; <code>isSolvent(true, 16666)</code>
</p>

The demo walks through every layer: 5-layer architecture → XRPL→FAssets→VaultCore deposit with live FDC attestation → FCC TEE confidential compute with Merkle root → `isSolvent()` returning `(true, 16666)` → autonomous AI risk rebalance → 4 PMW cross-chain instructions on Coston2 → verifiability recap.

> **Verifiable on Coston2:** All Flare-side PMW instructions, FDC attestations, `SolvencyRoot` publications, and XGBoost risk scoring are live and independently verifiable on Coston2 via `cast` calls and the block explorer. The XRPL settlement leg is simulated in the demo for reliability; the `FlareTeeManager` diamond call is real.

---

## Key features

- **All five Flare primitives are load-bearing.** FAssets, FTSO, FDC, FCC, and PMW are each structurally required for the protocol to function.
- **Verifiable-confidential pattern.** Positions are computed inside a TEE and published as a Merkle root, so an auditor can verify a **TEE-computed, FDC-anchored, Merkle-committed solvency state** without seeing individual positions.

---

## How Flare is used

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

The core verifiability invariant: **given the on-chain data (SolvencyRoot proof, FDC attestations, vault events) plus the TEE attestation from Flare's FCC infrastructure, an auditor can reconstruct and verify the vault's solvency.** The TEE provides confidentiality; FCC attestation proves the correct code ran; FDC anchors external state; the on-chain contracts make the published commitment publicly verifiable.

Full architecture, data-flow and sequence diagrams: [`docs/architecture.md`](./docs/architecture.md).

---

## What was built during Summer Signal

The entire Aegis system was built during the Flare Summer Signal hackathon.

| Component | Description |
|---|---|
| Vault contracts | `VaultCore`, `PolicyRegistry`, `SolvencyRoot`, `InstructionSender`, `VerifierRole`, `FDCAttestor`, `PMWInstructionRelay` |
| FCC extension | `PositionComputer`, `RiskAgent` (XGBoost, 200 trees), `PolicyEngine`, `ActionExecutor`, `SolvencyAttestor`, FDC + PMW clients |
| FDC integration | `XRPPayment` attestation ingestion, DA-Layer proof search (rounds N..N+4) |
| PMW execution | `PMWInstructionRelay` + `PMWClient` targeting `FlareTeeManager` diamond, 4 on-chain instructions |
| Safe-state management | NORMAL / SAFE_STATE / EMERGENCY modes, circuit breaker, emergency-exit path |
| Coston2 deployment | All 7 Aegis contracts + Flare system contract integration |
| Treasury dashboard | Next.js 16 — Treasury / Policy / Audit views, 18 API routes reading live Coston2 state |
| Production deposit path | Server-assisted XRPL → FAssets → VaultCore with FDC attestation |
| TypeScript SDK | `vault-client`, `policy-client`, `audit-client` |
| Test suite | 360 Foundry tests (fuzz, invariant, edge-case, failure-mode, Coston2 fork) |
| Autonomous policy loop | AI proposes → deterministic policy constrains → executor executes → TEE attests |

---

## Deployed contracts (Coston2)

All seven Aegis contracts are deployed and verifiable on the Coston2 testnet.

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
| Collateral ratio | ~166% (16,666 bps) |
| Minimum threshold | 150% (15,000 bps) |
| Solvency status | **SOLVENT** — `isSolvent()` returns `(true, 16666)` |
| Policy count | 3 — Conservative · Balanced · Aggressive |
| Instruction count | 13 |
| Current voting round | ~1,417,821 |

The vault moved above the 150% solvency threshold after FXRP deposits were made through the production deposit path during Phase 2 testing. The ratio fluctuates with the FTSO V2 XRP/USD price feed (refreshed every ~90s); the current state can be re-verified at any time using the `cast` commands below.

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

> **Tip:** For local development, the quickest way to run the on-chain
> solvency publisher is the included TEE daemon script:
> `./mini-services/aegis-tee/start.sh` (see
> [Running the FCC extension TEE as a daemon](#running-the-fcc-extension-tee-as-a-daemon)
> below). It publishes `SolvencyRoot` proofs on Coston2 without needing the
> full Docker Compose stack.

### Running the FCC extension TEE as a daemon

The Go extension's `OnChainPublisher` publishes solvency proofs to the
`SolvencyRoot` contract on Coston2. To run the TEE directly:

```bash
# From the repo root
export AEGIS_VERIFIER_PRIVATE_KEY=0x...   # the verifier key (has VERIFIER role)
export AEGIS_SOLVENCY_ROOT_ADDRESS=0xf52c1fd632d853ee46a48a82064d3f5d390f057d
export AEGIS_VAULT_CORE_ADDRESS=0xcb08be1cc86d3f94c54c64682372e32f669134bc
export AEGIS_RPC_URL=https://coston2-api.flare.network/ext/C/rpc

cd extension && go build -o ./bin/aegis-extension ./cmd/main.go
./bin/aegis-extension
```

Or use the included start script: `./mini-services/aegis-tee/start.sh`

When running, the TEE daemon:
- Polls `VaultCore.DepositMade` events every 15 seconds (chunked for Coston2's
  30-block `eth_getLogs` limit)
- Feeds each new deposit into the `PositionComputer` (builds the Merkle tree)
- Computes a fresh Merkle root and publishes it on-chain via
  `SolvencyRoot.publishSolvencyProof()` signed by the verifier key
- Reads the current voting round from `FlareSystemsManager.getCurrentVotingEpochId()`
  (so the auditor's FDC cross-check works)
- Runs the `RiskAgent` loop (90-second interval) with the XGBoost model
- Maintains the `SafeStateManager` (NORMAL / SAFE / EMERGENCY modes)

### Production deposit path (XRPL → FAssets → VaultCore)

The dashboard supports two deposit paths, toggled in the Treasury view:

1. **Demo Path** (default): EVM + FXRP faucet — the user connects MetaMask,
   the faucet drips 5 FXRP, the user signs `approve` + `depositFXRP` via
   MetaMask. Used for quick demos without XRPL testnet funds.

2. **Production Path**: server-assisted auto-send — XRPL → FAssets → VaultCore.
   The user only needs MetaMask (the FXRP recipient EVM address). **No Xaman
   app, no manual XRPL payment, no tx-hash pasting.** The server handles the
   entire XRPL → FDC → FAssets pipeline:
   - The user connects MetaMask on Coston2 (the FXRP recipient)
   - The user enters an XRP amount and selects a risk policy
   - On "Start FAssets Mint", the server:
     1. Sends an XRPL Payment from a pre-funded server-side testnet wallet
        to the FAssets Core Vault (`rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p` on
        Coston2) with a 32-byte memo encoding the EVM recipient address
     2. Verifies the payment on XRPL testnet
     3. Prepares an FDC `XRPPayment` attestation via the verifier API
     4. Submits `requestAttestation` to `FdcHub` (paying the FDC fee)
     5. Returns `{ phase: 'waiting_finalization', votingRound, abiEncodedRequest }`
   - The frontend polls Phase 2 every 10s. The server searches rounds
     **N through N+4** for the attestation proof in the DA Layer — this is
     required because FDC attestations submitted in round N are voted on and
     finalized in round **N+1**, so the proof appears under round N+1, not N.
     The DA Layer only returns proofs for finalized, indexed rounds.
   - On finding a proof, the server calls
     `AssetManagerFXRP.executeDirectMinting(proof)` — FXRP is minted to the
     user's EVM address. The mint step is idempotent: if an attestation bot
     has already processed the payment (`PaymentAlreadyConfirmed`), the server
     confirms the resulting FXRP balance and completes the flow.
   - The user signs `approve` + `depositFXRP` via MetaMask
   - The TEE daemon picks up the `DepositMade` event and publishes a fresh
     solvency root within 15 seconds
   - A 5-minute timeout with guided retry handles Coston2 attestation-network
     latency gracefully

The production path takes ~2-4 minutes end-to-end (FDC finalization + DA Layer proof indexing). The API route uses `maxDuration = 300` so it never
times out on Vercel. The `/api/fassets-mint?info=true` endpoint returns the
live Core Vault address, fee schedule, memo format, server wallet address,
and `autoSendAvailable` flag from the on-chain `AssetManagerFXRP` contract.

> **Xaman (optional):** A Xaman deep-link helper (`/api/xaman-payment-link`)
> remains available for users who prefer to sign the XRPL payment in their own
> wallet, but it is not required. Set `XAMM_API_KEY` + `XAMM_API_SECRET` on the
> server to enable QR-code sign-in; otherwise the auto-send path is used.

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
// Currently: isSolvent=true, collateralRatio=16666 (~166%) — SOLVENT

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
#   → (true, 16666)  ← SOLVENT state (~166% > 150% threshold)

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
cd contracts  && forge test --summary          # 360 tests, 0 failures
cd extension  && go test ./...                  # 13 packages
cd frontend   && npx tsc --noEmit && npm run build
```

---

## Implementation

Aegis is an original implementation. The core components:

| Component | Description |
|---|---|
| **Vault contracts** (Solidity 0.8.27) | `VaultCore`, `PolicyRegistry`, `SolvencyRoot`, `InstructionSender`, `VerifierRole`, `FDCAttestor`, `PMWInstructionRelay` + interfaces — 360 Foundry tests incl. fuzz & invariant tests. |
| **FCC extension** (Go, in TEE) | `PositionComputer`, `RiskAgent` (XGBoost, 200 trees), `Policy` engine, `SolvencyAttestor`, `ActionExecutor`, FDC + PMW clients — 13 tested packages. |
| **TypeScript SDK** | `vault-client`, `policy-client`, `audit-client`, provider + config — compiles clean. |
| **Institutional dashboard** (Next.js 16) | Treasury / Policy / Audit views, 18 API routes reading live Coston2 state, deployed to Vercel. |
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
│   ├── test/                       # 360 tests incl. fuzz, invariant, fork
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
| Foundry (Solidity) | **360 tests pass**, 0 failures (incl. fuzz, invariant, and Coston2 fork tests) |
| Go extension | **13 packages pass** (`go test ./...`) |
| TypeScript SDK | Compiles clean (`tsc --noEmit`) |
| Frontend | Next.js 16.3 build, 18 API routes, TypeScript clean (`tsc --noEmit`) |
| CI | GitHub Actions on every push and PR |

---

## Roadmap

| Phase | Milestone | Status |
|---|---|---|
| **Coston2 deployment** | Contracts live, deposit path proven end-to-end | ✅ Done |
| **External audit** | Trail of Bits (or equivalent) security audit | Next |
| **Songbird deployment** | Canary-network deployment after governance approval | Planned |
| **Mainnet launch** | Mainnet deployment with first institutional customer | Planned |
| **Scale** | Multi-vault, additional asset support (FDOGE, FBTC), institutional SaaS tier | Planned |

---

## License

[MIT](./LICENSE)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines. All contributions are welcome via pull request with passing CI.
