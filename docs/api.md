# API Reference

## Smart Contract Interfaces

### VaultCore

The core vault contract that holds deposited assets and manages vault state.

```solidity
interface IVaultCore {
    function deposit(uint256 amount) external payable;
    function withdraw(uint256 amount) external;
    function getVaultBalance() external view returns (uint256);
    function getDepositorBalance(address depositor) external view returns (uint256);
}
```

### PolicyRegistry

Stores risk policy parameters for each depositor.

```solidity
interface IPolicyRegistry {
    function setPolicy(address depositor, Policy calldata policy) external;
    function getPolicy(address depositor) external view returns (Policy memory);
    function validateAction(address depositor, Action calldata action) external view returns (bool);
}
```

### SolvencyRoot

Receives and stores Merkle root of solvency from the TEE.

```solidity
interface ISolvencyRoot {
    function publishRoot(bytes32 root) external;
    function getCurrentRoot() external view returns (bytes32);
    function verifyProof(bytes32[] calldata proof, bytes32 leaf) external view returns (bool);
}
```

### InstructionSender

Sends instructions to the FCC extension via TeeExtensionRegistry.

```solidity
interface IInstructionSender {
    function sendDepositAttestation(bytes calldata attestationData) external payable;
    function sendRebalanceInstruction(bytes calldata instruction) external payable;
    function sendSolvencyRequest() external payable;
}
```

## FCC Extension HTTP API

The extension exposes two HTTP endpoints inside the TEE:

### POST /action

Receives instructions from the TEE infrastructure.

```json
{
  "opType": "AEGIS_VAULT",
  "opCommand": "COMPUTE_POSITION",
  "message": "..."
}
```

### GET /state

Returns the current extension state.

```json
{
  "stateVersion": "0x...",
  "state": {
    "vaultCount": 1,
    "totalDeposits": "1000000000000000000",
    "lastSolvencyRoot": "0x..."
  }
}
```

## TypeScript SDK

### VaultClient

```typescript
import { VaultClient } from '@aegis/sdk';

const client = new VaultClient({
  rpcUrl: 'https://coston2-api.flare.network/ext/C/rpc',
  vaultAddress: '0x...',
});

await client.deposit(amount);
await client.withdraw(amount);
const balance = await client.getBalance();
```

### PolicyClient

```typescript
import { PolicyClient } from '@aegis/sdk';

const client = new PolicyClient({
  rpcUrl: 'https://coston2-api.flare.network/ext/C/rpc',
  policyRegistryAddress: '0x...',
});

await client.setPolicy({
  maxDrawdown: 15, // 15%
  rebalanceThreshold: 10, // 10%
  maxAllocation: 50, // 50%
});
```

### AuditClient

```typescript
import { AuditClient } from '@aegis/sdk';

const client = new AuditClient({
  rpcUrl: 'https://coston2-api.flare.network/ext/C/rpc',
  solvencyRootAddress: '0x...',
});

const root = await client.getCurrentRoot();
const isValid = await client.verifySolvency(proof, leaf);
```
