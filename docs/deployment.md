# Deployment Guide

## Coston2 Testnet Deployment

### Prerequisites

- [Foundry](https://book.getfoundry.sh/) installed (`forge`, `cast`, `anvil`)
- [Go 1.22+](https://go.dev/dl/) installed
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose installed
- [Node.js 18+](https://nodejs.org/) and [Bun](https://bun.sh/) (for frontend & SDK)
- Coston2 CFLR for gas (from [faucet](https://coston2-faucet.towolabs.com/))
- A deployer private key with funded CFLR on Coston2

### Step 1: Clone and Set Up

```bash
git clone https://github.com/sodiq-code/aegis.git
cd aegis
```

### Step 2: Deploy Smart Contracts

```bash
cd contracts

# Copy the environment template
cp .env.example .env

# Edit .env with your deployer private key
# PRIVATE_KEY=0x...

# Build contracts
forge build

# Run tests (143 tests, 0 failures)
forge test -vvv

# Deploy to Coston2
forge script script/DeployVaultContracts.s.sol --rpc-url coston2 --broadcast
forge script script/DeployFDCAttestor.s.sol --rpc-url coston2 --broadcast
forge script script/DeployPMWInstructionRelay.s.sol --rpc-url coston2 --broadcast
```

The deploy scripts will output the addresses of all deployed contracts. These are also saved in `config/coston2/deployed-addresses.json`.

### Step 3: Configure and Start FCC Extension

```bash
cd extension

# Copy the environment template
cp ../.env.example .env

# Edit .env with the deployed contract addresses and system contract addresses
# These are available in config/coston2/deployed-addresses.json
# INSTRUCTION_SENDER_ADDRESS=0x...
# TEE_EXTENSION_REGISTRY_ADDRESS=0x...
# TEE_MACHINE_REGISTRY_ADDRESS=0x...

# Build and start the extension stack (TEE + proxy + Redis)
docker compose -f ../docker-compose.coston2.yaml up --build
```

The extension stack consists of three Docker services:
- **extension-tee**: The TEE node running the Go extension (port 8080)
- **proxy**: Watches Coston2 for instructions, forwards to TEE, exposes results (port 3000)
- **redis**: In-memory store for queue and internal state

### Step 4: Register the Extension

```bash
cd tools

# Set the extension ID on-chain
go run ./cmd/register-extension --config ../config/coston2

# Register the TEE machine on-chain
go run ./cmd/register-tee --config ../config/coston2
```

### Step 5: Verify Deployment

```bash
# Check the extension health endpoint
curl http://localhost:8080/info

# Check the proxy status
curl http://localhost:3000/info

# Verify all contracts are deployed on Coston2
cd ../scripts
python3 m1_checkpoint.py
```

### Step 6: Start the Frontend Dashboard

```bash
cd frontend

# Install dependencies
bun install

# Set environment variables
export NEXT_PUBLIC_FCC_PROXY_URL=http://localhost:8080
export NEXT_PUBLIC_FLARE_RPC_URL=https://coston2-api.flare.network/ext/C/rpc

# Start the development server
bun run dev
```

The dashboard will be available at `http://localhost:3000` with three views:
- **Treasury**: Vault state, balances, risk score, FTSO price
- **Policy**: Risk policy configurator (set and inspect on-chain policies)
- **Audit**: Solvency proofs, verification tooling, FDC status

### Step 7: Test with the SDK

```bash
cd sdk

# Build the SDK
npx tsc

# Run the deposit flow example
npx tsx examples/deposit-flow.ts

# Run the audit verification example
npx tsx examples/audit-verify.ts

# Run comprehensive verification
node test/sdk-verify.js
```

## Deployed Contracts on Coston2

### Aegis Contracts

| Contract | Address | Code Size | Status |
|---|---|---|---|
| VaultCore | `0xcb08be1cc86d3f94c54c64682372e32f669134bc` | 5,103 bytes | Deployed |
| VerifierRole | `0xb513516d02d88be754c5204e132defbb0f4156e6` | **0 bytes** | **Needs redeployment** |
| PolicyRegistry | `0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5` | 5,133 bytes | Deployed |
| SolvencyRoot | `0xf52c1fd632d853ee46a48a82064d3f5d390f057d` | 4,277 bytes | Deployed |
| InstructionSender | `0xb175f16e1cea66360e354db4b178c04c69363c06` | 6,733 bytes | Deployed |
| FDCAttestor | `0x266a9537eaa76264c926541a77c2705f659ba4f1` | 3,411 bytes | Deployed |
| PMWInstructionRelay | `0xce23e1a26c41eaa305f69d9150d9ac82d8b30743` | 4,931 bytes | Deployed |

**VerifierRole note**: The VerifierRole contract is deployed at the expected address but contains 0 bytes of code. This means the deployment transaction was submitted but the constructor did not execute or the bytecode was empty. This affects role-based access control: `depositFXRP()` is blocked for non-admin callers because VaultCore references VerifierRole for verification. To fix, redeploy VerifierRole and update the VaultCore config.

### Flare System Contracts Used

| Contract | Address | Purpose |
|---|---|---|
| FtsoV2 | `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d` | XRP/USD price feeds (~$1.07, refreshed every ~90s) |
| FdcHub | `0x48aC463d7975828989331F4De43341627b9c5f1D` | FDC v1 attestation request submission |
| FdcVerification | `0x906507E0B64bcD494Db73bd0459d1C667e14B933` | FDC v1 proof verification |
| FdcRequestFeeConfigs | `0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e` | FDC attestation request fee calculation |
| FlareSystemsManager | `0xA90Db6D10F856799b10ef2A77EBCbF460aC71e52` | Voting epoch management |
| FlareTeeManager | `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE` | PMW Diamond (18 facets) for cross-chain wallet management |
| Fdc2Hub | `0x04dd3Ba33aC798d400bEc42A26F82f9812A421dc` | FDC v2 attestation hub (available but not used by Aegis) |
| Fdc2Verification | `0xA34Ff9be42b2C7782786270a51d33b1baC0462Cd` | FDC v2 verification (proxy, may have code via delegate) |

**Note on FDC v1 vs v2**: Aegis uses FDC v1 (FdcHub + FdcVerification) for all attestation operations. FDC v2 contracts are available on Coston2 but not currently integrated. The FDCAttestor contract only references FdcHub and FdcVerification.

## Songbird Deployment

Songbird deployment requires FCC and PMW to be available on the Songbird canary network. The process is identical to Coston2 deployment but with different RPC URL and contract addresses:

```bash
# Deploy contracts to Songbird
forge script script/DeployVaultContracts.s.sol --rpc-url songbird --broadcast

# Configure extension for Songbird
docker compose -f ../docker-compose.siblings.yaml up --build
```

**Status**: FCC and PMW are expected to be available on Songbird after governance approval. Monitor Flare governance proposals for availability.

## Mainnet Deployment

Mainnet deployment requires:
1. External security audit (target: Trail of Bits or equivalent)
2. FCC and PMW production-ready on Flare Mainnet
3. Governance approval for Aegis contracts
4. Institutional pilot with KYC/AML-compliant custodian

**Timeline**: External audit and Songbird deployment first, followed by Mainnet launch.

## Environment Variables

### Contracts (.env)

| Variable | Description | Required | Default |
|---|---|---|---|
| `PRIVATE_KEY` | Deployer private key | Yes | -- |
| `COSTON2_RPC_URL` | Coston2 RPC endpoint | No | `https://coston2-api.flare.network/ext/C/rpc` |

### Extension (.env)

| Variable | Description | Required | Default |
|---|---|---|---|
| `INSTRUCTION_SENDER_ADDRESS` | Deployed InstructionSender contract address | Yes | -- |
| `TEE_EXTENSION_REGISTRY_ADDRESS` | TeeExtensionRegistry contract address | Yes | (from Coston2 config) |
| `TEE_MACHINE_REGISTRY_ADDRESS` | TeeMachineRegistry contract address | Yes | (from Coston2 config) |
| `EXTENSION_PORT` | Extension HTTP server port | No | `8080` |
| `SIGN_PORT` | Signing server port | No | `9090` |
| `COSTON2_RPC_URL` | Coston2 RPC endpoint | No | `https://coston2-api.flare.network/ext/C/rpc` |

### Frontend (environment variables)

| Variable | Description | Required | Default |
|---|---|---|---|
| `NEXT_PUBLIC_FLARE_RPC_URL` | Flare RPC endpoint | No | `https://coston2-api.flare.network/ext/C/rpc` |
| `NEXT_PUBLIC_FCC_PROXY_URL` | FCC extension proxy URL | No | `http://localhost:8080` |

### SDK Configuration

The SDK is configured programmatically:

```typescript
import { AegisSDK } from '@aegis/sdk';

// Default: Coston2 testnet
const sdk = new AegisSDK();

// Custom configuration
const sdk2 = new AegisSDK({
  rpcUrl: 'https://coston2-api.flare.network/ext/C/rpc',
  fccProxyUrl: 'http://localhost:8080',
  network: 'coston2',  // or 'songbird'
});
```

## Verification Checklist

After deployment, verify each item using the commands shown:

- [ ] **6 of 7 Aegis contracts have code deployed** -- Run `cast codesize <address> --rpc-url coston2` for each contract. VerifierRole currently shows 0 bytes and needs redeployment.
- [ ] **VaultCore responds to balanceOf()** -- `cast call 0xcb08be1cc86d3f94c54c64682372e32f669134bc "balanceOf(address)" <addr> --rpc-url coston2`
- [ ] **PolicyRegistry has 3 policies** -- `cast call 0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5 "getPolicyCount()" --rpc-url coston2` should return 3
- [ ] **SolvencyRoot isSolvent() works** -- `cast call 0xf52c1fd632d853ee46a48a82064d3f5d390f057d "isSolvent()" --rpc-url coston2` currently returns (false, 14000)
- [ ] **InstructionSender has instructions** -- `cast call 0xb175f16e1cea66360e354db4b178c04c69363c06 "getInstructionCount()" --rpc-url coston2` should return >= 1
- [ ] **FDCAttestor gets voting round** -- `cast call 0x266a9537eaa76264c926541a77c2705f659ba4f1 "getCurrentVotingRound()" --rpc-url coston2` should return ~1415258
- [ ] **PMWInstructionRelay is accessible** -- `cast call 0xce23e1a26c41eaa305f69d9150d9ac82d8b30743 "getActionCount()" --rpc-url coston2`
- [ ] **FTSO V2 returns XRP/USD price ~$1.07** -- Use `vault.getXrpUsdPrice()` via SDK or cast
- [ ] **All 8 system contracts reachable** -- Verify FtsoV2, FdcHub, FdcVerification, FdcRequestFeeConfigs, FlareSystemsManager, FlareTeeManager, Fdc2Hub, Fdc2Verification
- [ ] **FCC extension health endpoint returns 200** -- `curl http://localhost:8080/info`
- [ ] **Frontend dashboard loads** -- Visit http://localhost:3000 (or https://aegis.vercel.app)
- [ ] **All 3 views display real on-chain data** -- Treasury, Policy, Audit views
- [ ] **Foundry tests pass** -- `forge test --summary` should show 143 tests, 0 failures
- [ ] **Go tests pass** -- `go test ./...` should show 13 packages passing
- [ ] **Deployment verification script passes** -- `bash scripts/verify-aegis.sh` should report all checks green

## Current Vault State (Live on Coston2)

| Metric | Value |
|---|---|
| Total FXRP Deposited | 0 |
| Active Positions | 0 |
| XRP/USD Price (FTSO V2) | ~$1.07 |
| Collateral Ratio | 140% (14,000 bps) |
| Min Threshold | 150% (15,000 bps) |
| Solvency Status | WARNING (ratio below threshold) |
| Policy Count | 3 (Conservative, Balanced, Aggressive) |
| Instruction Count | 13 |
| Current Voting Round | ~1,415,258 |
