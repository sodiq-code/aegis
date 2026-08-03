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

# Run tests
forge test -vvv

# Deploy to Coston2
forge script script/DeployVaultContracts.s.sol --rpc-url coston2 --broadcast
forge script script/DeployFDCAttestor.s.sol --rpc-url coston2 --broadcast
forge script script/DeployPMWInstructionRelay.s.sol --rpc-url coston2 --broadcast
```

The deploy scripts( scripts) will output the addresses of all deployed contracts. These are also saved in `config/coston2/deployed-addresses.json`.

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

| Contract | Address |
|---|---|
| VaultCore | `0xcb08be1cc86d3f94c54c64682372e32f669134bc` |
| VerifierRole | `0xb513516d02d88be754c5204e132defbb0f4156e6` |
| PolicyRegistry | `0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5` |
| SolvencyRoot | `0xf52c1fd632d853ee46a48a82064d3f5d390f057d` |
| InstructionSender | `0xb175f16e1cea66360e354db4b178c04c69363c06` |
| FDCAttestor | `0x266a9537eaa76264c926541a77c2705f659ba4f1` |
| PMWInstructionRelay | `0xce23e1a26c41eaa305f69d9150d9ac82d8b30743` |

### Flare System Contracts Used

| Contract | Address |
|---|---|
| FtsoV2 | `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d` |
| FdcHub | `0x48aC463d7975828989331F4De43341627b9c5f1D` |
| FdcVerification | `0x906507E0B64bcD494Db73bd0459d1C667e14B933` |
| FlareSystemsManager | `0xA90Db6D10F856799b10ef2A77EBCbF460aC71e52` |
| FlareTeeManager | `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE` |

## Songbird Deployment (Post-Hackathon)

Songbird deployment requires FCC and PMW to be available on the Songbird canary network. The process is identical to Coston2 deployment but with different RPC URL and contract addresses:

```bash
# Deploy contracts to Songbird
forge script script/DeployVaultContracts.s.sol --rpc-url songbird --broadcast

# Configure extension for Songbird
docker compose -f ../docker-compose.siblings.yaml up --build
```

**Status**: FCC and PMW are expected to be available on Songbird after governance approval. Monitor Flare governance proposals for availability.

## Mainnet Deployment (Post-Hackathon)

Mainnet deployment requires:
1. External security audit (target: Trail of Bits or equivalent)
2. FCC and PMW production-ready on Flare Mainnet
3. Governance approval for Aegis contracts
4. Institutional pilot with KYC/AML-compliant custodian

**Timeline**: Month 1–2 post-hackathon for audit and Songbird deployment; Month 3 for Mainnet launch with first institutional customer.

## Environment Variables

### Contracts (.env)

| Variable | Description | Required | Default |
|---|---|---|---|
| `PRIVATE_KEY` | Deployer private key | Yes | — |
| `COSTON2_RPC_URL` | Coston2 RPC endpoint | No | `https://coston2-api.flare.network/ext/C/rpc` |

### Extension (.env)

| Variable | Description | Required | Default |
|---|---|---|---|
| `INSTRUCTION_SENDER_ADDRESS` | Deployed InstructionSender contract address | Yes | — |
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

After deployment, verify:

- [ ] All 7 Aegis contracts deployed on Coston2 (use `vault.verifyContractsDeployed()`)
- [ ] All 5 FDC system contracts reachable (use `audit.getFdcStatus()`)
- [ ] FCC extension health endpoint returns 200 (`curl http://localhost:8080/info`)
- [ ] FTSO V2 returns XRP/USD price ~$1.07 (use `vault.getXrpUsdPrice()`)
- [ ] 3 default policies readable from PolicyRegistry (use `policy.listPolicies()`)
- [ ] Solvency proof published on SolvencyRoot (use `audit.getCurrentProof()`)
- [ ] Proof verification works (use `audit.verifyProof(merkleRoot)`)
- [ ] Frontend dashboard loads at http://localhost:3000
- [ ] All 3 views (Treasury, Policy, Audit) display real on-chain data
