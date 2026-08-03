# Deployment Guide

## Coston2 Testnet Deployment

### Prerequisites

- Foundry installed (`forge`, `cast`)
- Go 1.22+ installed
- Docker and Docker Compose installed
- Coston2 FLR for gas (from [faucet](https://coston2-faucet.towolabs.com/))

### Step 1: Deploy Smart Contracts

```bash
cd contracts

# Copy the environment template
cp .env.example .env

# Edit .env with your deployer private key
# PRIVATE_KEY=0x...

# Build contracts
forge build

# Deploy to Coston2
forge script script/DeployCoston2.s.sol --rpc-url coston2 --broadcast
```

The deploy script will output the addresses of all deployed contracts. Save these for the extension configuration.

### Step 2: Configure and Start FCC Extension

```bash
cd extension

# Copy the environment template
cp ../.env.example .env

# Edit .env with the deployed contract addresses
# INSTRUCTION_SENDER_ADDRESS=0x...
# TEE_EXTENSION_REGISTRY_ADDRESS=0x...
# TEE_MACHINE_REGISTRY_ADDRESS=0x...

# Build and start the extension stack
docker compose -f ../docker-compose.coston2.yaml up --build
```

The extension stack consists of three Docker services:
- `extension-tee`: The TEE node running the Go extension
- `proxy`: Watches Coston2 for instructions, forwards to TEE, exposes results
- `redis`: In-memory store for queue and internal state

### Step 3: Register Extension

```bash
cd tools

# Set the extension ID
go run ./cmd/register-extension --config ../config/coston2

# Register the TEE
go run ./cmd/register-tee --config ../config/coston2
```

### Step 4: Verify Deployment

```bash
# Check the extension health
curl http://localhost:8080/info

# Check the proxy status
curl http://localhost:3000/info
```

## Songbird Deployment (Post-Hackathon)

TBD — Songbird deployment requires FCC and PMW to be available on Songbird canary network.

## Mainnet Deployment (Post-Hackathon)

TBD — Mainnet deployment requires FCC and PMW to be production-ready on Flare mainnet.

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `PRIVATE_KEY` | Deployer private key | Yes |
| `INSTRUCTION_SENDER_ADDRESS` | Deployed InstructionSender contract address | Yes |
| `TEE_EXTENSION_REGISTRY_ADDRESS` | TeeExtensionRegistry contract address | Yes (from Coston2 config) |
| `TEE_MACHINE_REGISTRY_ADDRESS` | TeeMachineRegistry contract address | Yes (from Coston2 config) |
| `EXTENSION_PORT` | Extension HTTP server port | No (default: 8080) |
| `SIGN_PORT` | Signing server port | No (default: 9090) |
| `COSTON2_RPC_URL` | Coston2 RPC endpoint | No (default: https://coston2-api.flare.network/ext/C/rpc) |
