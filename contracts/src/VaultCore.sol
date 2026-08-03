// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./interfaces/vault/IVaultCore.sol";
import "./interfaces/vault/IPolicyRegistry.sol";
import "./interfaces/vault/ISolvencyRoot.sol";
import "./interfaces/vault/IVerifierRole.sol";
import "./interfaces/fassets/IFlareContractRegistry.sol";
import "./interfaces/fassets/IAssetManager.sol";
import "./interfaces/fassets/IFXRP.sol";
import "./interfaces/fassets/IFtsoV2.sol";

/// @title VaultCore
/// @notice Core vault contract for Aegis — manages FXRP deposits, withdrawals,
///         and collateral tracking using Flare FAssets and FTSO price feeds.
/// @dev Implements the report-specified API (Section 9.4.5):
///      depositFXRP(amount, policyId), withdraw(amount), emergencyExit(),
///      balanceOf(user), policyOf(user).
///      Uses FlareContractRegistry for dynamic resolution of FAssets and FTSO addresses.
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

    /// @notice Mapping from depositor => total FXRP balance
    mapping(address => uint256) private _depositorBalances;

    /// @notice Mapping from depositor => assigned policy ID
    mapping(address => uint256) private _depositorPolicies;

    /// @notice Whether the vault is in emergency mode
    bool private _emergencyMode;

    /// @notice VerifierRole contract for access control
    IVerifierRole public verifierRole;

    /// @notice FlareContractRegistry for resolving FAssets addresses
    IFlareContractRegistry public flareRegistry;

    // --- XRP/USD Feed ID for FTSO V2 ---
    // bytes21 feedId = 0x015852502f55534400000000000000000000000000 (XRP/USD)
    bytes21 public constant XRP_USD_FEED_ID = bytes21(0x015852502f55534400000000000000000000000000);

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

    modifier notInEmergency() {
        require(!_emergencyMode, "VaultCore: vault is in emergency mode");
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

        // Resolve FAssets addresses from the Flare Contract Registry
        // This follows the official Flare pattern: never hardcode addresses
        address assetManager = flareRegistry.getContractAddressByName("AssetManagerFXRP");
        require(assetManager != address(0), "VaultCore: AssetManagerFXRP not found");

        IAssetManager am = IAssetManager(assetManager);
        address fxrpToken = am.fAsset();
        require(fxrpToken != address(0), "VaultCore: FXRP token not found");

        // Resolve FTSO V2 from the registry
        address ftsoV2 = flareRegistry.getContractAddressByName("FtsoV2");
        require(ftsoV2 != address(0), "VaultCore: FtsoV2 not found");

        config = VaultConfig({
            assetManagerFXRP: assetManager,
            fxrpToken: fxrpToken,
            ftsoV2: ftsoV2,
            policyRegistry: _policyRegistry,
            solvencyRoot: _solvencyRoot,
            instructionSender: _instructionSender,
            verifierRole: _verifierRole,
            minDepositAmount: _minDepositAmount,
            maxDepositAmount: _maxDepositAmount,
            withdrawalWaitPeriod: 86400 // 1 day default
        });
    }

    // --- Report-Specified API (Section 9.4.5) ---

    /// @inheritdoc IVaultCore
    function depositFXRP(uint256 amount, uint256 policyId) external override notInEmergency returns (uint256) {
        require(amount >= config.minDepositAmount, "VaultCore: below minimum deposit");
        require(amount <= config.maxDepositAmount, "VaultCore: exceeds maximum deposit");

        // Validate policy exists and is active
        if (config.policyRegistry != address(0)) {
            IPolicyRegistry policy = IPolicyRegistry(config.policyRegistry);
            require(
                policy.validateDeposit(policyId, amount, _totalFxrpDeposited),
                "VaultCore: deposit violates policy"
            );
        }

        // Transfer FXRP from depositor to vault
        IFXRP fxrp = IFXRP(config.fxrpToken);
        require(
            fxrp.transferFrom(msg.sender, address(this), amount),
            "VaultCore: FXRP transfer failed"
        );

        // Create position
        uint256 positionId = _nextPositionId++;
        uint256 usdValuation = 0;
        uint256 price = getXrpUsdPrice();
        if (price > 0) {
            usdValuation = (amount * price) / 1e6;
        }

        Position storage position = _positions[positionId];
        position.depositor = msg.sender;
        position.fxrpAmount = amount;
        position.depositTimestamp = block.timestamp;
        position.lastValuation = usdValuation;
        position.policyId = policyId;
        position.isActive = true;

        _totalFxrpDeposited += amount;
        _activePositionCount++;
        _depositorPositions[msg.sender].push(positionId);
        _depositorBalances[msg.sender] += amount;
        _depositorPolicies[msg.sender] = policyId;

        emit DepositMade(msg.sender, amount, usdValuation, positionId);

        return positionId;
    }

    /// @inheritdoc IVaultCore
    function withdraw(uint256 amount) external override notInEmergency {
        require(amount > 0, "VaultCore: zero amount");
        require(_depositorBalances[msg.sender] >= amount, "VaultCore: insufficient balance");

        // Validate withdrawal against policy
        uint256 policyId = _depositorPolicies[msg.sender];
        if (policyId > 0 && config.policyRegistry != address(0)) {
            IPolicyRegistry policy = IPolicyRegistry(config.policyRegistry);
            uint256 positionValue = _depositorBalances[msg.sender];
            require(
                policy.validateWithdrawal(policyId, amount, positionValue),
                "VaultCore: withdrawal violates policy"
            );
        }

        // Reduce depositor balance
        _depositorBalances[msg.sender] -= amount;
        _totalFxrpDeposited -= amount;

        // Reduce from positions (FIFO)
        uint256 remaining = amount;
        uint256[] storage positions = _depositorPositions[msg.sender];
        for (uint256 i = 0; i < positions.length && remaining > 0; i++) {
            Position storage pos = _positions[positions[i]];
            if (!pos.isActive) continue;

            if (pos.fxrpAmount <= remaining) {
                remaining -= pos.fxrpAmount;
                pos.fxrpAmount = 0;
                pos.isActive = false;
                _activePositionCount--;
            } else {
                pos.fxrpAmount -= remaining;
                remaining = 0;
            }
        }

        // Transfer FXRP back to depositor
        IFXRP fxrp = IFXRP(config.fxrpToken);
        require(
            fxrp.transfer(msg.sender, amount),
            "VaultCore: FXRP transfer failed"
        );

        emit WithdrawalCompleted(msg.sender, amount, 0);
    }

    /// @inheritdoc IVaultCore
    function emergencyExit() external override {
        require(_emergencyMode, "VaultCore: not in emergency mode");
        require(_depositorBalances[msg.sender] > 0, "VaultCore: no balance");

        uint256 amount = _depositorBalances[msg.sender];
        _depositorBalances[msg.sender] = 0;
        _totalFxrpDeposited -= amount;

        // Mark all positions as inactive
        uint256[] storage positions = _depositorPositions[msg.sender];
        for (uint256 i = 0; i < positions.length; i++) {
            Position storage pos = _positions[positions[i]];
            if (pos.isActive) {
                pos.isActive = false;
                _activePositionCount--;
            }
        }

        // Transfer FXRP back to depositor
        IFXRP fxrp = IFXRP(config.fxrpToken);
        require(
            fxrp.transfer(msg.sender, amount),
            "VaultCore: FXRP transfer failed"
        );

        emit EmergencyExit(msg.sender, amount, 0);
    }

    /// @inheritdoc IVaultCore
    function balanceOf(address user) external view override returns (uint256) {
        return _depositorBalances[user];
    }

    /// @inheritdoc IVaultCore
    function policyOf(address user) external view override returns (uint256) {
        return _depositorPolicies[user];
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
    function getXrpUsdPrice() public override returns (uint256) {
        if (config.ftsoV2 == address(0)) return 0;

        // Read from FTSO V2 using the official Flare periphery pattern
        try IFtsoV2(config.ftsoV2).getFeedById(XRP_USD_FEED_ID) returns (
            uint256 value,
            int8 /* decimals */,
            uint64 /* timestamp */
        ) {
            if (value > 0) {
                return value;
            }
        } catch {
            // FTSO V2 call failed — return 0
        }
        return 0;
    }

    /// @inheritdoc IVaultCore
    function getTotalValuation() external override returns (uint256) {
        uint256 price = getXrpUsdPrice();
        if (price == 0) return 0;
        // totalFxrpDeposited is in UBA (6 decimals), price is in USD (5 decimals)
        // USD valuation = (totalFxrpDeposited * price) / 10^6
        return (_totalFxrpDeposited * price) / 1e6;
    }

    // --- State-Changing Functions ---

    /// @inheritdoc IVaultCore
    function revalueAllPositions() external override onlyVerifier {
        uint256 price = getXrpUsdPrice();
        require(price > 0, "VaultCore: no price available");

        for (uint256 i = 1; i < _nextPositionId; i++) {
            if (_positions[i].isActive) {
                _positions[i].lastValuation = (_positions[i].fxrpAmount * price) / 1e6;
                emit PositionRevalued(i, _positions[i].lastValuation, block.timestamp);
            }
        }
    }

    // --- Admin Functions ---

    /// @notice Set the vault to emergency mode
    function setEmergencyMode(bool emergency) external onlyAdmin {
        _emergencyMode = emergency;
    }

    /// @notice Check if the vault is in emergency mode
    function isEmergencyMode() external view returns (bool) {
        return _emergencyMode;
    }
}
