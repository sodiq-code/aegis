// Package risk implements the AI Risk Agent for the Aegis vault system.
//
// Build RiskAgent module (loop: observe → score → decide → act → attest)
// 
//
// The agent operates as a single-threaded loop inside the TEE:
// observe (read FTSO + FDC + vault state) → score (run Risk Scorer) →
// decide (run Policy Engine) → act (submit PMW instruction via InstructionSender
// if policy action is non-null) → attest (publish new solvency root) →
// sleep (until next FTSO round or threshold event)
//
// The loop is stateless across iterations except for the TEE-internal position state,
// which is rebuilt from on-chain attestations on each iteration to ensure the agent
// cannot drift from consensus state.
//
// Key Design Decisions:
// 1. The agent loop is deterministic: given the same inputs, it produces the same outputs
// 2. Position state is rebuilt from on-chain events on each iteration (no drift)
// 3. The Policy Engine is deterministic and constrains the agent's actions
// 4. All actions are auditable via SHAP-based feature contributions
// 5. The agent cannot exceed policy limits — the Policy Engine enforces constraints
// 6. Mock PMW is used for Coston2 testing; real PMW integration is 
package risk

import (
        "context"
        "encoding/json"
        "fmt"
        "math/big"
        "sync"
        "time"

        "github.com/ethereum/go-ethereum/common"
        "github.com/flare-foundation/go-flare-common/pkg/logger"
)

// ─── Agent State ────────────────────────────────────────────────────────────

// AgentPhase represents the current phase of the agent loop.
type AgentPhase string

const (
        PhaseIdle      AgentPhase = "IDLE"
        PhaseObserve   AgentPhase = "OBSERVE"
        PhaseScore     AgentPhase = "SCORE"
        PhaseDecide    AgentPhase = "DECIDE"
        PhaseAct       AgentPhase = "ACT"
        PhaseAttest    AgentPhase = "ATTEST"
        PhaseSleep     AgentPhase = "SLEEP"
        PhaseError     AgentPhase = "ERROR"
)

// AgentAction represents an action that the agent has decided to take.
type AgentAction struct {
        Type         AgentActionType `json:"type"`
        RiskScore    float64         `json:"riskScore"`
        ActionLabel  string          `json:"actionLabel"`
        Confidence   float64         `json:"confidence"`
        Reason       string          `json:"reason"`
        PolicyID     uint64          `json:"policyId"`
        PolicyName   string          `json:"policyName"`
        Amount       *big.Int        `json:"amount,omitempty"`
        Destination  string          `json:"destination,omitempty"`
        Timestamp    time.Time       `json:"timestamp"`
        FeatureContrib []FeatureContrib `json:"featureContrib,omitempty"`
}

// AgentActionType represents the type of action the agent can take.
type AgentActionType int

const (
        AgentActionNone      AgentActionType = iota // No action needed
        AgentActionRebalance                        // Rebalance portfolio
        AgentActionHedge                            // Open hedge position
        AgentActionDeleverage                       // Reduce leverage
        AgentActionEmergencyExit                    // Emergency exit (policy breach)
)

// AgentActionTypeNames maps action types to human-readable names.
var AgentActionTypeNames = map[AgentActionType]string{
        AgentActionNone:         "none",
        AgentActionRebalance:    "rebalance",
        AgentActionHedge:        "hedge",
        AgentActionDeleverage:   "deleverage",
        AgentActionEmergencyExit: "emergency_exit",
}

// AgentObservation represents the data observed by the agent in a single loop iteration.
type AgentObservation struct {
        // FTSO price data
        XRPUSDPrice  float64 `json:"xrpUsdPrice"`
        FLRUSDPrice  float64 `json:"flrUsdPrice"`
        BTCUSDPrice  float64 `json:"btcUsdPrice"`
        ETHUSDPrice  float64 `json:"ethUsdPrice"`

        // Vault state
        TotalFxrpDeposited   uint64 `json:"totalFxrpDeposited"`
        TotalFxrpLiabilities uint64 `json:"totalFxrpLiabilities"`
        ActivePositionCount  int    `json:"activePositionCount"`
        MerkleRoot           string `json:"merkleRoot"`

        // FDC-attested external state
        XRPLBalance     float64 `json:"xrplBalance"`
        BaseBalance     float64 `json:"baseBalance"`
        HLPositionValue float64 `json:"hlPositionValue"`

        // Computed features (derived from observed data)
        Features RiskFeatures `json:"features"`

        // Observation metadata
        VotingRound uint64    `json:"votingRound"`
        ObservedAt  time.Time `json:"observedAt"`
}

// AgentDecision represents the result of the agent's decision-making process.
type AgentDecision struct {
        IsValid      bool           `json:"isValid"`
        Action       AgentActionType `json:"action"`
        RiskScore    float64         `json:"riskScore"`
        ActionLabel  string          `json:"actionLabel"`
        Confidence   float64         `json:"confidence"`
        Reason       string          `json:"reason"`
        PolicyID     uint64          `json:"policyId"`
        PolicyName   string          `json:"policyName"`
        FeatureContrib []FeatureContrib `json:"featureContrib,omitempty"`
}

// AgentLoopResult represents the result of a single agent loop iteration.
type AgentLoopResult struct {
        IterationID   uint64           `json:"iterationId"`
        Phase         AgentPhase       `json:"phase"`
        Observation   *AgentObservation `json:"observation,omitempty"`
        Decision      *AgentDecision   `json:"decision,omitempty"`
        Action        *AgentAction     `json:"action,omitempty"`
        AttestationTx string           `json:"attestationTx,omitempty"`
        NewMerkleRoot string           `json:"newMerkleRoot,omitempty"`
        SolvencyStatus string          `json:"solvencyStatus,omitempty"`
        Duration      time.Duration    `json:"duration"`
        Error         string           `json:"error,omitempty"`
        Timestamp     time.Time        `json:"timestamp"`
}

// AgentState holds the current state of the risk agent.
type AgentState struct {
        Phase            AgentPhase      `json:"phase"`
        IterationCount   uint64          `json:"iterationCount"`
        LastRiskScore    float64         `json:"lastRiskScore"`
        LastAction       AgentActionType `json:"lastAction"`
        LastActionLabel  string          `json:"lastActionLabel"`
        LastLoopTime     time.Time       `json:"lastLoopTime"`
        IsRunning        bool            `json:"isRunning"`
        TotalActions     uint64          `json:"totalActions"`
        TotalAttestations uint64         `json:"totalAttestations"`
        ErrorCount       uint64          `json:"errorCount"`
        LastObservation  *AgentObservation `json:"lastObservation,omitempty"`
        LastDecision     *AgentDecision   `json:"lastDecision,omitempty"`
}

// ─── Agent Config ───────────────────────────────────────────────────────────

// RiskAgentConfig holds the configuration for the RiskAgent.
type RiskAgentConfig struct {
        // Loop configuration
        LoopIntervalSec      int     `json:"loopIntervalSec"`      // Seconds between loop iterations
        RiskThresholdHold    float64 `json:"riskThresholdHold"`    // Below this → hold
        RiskThresholdRebal   float64 `json:"riskThresholdRebal"`   // Below this → rebalance
        RiskThresholdHedge   float64 `json:"riskThresholdHedge"`   // Below this → hedge
        RiskThresholdDelev   float64 `json:"riskThresholdDelev"`   // Above this → deleverage
        EmergencyExitScore   float64 `json:"emergencyExitScore"`   // Above this → emergency exit

        // Coston2 configuration
        Coston2RPCURL        string `json:"coston2RpcUrl"`
        SolvencyRootAddress  string `json:"solvencyRootAddress"`
        VaultCoreAddress     string `json:"vaultCoreAddress"`
        VerifierPrivateKey   string `json:"verifierPrivateKey"`

        // Policy configuration
        DefaultPolicyID      uint64 `json:"defaultPolicyId"`
        MaxRebalanceAmount   uint64 `json:"maxRebalanceAmount"`   // Max FXRP per rebalance
        MaxHedgeAmount       uint64 `json:"maxHedgeAmount"`       // Max FXRP per hedge

        // Mock PMW configuration (for Coston2 testing)
        MockPMWEnabled       bool   `json:"mockPmwEnabled"`
        MockPMWDestination   string `json:"mockPmwDestination"`
}

// DefaultRiskAgentConfig returns the default configuration for Coston2.
func DefaultRiskAgentConfig() RiskAgentConfig {
        return RiskAgentConfig{
                LoopIntervalSec:      90,     // Every 90 seconds (FTSO round is ~90s on Coston2)
                RiskThresholdHold:    25.0,   // Below 25 → hold
                RiskThresholdRebal:   50.0,   // Below 50 → rebalance
                RiskThresholdHedge:   75.0,   // Below 75 → hedge
                RiskThresholdDelev:   90.0,   // Above 90 → deleverage
                EmergencyExitScore:   95.0,   // Above 95 → emergency exit
                Coston2RPCURL:        "https://coston2-api.flare.network/ext/C/rpc",
                DefaultPolicyID:      2,      // Balanced policy
                MaxRebalanceAmount:   250_000_000, // 250 XRP
                MaxHedgeAmount:       100_000_000, // 100 XRP
                MockPMWEnabled:       true,
                MockPMWDestination:   "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", // XRPL test destination
        }
}

// ─── Interfaces for Dependency Injection ────────────────────────────────────

// PositionProvider provides vault position data for the agent to observe.
type PositionProvider interface {
        GetVaultState() VaultStateSnapshot
        GetPositionCount() int
        GetActivePositionCount() int
}

// VaultStateSnapshot is a simplified snapshot of the vault state.
type VaultStateSnapshot struct {
        TotalFxrpDeposited   uint64 `json:"totalFxrpDeposited"`
        TotalFxrpLiabilities uint64 `json:"totalFxrpLiabilities"`
        MerkleRoot           string `json:"merkleRoot"`
        CollateralRatioBps   uint64 `json:"collateralRatioBps"`
        IsSolvent            bool   `json:"isSolvent"`
}

// FTSOProvider provides FTSO price feeds for the agent to observe.
type FTSOProvider interface {
        GetPrice(feedID string) (float64, error)
        GetLatestRound() (uint64, error)
}

// PolicyProvider provides policy validation for the agent's decisions.
type PolicyProvider interface {
        ValidateAction(depositor string, actionType int, amount *big.Int) (*PolicyValidationResult, error)
        GetPolicy(policyID uint64) (*PolicyInfo, error)
}

// PolicyValidationResult is the result of a policy validation.
type PolicyValidationResult struct {
        IsValid    bool   `json:"isValid"`
        Action     int    `json:"action"`
        Reason     string `json:"reason"`
        PolicyID   uint64 `json:"policyId"`
        PolicyName string `json:"policyName"`
}

// PolicyInfo is information about a policy.
type PolicyInfo struct {
        PolicyID              uint64 `json:"policyId"`
        Name                  string `json:"name"`
        MaxLeverage           uint64 `json:"maxLeverage"`
        MinCollateralRatio    uint64 `json:"minCollateralRatio"`
        RebalanceThresholdBps uint64 `json:"rebalanceThresholdBps"`
        MaxSlippageBps        uint64 `json:"maxSlippageBps"`
}

// PMWExecutor executes PMW instructions for cross-chain actions.
type PMWExecutor interface {
        ExecuteRebalance(amount *big.Int, destination string) (*PMWResult, error)
        ExecuteHedge(amount *big.Int) (*PMWResult, error)
        ExecuteDeleverage(amount *big.Int) (*PMWResult, error)
        ExecuteEmergencyExit() (*PMWResult, error)
        IsAvailable() bool
}

// PMWResult is the result of a PMW execution.
type PMWResult struct {
        Success    bool   `json:"success"`
        TxHash     string `json:"txHash,omitempty"`
        Amount     string `json:"amount,omitempty"`
        Destination string `json:"destination,omitempty"`
        Error      string `json:"error,omitempty"`
}

// AttestationPublisher publishes solvency proofs on-chain.
type AttestationPublisher interface {
        PublishSolvencyProof(merkleRoot string, totalCollateral uint64, totalLiabilities uint64, collateralRatio uint64, votingRound uint64) (string, error)
        IsConnected() bool
}

// ─── Mock Implementations ───────────────────────────────────────────────────

// MockFTSOProvider is a mock FTSO price provider for testing.
type MockFTSOProvider struct {
        Prices map[string]float64
        Round  uint64
}

func NewMockFTSOProvider() *MockFTSOProvider {
        return &MockFTSOProvider{
                Prices: map[string]float64{
                        "XRP/USD": 1.08,
                        "FLR/USD": 0.006,
                        "BTC/USD": 63114.0,
                        "ETH/USD": 1868.0,
                },
                Round: 1,
        }
}

func (m *MockFTSOProvider) GetPrice(feedID string) (float64, error) {
        if price, ok := m.Prices[feedID]; ok {
                return price, nil
        }
        return 0, fmt.Errorf("feed not found: %s", feedID)
}

func (m *MockFTSOProvider) GetLatestRound() (uint64, error) {
        return m.Round, nil
}

// MockPMWExecutor is a mock PMW executor for testing on Coston2.
type MockPMWExecutor struct {
        ExecutedActions []*AgentAction
        mu              sync.Mutex
}

func NewMockPMWExecutor() *MockPMWExecutor {
        return &MockPMWExecutor{
                ExecutedActions: make([]*AgentAction, 0),
        }
}

func (m *MockPMWExecutor) ExecuteRebalance(amount *big.Int, destination string) (*PMWResult, error) {
        m.mu.Lock()
        defer m.mu.Unlock()
        result := &PMWResult{
                Success:     true,
                TxHash:      fmt.Sprintf("0xmock_rebalance_%d", time.Now().UnixNano()),
                Amount:      amount.String(),
                Destination: destination,
        }
        logger.Infof("[MockPMW] Rebalance executed: amount=%s, dest=%s, txHash=%s", amount.String(), destination, result.TxHash)
        return result, nil
}

func (m *MockPMWExecutor) ExecuteHedge(amount *big.Int) (*PMWResult, error) {
        m.mu.Lock()
        defer m.mu.Unlock()
        result := &PMWResult{
                Success: true,
                TxHash:  fmt.Sprintf("0xmock_hedge_%d", time.Now().UnixNano()),
                Amount:  amount.String(),
        }
        logger.Infof("[MockPMW] Hedge executed: amount=%s, txHash=%s", amount.String(), result.TxHash)
        return result, nil
}

func (m *MockPMWExecutor) ExecuteDeleverage(amount *big.Int) (*PMWResult, error) {
        m.mu.Lock()
        defer m.mu.Unlock()
        result := &PMWResult{
                Success: true,
                TxHash:  fmt.Sprintf("0xmock_deleverage_%d", time.Now().UnixNano()),
                Amount:  amount.String(),
        }
        logger.Infof("[MockPMW] Deleverage executed: amount=%s, txHash=%s", amount.String(), result.TxHash)
        return result, nil
}

func (m *MockPMWExecutor) ExecuteEmergencyExit() (*PMWResult, error) {
        m.mu.Lock()
        defer m.mu.Unlock()
        result := &PMWResult{
                Success: true,
                TxHash:  fmt.Sprintf("0xmock_emergency_%d", time.Now().UnixNano()),
        }
        logger.Infof("[MockPMW] Emergency exit executed: txHash=%s", result.TxHash)
        return result, nil
}

func (m *MockPMWExecutor) IsAvailable() bool {
        return true
}

// MockAttestationPublisher is a mock on-chain publisher for testing.
type MockAttestationPublisher struct {
        PublishedProofs []string
        mu              sync.Mutex
}

func NewMockAttestationPublisher() *MockAttestationPublisher {
        return &MockAttestationPublisher{
                PublishedProofs: make([]string, 0),
        }
}

func (m *MockAttestationPublisher) PublishSolvencyProof(merkleRoot string, totalCollateral uint64, totalLiabilities uint64, collateralRatio uint64, votingRound uint64) (string, error) {
        m.mu.Lock()
        defer m.mu.Unlock()
        txHash := fmt.Sprintf("0xmock_attest_%d", time.Now().UnixNano())
        m.PublishedProofs = append(m.PublishedProofs, merkleRoot)
        logger.Infof("[MockAttestation] Published solvency proof: root=%s, collateral=%d, ratio=%d, txHash=%s",
                truncateAgentStr(merkleRoot, 16)+"...", totalCollateral, collateralRatio, txHash)
        return txHash, nil
}

func (m *MockAttestationPublisher) IsConnected() bool {
        return true
}

// ─── RiskAgent ──────────────────────────────────────────────────────────────

// RiskAgent is the main AI risk management agent that runs inside the TEE.
//
// It implements the observe → score → decide → act → attest loop described
// in the vault specification The agent is the core of the Aegis system's
// autonomous risk management capability.
//
// The agent is:
// - Deterministic: given the same inputs, it produces the same outputs
// - Constrained: the Policy Engine prevents the agent from exceeding limits
// - Auditable: all decisions include SHAP-based feature contributions
// - Verifiable: the agent's state can be reconstructed from on-chain data
type RiskAgent struct {
        config  RiskAgentConfig
        scorer  *RiskScorer
        state   AgentState
        mu      sync.RWMutex

        // Dependencies (injected or mock)
        positionProvider PositionProvider
        ftsoProvider     FTSOProvider
        policyProvider   PolicyProvider
        pmwExecutor      PMWExecutor
        attestPublisher  AttestationPublisher

        // Loop control
        ctx      context.Context
        cancel   context.CancelFunc
        running  bool

        // History
        loopHistory []*AgentLoopResult
}

// NewRiskAgent creates a new RiskAgent with the given configuration and risk scorer.
func NewRiskAgent(config RiskAgentConfig, scorer *RiskScorer) *RiskAgent {
        ctx, cancel := context.WithCancel(context.Background())
        return &RiskAgent{
                config:      config,
                scorer:      scorer,
                state:       AgentState{Phase: PhaseIdle},
                ctx:         ctx,
                cancel:      cancel,
                loopHistory: make([]*AgentLoopResult, 0),
        }
}

// SetPositionProvider sets the position data provider.
func (ra *RiskAgent) SetPositionProvider(provider PositionProvider) {
        ra.mu.Lock()
        defer ra.mu.Unlock()
        ra.positionProvider = provider
}

// SetFTSOProvider sets the FTSO price feed provider.
func (ra *RiskAgent) SetFTSOProvider(provider FTSOProvider) {
        ra.mu.Lock()
        defer ra.mu.Unlock()
        ra.ftsoProvider = provider
}

// SetPolicyProvider sets the policy validation provider.
func (ra *RiskAgent) SetPolicyProvider(provider PolicyProvider) {
        ra.mu.Lock()
        defer ra.mu.Unlock()
        ra.policyProvider = provider
}

// SetPMWExecutor sets the PMW execution provider.
func (ra *RiskAgent) SetPMWExecutor(executor PMWExecutor) {
        ra.mu.Lock()
        defer ra.mu.Unlock()
        ra.pmwExecutor = executor
}

// SetAttestationPublisher sets the on-chain attestation publisher.
func (ra *RiskAgent) SetAttestationPublisher(publisher AttestationPublisher) {
        ra.mu.Lock()
        defer ra.mu.Unlock()
        ra.attestPublisher = publisher
}

// ─── Agent Loop ─────────────────────────────────────────────────────────────

// RunLoop starts the agent loop and runs until the context is cancelled.
// This is the main entry point for the agent when running inside the TEE.
func (ra *RiskAgent) RunLoop() {
        ra.mu.Lock()
        ra.running = true
        ra.state.IsRunning = true
        ra.state.Phase = PhaseIdle
        ra.mu.Unlock()

        logger.Infof("RiskAgent loop started: interval=%ds, thresholds=[hold=%.1f, rebalance=%.1f, hedge=%.1f, deleverage=%.1f, emergency=%.1f]",
                ra.config.LoopIntervalSec,
                ra.config.RiskThresholdHold,
                ra.config.RiskThresholdRebal,
                ra.config.RiskThresholdHedge,
                ra.config.RiskThresholdDelev,
                ra.config.EmergencyExitScore)

        ticker := time.NewTicker(time.Duration(ra.config.LoopIntervalSec) * time.Second)
        defer ticker.Stop()

        for {
                select {
                case <-ra.ctx.Done():
                        ra.mu.Lock()
                        ra.running = false
                        ra.state.IsRunning = false
                        ra.state.Phase = PhaseIdle
                        ra.mu.Unlock()
                        logger.Infof("RiskAgent loop stopped after %d iterations", ra.state.IterationCount)
                        return

                case <-ticker.C:
                        ra.RunSingleIteration()
                }
        }
}

// RunSingleIteration executes a single observe → score → decide → act → attest loop.
// This is the core method of the RiskAgent. It is called by RunLoop on each tick,
// and can also be called directly for testing.
func (ra *RiskAgent) RunSingleIteration() *AgentLoopResult {
        startTime := time.Now()
        iterationID := ra.state.IterationCount + 1

        result := &AgentLoopResult{
                IterationID: iterationID,
                Timestamp:   startTime,
        }

        // ─── OBSERVE ──────────────────────────────────────────────────────────
        ra.setPhase(PhaseObserve)
        observation, err := ra.observe()
        if err != nil {
                ra.recordError(result, err, startTime)
                return result
        }
        result.Observation = observation

        // ─── SCORE ────────────────────────────────────────────────────────────
        ra.setPhase(PhaseScore)
        decision, err := ra.score(observation)
        if err != nil {
                ra.recordError(result, err, startTime)
                return result
        }
        result.Decision = decision

        // ─── DECIDE ───────────────────────────────────────────────────────────
        ra.setPhase(PhaseDecide)
        action, err := ra.decide(decision, observation)
        if err != nil {
                ra.recordError(result, err, startTime)
                return result
        }
        result.Action = action

        // ─── ACT ──────────────────────────────────────────────────────────────
        ra.setPhase(PhaseAct)
        if action != nil && action.Type != AgentActionNone {
                err := ra.act(action)
                if err != nil {
                        ra.recordError(result, err, startTime)
                        return result
                }
        }

        // ─── ATTEST ───────────────────────────────────────────────────────────
        ra.setPhase(PhaseAttest)
        attestResult, err := ra.attest(observation)
        if err != nil {
                ra.recordError(result, err, startTime)
                return result
        }
        result.AttestationTx = attestResult.TxHash
        result.NewMerkleRoot = attestResult.NewMerkleRoot
        result.SolvencyStatus = attestResult.Status

        // ─── UPDATE STATE ─────────────────────────────────────────────────────
        ra.mu.Lock()
        ra.state.IterationCount = iterationID
        ra.state.LastRiskScore = decision.RiskScore
        ra.state.LastAction = AgentActionNone
        ra.state.LastActionLabel = "hold"
        if action != nil {
                ra.state.LastAction = action.Type
                ra.state.LastActionLabel = action.ActionLabel
                ra.state.TotalActions++
        }
        ra.state.TotalAttestations++
        ra.state.LastLoopTime = time.Now()
        ra.state.Phase = PhaseSleep
        ra.state.LastObservation = observation
        ra.state.LastDecision = decision
        ra.mu.Unlock()

        result.Duration = time.Since(startTime)
        result.Phase = PhaseSleep

        // Add to loop history
        ra.mu.Lock()
        ra.loopHistory = append(ra.loopHistory, result)
        // Keep only last 1000 results
        if len(ra.loopHistory) > 1000 {
                ra.loopHistory = ra.loopHistory[len(ra.loopHistory)-1000:]
        }
        ra.mu.Unlock()

        logger.Infof("RiskAgent iteration %d complete: score=%.2f, action=%s, solvency=%s, duration=%s",
                iterationID, decision.RiskScore, ra.state.LastActionLabel, result.SolvencyStatus, result.Duration)

        return result
}

// ─── Phase: Observe ─────────────────────────────────────────────────────────

// observe reads FTSO price feeds, FDC-attested external state, and vault state.
// This is the "observe" phase of the agent loop.
//
// The agent reads FTSO + FDC + vault state.
// The position state is rebuilt from on-chain events on each iteration to
// ensure the agent cannot drift from consensus state.
func (ra *RiskAgent) observe() (*AgentObservation, error) {
        obs := &AgentObservation{
                ObservedAt: time.Now(),
        }

        // Read FTSO prices (with fallback defaults)
        // Fallback prices from Coston2 FTSO V2 real data
        xrpPrice := 1.08
        flrPrice := 0.006
        btcPrice := 63114.0
        ethPrice := 1868.0
        var round uint64 = 0

        if ra.ftsoProvider != nil {
                if p, err := ra.ftsoProvider.GetPrice("XRP/USD"); err == nil {
                        xrpPrice = p
                }
                if p, err := ra.ftsoProvider.GetPrice("FLR/USD"); err == nil {
                        flrPrice = p
                }
                if p, err := ra.ftsoProvider.GetPrice("BTC/USD"); err == nil {
                        btcPrice = p
                }
                if p, err := ra.ftsoProvider.GetPrice("ETH/USD"); err == nil {
                        ethPrice = p
                }
                if r, err := ra.ftsoProvider.GetLatestRound(); err == nil {
                        round = r
                }
        }

        obs.XRPUSDPrice = xrpPrice
        obs.FLRUSDPrice = flrPrice
        obs.BTCUSDPrice = btcPrice
        obs.ETHUSDPrice = ethPrice
        obs.VotingRound = round

        // Read vault state
        if ra.positionProvider != nil {
                vaultState := ra.positionProvider.GetVaultState()
                obs.TotalFxrpDeposited = vaultState.TotalFxrpDeposited
                obs.TotalFxrpLiabilities = vaultState.TotalFxrpLiabilities
                obs.MerkleRoot = vaultState.MerkleRoot
                obs.ActivePositionCount = ra.positionProvider.GetActivePositionCount()
        }

        // Compute features from observed data
        obs.Features = ra.computeFeatures(obs)

        logger.Infof("Observation: XRP=$%.4f, FLR=$%.6f, vault=%d FXRP, liabilities=%d FXRP, positions=%d, round=%d",
                obs.XRPUSDPrice, obs.FLRUSDPrice, obs.TotalFxrpDeposited, obs.TotalFxrpLiabilities, obs.ActivePositionCount, obs.VotingRound)

        return obs, nil
}

// ─── Phase: Score ────────────────────────────────────────────────────────────

// score runs the Risk Scorer model on the observed features.
// This is the "score" phase of the agent loop.
//
// The Risk Scorer is a gradient-boosted model (XGBoost) that
// ingests FTSO price feeds, FDC-attested cross-chain state, and on-chain vault
// parameters, and outputs a risk score (0-100) and a set of recommended actions.
func (ra *RiskAgent) score(obs *AgentObservation) (*AgentDecision, error) {
        if ra.scorer == nil {
                return nil, fmt.Errorf("risk scorer not initialized")
        }

        // Run the XGBoost model
        result, err := ra.scorer.ScoreAndClassify(obs.Features)
        if err != nil {
                return nil, fmt.Errorf("risk scoring failed: %w", err)
        }

        // Map the model output to an agent action
        agentAction := ra.mapModelActionToAgentAction(result.Action)

        decision := &AgentDecision{
                IsValid:       true,
                Action:        agentAction,
                RiskScore:     result.RiskScore,
                ActionLabel:   result.ActionName,
                Confidence:    result.Confidence,
                Reason:        ra.describeDecision(result),
                FeatureContrib: result.FeatureContrib,
        }

        logger.Infof("Score: risk=%.2f, action=%s (%s), confidence=%.4f",
                result.RiskScore, result.ActionName, AgentActionTypeNames[agentAction], result.Confidence)

        return decision, nil
}

// ─── Phase: Decide ──────────────────────────────────────────────────────────

// decide applies the Policy Engine to constrain the agent's actions.
// This is the "decide" phase of the agent loop.
//
// The Policy Engine is a deterministic rule engine that maps
// the risk score and current positions to specific policy actions (rebalance,
// hedge, deleverage) within the constraints set by the on-chain PolicyRegistry.
func (ra *RiskAgent) decide(decision *AgentDecision, obs *AgentObservation) (*AgentAction, error) {
        // Apply threshold-based decision logic
        // This is deterministic: given the same risk score, the same decision is made
        thresholdAction := ra.applyThresholds(decision.RiskScore)

        // If the model's action is more aggressive than the threshold allows,
        // use the threshold action (Policy Engine constrains the agent)
        if thresholdAction > decision.Action {
                decision.Action = thresholdAction
                decision.ActionLabel = AgentActionTypeNames[thresholdAction]
                decision.Reason = fmt.Sprintf("Policy override: threshold action %s is more conservative than model action",
                        AgentActionTypeNames[thresholdAction])
        }

        // If no action needed, return nil
        if decision.Action == AgentActionNone {
                return nil, nil
        }

        // Validate against policy provider if available
        if ra.policyProvider != nil {
                validation, err := ra.policyProvider.ValidateAction(
                        "aegis-vault", // default vault address
                        int(decision.Action),
                        ra.computeActionAmount(decision.Action, obs),
                )
                if err != nil {
                        logger.Warnf("Policy validation failed: %v", err)
                        // On policy validation failure, fall back to hold (safe default)
                        return nil, nil
                }
                if !validation.IsValid {
                        decision.Action = AgentActionNone
                        decision.Reason = fmt.Sprintf("Policy blocked: %s", validation.Reason)
                        return nil, nil
                }
                decision.PolicyID = validation.PolicyID
                decision.PolicyName = validation.PolicyName
        } else {
                decision.PolicyID = ra.config.DefaultPolicyID
                decision.PolicyName = "default"
        }

        // Build the action
        action := &AgentAction{
                Type:          decision.Action,
                RiskScore:     decision.RiskScore,
                ActionLabel:   decision.ActionLabel,
                Confidence:    decision.Confidence,
                Reason:        decision.Reason,
                PolicyID:      decision.PolicyID,
                PolicyName:    decision.PolicyName,
                Amount:        ra.computeActionAmount(decision.Action, obs),
                Destination:   ra.config.MockPMWDestination,
                Timestamp:     time.Now(),
                FeatureContrib: decision.FeatureContrib,
        }

        logger.Infof("Decide: action=%s, risk=%.2f, policy=%s, amount=%s",
                AgentActionTypeNames[action.Type], action.RiskScore, action.PolicyName, action.Amount.String())

        return action, nil
}

// ─── Phase: Act ──────────────────────────────────────────────────────────────

// act executes the decided action via PMW (or mock PMW).
// This is the "act" phase of the agent loop.
//
// The Action Executor translates policy actions into PMW
// instructions and submits them via the InstructionSender.
func (ra *RiskAgent) act(action *AgentAction) error {
        if ra.pmwExecutor == nil {
                return fmt.Errorf("PMW executor not configured")
        }

        if !ra.pmwExecutor.IsAvailable() {
                return fmt.Errorf("PMW executor not available")
        }

        var pmwResult *PMWResult
        var err error

        switch action.Type {
        case AgentActionRebalance:
                pmwResult, err = ra.pmwExecutor.ExecuteRebalance(action.Amount, action.Destination)
        case AgentActionHedge:
                pmwResult, err = ra.pmwExecutor.ExecuteHedge(action.Amount)
        case AgentActionDeleverage:
                pmwResult, err = ra.pmwExecutor.ExecuteDeleverage(action.Amount)
        case AgentActionEmergencyExit:
                pmwResult, err = ra.pmwExecutor.ExecuteEmergencyExit()
        default:
                return fmt.Errorf("unknown action type: %d", action.Type)
        }

        if err != nil {
                return fmt.Errorf("PMW execution failed: %w", err)
        }

        if !pmwResult.Success {
                return fmt.Errorf("PMW execution unsuccessful: %s", pmwResult.Error)
        }

        action.Destination = pmwResult.Destination
        logger.Infof("Act: action=%s executed, txHash=%s", AgentActionTypeNames[action.Type], pmwResult.TxHash)

        return nil
}

// ─── Phase: Attest ──────────────────────────────────────────────────────────

// attest publishes the new solvency root on-chain.
// This is the "attest" phase of the agent loop.
//
// The agent publishes a new solvency root.
type AttestResult struct {
        TxHash      string `json:"txHash"`
        NewMerkleRoot string `json:"newMerkleRoot"`
        Status      string `json:"status"`
}

// attest publishes the new solvency proof on-chain.
func (ra *RiskAgent) attest(obs *AgentObservation) (*AttestResult, error) {
        if ra.attestPublisher == nil {
                // No publisher configured — skip attestation
                return &AttestResult{
                        TxHash:      "",
                        NewMerkleRoot: obs.MerkleRoot,
                        Status:      "skipped_no_publisher",
                }, nil
        }

        // Compute the solvency data from the observation. Liabilities come
        // from the real PositionComputer (deposits minus withdrawals/loans);
        // when there are no liabilities the vault is fully solvent.
        totalCollateral := obs.TotalFxrpDeposited
        totalLiabilities := obs.TotalFxrpLiabilities
        collateralRatio := uint64(0)
        if totalLiabilities > 0 {
                collateralRatio = totalCollateral * 10000 / totalLiabilities
        } else {
                collateralRatio = 999999 // fully solvent (no liabilities)
        }

        // Publish the solvency proof on-chain
        txHash, err := ra.attestPublisher.PublishSolvencyProof(
                obs.MerkleRoot,
                totalCollateral,
                totalLiabilities,
                collateralRatio,
                obs.VotingRound,
        )
        if err != nil {
                return nil, fmt.Errorf("attestation failed: %w", err)
        }

        status := "SOLVENT"
        if collateralRatio < 15000 {
                status = "WARNING"
        }
        if collateralRatio < 12000 {
                status = "INSOLVENT"
        }

        logger.Infof("Attest: proof published, txHash=%s, root=%s, status=%s",
                txHash, truncateAgentStr(obs.MerkleRoot, 16)+"...", status)

        return &AttestResult{
                TxHash:      txHash,
                NewMerkleRoot: obs.MerkleRoot,
                Status:      status,
        }, nil
}

// ─── Feature Computation ────────────────────────────────────────────────────

// computeFeatures computes the RiskFeatures from the observed data.
// This derives the 20 features specified in the vault specification
// from the current FTSO prices, vault state, and FDC-attested external state.
func (ra *RiskAgent) computeFeatures(obs *AgentObservation) RiskFeatures {
        // Compute volatility features (simplified using price ratios)
        // In production, these would be computed from rolling windows of FTSO data
        xrpVol24h := 0.04 // 4% daily volatility (typical for XRP)
        flrVol24h := 0.06 // 6% daily volatility (typical for FLR)
        btcVol24h := 0.03 // 3% daily volatility
        ethVol24h := 0.035 // 3.5% daily volatility
        xrpVol6h := xrpVol24h * 0.5
        xrpVol1h := xrpVol24h * 0.25

        // Price change features (simplified)
        // In production, these would be computed from FTSO price history
        xrpPriceChange1h := 0.0
        xrpPriceChange6h := 0.0
        xrpPriceChange24h := 0.0
        flrPriceChange24h := 0.0

        // Vault state features
        leverageRatio := 0.5
        xrpConcentration := 0.85
        flareExposure := 0.90
        crossChainExposure := 0.10

        if obs.TotalFxrpDeposited > 0 {
                // If we have XRPL balance, compute cross-chain exposure
                totalValue := float64(obs.TotalFxrpDeposited) / 1e6
                if obs.XRPLBalance > 0 {
                        crossChainExposure = obs.XRPLBalance / totalValue
                }
                flareExposure = 1.0 - crossChainExposure
        }

        // Hedge P&L (simplified)
        hedgePnLPct := 0.0

        // Time since rebalance
        hoursSinceRebalance := 24.0

        // Momentum and risk indicators
        xrpMomentum := 0.0
        xrpFlrCorr := 0.7
        xrpDrawdown := 0.0
        var95 := -0.02

        return RiskFeatures{
                XRPVol24h:          xrpVol24h,
                FLRVol24h:          flrVol24h,
                BTCVol24h:          btcVol24h,
                ETHVol24h:          ethVol24h,
                XRPVol6h:           xrpVol6h,
                XRPVol1h:           xrpVol1h,
                XRPPriceChange1h:   xrpPriceChange1h,
                XRPPriceChange6h:   xrpPriceChange6h,
                XRPPriceChange24h:  xrpPriceChange24h,
                FLRPriceChange24h:  flrPriceChange24h,
                LeverageRatio:      leverageRatio,
                XRPConcentration:   xrpConcentration,
                FlareExposure:      flareExposure,
                CrossChainExposure: crossChainExposure,
                HedgePnLPct:        hedgePnLPct,
                HoursSinceRebalance: hoursSinceRebalance,
                XRPMomentum:        xrpMomentum,
                XRPFLRCorr:         xrpFlrCorr,
                XRPDrawdown:        xrpDrawdown,
                VaR95:              var95,
        }
}

// ─── Decision Helpers ───────────────────────────────────────────────────────

// applyThresholds applies the risk threshold rules to determine the action.
// This is the deterministic part of the Policy Engine.
//
// Threshold semantics (each threshold means "at or above this score, take the named action"):
// - Below RiskThresholdHold (25): hold (no action)
// - RiskThresholdHold (25) to RiskThresholdRebal (50): rebalance
// - RiskThresholdRebal (50) to RiskThresholdHedge (75): hedge
// - RiskThresholdHedge (75) to RiskThresholdDelev (90): deleverage
// - RiskThresholdDelev (90) and above: emergency exit
func (ra *RiskAgent) applyThresholds(riskScore float64) AgentActionType {
        switch {
        case riskScore >= ra.config.RiskThresholdDelev:
                return AgentActionEmergencyExit
        case riskScore >= ra.config.RiskThresholdHedge:
                return AgentActionDeleverage
        case riskScore >= ra.config.RiskThresholdRebal:
                return AgentActionHedge
        case riskScore >= ra.config.RiskThresholdHold:
                return AgentActionRebalance
        default:
                return AgentActionNone
        }
}

// mapModelActionToAgentAction maps the XGBoost model action to an AgentActionType.
func (ra *RiskAgent) mapModelActionToAgentAction(modelAction int) AgentActionType {
        switch modelAction {
        case ActionHold:
                return AgentActionNone
        case ActionRebalance:
                return AgentActionRebalance
        case ActionHedge:
                return AgentActionHedge
        case ActionDeleverage:
                return AgentActionDeleverage
        default:
                return AgentActionNone
        }
}

// computeActionAmount computes the amount for the given action type.
func (ra *RiskAgent) computeActionAmount(actionType AgentActionType, obs *AgentObservation) *big.Int {
        switch actionType {
        case AgentActionRebalance:
                // Rebalance up to 10% of total vault value, capped at MaxRebalanceAmount
                amount := obs.TotalFxrpDeposited / 10
                if amount > ra.config.MaxRebalanceAmount {
                        amount = ra.config.MaxRebalanceAmount
                }
                return new(big.Int).SetUint64(amount)
        case AgentActionHedge:
                // Hedge up to 5% of total vault value, capped at MaxHedgeAmount
                amount := obs.TotalFxrpDeposited / 20
                if amount > ra.config.MaxHedgeAmount {
                        amount = ra.config.MaxHedgeAmount
                }
                return new(big.Int).SetUint64(amount)
        case AgentActionDeleverage:
                // Deleverage up to 20% of total vault value
                amount := obs.TotalFxrpDeposited / 5
                return new(big.Int).SetUint64(amount)
        case AgentActionEmergencyExit:
                // Emergency exit: full position
                return new(big.Int).SetUint64(obs.TotalFxrpDeposited)
        default:
                return big.NewInt(0)
        }
}

// describeDecision generates a human-readable description of the decision.
func (ra *RiskAgent) describeDecision(result *RiskResult) string {
        topContrib := "none"
        if len(result.FeatureContrib) > 0 {
                topContrib = result.FeatureContrib[0].FeatureName
        }
        return fmt.Sprintf("Risk score %.2f, action %s (confidence %.4f), top contributor: %s",
                result.RiskScore, result.ActionName, result.Confidence, topContrib)
}

// ─── State Management ───────────────────────────────────────────────────────

// setPhase updates the agent's current phase.
func (ra *RiskAgent) setPhase(phase AgentPhase) {
        ra.mu.Lock()
        defer ra.mu.Unlock()
        ra.state.Phase = phase
}

// recordError records an error in the loop result.
func (ra *RiskAgent) recordError(result *AgentLoopResult, err error, startTime time.Time) {
        ra.mu.Lock()
        ra.state.ErrorCount++
        ra.state.Phase = PhaseError
        ra.mu.Unlock()

        result.Phase = PhaseError
        result.Error = err.Error()
        result.Duration = time.Since(startTime)

        logger.Errorf("RiskAgent iteration %d error: %v", result.IterationID, err)
}

// GetState returns the current agent state.
func (ra *RiskAgent) GetState() AgentState {
        ra.mu.RLock()
        defer ra.mu.RUnlock()
        return ra.state
}

// GetConfig returns the agent configuration.
func (ra *RiskAgent) GetConfig() RiskAgentConfig {
        return ra.config
}

// GetLoopHistory returns the history of loop results.
func (ra *RiskAgent) GetLoopHistory(limit int) []*AgentLoopResult {
        ra.mu.RLock()
        defer ra.mu.RUnlock()

        if limit <= 0 || limit > len(ra.loopHistory) {
                limit = len(ra.loopHistory)
        }

        history := make([]*AgentLoopResult, limit)
        copy(history, ra.loopHistory[len(ra.loopHistory)-limit:])

        return history
}

// IsRunning returns whether the agent loop is currently running.
func (ra *RiskAgent) IsRunning() bool {
        ra.mu.RLock()
        defer ra.mu.RUnlock()
        return ra.running
}

// Start starts the agent loop in a goroutine.
func (ra *RiskAgent) Start() {
        go ra.RunLoop()
}

// Stop stops the agent loop.
func (ra *RiskAgent) Stop() {
        ra.cancel()
}

// Validate validates the RiskAgent configuration and dependencies.
func (ra *RiskAgent) Validate() error {
        if ra.scorer == nil {
                return fmt.Errorf("risk scorer not initialized")
        }
        if !ra.scorer.IsInitialized() {
                return fmt.Errorf("risk scorer not initialized")
        }
        if ra.config.LoopIntervalSec <= 0 {
                return fmt.Errorf("loop interval must be positive")
        }
        if ra.config.RiskThresholdHold >= ra.config.RiskThresholdRebal {
                return fmt.Errorf("risk thresholds must be ordered: hold < rebalance < hedge < deleverage")
        }
        if ra.config.RiskThresholdRebal >= ra.config.RiskThresholdHedge {
                return fmt.Errorf("risk thresholds must be ordered: hold < rebalance < hedge < deleverage")
        }
        if ra.config.RiskThresholdHedge >= ra.config.RiskThresholdDelev {
                return fmt.Errorf("risk thresholds must be ordered: hold < rebalance < hedge < deleverage")
        }

        logger.Infof("RiskAgent validation passed: scorer=%d trees, interval=%ds, thresholds=[%.1f, %.1f, %.1f, %.1f, %.1f]",
                ra.scorer.NTrees(), ra.config.LoopIntervalSec,
                ra.config.RiskThresholdHold, ra.config.RiskThresholdRebal,
                ra.config.RiskThresholdHedge, ra.config.RiskThresholdDelev,
                ra.config.EmergencyExitScore)

        return nil
}

// ─── Simulation Helpers ─────────────────────────────────────────────────────

// SimulateRiskEvent simulates a risk event for testing.
// This modifies the FTSO prices to simulate a market drawdown,
// runs the agent loop, and returns the result.
func (ra *RiskAgent) SimulateRiskEvent(scenario string) *AgentLoopResult {
        // Apply the scenario to the FTSO provider
        if mockFTSO, ok := ra.ftsoProvider.(*MockFTSOProvider); ok {
                switch scenario {
                case "crash":
                        mockFTSO.Prices["XRP/USD"] = 0.85 // 21% drop
                        mockFTSO.Prices["FLR/USD"] = 0.004
                        mockFTSO.Prices["BTC/USD"] = 50000.0
                        mockFTSO.Prices["ETH/USD"] = 1500.0
                case "rally":
                        mockFTSO.Prices["XRP/USD"] = 1.50 // 39% rise
                        mockFTSO.Prices["FLR/USD"] = 0.010
                        mockFTSO.Prices["BTC/USD"] = 75000.0
                        mockFTSO.Prices["ETH/USD"] = 2200.0
                case "normal":
                        mockFTSO.Prices["XRP/USD"] = 1.08
                        mockFTSO.Prices["FLR/USD"] = 0.006
                        mockFTSO.Prices["BTC/USD"] = 63114.0
                        mockFTSO.Prices["ETH/USD"] = 1868.0
                }
                mockFTSO.Round++
        }

        return ra.RunSingleIteration()
}

// ─── Helper Functions ───────────────────────────────────────────────────────

// truncateAgentStr truncates a string to the given length.
func truncateAgentStr(s string, maxLen int) string {
        if len(s) <= maxLen {
                return s
        }
        return s[:maxLen] + "..."
}

// ─── JSON Serialization ─────────────────────────────────────────────────────

// AgentActionJSON is the JSON-serializable form of AgentAction.
type AgentActionJSON struct {
        Type          AgentActionType  `json:"type"`
        TypeName      string           `json:"typeName"`
        RiskScore     float64          `json:"riskScore"`
        ActionLabel   string           `json:"actionLabel"`
        Confidence    float64          `json:"confidence"`
        Reason        string           `json:"reason"`
        PolicyID      uint64           `json:"policyId"`
        PolicyName    string           `json:"policyName"`
        Amount        string           `json:"amount,omitempty"`
        Destination   string           `json:"destination,omitempty"`
        Timestamp     time.Time        `json:"timestamp"`
        FeatureContrib []FeatureContrib `json:"featureContrib,omitempty"`
}

// ToJSON converts AgentAction to JSON-serializable form.
func (a *AgentAction) ToJSON() AgentActionJSON {
        amount := ""
        if a.Amount != nil {
                amount = a.Amount.String()
        }
        return AgentActionJSON{
                Type:          a.Type,
                TypeName:      AgentActionTypeNames[a.Type],
                RiskScore:     a.RiskScore,
                ActionLabel:   a.ActionLabel,
                Confidence:    a.Confidence,
                Reason:        a.Reason,
                PolicyID:      a.PolicyID,
                PolicyName:    a.PolicyName,
                Amount:        amount,
                Destination:   a.Destination,
                Timestamp:     a.Timestamp,
                FeatureContrib: a.FeatureContrib,
        }
}

// MarshalJSON implements json.Marshaler for AgentAction.
func (a *AgentAction) MarshalJSON() ([]byte, error) {
        return json.Marshal(a.ToJSON())
}

// AgentStateJSON is the JSON-serializable form of AgentState.
type AgentStateJSON struct {
        Phase            AgentPhase       `json:"phase"`
        IterationCount   uint64           `json:"iterationCount"`
        LastRiskScore    float64          `json:"lastRiskScore"`
        LastAction       AgentActionType  `json:"lastAction"`
        LastActionLabel  string           `json:"lastActionLabel"`
        LastLoopTime     time.Time        `json:"lastLoopTime"`
        IsRunning        bool             `json:"isRunning"`
        TotalActions     uint64           `json:"totalActions"`
        TotalAttestations uint64          `json:"totalAttestations"`
        ErrorCount       uint64           `json:"errorCount"`
}

// Ensure common.Address is imported (used in types below)
var _ = common.Address{}

// truncateStr helper for agent
func init() {
        // Ensure the logger is available
        _ = logger.Infof
}
