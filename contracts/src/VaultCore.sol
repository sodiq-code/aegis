// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./interfaces/vault/IVaultCore.sol";
import "./interfaces/vault/IPolicyRegistry.sol";
import "./interfaces/vault/ISolvencyRoot.sol";
import "./interfaces/vault/IVerifierRole.sol";
import "./interfaces/fassets/IFlareContractRegistry.sol";
import "./interfaces/fassets/IAssetManager.sol";
import "./interfaces/fassets/IFXRP.sol";

/// @title VaultCore
/// @notice Core vault contract for Aegis — manages FXRP deposits, withdrawals,
///         and collateral tracking using Flare FAssets and FTSO price feeds.
/// @dev This is the primary entry point for institutional depositors.
///      All FXRP deposits are tracked as collateral positions with FTSO-denominated
///      valuations. The vault enforces policy constraints from PolicyRegistry.
contract VaultCore is IVaultCore {
    // --- State Variables ---

    VaultConfig public config;

    /// @notice Array of all positions
    mapping(uint256 => Position) private _positions;

    /// @notice Total number of positions (including inactive)
    uint256 private _nextPositionId;

    /// @notice Total FXRP deposited in the vault
    uint256 private _totalFxrpDeposited;

    /// @notice Number of active positions
    uint256 private _activePositionCount;

    /// @notice Mapping from depositor => position IDs
    mapping(address => uint256[]) private _depositorPositions;

    /// @notice VerifierRole contract for access control
    IVerifierRole public verifierRole;

    /// @notice FlareContractRegistry for resolving FAssets addresses
    IFlareContractRegistry public flareRegistry;

    // --- Modifiers ---

    modifier onlyAdmin() {
        require(verifierRole.hasRole(IVerifierRole.Role.DEFAULT_ADMIN, msg.sender),
            "VaultCore: caller is not admin");
        _;
    }

    modifier onlyVerifier() {
        require(
            verifierRole.hasRole(IVerifierRole.Role.VERIFIER, msg.sender) ||
            verifierRole.hasRole(IVerifierRole.Role.DEFAULT_ADMIN, msg.sender),
            "VaultCore: caller is not verifier"
        );
        _;
    }

    modifier onlyDepositorOrAdmin(uint256 positionId) {
        require(
            _positions[positionId].depositor == msg.sender ||
            verifierRole.hasRole(IVerifierRole.Role.DEFAULT_ADMIN, msg.sender),
            "VaultCore: caller is not position owner or admin"
        );
        _;
    }

    // --- Constructor ---

    constructor(
        address _flareRegistry,
        address _verifierRole,
        address _policyRegistry,
        address _solvencyRoot,
        address _instructionSender,
        uint256 _minDepositAmount,
        uint256 _maxDepositAmount
    ) {
        require(_flareRegistry != address(0), "VaultCore: zero registry address");
        require(_verifierRole != address(0), "VaultCore: zero verifier role address");

        flareRegistry = IFlareContractRegistry(_flareRegistry);
        verifierRole = IVerifierRole(_verifierRole);
        _nextPositionId = 1;

        // Resolve FAssets addresses from the registry
        address assetManager = flareRegistry.getContractAddressByName("AssetManagerFXRP");
        require(assetManager != address(0), "VaultCore: AssetManagerFXRP not found");

        IAssetManager am = IAssetManager(assetManager);
        address fxrpToken = am.fAsset();
        require(fxrpToken != address(0), "VaultCore: FXRP token not found");

        address ftsoV2 = flareRegistry.getContractAddressByName("FtsoV2");

        config = VaultConfig({
            assetManagerFXRP: assetManager,
            fxrpToken: fxrpToken,
            ftsoV2: ftsoV2,
            policyRegistry: _policyRegistry,
            solvencyRoot: _solvencyRoot,
            instructionSender: _instructionSender,
            minDepositAmount: _minDepositAmount,
            maxDepositAmount: _maxDepositAmount,
            withdrawalWaitPeriod: 86400 // 1 day default
        });
    }

    // --- View Functions ---

    /// @inheritdoc IVaultCore
    function getConfig() external view override returns (VaultConfig memory) {
        return config;
    }

    /// @inheritdoc IVaultCore
    function getPosition(uint256 positionId) external view override returns (Position memory) {
        require(_positions[positionId].depositor != address(0), "VaultCore: position does not exist");
        return _positions[positionId];
    }

    /// @inheritdoc IVaultCore
    function getTotalFxrpDeposited() external view override returns (uint256) {
        return _totalFxrpDeposited;
    }

    /// @inheritdoc IVaultCore
    function getActivePositionCount() external view override returns (uint256) {
        return _activePositionCount;
    }

    /// @inheritdoc IVaultCore
    function getXrpUsdPrice() public view override returns (uint256) {
        // In production, this would read from FTSO V2
        // For now, return a placeholder that can be overridden by the verifier
        return 0;
    }

    /// @inheritdoc IVaultCore
    function getTotalValuation() external view override returns (uint256) {
        uint256 price = getXrpUsdPrice();
        if (price == 0) return 0;
        // totalFxrpDeposited is in UBA (6 decimals), price is in USD (5 decimals)
        // USD valuation = (totalFxrpDeposited * price) / 10^6
        return (_totalFxrpDeposited * price) / 1e6;
    }

    // --- State-Changing Functions ---

    /// @inheritdoc IVaultCore
    function deposit(uint256 fxrpAmount) external override returns (uint256) {
        require(fxrpAmount >= config.minDepositAmount, "VaultCore: below minimum deposit");
        require(fxrpAmount <= config.maxDepositAmount, "VaultCore: exceeds maximum deposit");

        // Transfer FXRP from depositor to vault
        IFXRP fxrp = IFXRP(config.fxrpToken);
        require(
            fxrp.transferFrom(msg.sender, address(this), fxrpAmount),
            "VaultCore: FXRP transfer failed"
        );

        // Create position
        uint256 positionId = _nextPositionId++;
        uint256 usdValuation = 0;
        uint256 price = getXrpUsdPrice();
        if (price > 0) {
            usdValuation = (fxrpAmount * price) / 1e6;
        }

        Position storage position = _positions[positionId];
        position.depositor = msg.sender;
        position.fxrpAmount = fxrpAmount;
        position.depositTimestamp = block.timestamp;
        position.lastValuation = usdValuation;
        position.isActive = true;

        _totalFxrpDeposited += fxrpAmount;
        _activePositionCount++;
        _depositorPositions[msg.sender].push(positionId);

        // Validate deposit against policy
        if (config.policyRegistry != address(0)) {
            IPolicyRegistry policy = IPolicyRegistry(config.policyRegistry);
            uint256 policyId = _getDepositorPolicyId(msg.sender);
            if (policyId > 0) {
                require(
                    policy.validateDeposit(policyId, fxrpAmount, _totalFxrpDeposited),
                    "VaultCore: deposit violates policy"
                );
            }
        }

        emit DepositMade(msg.sender, fxrpAmount, usdValuation, positionId);

        return positionId;
    }

    /// @inheritdoc IVaultCore
    function initiateWithdrawal(uint256 positionId, uint256 fxrpAmount) external override {
        Position storage position = _positions[positionId];
        require(position.depositor == msg.sender, "VaultCore: not position owner");
        require(position.isActive, "VaultCore: position not active");
        require(fxrpAmount <= position.fxrpAmount, "VaultCore: insufficient balance");
        require(
            block.timestamp >= position.depositTimestamp + config.withdrawalWaitPeriod,
            "VaultCore: withdrawal wait period not elapsed"
        );

        // Validate withdrawal against policy
        if (config.policyRegistry != address(0)) {
            IPolicyRegistry policy = IPolicyRegistry(config.policyRegistry);
            uint256 policyId = _getDepositorPolicyId(msg.sender);
            if (policyId > 0) {
                require(
                    policy.validateWithdrawal(policyId, fxrpAmount, position.lastValuation),
                    "VaultCore: withdrawal violates policy"
                );
            }
        }

        emit WithdrawalInitiated(msg.sender, fxrpAmount, positionId);
    }

    /// @inheritdoc IVaultCore
    function completeWithdrawal(uint256 positionId) external override {
        Position storage position = _positions[positionId];
        require(position.depositor == msg.sender, "VaultCore: not position owner");
        require(position.isActive, "VaultCore: position not active");

        uint256 fxrpAmount = position.fxrpAmount;

        // Update position
        position.fxrpAmount = 0;
        position.isActive = false;
        _totalFxrpDeposited -= fxrpAmount;
        _activePositionCount--;

        // Transfer FXRP back to depositor
        IFXRP fxrp = IFXRP(config.fxrpToken);
        require(
            fxrp.transfer(msg.sender, fxrpAmount),
            "VaultCore: FXRP transfer failed"
        );

        emit WithdrawalCompleted(msg.sender, fxrpAmount, positionId);
    }

    /// @inheritdoc IVaultCore
    function revalueAllPositions() external override onlyVerifier {
        // Revalue all positions using the latest FTSO price
        // This is called by the FCC extension's PositionComputer
        uint256 price = getXrpUsdPrice();
        require(price > 0, "VaultCore: no price available");

        for (uint256 i = 1; i < _nextPositionId; i++) {
            if (_positions[i].isActive) {
                _positions[i].lastValuation = (_positions[i].fxrpAmount * price) / 1e6;
                emit PositionRevalued(i, _positions[i].lastValuation, block.timestamp);
            }
        }
    }

    /// @inheritdoc IVaultCore
    function emergencyWithdraw(uint256 positionId, string calldata reason)
        external
        override
        onlyAdmin
    {
        Position storage position = _positions[positionId];
        require(position.isActive, "VaultCore: position not active");

        uint256 fxrpAmount = position.fxrpAmount;
        address depositor = position.depositor;

        position.fxrpAmount = 0;
        position.isActive = false;
        _totalFxrpDeposited -= fxrpAmount;
        _activePositionCount--;

        IFXRP fxrp = IFXRP(config.fxrpToken);
        require(
            fxrp.transfer(depositor, fxrpAmount),
            "VaultCore: FXRP transfer failed"
        );

        emit EmergencyWithdrawal(depositor, fxrpAmount, reason);
    }

    // --- Internal Functions ---

    function _getDepositorPolicyId(address depositor) internal view returns (uint256) {
        if (config.policyRegistry == address(0)) return 0;
        try IPolicyRegistry(config.policyRegistry).getPolicyForDepositor(depositor) returns (IPolicyRegistry.Policy memory p) {
            return p.policyId;
        } catch {
            return 0;
        }
    }
}
