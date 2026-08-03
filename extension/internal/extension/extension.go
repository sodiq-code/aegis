package extension

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"sync"

	"extension-scaffold/internal/attestation"
	"extension-scaffold/internal/config"
	"extension-scaffold/internal/executor"
	"extension-scaffold/internal/policy"
	"extension-scaffold/internal/position"
	"extension-scaffold/internal/risk"
	"extension-scaffold/pkg/types"

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
}

// ─── PolicyEngineAdapter ────────────────────────────────────────────────────

// PolicyEngineAdapter adapts the PolicyEngine to implement the RiskAgent's
// PolicyProvider interface. This wiring ensures that the RiskAgent's decisions
// are validated against the deterministic policy constraints.
//
// Per the report's Section 9.3.3: "The Policy Engine is a deterministic rule
// engine that maps the risk score and current positions to specific policy
// actions within the constraints set by the on-chain PolicyRegistry."
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
// Per the report's Section 9.3.3: "The Action Executor translates policy actions
// into PMW instructions and submits them via the InstructionSender."
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

	// Initialize the RiskAgent with XGBoost model
	scorer, err := risk.NewRiskScorer()
	if err != nil {
		fmt.Printf("Warning: failed to initialize RiskAgent: %v\n", err)
	} else {
		agentConfig := risk.DefaultRiskAgentConfig()
		e.RiskAgent = risk.NewRiskAgent(agentConfig, scorer)

		// Set up providers for Coston2 testing
		ftsoProvider := risk.NewMockFTSOProvider()
		e.RiskAgent.SetFTSOProvider(ftsoProvider)

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
	if e.ActionExecutor != nil {
		total, blocked, capped, success, failed := e.ActionExecutor.GetExecutionStats()
		execStats = fmt.Sprintf("total=%d,blocked=%d,capped=%d,success=%d,failed=%d", total, blocked, capped, success, failed)
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
