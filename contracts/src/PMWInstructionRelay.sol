// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./interfaces/pmw/IExtensionManagerFacet.sol";
import "./interfaces/pmw/IWalletProjectManagerFacet.sol";
import "./interfaces/pmw/IWalletManagerFacet.sol";
import "./interfaces/vault/IInstructionSender.sol";
import "./interfaces/vault/IVerifierRole.sol";

/// @title PMWInstructionRelay
/// @notice Relays Aegis vault instructions to the FCC Diamond for PMW XRPL execution.
///
/// PMW integration: wire ActionExecutor to PMW for XRPL execution.
/// 
///
/// RiskAgent → propose action → InstructionSender → policy check → PMW → XRPL
///
/// This contract bridges the Aegis vault system and the FCC Diamond, enabling
/// the RiskAgent to trigger real PMW XRPL transactions on policy breach.
///
/// Flow:
/// 1. RiskAgent detects policy breach
/// 2. ActionExecutor validates action against PolicyEngine
/// 3. ActionExecutor calls PMWInstructionRelay.executeAction()
/// 4. PMWInstructionRelay submits instruction to FCC Diamond
/// 5. TEE machines sign and execute the XRPL transaction
/// 6. FDC attestation confirms the transaction on XRPL
contract PMWInstructionRelay {
    // ─── State Variables ──────────────────────────────────────────────────

    /// @notice The FCC Diamond address on Coston2.
    address public immutable FCC_DIAMOND;

    /// @notice The InstructionSender contract for Aegis vault.
    IInstructionSender public instructionSender;

    /// @notice The VerifierRole contract for access control.
    IVerifierRole public verifierRole;

    /// @notice The PMW wallet project ID.
    bytes32 public pmwProjectId;

    /// @notice The PMW wallet ID for XRPL execution.
    bytes32 public pmwWalletId;

    /// @notice Whether the PMW system is initialized.
    bool public pmwInitialized;

    /// @notice Total number of actions executed via PMW.
    uint256 public totalActionsExecuted;

    /// @notice Total number of PMW transactions confirmed.
    uint256 public totalPMWTransactionsConfirmed;

    /// @notice Mapping from action ID => PMW action result.
    mapping(uint256 => PMWAction) private _actions;

    /// @notice Next action ID.
    uint256 private _nextActionId;

    // ─── Data Types ───────────────────────────────────────────────────────

    /// @notice Represents a PMW action with its lifecycle.
    struct PMWAction {
        uint256 actionId;
        uint8 actionType;      // 0=rebalance, 1=hedge, 2=deleverage, 3=emergency_exit
        uint256 amount;
        address destination;
        bytes32 instructionId;
        bytes32 xrplTxHash;
        uint8 status;          // 0=pending, 1=submitted, 2=confirmed, 3=failed
        uint256 createdAt;
        uint256 confirmedAt;
    }

    // ─── Events ───────────────────────────────────────────────────────────

    event PMWActionCreated(uint256 indexed actionId, uint8 actionType, uint256 amount, address destination);
    event PMWActionSubmitted(uint256 indexed actionId, bytes32 instructionId);
    event PMWActionConfirmed(uint256 indexed actionId, bytes32 xrplTxHash);
    event PMWActionFailed(uint256 indexed actionId, string reason);
    event PMWProjectCreated(bytes32 projectId, uint256 extensionId);
    event PMWWalletCreated(bytes32 walletId, bytes32 projectId);
    event PMWWalletEnabled(bytes32 walletId);
    event PMWSystemInitialized(bytes32 projectId, bytes32 walletId);

    // ─── Modifiers ────────────────────────────────────────────────────────

    modifier onlyVerifier() {
        require(
            verifierRole.hasRole(IVerifierRole.Role.VERIFIER, msg.sender) ||
            verifierRole.hasRole(IVerifierRole.Role.DEFAULT_ADMIN, msg.sender),
            "PMWInstructionRelay: caller is not verifier"
        );
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────

    constructor(
        address _fccDiamond,
        address _instructionSender,
        address _verifierRole
    ) {
        require(_fccDiamond != address(0), "FCC diamond cannot be zero");
        require(_instructionSender != address(0), "InstructionSender cannot be zero");
        require(_verifierRole != address(0), "VerifierRole cannot be zero");

        FCC_DIAMOND = _fccDiamond;
        instructionSender = IInstructionSender(_instructionSender);
        verifierRole = IVerifierRole(_verifierRole);
        _nextActionId = 1;
    }

    // ─── PMW System Initialization ────────────────────────────────────────

    /// @notice Initializes the PMW system by querying capabilities and creating a wallet project.
    /// @param _extensionId The extension ID for the PMW wallet project.
    function initializePMW(uint256 _extensionId) external onlyVerifier returns (bytes32) {
        require(!pmwInitialized, "PMW already initialized");

        // Step 1: Query PMW system capabilities
        IExtensionManagerFacet em = IExtensionManagerFacet(FCC_DIAMOND);
        bytes32[] memory keyTypes = em.getSystemSupportedKeyTypes();

        bool xrpSupported = false;
        for (uint256 i = 0; i < keyTypes.length; i++) {
            if (keyTypes[i] == bytes32("XRP")) {
                xrpSupported = true;
                break;
            }
        }
        require(xrpSupported, "XRP key type not supported on this network");

        // Step 2: Create a wallet project
        IWalletProjectManagerFacet pm = IWalletProjectManagerFacet(FCC_DIAMOND);
        bytes32 projectId = pm.createProject(_extensionId, bytes32("XRP"), bytes32("sha512half-secp256k1-ecdsa"));

        pmwProjectId = projectId;
        emit PMWProjectCreated(projectId, _extensionId);

        // Step 3: Create a wallet
        IWalletManagerFacet wm = IWalletManagerFacet(FCC_DIAMOND);
        wm.createWallet(projectId);

        // Get the wallet ID
        bytes32[] memory walletIds = wm.getProjectWalletIds(projectId);
        bytes32 walletId = walletIds[walletIds.length - 1];

        pmwWalletId = walletId;
        emit PMWWalletCreated(walletId, projectId);

        // Step 4: Enable the wallet
        wm.enableWallet(walletId);
        emit PMWWalletEnabled(walletId);

        pmwInitialized = true;
        emit PMWSystemInitialized(projectId, walletId);

        return projectId;
    }

    // ─── Action Execution ─────────────────────────────────────────────────

    /// @notice Executes an action via PMW on XRPL.
    /// @param _actionType The type of action (0=rebalance, 1=hedge, 2=deleverage, 3=emergency_exit).
    /// @param _amount The amount to execute.
    /// @param _destination The destination address on XRPL.
    /// @dev When PMW is not initialized, the action is still submitted via the InstructionSender
    /// for on-chain tracking. The TEE extension will handle the actual PMW execution.
    function executeAction(
        uint8 _actionType,
        uint256 _amount,
        address _destination
    ) external onlyVerifier returns (uint256) {
        require(_amount > 0, "Amount must be greater than zero");
        require(_destination != address(0), "Destination cannot be zero");

        uint256 actionId = _nextActionId++;

        PMWAction storage action = _actions[actionId];
        action.actionId = actionId;
        action.actionType = _actionType;
        action.amount = _amount;
        action.destination = _destination;
        action.status = 0; // pending
        action.createdAt = block.timestamp;

        emit PMWActionCreated(actionId, _actionType, _amount, _destination);

        // Submit the instruction to the InstructionSender
        bytes memory payload = abi.encode(
            IInstructionSender.InstructionType(_actionType),
            uint256(0), // position ID
            _amount,
            _destination
        );

        try instructionSender.sendInstruction(payload) {
            action.status = 1; // submitted
            emit PMWActionSubmitted(actionId, bytes32(actionId));
        } catch Error(string memory reason) {
            action.status = 3; // failed
            emit PMWActionFailed(actionId, reason);
            return actionId;
        }

        totalActionsExecuted++;

        return actionId;
    }

    /// @notice Confirms a PMW action with the XRPL transaction hash.
    /// @param _actionId The action ID to confirm.
    /// @param _xrplTxHash The XRPL transaction hash.
    function confirmAction(uint256 _actionId, bytes32 _xrplTxHash) external onlyVerifier {
        require(_actions[_actionId].actionId != 0, "Action not found");
        require(_actions[_actionId].status == 1, "Action not submitted");
        require(_xrplTxHash != bytes32(0), "XRPL tx hash cannot be zero");

        _actions[_actionId].status = 2; // confirmed
        _actions[_actionId].xrplTxHash = _xrplTxHash;
        _actions[_actionId].confirmedAt = block.timestamp;

        totalPMWTransactionsConfirmed++;

        emit PMWActionConfirmed(_actionId, _xrplTxHash);
    }

    /// @notice Marks a PMW action as failed.
    /// @param _actionId The action ID to mark as failed.
    /// @param _reason The failure reason.
    function failAction(uint256 _actionId, string calldata _reason) external onlyVerifier {
        require(_actions[_actionId].actionId != 0, "Action not found");
        require(_actions[_actionId].status <= 1, "Action already confirmed or failed");

        _actions[_actionId].status = 3; // failed

        emit PMWActionFailed(_actionId, _reason);
    }

    // ─── View Functions ───────────────────────────────────────────────────

    /// @notice Gets an action by ID.
    function getAction(uint256 _actionId) external view returns (PMWAction memory) {
        require(_actions[_actionId].actionId != 0, "Action not found");
        return _actions[_actionId];
    }

    /// @notice Gets the total number of actions.
    function getActionCount() external view returns (uint256) {
        return _nextActionId - 1;
    }

    /// @notice Checks if the PMW system is initialized.
    function isPMWReady() external view returns (bool) {
        return pmwInitialized;
    }

    /// @notice Gets the PMW system info.
    function getPMWInfo() external view returns (
        bytes32 projectId,
        bytes32 walletId,
        bool initialized,
        uint256 actionsExecuted,
        uint256 transactionsConfirmed
    ) {
        return (
            pmwProjectId,
            pmwWalletId,
            pmwInitialized,
            totalActionsExecuted,
            totalPMWTransactionsConfirmed
        );
    }
}
