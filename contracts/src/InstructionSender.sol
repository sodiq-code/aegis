// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./interfaces/vault/IInstructionSender.sol";
import "./interfaces/vault/IVerifierRole.sol";

/// @title InstructionSender
/// @notice Sends cross-chain instructions to the XRPL via Flare PMW.
contract InstructionSender is IInstructionSender {
    // --- State Variables ---

    /// @notice Mapping from instruction ID => Instruction
    mapping(uint256 => Instruction) private _instructions;

    /// @notice Total number of instructions
    uint256 private _nextInstructionId;

    /// @notice PMW wallet project ID
    uint256 private _pmwProjectId;

    /// @notice VerifierRole contract for access control
    IVerifierRole public verifierRole;

    /// @notice Mapping from status => instruction IDs
    mapping(InstructionStatus => uint256[]) private _instructionsByStatus;

    // --- Modifiers ---

    modifier onlyAdmin() {
        require(
            verifierRole.hasRole(IVerifierRole.Role.DEFAULT_ADMIN, msg.sender),
            "InstructionSender: caller is not admin"
        );
        _;
    }

    modifier onlyVerifier() {
        require(
            verifierRole.hasRole(IVerifierRole.Role.VERIFIER, msg.sender) ||
            verifierRole.hasRole(IVerifierRole.Role.DEFAULT_ADMIN, msg.sender),
            "InstructionSender: caller is not verifier"
        );
        _;
    }

    // --- Constructor ---

    constructor(address _verifierRole) {
        require(_verifierRole != address(0), "InstructionSender: zero address");
        verifierRole = IVerifierRole(_verifierRole);
        _nextInstructionId = 1;
    }

    // --- View Functions ---

    /// @inheritdoc IInstructionSender
    function getInstruction(uint256 instructionId) external view override returns (Instruction memory) {
        require(_instructions[instructionId].initiator != address(0), "InstructionSender: not found");
        return _instructions[instructionId];
    }

    /// @inheritdoc IInstructionSender
    function getInstructionsByStatus(InstructionStatus status)
        external
        view
        override
        returns (Instruction[] memory)
    {
        uint256[] storage ids = _instructionsByStatus[status];
        Instruction[] memory result = new Instruction[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            result[i] = _instructions[ids[i]];
        }
        return result;
    }

    /// @inheritdoc IInstructionSender
    function getInstructionCount() external view override returns (uint256) {
        return _nextInstructionId - 1;
    }

    /// @inheritdoc IInstructionSender
    function getPMWProjectId() external view override returns (uint256) {
        return _pmwProjectId;
    }

    // --- State-Changing Functions ---

    /// @inheritdoc IInstructionSender
    function createInstruction(
        InstructionType instrType,
        uint256 positionId,
        uint256 amount,
        address destination
    ) external override onlyVerifier returns (uint256) {
        require(amount > 0, "InstructionSender: zero amount");
        require(destination != address(0), "InstructionSender: zero destination");

        uint256 instructionId = _nextInstructionId++;

        Instruction storage instr = _instructions[instructionId];
        instr.instructionId = instructionId;
        instr.instrType = instrType;
        instr.initiator = msg.sender;
        instr.positionId = positionId;
        instr.amount = amount;
        instr.destination = destination;
        instr.createdAt = block.timestamp;
        instr.status = InstructionStatus.PENDING;

        _instructionsByStatus[InstructionStatus.PENDING].push(instructionId);

        emit InstructionCreated(instructionId, instrType, msg.sender, amount);

        return instructionId;
    }

    /// @inheritdoc IInstructionSender
    function submitInstruction(uint256 instructionId) external override onlyVerifier {
        Instruction storage instr = _instructions[instructionId];
        require(instr.initiator != address(0), "InstructionSender: not found");
        require(instr.status == InstructionStatus.PENDING, "InstructionSender: not pending");

        _removeFromStatusList(instr.status, instructionId);
        instr.status = InstructionStatus.SUBMITTED;
        _instructionsByStatus[InstructionStatus.SUBMITTED].push(instructionId);

        emit InstructionSubmitted(instructionId, bytes32(0));
    }

    /// @inheritdoc IInstructionSender
    function confirmInstruction(uint256 instructionId, bytes32 xrplTxHash)
        external
        override
        onlyVerifier
    {
        Instruction storage instr = _instructions[instructionId];
        require(instr.initiator != address(0), "InstructionSender: not found");
        require(
            instr.status == InstructionStatus.SUBMITTED,
            "InstructionSender: not submitted"
        );
        require(xrplTxHash != bytes32(0), "InstructionSender: zero tx hash");

        _removeFromStatusList(instr.status, instructionId);
        instr.status = InstructionStatus.CONFIRMED;
        instr.executedAt = block.timestamp;
        instr.xrplTxHash = xrplTxHash;
        _instructionsByStatus[InstructionStatus.CONFIRMED].push(instructionId);

        emit InstructionConfirmed(instructionId, xrplTxHash);
    }

    /// @inheritdoc IInstructionSender
    function cancelInstruction(uint256 instructionId, string calldata reason)
        external
        override
        onlyVerifier
    {
        Instruction storage instr = _instructions[instructionId];
        require(instr.initiator != address(0), "InstructionSender: not found");
        require(
            instr.status == InstructionStatus.PENDING || instr.status == InstructionStatus.SUBMITTED,
            "InstructionSender: cannot cancel"
        );

        _removeFromStatusList(instr.status, instructionId);
        instr.status = InstructionStatus.CANCELLED;
        _instructionsByStatus[InstructionStatus.CANCELLED].push(instructionId);

        emit InstructionCancelled(instructionId, reason);
    }

    /// @inheritdoc IInstructionSender
    function failInstruction(uint256 instructionId, string calldata reason)
        external
        override
        onlyVerifier
    {
        Instruction storage instr = _instructions[instructionId];
        require(instr.initiator != address(0), "InstructionSender: not found");
        require(
            instr.status == InstructionStatus.PENDING || instr.status == InstructionStatus.SUBMITTED,
            "InstructionSender: cannot fail"
        );

        _removeFromStatusList(instr.status, instructionId);
        instr.status = InstructionStatus.FAILED;
        _instructionsByStatus[InstructionStatus.FAILED].push(instructionId);

        emit InstructionFailed(instructionId, reason);
    }

    /// @inheritdoc IInstructionSender
    function setPMWProjectId(uint256 projectId) external override onlyAdmin {
        _pmwProjectId = projectId;
    }

    // --- Internal Functions ---

    function _removeFromStatusList(InstructionStatus status, uint256 instructionId) internal {
        uint256[] storage list = _instructionsByStatus[status];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == instructionId) {
                list[i] = list[list.length - 1];
                list.pop();
                break;
            }
        }
    }
}
