// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IInstructionSender
/// @notice Sends cross-chain instructions to the XRPL via Flare PMW.
/// API matches the Aegis blueprint exactly:
/// sendInstruction(payload), getResponse(instructionId).
/// @dev Instructions are signed by the FCC extension's ActionExecutor within the TEE,
/// and then submitted to the PMW diamond for execution on the XRPL.
interface IInstructionSender {
    // --- Enums ---

    /// @notice Type of instruction to send
    enum InstructionType {
        PAYMENT,            // XRPL payment (e.g., rebalancing transfer)
        REDEEM,             // Redeem FXRP back to XRP
        REBALANCE,          // Move assets between vaults for risk management
        EMERGENCY_TRANSFER, // Emergency transfer of assets
        SETTLE_LIABILITY    // Settle a vault liability
    }

    /// @notice Status of an instruction
    enum InstructionStatus {
        PENDING,            // Instruction is pending submission
        SUBMITTED,          // Instruction submitted to PMW
        CONFIRMED,          // Instruction confirmed on XRPL
        FAILED,             // Instruction failed
        CANCELLED           // Instruction was cancelled
    }

    // --- Structs ---

    /// @notice A cross-chain instruction
    struct Instruction {
        uint256 instructionId;      // Unique instruction identifier
        InstructionType instrType;  // Type of instruction
        address initiator;          // Address that initiated the instruction
        uint256 positionId;         // Associated vault position
        uint256 amount;             // Amount in UBA
        address destination;        // Destination address on XRPL
        uint256 createdAt;          // Creation timestamp
        uint256 executedAt;         // Execution timestamp (0 if not executed)
        InstructionStatus status;   // Current status
        bytes32 xrplTxHash;         // XRPL transaction hash (if confirmed)
        bytes pmwInstruction;       // PMW-encoded instruction data
    }

    // --- Events ---

    /// @notice Emitted when a new instruction is created
    event InstructionCreated(
        uint256 indexed instructionId,
        InstructionType instrType,
        address indexed initiator,
        uint256 amount
    );

    /// @notice Emitted when an instruction is submitted to PMW
    event InstructionSubmitted(
        uint256 indexed instructionId,
        bytes32 pmwTransactionId
    );

    /// @notice Emitted when an instruction is confirmed on XRPL
    event InstructionConfirmed(
        uint256 indexed instructionId,
        bytes32 xrplTxHash
    );

    /// @notice Emitted when an instruction fails
    event InstructionFailed(
        uint256 indexed instructionId,
        string reason
    );

    /// @notice Emitted when an instruction is cancelled
    event InstructionCancelled(
        uint256 indexed instructionId,
        string reason
    );

    // --- Vault API ---

    /// @notice Send an instruction to the FCC extension (vault -> TEE)
    /// @param payload The instruction payload (ABI-encoded)
    function sendInstruction(bytes calldata payload) external;

    /// @notice Get the response for an instruction
    /// @param instructionId The instruction ID
    /// @return response The response data from the FCC extension
    function getResponse(bytes32 instructionId) external view returns (bytes memory response);

    // --- Extended API ---

    /// @notice Create a new instruction
    function createInstruction(
        InstructionType instrType,
        uint256 positionId,
        uint256 amount,
        address destination
    ) external returns (uint256 instructionId);

    /// @notice Submit an instruction to PMW for execution
    function submitInstruction(uint256 instructionId) external;

    /// @notice Confirm an instruction after XRPL execution
    function confirmInstruction(uint256 instructionId, bytes32 xrplTxHash) external;

    /// @notice Cancel a pending instruction
    function cancelInstruction(uint256 instructionId, string calldata reason) external;

    /// @notice Mark an instruction as failed
    function failInstruction(uint256 instructionId, string calldata reason) external;

    /// @notice Get an instruction by ID
    function getInstruction(uint256 instructionId) external view returns (Instruction memory instruction);

    /// @notice Get instructions by status
    function getInstructionsByStatus(InstructionStatus status) external view returns (Instruction[] memory instructions);

    /// @notice Get the total number of instructions
    function getInstructionCount() external view returns (uint256 count);

    /// @notice Get the PMW wallet project ID
    function getPMWProjectId() external view returns (uint256 projectId);

    /// @notice Set the PMW wallet project ID
    function setPMWProjectId(uint256 projectId) external;
}
