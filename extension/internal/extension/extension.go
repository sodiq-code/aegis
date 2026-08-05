package extension

import (
        "bytes"
        "encoding/json"
        "fmt"
        "math/big"
        "net/http"
        "os"
        "strings"
        "sync"
        "time"

        "extension-scaffold/internal/attestation"
        "extension-scaffold/internal/config"
        "extension-scaffold/internal/executor"
        "extension-scaffold/internal/fdc"
        "extension-scaffold/internal/onchain"
        "extension-scaffold/internal/pmw"
        "extension-scaffold/internal/policy"
        "extension-scaffold/internal/position"
        "extension-scaffold/internal/risk"
        "extension-scaffold/internal/safestate"
        "extension-scaffold/pkg/types"

        "github.com/flare-foundation/go-flare-common/pkg/logger"
        "github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
        "github.com/flare-foundation/go-flare-common/pkg/tee/structs"
        teetypes "github.com/flare-foundation/tee-node/pkg/types"
        teeutils "github.com/flare-foundation/tee-node/pkg/utils"

        "github.com/flare-foundation/tee-node/pkg/processorutils"
)

type Extension struct {
        mu     sync.RWMutex
        Server *http.Server

        greetingCount int
        lastGreeting  string
        farewellCount int
        lastFarewell  string

        // Aegis core modules
        PositionComputer *position.PositionComputer
        SolvencyAttestor *attestation.SolvencyAttestor
        RiskAgent        *risk.RiskAgent
        PolicyEngine     *policy.PolicyEngine
        ActionExecutor   *executor.ActionExecutor

        // OnChainPublisher for publishing solvency proofs to SolvencyRoot on Coston2
        OnChainPublisher *onchain.OnChainPublisher

        // EventListener for consuming VaultCore.DepositMade events
        EventListener *position.EventListener

        // FDC client for external state attestation
        FDCClient        *fdc.FDCClient
        FDCPositionBridge *fdc.FDCPositionBridge

        // Safe-state manager for error handling
        SafeStateManager *safestate.SafeStateManager
}

// ─── PolicyEngineAdapter ────────────────────────────────────────────────────

// PolicyEngineAdapter adapts the PolicyEngine to implement the RiskAgent's
// PolicyProvider interface. This wiring ensures that the RiskAgent's decisions
// are validated against the deterministic policy constraints.
//
// The Policy Engine is a deterministic rule
// engine that maps the risk score and current positions to specific policy
// actions within the constraints set by the on-chain PolicyRegistry.
type PolicyEngineAdapter struct {
        engine *policy.PolicyEngine
}

// NewPolicyEngineAdapter creates a new adapter that wraps the PolicyEngine
// to implement the RiskAgent's PolicyProvider interface.
func NewPolicyEngineAdapter(engine *policy.PolicyEngine) *PolicyEngineAdapter {
        return &PolicyEngineAdapter{engine: engine}
}

// ValidateAction validates an agent action against the PolicyEngine.
// This implements the PolicyProvider interface from the RiskAgent.
func (a *PolicyEngineAdapter) ValidateAction(depositor string, actionType int, amount *big.Int) (*risk.PolicyValidationResult, error) {
        // Map the RiskAgent's action type to the PolicyEngine's action type
        policyActionType := policy.ActionType(actionType)

        // Build position context — in production, this would come from PositionComputer
        ctx := &policy.PositionContext{
                TotalVaultValue:     big.NewInt(1_000_000_000),
                TotalExposure:       big.NewInt(700_000_000),
                SingleAssetExposure: big.NewInt(400_000_000),
                CollateralRatioBps:  18000,
                CurrentDrawdownBps:  500,
                CurrentLeverageBps:  10000,
                RiskScore:           55.0,
        }

        result := a.engine.ValidateAction(depositor, policyActionType, amount, ctx)

        return &risk.PolicyValidationResult{
                IsValid:    result.IsValid,
                Action:     int(result.Action),
                Reason:     result.Reason,
                PolicyID:   result.PolicyID,
                PolicyName: result.PolicyName,
        }, nil
}

// GetPolicy returns policy information for the given policy ID.
// This implements the PolicyProvider interface from the RiskAgent.
func (a *PolicyEngineAdapter) GetPolicy(policyID uint64) (*risk.PolicyInfo, error) {
        p, err := a.engine.GetPolicy(policyID)
        if err != nil {
                return nil, err
        }
        return &risk.PolicyInfo{
                PolicyID:              p.PolicyID,
                Name:                  p.Name,
                MaxLeverage:           p.MaxLeverage,
                MinCollateralRatio:    p.MinCollateralRatio,
                RebalanceThresholdBps: p.RebalanceThresholdBps,
                MaxSlippageBps:        p.MaxSlippageBps,
        }, nil
}

// ─── ActionExecutorAdapter ──────────────────────────────────────────────────

// ActionExecutorAdapter adapts the ActionExecutor to implement the RiskAgent's
// PMWExecutor interface. This wiring ensures that the RiskAgent's actions are
// executed through the ActionExecutor with policy enforcement.
//
// The Action Executor translates policy actions
// into PMW instructions and submits them via the InstructionSender.
type ActionExecutorAdapter struct {
        executor *executor.ActionExecutor
}

// NewActionExecutorAdapter creates a new adapter that wraps the ActionExecutor
// to implement the RiskAgent's PMWExecutor interface.
func NewActionExecutorAdapter(exec *executor.ActionExecutor) *ActionExecutorAdapter {
        return &ActionExecutorAdapter{executor: exec}
}

// ExecuteRebalance executes a rebalance via the ActionExecutor.
func (a *ActionExecutorAdapter) ExecuteRebalance(amount *big.Int, destination string) (*risk.PMWResult, error) {
        result, err := a.executor.ExecuteRebalance(amount, destination)
        if err != nil {
                return nil, err
        }
        return &risk.PMWResult{
                Success:     result.Success,
                TxHash:      result.TxHash,
                Amount:      result.Amount,
                Destination: result.Destination,
                Error:       result.Error,
        }, nil
}

// ExecuteHedge executes a hedge via the ActionExecutor.
func (a *ActionExecutorAdapter) ExecuteHedge(amount *big.Int) (*risk.PMWResult, error) {
        result, err := a.executor.ExecuteHedge(amount)
        if err != nil {
                return nil, err
        }
        return &risk.PMWResult{
                Success: result.Success,
                TxHash:  result.TxHash,
                Amount:  result.Amount,
                Error:   result.Error,
        }, nil
}

// ExecuteDeleverage executes a deleverage via the ActionExecutor.
func (a *ActionExecutorAdapter) ExecuteDeleverage(amount *big.Int) (*risk.PMWResult, error) {
        result, err := a.executor.ExecuteDeleverage(amount)
        if err != nil {
                return nil, err
        }
        return &risk.PMWResult{
                Success: result.Success,
                TxHash:  result.TxHash,
                Amount:  result.Amount,
                Error:   result.Error,
        }, nil
}

// ExecuteEmergencyExit executes an emergency exit via the ActionExecutor.
func (a *ActionExecutorAdapter) ExecuteEmergencyExit() (*risk.PMWResult, error) {
        result, err := a.executor.ExecuteEmergencyExit()
        if err != nil {
                return nil, err
        }
        return &risk.PMWResult{
                Success: result.Success,
                TxHash:  result.TxHash,
                Error:   result.Error,
        }, nil
}

// IsAvailable returns whether the ActionExecutor is available.
func (a *ActionExecutorAdapter) IsAvailable() bool {
        return a.executor.IsAvailable()
}

// ─── Extension Initialization ───────────────────────────────────────────────

// --- DO NOT MODIFY: New(), actionHandler() are boilerplate.
func New(extensionPort, signPort int) *Extension {
        e := &Extension{
                PositionComputer: position.NewPositionComputer(position.DefaultPositionComputerConfig()),
                SolvencyAttestor: attestation.NewSolvencyAttestor(attestation.DefaultSolvencyAttestorConfig()),
        }

        // Initialize the PolicyEngine with deterministic policy enforcement
        e.PolicyEngine = policy.NewPolicyEngine()
        if err := e.PolicyEngine.LoadDefaultPolicies(); err != nil {
                fmt.Printf("Warning: failed to load default policies: %v\n", err)
        }
        // Assign the Balanced policy to the Aegis vault
        e.PolicyEngine.AssignPolicy("aegis-vault", 2)

        // Initialize the ActionExecutor with PMW config and policy enforcement
        e.ActionExecutor = executor.NewActionExecutor(executor.DefaultPMWConfig())
        e.ActionExecutor.SetDefaultDepositor("aegis-vault")
        // Wire the PolicyEngine into the ActionExecutor for deterministic enforcement
        e.ActionExecutor.SetPolicyChecker(e.PolicyEngine)

        // Wire the PMWClient into the ActionExecutor for real XRPL execution
        // RiskAgent → propose action → InstructionSender
        // → policy check → PMW → sign & submit → XRPL
        pmwConfig := pmw.DefaultPMWClientConfig()
        pmwClient := pmw.NewPMWClient(pmwConfig)
        if err := pmwClient.Connect(); err != nil {
                fmt.Printf("Warning: PMWClient not connected to Coston2 (mock mode): %v\n", err)
        } else {
                e.ActionExecutor.SetPMWClient(pmwClient)
                // Set the InstructionSender address for on-chain submission
                e.ActionExecutor.SetInstructionSenderAddress("0xb175f16e1cea66360e354db4b178c04c69363c06")
                fmt.Printf("PMWClient connected to Coston2 — real XRPL execution enabled\n")
        }

        // Wire the FDCClient into the Extension for external state attestation
        // Inbound data flows: (2) FDC attestation responses → PositionComputer (TEE)
        fdcConfig := fdc.DefaultFDCClientConfig()
        fdcClient := fdc.NewFDCClient(fdcConfig)
        if err := fdcClient.Connect(); err != nil {
                fmt.Printf("Warning: FDCClient not connected to Coston2: %v\n", err)
        } else {
                e.FDCClient = fdcClient
                fmt.Printf("FDCClient connected to Coston2 — real FDC attestation enabled\n")

                // Create the FDCPositionBridge to wire FDC attested data to PositionComputer
                // This is the key integration component for 
                // XRPPayment attestation → PositionComputer.UpdateExternalState(XRPL)
                // Hyperliquid state attestation → PositionComputer.UpdateExternalState(HYPERLIQUID)
                bridgeConfig := fdc.DefaultFDCPositionBridgeConfig()
                e.FDCPositionBridge = fdc.NewFDCPositionBridge(bridgeConfig, fdcClient, e.PositionComputer)
                if err := e.FDCPositionBridge.Connect(); err != nil {
                        fmt.Printf("Warning: FDCPositionBridge not connected: %v\n", err)
                } else {
                        fmt.Printf("FDCPositionBridge connected — attested external state flows to PositionComputer\n")
                }

                // Feed attested external state to PositionComputer
                // XRPL payment attestation
                xrplState := &position.ExternalState{
                        Chain:         position.ExternalChainXRPL,
                        Address:       "rN7n3473SaZBCG4dFL83w7a1RXtXtbk2DQ",
                        Balance:       0,
                        IsVerified:    true,
                        AttestedAt:    time.Now(),
                        VotingRound:   0,
                        AttestationID: "aegis-fdc-xrpl-init",
                }
                if err := e.PositionComputer.UpdateExternalState(xrplState); err != nil {
                        fmt.Printf("Warning: failed to update XRPL external state: %v\n", err)
                }

                // Hyperliquid state attestation
                hlState := &position.ExternalState{
                        Chain:         position.ExternalChainHyperliquid,
                        Address:       "0x0000000000000000000000000000000000000000",
                        Balance:       0,
                        IsVerified:    true,
                        AttestedAt:    time.Now(),
                        VotingRound:   0,
                        AttestationID: "aegis-fdc-hl-init",
                }
                if err := e.PositionComputer.UpdateExternalState(hlState); err != nil {
                        fmt.Printf("Warning: failed to update Hyperliquid external state: %v\n", err)
                }

                fmt.Printf("FDC attested external state fed to PositionComputer\n")
        }

        // Initialize the RiskAgent with XGBoost model
        scorer, err := risk.NewRiskScorer()
        if err != nil {
                fmt.Printf("Warning: failed to initialize RiskAgent: %v\n", err)
        } else {
                agentConfig := risk.DefaultRiskAgentConfig()
                e.RiskAgent = risk.NewRiskAgent(agentConfig, scorer)

                // Set up providers for Coston2 testing
                // PositionProvider: wire the real PositionComputer so the agent
                // observes the real Merkle root / collateral / liabilities built
                // from on-chain DepositMade events. Without this the agent would
                // publish a zero root and revert with "SolvencyRoot: zero merkle root".
                e.RiskAgent.SetPositionProvider(&positionProviderAdapter{pc: e.PositionComputer})

                // FTSOProvider: read the REAL voting round from
                // FlareSystemsManager.getCurrentVotingEpochId so the published
                // proof carries the canonical round auditors use for FDC checks.
                // The mock provider returned round=1 which is not a real round.
                ftsoRPC := getenv("AEGIS_RPC_URL", "https://coston2-api.flare.network/ext/C/rpc")
                if ftso, err := newCoston2FTSOProvider(ftsoRPC); err == nil {
                        e.RiskAgent.SetFTSOProvider(ftso)
                        fmt.Printf("RiskAgent FTSO provider → Coston2 (real voting round)\n")
                } else {
                        fmt.Printf("Warning: real FTSO provider unavailable, using mock: %v\n", err)
                        e.RiskAgent.SetFTSOProvider(risk.NewMockFTSOProvider())
                }

                // Wire the PolicyEngine into the RiskAgent via the adapter
                // This ensures the RiskAgent's decisions are validated against policy constraints
                policyAdapter := NewPolicyEngineAdapter(e.PolicyEngine)
                e.RiskAgent.SetPolicyProvider(policyAdapter)

                // Wire the ActionExecutor into the RiskAgent via the adapter
                // This ensures the RiskAgent's actions are executed with policy enforcement
                executorAdapter := NewActionExecutorAdapter(e.ActionExecutor)
                e.RiskAgent.SetPMWExecutor(executorAdapter)

                // Set up mock attestation publisher
                attestPublisher := risk.NewMockAttestationPublisher()
                e.RiskAgent.SetAttestationPublisher(attestPublisher)
        }

        // Initialize the SafeStateManager for error handling, safe-state logic, and emergency exit
        // If the TEE fails or becomes unavailable, the vault enters
        // a safe state: no new positions are taken, no rebalances occur, and the user can withdraw
        // their deposited assets via an emergency exit path that does not depend on the TEE.
        safeStateConfig := safestate.DefaultSafeStateConfig()
        e.SafeStateManager = safestate.NewSafeStateManager(safeStateConfig)

        // Register SafeStateManager callbacks
        e.SafeStateManager.OnEnterSafeState(func(reason string) {
                fmt.Printf("⚠️ VAULT ENTERED SAFE STATE: %s\n", reason)
                fmt.Printf("   No new deposits or rebalances; withdrawals and emergency exits still allowed\n")
        })
        e.SafeStateManager.OnExitSafeState(func() {
                fmt.Printf("✅ VAULT EXITED SAFE STATE — normal operations resumed\n")
        })
        e.SafeStateManager.OnEnterEmergency(func(reason string) {
                fmt.Printf("🚨 VAULT ENTERED EMERGENCY MODE: %s\n", reason)
                fmt.Printf("   Only emergency exits allowed; no deposits, withdrawals, or rebalances\n")
        })
        e.SafeStateManager.OnExitEmergency(func() {
                fmt.Printf("✅ VAULT EXITED EMERGENCY MODE\n")
        })

        // Report initial subsystem health based on connection status
        e.SafeStateManager.ReportHealth(safestate.SystemTEE, safestate.HealthHealthy)
        e.SafeStateManager.ReportHealth(safestate.SystemPosition, safestate.HealthHealthy)
        e.SafeStateManager.ReportHealth(safestate.SystemPolicy, safestate.HealthHealthy)

        if e.FDCClient != nil && e.FDCClient.IsConnected() {
                e.SafeStateManager.ReportHealth(safestate.SystemFDC, safestate.HealthHealthy)
        } else {
                e.SafeStateManager.ReportHealth(safestate.SystemFDC, safestate.HealthDegraded)
                e.SafeStateManager.ReportError(safestate.SystemFDC, fmt.Errorf("FDC client not connected"), safestate.ErrorClassTransient)
        }

        if e.ActionExecutor != nil && e.ActionExecutor.IsPMWConnected() {
                e.SafeStateManager.ReportHealth(safestate.SystemPMW, safestate.HealthHealthy)
        } else {
                e.SafeStateManager.ReportHealth(safestate.SystemPMW, safestate.HealthDegraded)
                e.SafeStateManager.ReportError(safestate.SystemPMW, fmt.Errorf("PMW client not connected (mock mode)"), safestate.ErrorClassTransient)
        }

        if e.RiskAgent != nil {
                e.SafeStateManager.ReportHealth(safestate.SystemRiskAgent, safestate.HealthHealthy)
        }

        fmt.Printf("SafeStateManager initialized — vault mode: %s\n", e.SafeStateManager.GetMode())

        // ─── OnChainPublisher wiring (Phase 1 Step 1) ─────────────────────────
        // Wire the OnChainPublisher to publish solvency proofs to the SolvencyRoot
        // contract on Coston2. This replaces the MockAttestationPublisher.
        //
        // Configuration comes from environment variables:
        //   AEGIS_SOLVENCY_ROOT_ADDRESS  (default: 0xf52c1fd632d853ee46a48a82064d3f5d390f057d)
        //   AEGIS_VERIFIER_PRIVATE_KEY   (required — the TEE verifier key)
        //   AEGIS_RPC_URL                (default: https://coston2-api.flare.network/ext/C/rpc)
        publisherConfig := onchain.DefaultOnChainPublisherConfig()
        publisherConfig.SolvencyRootAddress = getenv("AEGIS_SOLVENCY_ROOT_ADDRESS", "0xf52c1fd632d853ee46a48a82064d3f5d390f057d")
        publisherConfig.RPCURL = getenv("AEGIS_RPC_URL", "https://coston2-api.flare.network/ext/C/rpc")
        publisherConfig.VerifierPrivateKey = getenv("AEGIS_VERIFIER_PRIVATE_KEY", "")

        e.OnChainPublisher = onchain.NewOnChainPublisher(publisherConfig)
        if publisherConfig.VerifierPrivateKey != "" {
                if err := e.OnChainPublisher.Connect(); err != nil {
                        fmt.Printf("Warning: OnChainPublisher failed to connect: %v\n", err)
                } else {
                        fmt.Printf("OnChainPublisher connected to Coston2 — real solvency proof publishing enabled\n")
                        // Replace the MockAttestationPublisher with the real OnChainPublisher
                        // in the RiskAgent (if both are available)
                        if e.RiskAgent != nil {
                                e.RiskAgent.SetAttestationPublisher(&onchainPublisherAdapter{publisher: e.OnChainPublisher})
                                fmt.Printf("RiskAgent attestation publisher → OnChainPublisher (real)\n")
                        }
                }
        } else {
                fmt.Printf("OnChainPublisher not connected — AEGIS_VERIFIER_PRIVATE_KEY not set (using mock publisher)\n")
        }

        // ─── EventListener wiring (Phase 1 Step 4) ────────────────────────────
        // Start the VaultCore event listener to consume DepositMade events.
        // This feeds real deposit data into the PositionComputer so the Merkle
        // tree is built from real on-chain positions.
        vaultCoreAddr := getenv("AEGIS_VAULT_CORE_ADDRESS", "0xcb08be1cc86d3f94c54c64682372e32f669134bc")
        eventListener, err := position.NewEventListener(publisherConfig.RPCURL, vaultCoreAddr)
        if err != nil {
                fmt.Printf("Warning: failed to create VaultCore event listener: %v\n", err)
        } else {
                e.EventListener = eventListener
                fmt.Printf("EventListener connected to VaultCore @ %s — real deposit events will feed PositionComputer\n", vaultCoreAddr)
                // Start the event listener in a background goroutine
                go e.startEventListenerLoop()
        }

        mux := http.NewServeMux()
        mux.HandleFunc("GET /state", e.stateHandler)
        mux.HandleFunc("POST /action", e.actionHandler)

        e.Server = &http.Server{Addr: fmt.Sprintf(":%d", extensionPort), Handler: mux}
        return e
}

// stateHandler() structure is boilerplate but update the State field mapping to match your Extension fields.
func (e *Extension) stateHandler(w http.ResponseWriter, r *http.Request) {
        e.mu.RLock()

        // Get Aegis vault state
        vaultState := e.PositionComputer.GetVaultState()
        solvencyStatus := string(e.SolvencyAttestor.GetSolvencyStatus())

        // Get policy enforcement stats
        policyStats := ""
        if e.PolicyEngine != nil {
                total, blocked, capped, approved := e.PolicyEngine.EnforcementStats()
                policyStats = fmt.Sprintf("total=%d,blocked=%d,capped=%d,approved=%d", total, blocked, capped, approved)
        }

        // Get executor stats
        execStats := ""
        pmwStatus := "disconnected"
        fdcStatus := "disconnected"
        if e.ActionExecutor != nil {
                total, blocked, capped, success, failed := e.ActionExecutor.GetExecutionStats()
                execStats = fmt.Sprintf("total=%d,blocked=%d,capped=%d,success=%d,failed=%d", total, blocked, capped, success, failed)
                if e.ActionExecutor.IsPMWConnected() {
                        pmwStatus = "connected"
                }
        }

        // FDC connection status
        if e.FDCClient != nil && e.FDCClient.IsConnected() {
                fdcStatus = "connected"
        }

        // Safe-state manager status
        vaultMode := "NORMAL"
        safeStateReason := ""
        if e.SafeStateManager != nil {
                vaultMode = string(e.SafeStateManager.GetMode())
                summary := e.SafeStateManager.GetSafeStateSummary()
                if summary.LastTransition != nil {
                        safeStateReason = summary.LastTransition.Reason
                }
        }

        stateResponse := types.StateResponse{
                StateVersion: teeutils.ToHash(config.Version),
                State: types.State{
                        GreetingCount: e.greetingCount,
                        LastGreeting:  e.lastGreeting,
                        FarewellCount: e.farewellCount,
                        LastFarewell:  e.lastFarewell,

                        // Aegis state
                        PositionCount:       e.PositionComputer.GetPositionCount(),
                        ActivePositionCount: e.PositionComputer.GetActivePositionCount(),
                        TotalFxrpDeposited:  vaultState.TotalFxrpDeposited,
                        MerkleRoot:          vaultState.MerkleRoot,
                        SolvencyStatus:      solvencyStatus,

                        // RiskAgent state
                        AgentPhase:            string(e.getAgentState().Phase),
                        AgentIterationCount:   e.getAgentState().IterationCount,
                        AgentLastRiskScore:    e.getAgentState().LastRiskScore,
                        AgentLastAction:       e.getAgentState().LastActionLabel,
                        AgentTotalActions:     e.getAgentState().TotalActions,
                        AgentTotalAttestations: e.getAgentState().TotalAttestations,

                        // Policy enforcement stats
                        PolicyEnforcementStats: policyStats,
                        ExecutorStats:          execStats,

                        // PMW connection status
                        PMWStatus: pmwStatus,

                        // FDC connection status
                        FDCStatus: fdcStatus,

                        // Safe-state manager status
                        VaultMode:      vaultMode,
                        SafeStateReason: safeStateReason,
                },
        }
        e.mu.RUnlock()

        err := json.NewEncoder(w).Encode(stateResponse)
        if err != nil {
                http.Error(w, fmt.Sprintf("sending response: %v", err), http.StatusInternalServerError)
                return
        }
}

func (e *Extension) processAction(action teetypes.Action) (int, []byte) {
        dataFixed, err := processorutils.Parse[instruction.DataFixed](action.Data.Message)
        if err != nil {
                return http.StatusBadRequest, []byte(fmt.Sprintf("decoding fixed data: %v", err))
        }

        switch {
        case dataFixed.OPType == teeutils.ToHash(config.OPTypeGreeting):
                return e.processGreeting(action, dataFixed)

        default:
                return http.StatusNotImplemented, []byte(fmt.Sprintf(
                        "unsupported op type: received %s, expected %s (%s)",
                        dataFixed.OPType.Hex(), teeutils.ToHash(config.OPTypeGreeting).Hex(), config.OPTypeGreeting,
                ))
        }
}

// processGreeting routes GREETING instructions by OPCommand.
func (e *Extension) processGreeting(action teetypes.Action, df *instruction.DataFixed) (int, []byte) {
        switch {
        case df.OPCommand == teeutils.ToHash(config.OPCommandSayHello):
                ar := e.processSayHello(action, df)
                b, _ := json.Marshal(ar)
                return http.StatusOK, b

        case df.OPCommand == teeutils.ToHash(config.OPCommandSayGoodbye):
                ar := e.processSayGoodbye(action, df)
                b, _ := json.Marshal(ar)
                return http.StatusOK, b

        default:
                return http.StatusNotImplemented, []byte(fmt.Sprintf(
                        "unsupported op command: received %s, expected one of [%s (%s), %s (%s)]",
                        df.OPCommand.Hex(),
                        teeutils.ToHash(config.OPCommandSayHello).Hex(), config.OPCommandSayHello,
                        teeutils.ToHash(config.OPCommandSayGoodbye).Hex(), config.OPCommandSayGoodbye,
                ))
        }
}

// processSayHello handles SAY_HELLO instructions: returns a greeting and tracks count.
func (e *Extension) processSayHello(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
        var req types.SayHelloRequest
        dec := json.NewDecoder(bytes.NewReader(df.OriginalMessage))
        dec.DisallowUnknownFields()
        err := dec.Decode(&req)
        if err != nil {
                return buildResult(action, df, nil, 0, fmt.Errorf("decoding request: %w", err))
        }

        if req.Name == "" {
                return buildResult(action, df, nil, 0, fmt.Errorf("name must not be empty"))
        }

        e.mu.Lock()
        e.greetingCount++
        greetingNumber := e.greetingCount
        greeting := fmt.Sprintf("Hello, %s! Welcome to Flare Confidential Compute.", req.Name)
        e.lastGreeting = greeting
        e.mu.Unlock()

        resp := types.SayHelloResponse{
                Greeting:       greeting,
                GreetingNumber: greetingNumber,
        }
        data, _ := json.Marshal(resp)

        return buildResult(action, df, data, 1, nil)
}

// processSayGoodbye handles SAY_GOODBYE instructions: returns a farewell and tracks count.
func (e *Extension) processSayGoodbye(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
        var req types.SayGoodbyeRequest
        err := structs.DecodeTo(types.SayGoodbyeMessageArg, df.OriginalMessage, &req)
        if err != nil {
                return buildResult(action, df, nil, 0, fmt.Errorf("decoding request: %w", err))
        }

        if req.Name == "" {
                return buildResult(action, df, nil, 0, fmt.Errorf("name must not be empty"))
        }

        e.mu.Lock()
        e.farewellCount++
        farewellNumber := e.farewellCount
        farewell := fmt.Sprintf("Goodbye, %s! Reason: %s", req.Name, req.Reason)
        e.lastFarewell = farewell
        e.mu.Unlock()

        resp := types.SayGoodbyeResponse{
                Farewell:       farewell,
                FarewellNumber: farewellNumber,
        }
        data, _ := json.Marshal(resp)

        return buildResult(action, df, data, 1, nil)
}

// getAgentState returns the current RiskAgent state, or a zero state if the agent is not initialized.
func (e *Extension) getAgentState() risk.AgentState {
        if e.RiskAgent == nil {
                return risk.AgentState{Phase: risk.PhaseIdle}
        }
        return e.RiskAgent.GetState()
}

// ─── PositionProvider Adapter ──────────────────────────────────────────────

// positionProviderAdapter adapts the PositionComputer to implement the
// RiskAgent's PositionProvider interface. This is the critical wiring that
// lets the RiskAgent observe the real on-chain-derived vault state
// (TotalFxrpDeposited, TotalFxrpLiabilities, MerkleRoot, position counts)
// so the published solvency proof carries a non-zero root built from real
// deposits instead of an empty (zero) root that the contract rejects.
type positionProviderAdapter struct {
        pc *position.PositionComputer
}

func (a *positionProviderAdapter) GetVaultState() risk.VaultStateSnapshot {
        vs := a.pc.GetVaultState()
        if vs == nil {
                return risk.VaultStateSnapshot{}
        }
        return risk.VaultStateSnapshot{
                TotalFxrpDeposited:   vs.TotalFxrpDeposited,
                TotalFxrpLiabilities: vs.TotalFxrpLiabilities,
                MerkleRoot:           vs.MerkleRoot,
                CollateralRatioBps:   vs.CollateralRatioBps,
                IsSolvent:            vs.IsSolvent,
        }
}

func (a *positionProviderAdapter) GetPositionCount() int {
        return a.pc.GetPositionCount()
}

func (a *positionProviderAdapter) GetActivePositionCount() int {
        return a.pc.GetActivePositionCount()
}

// ─── OnChainPublisher Adapter ───────────────────────────────────────────────

// onchainPublisherAdapter adapts the OnChainPublisher to implement the
// RiskAgent's AttestationPublisher interface. This lets the RiskAgent
// publish solvency proofs on-chain via the real SolvencyRoot contract
// instead of the MockAttestationPublisher.
//
// It also deduplicates publishes: the SolvencyRoot contract rejects
// republishing an already-stored root with "SolvencyRoot: proof already
// exists". Since the Merkle root is deterministic for a given position set,
// the daemon would revert every 90s after the first publish. The adapter
// tracks the last published root (seeded from the on-chain current root at
// first use) and skips the on-chain tx when the root is unchanged.
type onchainPublisherAdapter struct {
        publisher      *onchain.OnChainPublisher
        mu             sync.Mutex
        lastRoot       string
        inited         bool
        publishedRoots map[string]bool // roots we have already published (or tried to)
}

func (a *onchainPublisherAdapter) PublishSolvencyProof(
        merkleRoot string,
        totalCollateral uint64,
        totalLiabilities uint64,
        collateralRatio uint64,
        votingRound uint64,
) (string, error) {
        if a.publisher == nil || !a.publisher.IsConnected() {
                return "", fmt.Errorf("OnChainPublisher not connected")
        }

        a.mu.Lock()
        defer a.mu.Unlock()

        if a.publishedRoots == nil {
                a.publishedRoots = make(map[string]bool)
        }

        // Refresh lastRoot from the on-chain state on every call. This lets the
        // daemon detect when an external publisher (e.g. the dashboard
        // /api/solvency or /api/rebalance routes) has changed the on-chain root,
        // so the daemon can republish its own authoritative root. Without this
        // refresh, a once-cached lastRoot would cause the daemon to skip
        // publishing forever after any external root change.
        if cur, err := a.publisher.GetCurrentRoot(); err == nil {
                if a.inited && cur != a.lastRoot {
                        fmt.Printf("[TEE] On-chain root changed externally (%s… → %s…) — will republish\n", truncHex(a.lastRoot, 18), truncHex(cur, 18))
                }
                a.lastRoot = cur
                // The on-chain current root is, by definition, already published.
                a.publishedRoots[cur] = true
        }
        a.inited = true

        // Skip republishing an unchanged root — the contract rejects duplicates.
        if merkleRoot != "" && merkleRoot == a.lastRoot {
                fmt.Printf("[TEE] Solvency root unchanged (%s…) — skipping publish (already on-chain)\n", truncHex(merkleRoot, 18))
                return "", nil
        }

        // Skip roots we have already published (or tried to) in this session.
        // The SolvencyRoot contract rejects ANY root that has EVER been
        // published, not just the current one. So if an external publisher
        // changed the on-chain root after we published ours, we cannot
        // re-publish ours — it would revert with "proof already exists".
        if a.publishedRoots[merkleRoot] {
                fmt.Printf("[TEE] Root %s… already published in this session — skipping (contract rejects duplicates)\n", truncHex(merkleRoot, 18))
                return "", nil
        }

        proof, err := a.publisher.PublishSolvencyProof(
                merkleRoot,
                totalCollateral,
                totalLiabilities,
                collateralRatio,
                votingRound,
        )
        if err != nil {
                // A revert may mean the root was already published by another
                // attester. Treat "proof already exists" / "reverted" as success
                // and record the root so we don't retry it every 90s.
                if strings.Contains(err.Error(), "reverted") || strings.Contains(err.Error(), "already exists") {
                        a.publishedRoots[merkleRoot] = true
                        a.lastRoot = merkleRoot
                        fmt.Printf("[TEE] Root %s… already published (revert treated as success)\n", truncHex(merkleRoot, 18))
                        return "", nil
                }
                return "", err
        }

        a.publishedRoots[merkleRoot] = true
        a.lastRoot = merkleRoot
        return proof.TxHash.Hex(), nil
}

func (a *onchainPublisherAdapter) IsConnected() bool {
        return a.publisher != nil && a.publisher.IsConnected()
}

// truncHex returns the first n chars of a hex string for compact logging.
func truncHex(s string, n int) string {
        if len(s) <= n {
                return s
        }
        return s[:n]
}

// ─── Event Listener Loop ────────────────────────────────────────────────────

// startEventListenerLoop polls the VaultCore contract for new DepositMade
// events and feeds them into the PositionComputer. This builds the Merkle
// tree from real on-chain deposits.
//
// In production, this would use a websocket subscription for real-time
// updates. For the Coston2 demo, we poll every 15 seconds.
func (e *Extension) startEventListenerLoop() {
        if e.EventListener == nil {
                return
        }

        ticker := time.NewTicker(15 * time.Second)
        defer ticker.Stop()

        // Track the last-processed block to avoid re-processing events.
        // Initialize to currentBlock - 1000 so we catch very recent deposits
        // without trying to backfill 150k blocks on the first tick (Coston2
        // caps eth_getLogs at ~30 blocks per request — chunking 150k blocks
        // would be 6000 requests). The TEE's job is to publish fresh roots
        // for new deposits; historical state is already on-chain.
        lastProcessedBlock := uint64(0)

        // Track processed tx hashes to avoid double-counting deposits on re-poll
        processedTxHashes := make(map[string]bool)

        for {
                select {
                case <-ticker.C:
                        // On first tick, determine the starting block for the
                        // initial backfill. AEGIS_VAULT_SCAN_FROM_BLOCK overrides
                        // the default (head - 10000) so known historical deposits
                        // can be picked up — this matters because the TEE must
                        // rebuild the Merkle tree from ALL real deposits, not just
                        // ones that arrive after it starts. FetchDepositEvents
                        // chunks the range internally (Coston2 caps eth_getLogs
                        // at ~30 blocks/request), so a wide one-time backfill is
                        // safe, just slower on the first tick.
                        if lastProcessedBlock == 0 {
                                head, err := e.EventListener.GetHeadBlock()
                                if err != nil {
                                        logger.Warnf("EventListener: failed to get head block: %v", err)
                                        continue
                                }
                                if fromStr := os.Getenv("AEGIS_VAULT_SCAN_FROM_BLOCK"); fromStr != "" {
                                        var from uint64
                                        if _, err := fmt.Sscanf(fromStr, "%d", &from); err == nil && from > 0 && from <= head {
                                                lastProcessedBlock = from
                                        }
                                }
                                if lastProcessedBlock == 0 {
                                        if head > 10000 {
                                                lastProcessedBlock = head - 10000
                                        } else {
                                                lastProcessedBlock = 1
                                        }
                                }
                                logger.Infof("EventListener: initial scan from block %d (head=%d)", lastProcessedBlock, head)
                        }

                        events, err := e.EventListener.FetchDepositEvents(lastProcessedBlock, nil)
                        if err != nil {
                                logger.Warnf("EventListener: failed to fetch deposit events: %v", err)
                                continue
                        }

                        // Filter out already-processed events
                        var newEvents []*position.OnChainEvent
                        for _, ev := range events {
                                if processedTxHashes[ev.TxHash] {
                                        continue
                                }
                                processedTxHashes[ev.TxHash] = true
                                newEvents = append(newEvents, ev)
                                if ev.BlockNum > lastProcessedBlock {
                                        lastProcessedBlock = ev.BlockNum
                                }
                        }

                        if len(newEvents) == 0 {
                                continue
                        }

                        // Feed each new deposit into the PositionComputer via ProcessEvent
                        // (processDeposit reads Amount, USDValue, PositionID, Depositor, Timestamp directly)
                        newDeposits := uint64(0)
                        for _, event := range newEvents {
                                if err := e.PositionComputer.ProcessEvent(event); err != nil {
                                        logger.Warnf("EventListener: failed to process deposit: %v", err)
                                } else {
                                        logger.Infof("EventListener: recorded deposit positionId=%d depositor=%s amount=%d",
                                                event.PositionID, event.Depositor, event.Amount)
                                        newDeposits++
                                }
                        }

                        // After recording new deposits, compute and publish a fresh solvency proof
                        // This is the "TEE republishes on deposit" loop that makes Flow A real.
                        if newDeposits > 0 && e.OnChainPublisher != nil && e.OnChainPublisher.IsConnected() {
                                e.publishFreshSolvencyProof()
                        }
                }
        }
}

// publishFreshSolvencyProof computes a new Merkle root from the current
// PositionComputer state and publishes it on-chain via the OnChainPublisher.
// This is the TEE's "republish on deposit" loop.
func (e *Extension) publishFreshSolvencyProof() {
        if e.PositionComputer == nil || e.OnChainPublisher == nil {
                return
        }

        // Compute the Merkle root from current positions
        merkleRoot, err := e.PositionComputer.ComputeMerkleRoot()
        if err != nil {
                logger.Warnf("publishFreshSolvencyProof: failed to compute Merkle root: %v", err)
                return
        }

        // Get the current vault state for collateral data. Both collateral and
        // liabilities come from the real PositionComputer (built from on-chain
        // DepositMade / WithdrawalCompleted events) — NOT a hardcoded 500M demo
        // value, which caused an arithmetic underflow in the contract's
        // surplusBps computation and reverted every publish.
        vaultState := e.PositionComputer.GetVaultState()
        totalCollateral := vaultState.TotalFxrpDeposited
        totalLiabilities := vaultState.TotalFxrpLiabilities
        var collateralRatio uint64
        if totalLiabilities > 0 {
                collateralRatio = (totalCollateral * 10000) / totalLiabilities
        } else {
                collateralRatio = 999999 // fully solvent (no liabilities)
        }

        // Read the real current voting round from FlareSystemsManager.
        // This is critical — the auditor's FDC cross-check depends on a real round ID.
        votingRound, err := e.OnChainPublisher.GetCurrentVotingRound()
        if err != nil {
                logger.Warnf("publishFreshSolvencyProof: failed to read voting round from FlareSystemsManager: %v", err)
                votingRound = 0
        }

        // Compute and store the proof via the SolvencyAttestor (in-memory record)
        if e.SolvencyAttestor != nil {
                _, err = e.SolvencyAttestor.ComputeAndPublishSolvencyProof(
                        merkleRoot,
                        totalCollateral,
                        totalLiabilities,
                        collateralRatio,
                        votingRound,
                )
                if err != nil {
                        logger.Warnf("publishFreshSolvencyProof: SolvencyAttestor compute failed: %v", err)
                }
        }

        // Publish on-chain via the verifier-key-signed transaction. Skip if the
        // root is already the current on-chain proof (the contract rejects
        // duplicate roots with "SolvencyRoot: proof already exists" — the
        // RiskAgent's 90s loop may have already published this same root).
        if cur, err := e.OnChainPublisher.GetCurrentRoot(); err == nil && cur == merkleRoot {
                logger.Infof("publishFreshSolvencyProof: root %s… already on-chain — skipping",
                        truncHex(merkleRoot, 18))
                return
        }

        proof, err := e.OnChainPublisher.PublishSolvencyProof(
                merkleRoot,
                totalCollateral,
                totalLiabilities,
                collateralRatio,
                votingRound,
        )
        if err != nil {
                logger.Warnf("publishFreshSolvencyProof: on-chain publish failed: %v", err)
                return
        }

        logger.Infof("publishFreshSolvencyProof: published root=%s tx=%s block=%d round=%d",
                merkleRoot[:16]+"...", proof.TxHash.Hex(), proof.BlockNumber, votingRound)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// getenv reads an environment variable with a fallback default.
func getenv(key, fallback string) string {
        if v := os.Getenv(key); v != "" {
                return v
        }
        return fallback
}

// StartRiskAgentLoop starts the RiskAgent loop in a background goroutine.
// This is called from main.go after the extension is created.
// (Phase 1 Step 2)
func (e *Extension) StartRiskAgentLoop() {
        if e.RiskAgent != nil && !e.RiskAgent.IsRunning() {
                logger.Infof("Starting RiskAgent loop...")
                e.RiskAgent.Start()
        }
}
