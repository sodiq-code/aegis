# Architecture

## Overview

Aegis is a verifiable, confidential, AI-managed cross-chain treasury protocol for XRP-native institutions on Flare. It uses every enshrined Flare primitive in a load-bearing way: FAssets for the core asset, FTSO for price discovery, FDC for cross-chain state attestation, FCC for confidential computation, and PMW for cross-chain execution. Remove any one primitive and the product cannot exist.

The architecture is organized as five distinct layers, each with a clear responsibility boundary and well-defined interfaces between them. Data flows downward from asset onboarding through vault contracts, confidential computation, cross-chain execution, and finally verification — with each layer adding a specific capability that depends on a specific Flare primitive.

## Five-Layer Architecture

### Layer 1 — Asset Onboarding

This layer is responsible for getting XRP from the XRP Ledger onto Flare in a trustless, 1:1 pegged form. It leverages two Flare primitives: Flare Smart Accounts for seamless XRPL wallet onboarding, and FAssets for minting the FXRP token.

- **Flare Smart Accounts**: Onboards XRP holders from XRPL wallets (Xaman, Ledger, Joey Wallet) with a single signature. The smart account system maps an XRPL address to a Flare EVM address, allowing deposits without requiring users to manage a separate Flare private key. This eliminates the primary onboarding friction for XRP treasury holders.
- **FAssets (FXRP)**: Mints 1:1 FXRP representations of XRP on Flare. FXRP is the core asset deposited into Aegis vaults. The FAssets protocol is enshrined on Flare and economically secured — it is not a bridge or a wrapper, but a native Flare representation backed by the FAssets collateral pool and agent system.
- **Liquid Staking (sFLR)**: Alternative deposit path for FLR holders via Sceptre-style liquid staking. This provides a second asset class for vaults that want to accept FLR-based collateral in addition to FXRP.

**Key invariant**: Every FXRP in an Aegis vault corresponds to exactly 1 XRP locked in the FAssets system. The peg is maintained by Flare's FAssets protocol, not by Aegis.

### Layer 2 — On-Chain Vault Contracts (Flare C-Chain)

This layer contains the Solidity smart contracts deployed on Flare's C-Chain that govern vault operations, risk policies, and solvency proofs. All contracts are written in Solidity 0.8.27, tested with Foundry (143 tests including fuzz tests), and deployed on Coston2 testnet.

- **VaultCore**: The primary entry point for depositors. Holds deposited FXRP/sFLR, enforces deposit/withdrawal rules, tracks vault state (total deposits, valuations, position count), reads XRP/USD price from FTSO V2, and manages emergency mode. The contract implements the exact API specified in the report's Section 9.4.5: `depositFXRP(amount, policyId)`, `withdraw(amount)`, `emergencyExit()`.
- **PolicyRegistry**: Stores risk policy parameters for each vault. Policies define the constraints within which the AI risk agent must operate: maximum drawdown (basis points), maximum single-asset exposure, hedge thresholds, allowed asset list, deposit/withdrawal limits per transaction, minimum collateral ratio, maximum leverage, rebalance thresholds, and the actions to take on risk breach or solvency warning. Three default policies are provided: Conservative (15% drawdown, 40% exposure), Balanced (25% drawdown, 60% exposure), and Aggressive (40% drawdown, 80% exposure).
- **SolvencyRoot**: Receives the Merkle root of solvency computed inside the TEE and makes it verifiable on-chain. Stores the current proof and proof history. Provides `isSolvent()` (returns bool + collateral ratio), `getCurrentSolvencyProof()` (returns full proof struct), and emits `SolvencyProofPublished` events for audit trail.
- **InstructionSender**: Sends instructions to the FCC extension via the TeeExtensionRegistry contract. Handles deposit attestation requests, rebalance instructions, and solvency computation requests.
- **VerifierRole**: Access control for auditor verification functions. Only addresses with the verifier role can call certain read functions on SolvencyRoot and FDCAttestor that are restricted to auditors.
- **FDCAttestor**: Requests and verifies FDC attestations on-chain. Integrates with FdcHub, FdcVerification, and Fdc2Hub/Fdc2Verification for both FDC v1 and v2 attestation types. Tracks the current voting epoch ID.
- **PMWInstructionRelay**: Relays PMW execution instructions from the ActionExecutor (inside the TEE) to the FlareTeeManager diamond for cross-chain execution via PMW data-provider consensus.

**Key invariant**: The on-chain contracts never see individual positions. They only see aggregate values (total deposits, Merkle roots) and policy parameters. Position-level confidentiality is maintained by Layer 3.

### Layer 3 — Confidential Compute (FCC)

This layer runs entirely inside Trusted Execution Environments (TEEs), attested via Flare Confidential Compute (FCC). FCC is Flare's TEE-based verifiable compute layer — the first delivery of the Flare 2.0 vision. It provides hardware-backed confidentiality (Intel SGX/TDX) with on-chain attestation, meaning anyone can verify that the correct code ran inside the TEE without being able to see the data it processed.

The FCC extension is written in Go and compiled as a shared library that runs inside the TEE node. It exposes HTTP endpoints for the proxy to call when instructions arrive on-chain.

- **PositionComputer**: Rebuilds the complete vault state from on-chain events (deposits, withdrawals, rebalances) and FDC-attested external state (XRPL balances, Hyperliquid positions). Uses a keccak256-based Merkle tree to commit to the position vector. The Merkle root is what gets published on-chain via SolvencyRoot — individual positions never leave the TEE.
- **RiskAgent**: The AI risk agent that implements the full observe → score → decide → act → attest loop. On each iteration (triggered by FTSO price updates or threshold events), it: (1) reads FTSO price feeds and FDC-attested cross-chain state; (2) runs the XGBoost risk scoring model (200 trees, depth 6, trained on historical FTSO data); (3) produces a risk score (0–100) and action classification (hold, rebalance, hedge, deleverage); (4) passes the action to the Policy Engine for validation; (5) if approved, routes to ActionExecutor; (6) publishes updated solvency proof.
- **Policy Engine**: Deterministic policy enforcement. Reads on-chain policy parameters from PolicyRegistry and constrains the AI agent's actions within those bounds. If the AI agent recommends an action that exceeds policy limits (e.g., rebalance exceeds maxDrawdownBps), the Policy Engine blocks it and logs the violation. This is the critical safety layer that makes the AI agent trustworthy — it cannot exceed its mandate.
- **SolvencyAttestor**: Computes the Merkle root of solvency and publishes it on-chain via the SolvencyRoot contract. The solvency proof asserts that total collateral exceeds total liabilities by a stated margin (surplusBps), without revealing the individual position amounts. This is the "confidentiality-to-verifiability transformation" that is the emotional core of the demo.

**Key invariant**: All position data stays inside the TEE. Only aggregate commitments (Merkle roots) and policy-compliant actions leave the TEE. FCC attestation proves the correct code ran.

### Layer 4 — Cross-Chain Execution (PMW)

This layer handles cross-chain execution using Flare's Protocol Managed Wallets (PMW). PMW extends Flare's consensus to external chains — XRPL, Base, Hyperliquid — by managing wallets on those chains via data-provider consensus. The TEE holds the signing key for the PMW wallet, and data providers vote on whether to sign the transaction.

- **ActionExecutor**: Routes approved actions from the RiskAgent/Policy Engine to PMW for cross-chain execution. Supports three action types: XRPL operations (payment, trustline), Base OFT transfers (cross-chain FXRP via LayerZero), and Hyperliquid hedging (spot trades on the FXRP/USDH market).
- **XRPL wallet ops**: PMW-mediated wallet creation, instruction submission, and transaction signing on the XRP Ledger. This is the primary settlement layer for XRP treasury operations.
- **Base OFT transfers**: Cross-chain FXRP transfers via the OFT (Omnichain Fungible Token) route on Base. Used for rebalancing vault exposure across chains.
- **Hyperliquid hedging**: Automated hedging via the FXRP/USDH spot market on Hyperliquid. The risk agent can trigger hedge positions when the risk score exceeds the hedge threshold.

**Key invariant**: PMW transactions are signed by the TEE-held key and validated by data-provider consensus. No single party can authorize a cross-chain transaction.

### Layer 5 — Verification & Audit

This layer provides the verification and audit interface that allows external parties to verify the vault's solvency without seeing individual positions. It uses FDC for cross-chain state attestation and the SolvencyRoot contract for on-chain proof verification.

- **FDC attestation**: Attests external chain state — XRPL payments (using the XRPPayment attestation type), address validity (AddressValidity for compliance), and Hyperliquid state — for position computation inside the TEE. FDC is Flare's attestation system that brings verifiable external data on-chain.
- **Solvency proof oracle**: The TEE-computed proof that assets exceed liabilities by a stated margin. The proof is a Merkle root published on-chain via SolvencyRoot. Anyone can verify it by: (1) reading the on-chain proof; (2) comparing the Merkle root to their own computation; (3) checking the FDC merkle root for the corresponding voting round.
- **Auditor dashboard**: The frontend audit view that allows external auditors to request solvency attestations, verify proofs on-chain, inspect FDC infrastructure status, and view proof history — all without ever seeing individual positions.

**Key invariant**: An auditor can verify that the vault is solvent without seeing any individual position. This is the confidentiality-to-verifiability transformation.

## Data Flow Diagrams

### Deposit Flow (end-to-end)

```
XRPL Wallet          Flare Smart Accounts     FAssets       VaultCore        FCC Extension       SolvencyRoot
    │                       │                    │              │                  │                  │
    │  1. Sign XRPL tx      │                    │              │                  │                  │
    │──────────────────────>│                    │              │                  │                  │
    │                       │  2. Mint FXRP      │              │                  │                  │
    │                       │───────────────────>│              │                  │                  │
    │                       │                    │  3. Deposit  │                  │                  │
    │                       │                    │─────────────>│                  │                  │
    │                       │                    │              │  4. FDC attest   │                  │
    │                       │                    │              │─────────────────>│                  │
    │                       │                    │              │                  │  5. Compute root │
    │                       │                    │              │                  │─────────────────>│
    │                       │                    │              │                  │                  │
    │                       │                    │              │  VaultCore event │  Merkle root     │
    │                       │                    │              │  DepositMade     │  published       │
```

1. **XRPL Wallet** signs a single XRPL transaction (via Xaman or other wallet)
2. **Flare Smart Accounts** maps the XRPL signature to a Flare EVM address and mints FXRP via FAssets
3. **VaultCore** receives the FXRP deposit, assigns a risk policy, emits `DepositMade` event
4. **FDC** attests the XRPL payment on the XRP Ledger (using XRPPayment attestation type)
5. **PositionComputer** (inside TEE) rebuilds vault state from events + FDC-attested data; **SolvencyAttestor** computes new Merkle root and publishes on-chain via SolvencyRoot

### Rebalance Flow (autonomous risk management)

```
FTSO V2          RiskAgent (TEE)      Policy Engine       ActionExecutor       PMW              FDC            SolvencyRoot
   │                    │                    │                   │                │                │                │
   │  1. Price update   │                    │                   │                │                │                │
   │──────────────────->│                    │                   │                │                │                │
   │                    │  2. Score (XGBoost)│                   │                │                │                │
   │                    │  risk=72, action=  │                   │                │                │                │
   │                    │  "Hedge"           │                   │                │                │                │
   │                    │                    │  3. Validate      │                │                │                │
   │                    │                    │  against policy   │                │                │                │
   │                    │                    │  ✓ Approved       │                │                │                │
   │                    │                    │──────────────────>│                │                │                │
   │                    │                    │                   │  4. Route to   │                │                │
   │                    │                    │                   │  PMW           │                │                │
   │                    │                    │                   │───────────────>│                │                │
   │                    │                    │                   │                │  5. Execute    │                │
   │                    │                    │                   │                │  on XRPL       │                │
   │                    │                    │                   │                │                │  6. Attest    │
   │                    │                    │                   │                │                │  payment      │
   │                    │                    │                   │                │───────────────>│                │
   │                    │                    │                   │                │                │                │
   │                    │  7. Update state   │                   │                │                │                │
   │                    │  + publish root    │                   │                │                │                │
   │                    │────────────────────────────────────────────────────────────────────────────────────────>│
```

1. **FTSO V2** delivers a new XRP/USD price (every ~90 seconds)
2. **RiskAgent** (inside TEE) runs XGBoost on the updated feature vector, produces risk score (0–100) and action (hold/rebalance/hedge/deleverage)
3. **Policy Engine** validates the action against on-chain policy parameters from PolicyRegistry (deterministic — cannot be overridden by AI)
4. **ActionExecutor** routes the approved action to PMW for cross-chain execution
5. **PMW** signs and executes the transaction on XRPL via data-provider consensus
6. **FDC** attests the executed payment on XRPL
7. **PositionComputer** updates vault state from FDC-attested result; **SolvencyAttestor** publishes new Merkle root on-chain

### Audit Flow (solvency verification)

```
Auditor          AuditClient         SolvencyRoot          FDC Verification       TEE
   │                  │                    │                      │                  │
   │  1. Request      │                    │                      │                  │
   │  attestation     │                    │                      │                  │
   │─────────────────>│                    │                      │                  │
   │                  │  2. Read proof     │                      │                  │
   │                  │──────────────────>│                      │                  │
   │                  │  proof returned   │                      │                  │
   │                  │<──────────────────│                      │                  │
   │                  │                    │                      │                  │
   │                  │  3. Verify merkle  │                      │                  │
   │                  │  root on-chain     │                      │                  │
   │                  │──────────────────>│                      │                  │
   │                  │  ✓ Root matches   │                      │                  │
   │                  │<──────────────────│                      │                  │
   │                  │                    │                      │                  │
   │                  │  4. Check FDC      │                      │                  │
   │                  │  merkle root       │                      │                  │
   │                  │─────────────────────────────────────────>│                  │
   │                  │  ✓ FDC confirms   │                      │                  │
   │                  │<─────────────────────────────────────────│                  │
   │                  │                    │                      │                  │
   │  5. Verified ✓   │                    │                      │                  │
   │  (no positions   │                    │                      │                  │
   │   revealed)      │                    │                      │                  │
   │<─────────────────│                    │                      │                  │
```

1. **Auditor** requests a solvency attestation (via the SDK or dashboard)
2. **AuditClient** reads the current solvency proof from SolvencyRoot on-chain
3. **AuditClient** verifies the Merkle root matches the on-chain proof
4. **AuditClient** checks the FDC merkle root for the corresponding voting round
5. **Auditor** receives verification result — **no individual positions are ever revealed**

## Security Model

| Layer | Threat | Mitigation |
|---|---|---|
| Smart contracts | Exploit | OpenZeppelin, Foundry fuzz tests, timelocked multisig |
| TEE | Compromise | FCC attestation, deterministic logic, frequent key rotation |
| AI agent | Misbehaviour | Deterministic Policy Engine, on-chain constraints, fail-safe |
| PMW | Key compromise | TEE key custody, data-provider consensus |
| FDC | Attestation delay | Safe-state logic, cached attestations, fallback to last-known-good |
| Economic | FTSO manipulation | FTSO is enshrined and economically secured; multi-source inputs |

## Verifiability Invariant

The core verifiability invariant of Aegis is: **given the on-chain data (SolvencyRoot proof, FDC attestations, vault events), any auditor can reconstruct and verify the vault's solvency without trusting any party**. The TEE provides confidentiality; FCC attestation proves the correct code ran; FDC anchors external state; and the on-chain contracts make everything publicly verifiable. This is the "confidentiality-to-verifiability transformation" — positions are confidential, solvency is verifiable.
