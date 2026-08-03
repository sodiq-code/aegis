# Architecture

## Overview

Aegis is a verifiable, confidential, AI-managed cross-chain treasury protocol for XRP-native institutions on Flare. It uses every enshrined Flare primitive in a load-bearing way.

## Five-Layer Architecture

### Layer 1 — Asset Onboarding

- **Flare Smart Accounts**: Onboards XRP holders from XRPL wallets (Xaman, Ledger, Joey Wallet) with a single signature
- **FAssets (FXRP)**: Mints 1:1 FXRP representations of XRP on Flare; core asset deposited into vaults
- **Liquid Staking (sFLR)**: Alternative deposit via Sceptre-style liquid staking for FLR holders

### Layer 2 — On-Chain Vault Contracts (Flare C-Chain)

- **VaultCore**: Holds deposited FXRP/sFLR; enforces deposit/withdrawal rules; tracks vault state
- **PolicyRegistry**: Stores risk policy parameters (max drawdown, rebalance thresholds, asset allocation limits)
- **SolvencyRoot**: Receives Merkle root of solvency from the TEE; makes solvency verifiable on-chain
- **InstructionSender**: Sends instructions to the FCC extension via TeeExtensionRegistry
- **VerifierRole**: Access control for auditor verification functions

### Layer 3 — Confidential Compute (FCC)

All computation runs inside Trusted Execution Environments (TEEs), attested via FCC:

- **PositionComputer**: Rebuilds complete vault state from on-chain events + FDC-attested external state
- **RiskAgent**: AI risk agent (XGBoost) that monitors FTSO price feeds and FDC-attested cross-chain state; executes the observe → score → decide → act → attest loop
- **Policy Engine**: Deterministic policy enforcement; constrains the AI agent's actions within on-chain parameters
- **SolvencyAttestor**: Computes Merkle root of solvency and publishes on-chain via SolvencyRoot contract

### Layer 4 — Cross-Chain Execution (PMW)

- **ActionExecutor**: Routes approved actions to PMW for cross-chain execution
- **XRPL wallet ops**: PMW-mediated wallet creation, instruction, and signing on XRPL
- **Base OFT transfers**: Cross-chain FXRP transfers via the OFT route
- **Hyperliquid hedging**: Automated hedging via the FXRP/USDH spot market

### Layer 5 — Verification & Audit

- **FDC attestation**: Attests external chain state (XRPL payments, address validity) for position computation
- **Solvency proof oracle**: TEE-computed proof that assets exceed liabilities by a stated margin
- **Auditor dashboard**: External auditors can verify solvency cryptographically without seeing individual positions

## Data Flow

### Deposit Flow

1. User signs XRPL transaction via Flare Smart Accounts
2. FXRP is minted on Flare
3. FDC attests the XRPL payment
4. VaultCore receives the deposit
5. PositionComputer updates vault state inside TEE
6. SolvencyAttestor publishes updated Merkle root on-chain

### Rebalance Flow

1. FTSO price feeds update (FTSO is enshrined and economically secured)
2. RiskAgent detects threshold breach (inside TEE)
3. Policy Engine validates the action against on-chain parameters (deterministic)
4. ActionExecutor routes to PMW for cross-chain execution
5. PMW signs transaction via data-provider consensus
6. FDC attests the executed payment
7. PositionComputer updates vault state
8. SolvencyAttestor publishes updated Merkle root on-chain

### Audit Flow

1. Auditor requests solvency attestation
2. TEE computes proof that assets exceed liabilities
3. Merkle root is published on-chain
4. Auditor verifies the proof cryptographically
5. Individual positions never leave the TEE

## Security Model

| Layer | Threat | Mitigation |
|---|---|---|
| Smart contracts | Exploit | OpenZeppelin, Foundry fuzz tests, timelocked multisig |
| TEE | Compromise | FCC attestation, deterministic logic, frequent key rotation |
| AI agent | Misbehaviour | Deterministic Policy Engine, on-chain constraints, fail-safe |
| PMW | Key compromise | TEE key custody, data-provider consensus |
| FDC | Attestation delay | Safe-state logic, cached attestations, fallback to last-known-good |
| Economic | FTSO manipulation | FTSO is enshrined and economically secured; multi-source inputs |
