# @aegis/sdk

TypeScript SDK for **Aegis** — A Verifiable, Confidential, AI-Managed Cross-Chain Treasury and Autonomous Risk Layer for XRP-Native Institutions on Flare.

## Installation

```bash
npm install @aegis/sdk
```

## Quick Start

```typescript
import { AegisSDK } from '@aegis/sdk';

// Create SDK instance (defaults to Coston2 testnet)
const sdk = new AegisSDK();

// Vault operations
const state = await sdk.vault.getState();
console.log(`XRP/USD: $${state.xrpUsdPrice}`);
console.log(`Collateral Ratio: ${state.solvency.collateralRatio}%`);

// Policy operations
const policies = await sdk.policy.listPolicies();
const check = await sdk.policy.checkAction(1, ActionType.DEPOSIT, 100);

// Audit operations
const proof = await sdk.audit.getCurrentProof();
const result = await sdk.audit.verifyProof(proof.merkleRoot);
console.log(`Verified: ${result.verified}`);
```

## Clients

### VaultClient

Access vault state, solvency info, risk scores, and positions.

```typescript
const vault = sdk.vault;

// Read vault state
const state = await vault.getState();
const solvency = await vault.getSolvencyInfo();
const riskScore = await vault.getRiskScore();
const position = await vault.getPosition(); // from FCC extension (TEE)

// Individual reads
const price = await vault.getXrpUsdPrice();
const deposited = await vault.getTotalDeposited();
const isEmergency = await vault.isEmergencyMode();

// Verify contracts deployed
const deployed = await vault.verifyContractsDeployed();
```

### PolicyClient

Set and inspect risk policies, validate actions.

```typescript
const policy = sdk.policy;

// List all policies
const policies = await policy.listPolicies();
const count = await policy.getPolicyCount();

// Get individual policy
const p = await policy.getPolicy(1);

// Check if action is allowed
import { ActionType, PolicyAction } from '@aegis/sdk';
const result = await policy.checkAction(1, ActionType.DEPOSIT, 100);
if (result.allowed) {
  console.log('Deposit allowed');
} else {
  console.log(`Blocked: ${policy.getActionName(result.action)}`);
}
```

### AuditClient

Request and verify solvency attestations.

```typescript
const audit = sdk.audit;

// Current proof
const proof = await audit.getCurrentProof();
console.log(`Merkle Root: ${proof.merkleRoot}`);
console.log(`Collateral Ratio: ${proof.collateralRatio}%`);

// Verify proof on-chain
const result = await audit.verifyProof(proof.merkleRoot);

// FDC attestation infrastructure
const fdcStatus = await audit.getFdcStatus();

// Request fresh attestation
const attResult = await audit.requestAttestation();

// Proof history
const history = await audit.getProofHistory();
```

## Configuration

```typescript
import { AegisSDK } from '@aegis/sdk';

// Default: Coston2 testnet
const sdk = new AegisSDK();

// Custom RPC
const sdk2 = new AegisSDK({
  rpcUrl: 'https://coston2-api.flare.network/ext/C/rpc',
  fccProxyUrl: 'http://localhost:8080',
});

// Songbird
const sdk3 = new AegisSDK({ network: 'songbird' });

// Custom fetch (for non-browser environments)
const sdk4 = new AegisSDK({ fetch: customFetch });
```

## Networks

| Network  | Chain ID | RPC URL |
|----------|----------|---------|
| Coston2  | 114      | `https://coston2-api.flare.network/ext/C/rpc` |
| Songbird | 14       | `https://songbird-api.flare.network/ext/C/rpc` |

## Contract Addresses (Coston2)

| Contract | Address |
|----------|---------|
| VaultCore | `0xcb08be1cc86d3f94c54c64682372e32f669134bc` |
| PolicyRegistry | `0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5` |
| SolvencyRoot | `0xf52c1fd632d853ee46a48a82064d3f5d390f057d` |
| FDCAttestor | `0x266a9537eaa76264c926541a77c2705f659ba4f1` |

## License

MIT
