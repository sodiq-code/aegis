// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IInstructionSender
/// @notice Sends cross-chain instructions to the XRPL via Flare PMW (Protocol Managed Wallets).
///         The InstructionSender is the gateway for Aegis to execute rebalancing,
///         redemptions, and other operations on the XRPL through PMW-managed wallets.
/// @dev Instructions are signed by the FCC extension's ActionExecutor within the TEE,
///      and then submitted to the PMW diamond for execution on the XRPL.
///      The PMW diamond on Coston2 is at 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE.
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

    // --- Functions ---

    /// @notice Create a new instruction
    /// @param instrType Type of instruction
    /// @param positionId Associated vault position
    /// @param amount Amount in UBA
    /// @param destination Destination address on XRPL
    /// @return instructionId The ID of the newly created instruction
    function createInstruction(
        InstructionType instrType,
        uint256 positionId,
        uint256 amount,
        address destination
    ) external returns (uint256 instructionId);

    /// @notice Submit an instruction to PMW for execution
    /// @param instructionId The instruction to submit
    function submitInstruction(uint256 instructionId) external;

    /// @notice Confirm an instruction after XRPL execution
    /// @param instructionId The instruction to confirm
    /// @param xrplTxHash The XRPL transaction hash
    function confirmInstruction(uint256 instructionId, bytes32 xrplTxHash) external;

    /// @notice Cancel a pending instruction
    /// @param instructionId The instruction to cancel
    /// @param reason The reason for cancellation
    function cancelInstruction(uint256 instructionId, string calldata reason) external;

    /// @notice Mark an instruction as failed
    /// @param instructionId The instruction that failed
    /// @param reason The reason for failure
    function failInstruction(uint256 instructionId, string calldata reason) external;

    /// @notice Get an instruction by ID
    /// @param instructionId The instruction ID
    /// @return instruction The instruction data
    function getInstruction(uint256 instructionId) external view returns (Instruction memory instruction);

    /// @notice Get instructions by status
    /// @param status The status to filter by
    /// @return instructions Array of instructions with the given status
    function getInstructionsByStatus(InstructionStatus status) external view returns (Instruction[] memory instructions);

    /// @notice Get the total number of instructions
    /// @return count Number of instructions
    function getInstructionCount() external view returns (uint256 count);

    /// @notice Get the PMW wallet project ID
    /// @return projectId The PMW wallet project ID
    function getPMWProjectId() external view returns (uint256 projectId);

    /// @notice Set the PMW wallet project ID
    /// @param projectId The new PMW wallet project ID
    function setPMWProjectId(uint256 projectId) external;
}
