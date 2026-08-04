# API Reference

This document provides the complete API reference for all Aegis smart contracts, the FCC extension HTTP API, and the TypeScript SDK. Every interface is taken directly from the deployed Solidity source code on Coston2.

## Smart Contract Interfaces

### VaultCore

The core vault contract that holds deposited FXRP, tracks positions, reads XRP/USD price from FTSO V2, and manages emergency mode. This is the primary entry point for depositors.

**Deployed on Coston2**: `0xcb08be1cc86d3f94c54c64682372e32f669134bc` (5,103 bytes)

```solidity
interface IVaultCore {
    struct Position {
        address depositor;
        uint256 fxrpAmount;
        uint256 depositTimestamp;
        uint256 lastValuation;
        uint256 policyId;
        bool isActive;
    }

    struct VaultConfig {
        address assetManagerFXRP;
        address fxrpToken;
        address ftsoV2;
        address policyRegistry;
        address solvencyRoot;
        address instructionSender;
        address verifierRole;
        uint256 minDepositAmount;
        uint256 maxDepositAmount;
        uint256 withdrawalWaitPeriod;
    }

    // --- Vault API ---

    /// @notice Deposit FXRP into the vault with a risk policy.
    /// @param amount The amount of FXRP to deposit.
    /// @param policyId The risk policy to assign to this position.
    /// @return positionId The ID of the newly created position.
    function depositFXRP(uint256 amount, uint256 policyId) external returns (uint256 positionId);

    /// @notice Withdraw FXRP from the vault.
    /// @param amount The amount of FXRP to withdraw.
    function withdraw(uint256 amount) external;

    /// @notice Emergency exit: withdraw all funds immediately.
    function emergencyExit() external;

    /// @notice Get the FXRP balance of a depositor.
    /// @param user The depositor address.
    /// @return balance The total FXRP balance.
    function balanceOf(address user) external view returns (uint256 balance);

    /// @notice Get the risk policy ID assigned to a depositor.
    /// @param user The depositor address.
    /// @return policyId The policy ID.
    function policyOf(address user) external view returns (uint256 policyId);

    // --- Extended API ---

    /// @notice Get the current XRP/USD price from FTSO V2.
    /// @return price The XRP/USD price (18 decimals).
    function getXrpUsdPrice() external returns (uint256 price);

    /// @notice Get the total USD valuation of the vault.
    /// @return totalUsdValuation The total valuation in USD (18 decimals).
    function getTotalValuation() external returns (uint256 totalUsdValuation);

    /// @notice Get a position by ID.
    /// @param positionId The position ID.
    /// @return position The position struct.
    function getPosition(uint256 positionId) external view returns (Position memory position);

    /// @notice Get the total FXRP deposited in the vault.
    /// @return totalFxrp The total FXRP amount.
    function getTotalFxrpDeposited() external view returns (uint256 totalFxrp);

    /// @notice Get the number of active positions.
    /// @return count The active position count.
    function getActivePositionCount() external view returns (uint256 count);

    /// @notice Revalue all positions using the current FTSO price.
    function revalueAllPositions() external;

    /// @notice Get the vault configuration.
    /// @return config The vault config struct.
    function getConfig() external view returns (VaultConfig memory config);
}
```

### PolicyRegistry

Stores risk policy parameters for each vault. Policies define the constraints within which the AI risk agent must operate, including drawdown limits, exposure caps, hedge thresholds, and the actions to take on risk breach or solvency warning. Three default policies are provided: Conservative (15% drawdown, 40% exposure), Balanced (25% drawdown, 60% exposure), and Aggressive (40% drawdown, 80% exposure).

**Deployed on Coston2**: `0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5` (5,133 bytes)

```solidity
interface IPolicyRegistry {
    enum RiskLevel { LOW, MEDIUM, HIGH, CRITICAL }
    enum PolicyAction { ALLOW, REQUIRE_APPROVAL, DELAY, BLOCK }

    struct Policy {
        uint256 policyId;
        address owner;
        string name;
        string description;
        RiskLevel riskLevel;
        bool isActive;
        uint256 createdAt;
        uint256 updatedAt;
        uint256 maxDrawdownBps; // Max drawdown in basis points
        uint256 maxSingleExposureBps; // Max single-asset exposure in bps
        uint256 hedgeThresholdBps; // Hedge trigger threshold in bps
        address[] allowedAssets; // Assets allowed in this policy
        uint256 maxDepositPerTx; // Max deposit per transaction
        uint256 maxWithdrawalPerTx; // Max withdrawal per transaction
        uint256 maxTotalExposure; // Max total exposure across all positions
        uint256 minCollateralRatio; // Min collateral ratio (e.g., 15000 = 150%)
        uint256 maxLeverage; // Max leverage factor
        uint256 withdrawalDelaySeconds; // Delay before withdrawal executes
        uint256 rebalanceThresholdBps; // Rebalance trigger threshold in bps
        uint256 maxSlippageBps; // Max allowed slippage in bps
        PolicyAction onRiskBreach; // Action when risk threshold breached
        PolicyAction onSolvencyWarning; // Action when solvency warning triggered
    }

    /// @notice Set a policy (owner only).
    function setPolicy(uint256 policyId, Policy calldata p) external;

    /// @notice Get a policy by ID.
    function getPolicy(uint256 policyId) external view returns (Policy memory policy);

    /// @notice Create a new policy.
    function createPolicy(...) external returns (uint256 policyId);

    /// @notice Update a policy field.
    function updatePolicy(uint256 policyId, string calldata fieldChanged) external;

    /// @notice Activate or deactivate a policy.
    function setPolicyStatus(uint256 policyId, bool isActive) external;

    /// @notice Assign a policy to a depositor.
    function assignPolicy(uint256 policyId, address depositor) external;

    /// @notice Get the policy assigned to a depositor.
    function getPolicyForDepositor(address depositor) external view returns (Policy memory policy);

    /// @notice Check if an action is allowed under a policy.
    function checkAction(uint256 policyId, uint8 actionType, uint256 amount)
        external view returns (bool allowed, PolicyAction action);

    /// @notice Get the total number of policies.
    function getPolicyCount() external view returns (uint256 count);

    /// @notice Validate a deposit against policy limits.
    function validateDeposit(uint256 policyId, uint256 depositAmount, uint256 currentTotalExposure)
        external view returns (bool isValid);

    /// @notice Validate a withdrawal against policy limits.
    function validateWithdrawal(uint256 policyId, uint256 withdrawalAmount, uint256 currentPositionValue)
        external view returns (bool isValid);
}
```

### SolvencyRoot

Receives the Merkle root of solvency computed inside the TEE and makes it verifiable on-chain. Stores the current proof and proof history. Provides `isSolvent()` which returns a boolean and the current collateral ratio, `getCurrentSolvencyProof()` which returns the full proof struct, and `verifyPosition()` for individual position inclusion verification. The proof asserts that total collateral exceeds total liabilities by a stated margin, without revealing individual position amounts.

**Deployed on Coston2**: `0xf52c1fd632d853ee46a48a82064d3f5d390f057d` (4,277 bytes)

```solidity
interface ISolvencyRoot {
    struct SolvencyProof {
        bytes32 merkleRoot;
        uint256 surplusBps; // Surplus over liabilities in basis points
        uint256 totalFxrpCollateral; // Total FXRP collateral
        uint256 totalLiabilities; // Total liabilities
        uint256 collateralRatio; // Collateral ratio (e.g., 14000 = 140%)
        uint256 timestamp; // When the proof was computed
        uint256 votingRound; // FDC voting round when proof was published
        address attestor; // Address that published the proof
        bool isValid; // Whether the proof is currently valid
    }

    /// @notice Publish a new solvency Merkle root.
    function publishRoot(bytes32 root, uint256 surplusBps) external;

    /// @notice Verify a Merkle proof against the current root.
    function verifySolvency(bytes32[] calldata proof, bytes32 leaf)
        external view returns (bool isValid);

    /// @notice Publish a full solvency proof with all fields.
    function publishSolvencyProof(
        bytes32 merkleRoot,
        uint256 totalFxrpCollateral,
        uint256 totalLiabilities,
        uint256 collateralRatio,
        uint256 votingRound
    ) external;

    /// @notice Verify that a specific position is included in the Merkle tree.
    function verifyPosition(
        uint256 positionId,
        address depositor,
        uint256 fxrpAmount,
        uint256 usdValuation,
        bytes32[] calldata merkleProof
    ) external view returns (bool isValid);

    /// @notice Get the current solvency proof.
    function getCurrentSolvencyProof() external view returns (SolvencyProof memory proof);

    /// @notice Get a solvency proof by its Merkle root.
    function getSolvencyProof(bytes32 merkleRoot) external view returns (SolvencyProof memory proof);

    /// @notice Check if the vault is solvent and get the collateral ratio.
    function isSolvent() external view returns (bool isSolvent, uint256 collateralRatio);

    /// @notice Get the last N solvency proofs for history.
    function getSolvencyHistory(uint256 count) external view returns (SolvencyProof[] memory proofs);

    /// @notice Invalidate a solvency proof (e.g., if attestation fails).
    function invalidateSolvencyProof(bytes32 merkleRoot, string calldata reason) external;

    /// @notice Get the minimum collateral ratio threshold.
    function getMinCollateralRatio() external view returns (uint256 threshold);

    /// @notice Set the minimum collateral ratio threshold.
    function setMinCollateralRatio(uint256 threshold) external;
}
```

### InstructionSender

Sends instructions to the FCC extension via the TeeExtensionRegistry contract. Handles deposit attestation requests, rebalance instructions, solvency computation requests, and payment/redeem/settle operations. Each instruction has a lifecycle: PENDING -> SUBMITTED -> CONFIRMED or FAILED or CANCELLED.

**Deployed on Coston2**: `0xb175f16e1cea66360e354db4b178c04c69363c06` (6,733 bytes)

```solidity
interface IInstructionSender {
    enum InstructionType { PAYMENT, REDEEM, REBALANCE, EMERGENCY_TRANSFER, SETTLE_LIABILITY }
    enum InstructionStatus { PENDING, SUBMITTED, CONFIRMED, FAILED, CANCELLED }

    struct Instruction {
        uint256 instructionId;
        InstructionType instrType;
        address initiator;
        uint256 positionId;
        uint256 amount;
        address destination;
        uint256 createdAt;
        uint256 executedAt;
        InstructionStatus status;
        bytes32 xrplTxHash;
        bytes pmwInstruction;
    }

    /// @notice Send a raw instruction payload to the FCC extension.
    function sendInstruction(bytes calldata payload) external;

    /// @notice Get the response for an instruction.
    function getResponse(bytes32 instructionId) external view returns (bytes memory response);

    /// @notice Create a new instruction with typed parameters.
    function createInstruction(
        InstructionType instrType,
        uint256 positionId,
        uint256 amount,
        address destination
    ) external returns (uint256 instructionId);

    /// @notice Submit a pending instruction to the FCC extension.
    function submitInstruction(uint256 instructionId) external;

    /// @notice Confirm an instruction with the XRPL transaction hash.
    function confirmInstruction(uint256 instructionId, bytes32 xrplTxHash) external;

    /// @notice Cancel a pending instruction.
    function cancelInstruction(uint256 instructionId, string calldata reason) external;

    /// @notice Mark an instruction as failed.
    function failInstruction(uint256 instructionId, string calldata reason) external;

    /// @notice Get an instruction by ID.
    function getInstruction(uint256 instructionId) external view returns (Instruction memory instruction);

    /// @notice Get all instructions with a given status.
    function getInstructionsByStatus(InstructionStatus status)
        external view returns (Instruction[] memory instructions);

    /// @notice Get the total number of instructions.
    function getInstructionCount() external view returns (uint256 count);

    /// @notice Get the PMW project ID for this vault.
    function getPMWProjectId() external view returns (uint256 projectId);

    /// @notice Set the PMW project ID.
    function setPMWProjectId(uint256 projectId) external;
}
```

### VerifierRole

Access control for auditor verification functions. Only addresses with the verifier role can call certain read functions on SolvencyRoot and FDCAttestor that are restricted to auditors. Also manages TEE identity registration and signature verification. Implements four roles: DEFAULT_ADMIN, VERIFIER, OPERATOR, and DEPOSITOR.

**Deployed on Coston2**: `0xb513516d02d88be754c5204e132defbb0f4156e6` (NOTE: 0 bytes code -- needs redeployment)

```solidity
interface IVerifierRole {
    enum Role { DEFAULT_ADMIN, VERIFIER, OPERATOR, DEPOSITOR }

    struct RoleAssignment {
        address account;
        Role role;
        address assignedBy;
        uint256 assignedAt;
        bool isActive;
    }

    /// @notice Check if an account has a specific role.
    function hasRole(Role role, address account) external view returns (bool hasRole);

    /// @notice Grant a role to an account.
    function grantRole(Role role, address account) external;

    /// @notice Revoke a role from an account.
    function revokeRole(Role role, address account) external;

    /// @notice Register a verifier with their TEE identity.
    function registerVerifier(address verifier, bytes32 teeIdentity) external;

    /// @notice Verify a signature from a registered verifier.
    function verifySignature(
        address verifier,
        bytes32 messageHash,
        bytes calldata signature
    ) external view returns (bool isValid);

    /// @notice Get the TEE identity of a verifier.
    function getVerifierTeeIdentity(address verifier) external view returns (bytes32 teeIdentity);

    /// @notice Get all members of a role.
    function getRoleMembers(Role role) external view returns (address[] memory accounts);

    /// @notice Get the number of members of a role.
    function getRoleMemberCount(Role role) external view returns (uint256 count);

    /// @notice Check if an account has a verified TEE identity.
    function isVerifiedTEE(address account) external view returns (bool isVerified);
}
```

### FDCAttestor

Requests and verifies FDC XRPPayment attestations on Coston2. Integrates with FdcHub (v1) and FdcVerification for attestation request submission and proof verification. Tracks verified payments by transaction ID and emits events for attestation lifecycle tracking. Uses FDC v1 only (FdcHub + FdcVerification).

**Deployed on Coston2**: `0x266a9537eaa76264c926541a77c2705f659ba4f1` (3,411 bytes)

```solidity
interface IFDCAttestor {
    /// @notice Get the current voting round ID from FlareSystemsManager.
    function getCurrentVotingRound() external view returns (uint256);

    /// @notice Get the FDC Merkle root for a given voting round.
    function getMerkleRoot(uint256 _votingRoundId) external view returns (bytes32);

    /// @notice Get the attestation request fee for a given request.
    function getRequestFee(bytes calldata _abiEncodedRequest) external view returns (uint256);

    /// @notice Request an XRPPayment attestation from the FDC.
    /// @param _abiEncodedRequest The ABI-encoded attestation request.
    /// @return _attestationType The attestation type returned by the FDC hub.
    /// @return _votingRoundId The voting round in which the request will be processed.
    function requestAttestation(bytes calldata _abiEncodedRequest)
        external payable returns (bytes32 _attestationType, uint256 _votingRoundId);

    /// @notice Verify a Payment attestation proof and store the result.
    /// @param _proof The Payment proof containing Merkle proof and attestation data.
    /// @return True if the proof is valid and the payment was stored.
    function verifyAndStorePayment(IPayment.Proof calldata _proof) external returns (bool);

    /// @notice Check if a payment has been verified.
    function isPaymentVerified(bytes32 _transactionId) external view returns (bool);

    /// @notice Get a verified payment's details.
    function getVerifiedPayment(bytes32 _transactionId)
        external view returns (IPayment.ResponseBody memory);
}
```

### PMWInstructionRelay

Relays Aegis vault instructions to the FCC Diamond (FlareTeeManager) for PMW XRPL execution. Bridges the Aegis vault system and the FCC Diamond, enabling the RiskAgent to trigger real PMW XRPL transactions on policy breach. Manages PMW wallet project creation, action execution (rebalance, hedge, deleverage, emergency exit), and action lifecycle tracking. Access is restricted to addresses with the VERIFIER or DEFAULT_ADMIN role.

**Deployed on Coston2**: `0xce23e1a26c41eaa305f69d9150d9ac82d8b30743` (4,931 bytes)

```solidity
interface IPMWInstructionRelay {
    struct PMWAction {
        uint256 actionId;
        uint8 actionType; // 0=rebalance, 1=hedge, 2=deleverage, 3=emergency_exit
        uint256 amount;
        address destination;
        bytes32 instructionId;
        bytes32 xrplTxHash;
        uint8 status; // 0=pending, 1=submitted, 2=confirmed, 3=failed
        uint256 createdAt;
        uint256 confirmedAt;
    }

    /// @notice Initialize the PMW system (create project + wallet).
    /// @param _extensionId The extension ID for the PMW wallet project.
    function initializePMW(uint256 _extensionId) external returns (bytes32);

    /// @notice Execute an action via PMW on XRPL.
    /// @param _actionType 0=rebalance, 1=hedge, 2=deleverage, 3=emergency_exit
    /// @param _amount The amount to execute.
    /// @param _destination The destination address on XRPL.
    function executeAction(uint8 _actionType, uint256 _amount, address _destination)
        external returns (uint256);

    /// @notice Confirm a PMW action with the XRPL transaction hash.
    function confirmAction(uint256 _actionId, bytes32 _xrplTxHash) external;

    /// @notice Mark a PMW action as failed.
    function failAction(uint256 _actionId, string calldata _reason) external;

    /// @notice Get an action by ID.
    function getAction(uint256 _actionId) external view returns (PMWAction memory);

    /// @notice Get the total number of actions.
    function getActionCount() external view returns (uint256);

    /// @notice Check if PMW is initialized.
    function isPMWReady() external view returns (bool);

    /// @notice Get PMW system info (projectId, walletId, initialized, stats).
    function getPMWInfo() external view returns (
        bytes32 projectId,
        bytes32 walletId,
        bool initialized,
        uint256 actionsExecuted,
        uint256 transactionsConfirmed
    );
}
```

## FCC Extension HTTP API

The extension exposes two HTTP endpoints inside the TEE. The FCC proxy watches for on-chain instructions, forwards them to the TEE extension, and exposes the results.

### POST /action

Receives instructions from the TEE infrastructure. The proxy calls this endpoint when an instruction arrives on-chain via the TeeExtensionRegistry.

**Request**:
```json
{
  "opType": "AEGIS_VAULT",
  "opCommand": "COMPUTE_POSITION",
  "message": "...
}
```

**Supported opCommand values**:
- `COMPUTE_POSITION` -- Rebuilds the vault state from on-chain events and FDC-attested external state, computes the Merkle root
- `COMPUTE_SOLVENCY` -- Runs the SolvencyAttestor, computes the solvency proof, publishes on-chain
- `RISK_EVALUATE` -- Runs the XGBoost risk scoring model and Policy Engine
- `EXECUTE_ACTION` -- Routes an approved action to PMW for cross-chain execution

### GET /state

Returns the current extension state including vault count, total deposits, and the last published solvency root.

**Response**:
```json
{
  "stateVersion": "0x...",
  "state": {
    "vaultCount": 1,
    "totalDeposits": "1000000000000000000",
    "lastSolvencyRoot": "0x...",
    "riskScore": 50,
    "collateralRatio": 14000,
    "lastVotingRound": 1415258
  }
}
```

### GET /info

Returns the extension health and version information. Used by the deployment verification checklist.

**Response**:
```json
{
  "version": "1.0.0",
  "status": "healthy",
  "teeAttested": true,
  "uptime": "72h
}
```

## TypeScript SDK

The TypeScript SDK (`@aegis/sdk`) provides typed access to all Aegis contracts. It compiles with `tsc --noEmit` and supports both browser and Node.js environments.

### VaultClient

Access vault state, solvency info, risk scores, and positions.

```typescript
import { VaultClient } from '@aegis/sdk';

const vault = new VaultClient({
  rpcUrl: 'https://coston2-api.flare.network/ext/C/rpc',
  vaultAddress: '0xcb08be1cc86d3f94c54c64682372e32f669134bc',
});

// Read vault state
const state = await vault.getState();
const solvency = await vault.getSolvencyInfo();
const riskScore = await vault.getRiskScore();

// Individual reads
const price = await vault.getXrpUsdPrice(); // ~1.07e18 on Coston2
const deposited = await vault.getTotalDeposited(); // 0 FXRP currently
const positionCount = await vault.getActivePositionCount();
const isEmergency = await vault.isEmergencyMode();

// Deposit and withdraw
await vault.depositFXRP(amount, policyId);
await vault.withdraw(amount);

// Verify contracts deployed on-chain
const deployed = await vault.verifyContractsDeployed();
```

### PolicyClient

Set and inspect risk policies, validate actions against policy limits.

```typescript
import { PolicyClient, ActionType, PolicyAction } from '@aegis/sdk';

const policy = new PolicyClient({
  rpcUrl: 'https://coston2-api.flare.network/ext/C/rpc',
  policyRegistryAddress: '0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5',
});

// List all policies (3 default: Conservative, Balanced, Aggressive)
const policies = await policy.listPolicies();
const count = await policy.getPolicyCount(); // 3

// Get individual policy
const p = await policy.getPolicy(1); // Conservative

// Check if action is allowed
const result = await policy.checkAction(1, ActionType.DEPOSIT, 100);
if (result.allowed) {
  console.log('Deposit allowed');
} else {
  console.log(`Blocked: ${policy.getActionName(result.action)}`);
}

// Validate deposit/withdrawal against policy limits
const validDeposit = await policy.validateDeposit(1, depositAmount, currentTotalExposure);
const validWithdrawal = await policy.validateWithdrawal(1, withdrawalAmount, currentPositionValue);
```

### AuditClient

Request and verify solvency attestations without seeing individual positions. This is the confidentiality-to-verifiability transformation in action.

```typescript
import { AuditClient } from '@aegis/sdk';

const audit = new AuditClient({
  rpcUrl: 'https://coston2-api.flare.network/ext/C/rpc',
  solvencyRootAddress: '0xf52c1fd632d853ee46a48a82064d3f5d390f057d',
});

// Current proof
const proof = await audit.getCurrentProof();
console.log(`Merkle Root: ${proof.merkleRoot}`);
console.log(`Collateral Ratio: ${proof.collateralRatio}%`);

// Check solvency
const { isSolvent, collateralRatio } = await audit.isSolvent();
// Currently returns: isSolvent=false, collateralRatio=14000 (140%)

// Verify proof on-chain
const result = await audit.verifyProof(proof.merkleRoot);

// FDC attestation infrastructure
const fdcStatus = await audit.getFdcStatus();

// Proof history
const history = await audit.getProofHistory();
```

### Unified AegisSDK

For convenience, all clients are also available through a single `AegisSDK` class:

```typescript
import { AegisSDK } from '@aegis/sdk';

// Default: Coston2 testnet
const sdk = new AegisSDK();

// Custom configuration
const sdk2 = new AegisSDK({
  rpcUrl: 'https://coston2-api.flare.network/ext/C/rpc',
  fccProxyUrl: 'http://localhost:8080',
  network: 'coston2',
});

// Access all clients through the SDK
const vaultState = await sdk.vault.getState();
const policies = await sdk.policy.listPolicies();
const proof = await sdk.audit.getCurrentProof();
```
