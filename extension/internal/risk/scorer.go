// Package risk implements the AI Risk Scorer for the Aegis vault system.
//
// Train XGBoost risk model on historical FTSO data (offline).
// 
// - Risk Scorer: XGBoost, ~200 trees, depth 6
// - Features: rolling volatility of FXRP/FLR/USD, vault leverage ratio,
// single-asset concentration, cross-chain exposure breakdown,
// recent hedge P&L, time-since-last-rebalance
// - Output: risk score (0-100) and action classification (hold, rebalance, hedge, deleverage)
// - Model file bundled into extension; inference runs in TEE
package risk

import (
        "embed"
        "encoding/json"
        "fmt"
        "math"
        "os"
        "path/filepath"
        "sync"
)

//go:embed model/risk_score_model.json model/risk_action_model.json model/features.json model/model_meta.json
var modelFS embed.FS

// Action labels matching the vault specification
const (
        ActionHold       = 0 // hold - no action needed, risk within acceptable range
        ActionRebalance  = 1 // rebalance - portfolio rebalance recommended, moderate risk
        ActionHedge      = 2 // hedge - hedge position recommended, elevated risk
        ActionDeleverage = 3 // deleverage - reduce leverage urgently, critical risk
)

// ActionNames maps action IDs to human-readable names
var ActionNames = map[int]string{
        ActionHold:       "hold",
        ActionRebalance:  "rebalance",
        ActionHedge:      "hedge",
        ActionDeleverage: "deleverage",
}

// ActionDescriptions maps action IDs to descriptions
var ActionDescriptions = map[int]string{
        ActionHold:       "hold - no action needed, risk within acceptable range",
        ActionRebalance:  "rebalance - portfolio rebalance recommended, moderate risk",
        ActionHedge:      "hedge - hedge position recommended, elevated risk",
        ActionDeleverage: "deleverage - reduce leverage urgently, critical risk",
}

// ─── XGBoost JSON Model Structures ──────────────────────────────────────────

// XGBoostModel represents the XGBoost JSON model format.
type XGBoostModel struct {
        Version []int            `json:"version"`
        Learner XGBoostLearner   `json:"learner"`
}

// XGBoostLearner represents the learner section.
type XGBoostLearner struct {
        FeatureNames      []string                `json:"feature_names"`
        FeatureTypes      []string                `json:"feature_types"`
        GradientBooster  XGBoostGradientBooster  `json:"gradient_booster"`
        LearnerModelParam XGBoostLearnerModelParam `json:"learner_model_param"`
        Objective        XGBoostObjective        `json:"objective"`
}

// XGBoostLearnerModelParam represents learner model parameters.
type XGBoostLearnerModelParam struct {
        BaseScore       string `json:"base_score"`
        BoostFromAverage string `json:"boost_from_average"`
        NumClass        string `json:"num_class"`
        NumFeature      string `json:"num_feature"`
        NumTarget       string `json:"num_target"`
}

// XGBoostGradientBooster represents the gradient booster.
type XGBoostGradientBooster struct {
        Model XGBoostGBModel `json:"model"`
        Name  string         `json:"name"`
}

// XGBoostGBModel represents the GB model.
type XGBoostGBModel struct {
        GBTreeModelParam XGBoostGBTreeModelParam `json:"gbtree_model_param"`
        IterationIndptr  []int                    `json:"iteration_indptr"`
        TreeInfo         []int                    `json:"tree_info"`
        Trees            []XGBoostTree            `json:"trees"`
}

// XGBoostGBTreeModelParam represents the GB tree model parameters.
type XGBoostGBTreeModelParam struct {
        NumParallelTree string `json:"num_parallel_tree"`
        NumTrees        string `json:"num_trees"`
}

// XGBoostTree represents a single decision tree in the XGBoost model.
type XGBoostTree struct {
        BaseWeights      []float64 `json:"base_weights"`
        DefaultLeft      []int     `json:"default_left"`
        LeftChildren     []int     `json:"left_children"`
        RightChildren    []int     `json:"right_children"`
        SplitConditions  []float64 `json:"split_conditions"`
        SplitIndices     []int     `json:"split_indices"`
        SplitType        []int     `json:"split_type"`
        Parents          []int     `json:"parents"`
        TreeParam        XGBoostTreeParam `json:"tree_param"`
}

// XGBoostTreeParam represents tree parameters.
type XGBoostTreeParam struct {
        NumDeleted   string `json:"num_deleted"`
        NumFeature   string `json:"num_feature"`
        NumNodes     string `json:"num_nodes"`
        SizeLeafVector string `json:"size_leaf_vector"`
}

// XGBoostObjective represents the objective function.
type XGBoostObjective struct {
        Name         string                `json:"name"`
        RegLossParam XGBoostRegLossParam   `json:"reg_loss_param"`
}

// XGBoostRegLossParam represents regression loss parameters.
type XGBoostRegLossParam struct {
        ScalePosWeight string `json:"scale_pos_weight"`
}

// ─── Feature and Result Structures ──────────────────────────────────────────

// RiskFeatures represents the input feature vector for the risk model.
// All features match the vault specificationification.
type RiskFeatures struct {
        // Rolling volatility features
        XRPVol24h  float64 `json:"xrp_vol_24h"`
        FLRVol24h  float64 `json:"flr_vol_24h"`
        BTCVol24h  float64 `json:"btc_vol_24h"`
        ETHVol24h  float64 `json:"eth_vol_24h"`
        XRPVol6h   float64 `json:"xrp_vol_6h"`
        XRPVol1h   float64 `json:"xrp_vol_1h"`

        // Price change features
        XRPPriceChange1h  float64 `json:"xrp_price_change_1h"`
        XRPPriceChange6h  float64 `json:"xrp_price_change_6h"`
        XRPPriceChange24h float64 `json:"xrp_price_change_24h"`
        FLRPriceChange24h float64 `json:"flr_price_change_24h"`

        // Vault state features
        LeverageRatio      float64 `json:"leverage_ratio"`
        XRPConcentration   float64 `json:"xrp_concentration"`
        FlareExposure      float64 `json:"flare_exposure"`
        CrossChainExposure float64 `json:"cross_chain_exposure"`

        // Hedge P&L
        HedgePnLPct float64 `json:"hedge_pnl_pct"`

        // Time since rebalance
        HoursSinceRebalance float64 `json:"hours_since_rebalance"`

        // Additional risk indicators
        XRPMomentum float64 `json:"xrp_momentum"`
        XRPFLRCorr  float64 `json:"xrp_flr_corr"`
        XRPDrawdown float64 `json:"xrp_drawdown"`
        VaR95       float64 `json:"var_95"`
}

// RiskResult represents the output of the risk inference.
type RiskResult struct {
        RiskScore      float64         `json:"risk_score"`
        Action         int             `json:"action"`
        ActionName     string          `json:"action_name"`
        ActionProb     []float64       `json:"action_prob"`
        Confidence     float64         `json:"confidence"`
        FeatureContrib []FeatureContrib `json:"feature_contrib"`
}

// FeatureContrib represents a feature's contribution to the risk score.
type FeatureContrib struct {
        FeatureName  string  `json:"feature_name"`
        Value        float64 `json:"value"`
        Contribution float64 `json:"contribution"`
}

// ModelMeta contains metadata about the trained model.
type ModelMeta struct {
        ModelType      string            `json:"model_type"`
        NTrees         int               `json:"n_trees"`
        MaxDepth       int               `json:"max_depth"`
        LearningRate   float64           `json:"learning_rate"`
        FeatureCount   int               `json:"feature_count"`
        RiskScoreRange [2]float64        `json:"risk_score_range"`
        ActionClasses  int               `json:"action_classes"`
        ActionLabels   []string          `json:"action_labels"`
        FTSOFeeds      map[string]string `json:"coston2_ftso_feeds"`
}

// FeatureConfig contains the feature names and metadata.
type FeatureConfig struct {
        FeatureNames       []string          `json:"feature_names"`
        FeatureCount       int               `json:"feature_count"`
        ActionLabels       []string          `json:"action_labels"`
        ActionDescriptions map[string]string `json:"action_descriptions"`
}

// ─── Risk Scorer ────────────────────────────────────────────────────────────

// RiskScorer is the main risk inference engine.
// It loads the XGBoost model files and provides inference capabilities
// that run inside the TEE (FCC extension).
type RiskScorer struct {
        mu            sync.RWMutex
        scoreModel    *XGBoostModel
        actionModel   *XGBoostModel
        featureConfig *FeatureConfig
        modelMeta     *ModelMeta
        baseScore     float64
        initialized   bool
}

// NewRiskScorer creates a new RiskScorer with embedded model files.
func NewRiskScorer() (*RiskScorer, error) {
        rs := &RiskScorer{}
        if err := rs.loadEmbeddedModels(); err != nil {
                return nil, fmt.Errorf("failed to load embedded models: %w", err)
        }
        return rs, nil
}

// NewRiskScorerFromPath creates a new RiskScorer from model files at a given path.
func NewRiskScorerFromPath(modelDir string) (*RiskScorer, error) {
        rs := &RiskScorer{}
        if err := rs.loadModelsFromPath(modelDir); err != nil {
                return nil, fmt.Errorf("failed to load models from path: %w", err)
        }
        return rs, nil
}

// loadEmbeddedModels loads model files from the embedded filesystem.
func (rs *RiskScorer) loadEmbeddedModels() error {
        // Load score model
        scoreData, err := modelFS.ReadFile("model/risk_score_model.json")
        if err != nil {
                return fmt.Errorf("failed to read score model: %w", err)
        }

        var scoreModel XGBoostModel
        if err := json.Unmarshal(scoreData, &scoreModel); err != nil {
                return fmt.Errorf("failed to parse score model: %w", err)
        }
        rs.scoreModel = &scoreModel

        // Parse base score
        rs.baseScore = parseFloat(rs.scoreModel.Learner.LearnerModelParam.BaseScore, 0.5)

        // Load action model
        actionData, err := modelFS.ReadFile("model/risk_action_model.json")
        if err != nil {
                return fmt.Errorf("failed to read action model: %w", err)
        }

        var actionModel XGBoostModel
        if err := json.Unmarshal(actionData, &actionModel); err != nil {
                return fmt.Errorf("failed to parse action model: %w", err)
        }
        rs.actionModel = &actionModel

        // Load feature config
        featureData, err := modelFS.ReadFile("model/features.json")
        if err != nil {
                return fmt.Errorf("failed to read features config: %w", err)
        }

        var featureConfig FeatureConfig
        if err := json.Unmarshal(featureData, &featureConfig); err != nil {
                return fmt.Errorf("failed to parse features config: %w", err)
        }
        rs.featureConfig = &featureConfig

        // Load model metadata
        metaData, err := modelFS.ReadFile("model/model_meta.json")
        if err != nil {
                return fmt.Errorf("failed to read model metadata: %w", err)
        }

        var modelMeta ModelMeta
        if err := json.Unmarshal(metaData, &modelMeta); err != nil {
                return fmt.Errorf("failed to parse model metadata: %w", err)
        }
        rs.modelMeta = &modelMeta

        rs.initialized = true
        return nil
}

// loadModelsFromPath loads model files from a filesystem path.
func (rs *RiskScorer) loadModelsFromPath(modelDir string) error {
        // Load score model
        scorePath := filepath.Join(modelDir, "risk_score_model.json")
        scoreData, err := os.ReadFile(scorePath)
        if err != nil {
                return fmt.Errorf("failed to read score model: %w", err)
        }
        var scoreModel XGBoostModel
        if err := json.Unmarshal(scoreData, &scoreModel); err != nil {
                return fmt.Errorf("failed to parse score model: %w", err)
        }
        rs.scoreModel = &scoreModel

        // Parse base score
        rs.baseScore = parseFloat(rs.scoreModel.Learner.LearnerModelParam.BaseScore, 0.5)

        // Load action model
        actionPath := filepath.Join(modelDir, "risk_action_model.json")
        actionData, err := os.ReadFile(actionPath)
        if err != nil {
                return fmt.Errorf("failed to read action model: %w", err)
        }
        var actionModel XGBoostModel
        if err := json.Unmarshal(actionData, &actionModel); err != nil {
                return fmt.Errorf("failed to parse action model: %w", err)
        }
        rs.actionModel = &actionModel

        // Load feature config
        featurePath := filepath.Join(modelDir, "features.json")
        featureData, err := os.ReadFile(featurePath)
        if err != nil {
                return fmt.Errorf("failed to read features config: %w", err)
        }
        var featureConfig FeatureConfig
        if err := json.Unmarshal(featureData, &featureConfig); err != nil {
                return fmt.Errorf("failed to parse features config: %w", err)
        }
        rs.featureConfig = &featureConfig

        // Load model metadata
        metaPath := filepath.Join(modelDir, "model_meta.json")
        metaData, err := os.ReadFile(metaPath)
        if err != nil {
                return fmt.Errorf("failed to read model metadata: %w", err)
        }
        var modelMeta ModelMeta
        if err := json.Unmarshal(metaData, &modelMeta); err != nil {
                return fmt.Errorf("failed to parse model metadata: %w", err)
        }
        rs.modelMeta = &modelMeta

        rs.initialized = true
        return nil
}

// featuresToVector converts RiskFeatures to a float64 slice for model input.
func featuresToVector(f RiskFeatures) []float64 {
        return []float64{
                f.XRPVol24h, f.FLRVol24h, f.BTCVol24h, f.ETHVol24h,
                f.XRPVol6h, f.XRPVol1h,
                f.XRPPriceChange1h, f.XRPPriceChange6h, f.XRPPriceChange24h, f.FLRPriceChange24h,
                f.LeverageRatio, f.XRPConcentration, f.FlareExposure, f.CrossChainExposure,
                f.HedgePnLPct, f.HoursSinceRebalance,
                f.XRPMomentum, f.XRPFLRCorr, f.XRPDrawdown, f.VaR95,
        }
}

// predictTree predicts the output of a single tree for the given feature vector.
func predictTree(tree *XGBoostTree, features []float64) float64 {
        nodeID := 0
        for {
                // Check if this is a leaf node (left_children == -1 indicates leaf)
                if tree.LeftChildren[nodeID] == -1 {
                        return tree.BaseWeights[nodeID]
                }

                // Get the split feature and threshold
                featureIdx := tree.SplitIndices[nodeID]
                threshold := tree.SplitConditions[nodeID]

                var goLeft bool
                if featureIdx < len(features) {
                        goLeft = features[featureIdx] < threshold
                } else {
                        goLeft = tree.DefaultLeft[nodeID] == 1
                }

                if goLeft {
                        nodeID = tree.LeftChildren[nodeID]
                } else {
                        nodeID = tree.RightChildren[nodeID]
                }

                if nodeID < 0 || nodeID >= len(tree.LeftChildren) {
                        // Safety: should not happen, but guard against malformed trees
                        return 0
                }
        }
}

// predictEnsemble predicts the output of the full ensemble of trees.
func predictEnsemble(model *XGBoostModel, baseScore float64, features []float64) float64 {
        trees := model.Learner.GradientBooster.Model.Trees
        result := baseScore

        for i := 0; i < len(trees); i++ {
                result += predictTree(&trees[i], features)
        }

        return result
}

// predictEnsembleMultiClass predicts the output for multi-class classification.
// Returns raw logits for each class.
func predictEnsembleMultiClass(model *XGBoostModel, baseScore float64, features []float64, nClasses int) []float64 {
        trees := model.Learner.GradientBooster.Model.Trees
        logits := make([]float64, nClasses)

        // For multi-class, trees are grouped by class
        // Each class gets nTrees/nClasses trees
        for i := 0; i < len(trees); i++ {
                classIdx := i % nClasses
                logits[classIdx] += predictTree(&trees[i], features)
        }

        // Add base score
        for i := range logits {
                logits[i] += baseScore
        }

        return logits
}

// Score runs the risk scoring model and returns the risk score (0-100).
func (rs *RiskScorer) Score(features RiskFeatures) (float64, error) {
        if !rs.initialized {
                return 0, fmt.Errorf("risk scorer not initialized")
        }

        rs.mu.RLock()
        defer rs.mu.RUnlock()

        vec := featuresToVector(features)
        score := predictEnsemble(rs.scoreModel, rs.baseScore, vec)

        // Clamp to 0-100 range
        score = math.Max(0, math.Min(100, score))

        return score, nil
}

// Classify runs the action classification model and returns the action probabilities.
func (rs *RiskScorer) Classify(features RiskFeatures) ([]float64, int, error) {
        if !rs.initialized {
                return nil, 0, fmt.Errorf("risk scorer not initialized")
        }

        rs.mu.RLock()
        defer rs.mu.RUnlock()

        vec := featuresToVector(features)
        nClasses := 4
        logits := predictEnsembleMultiClass(rs.actionModel, rs.baseScore, vec, nClasses)

        // Apply softmax to get probabilities
        probs := softmax(logits)

        // Find the action with highest probability
        maxAction := 0
        maxProb := probs[0]
        for i := 1; i < len(probs); i++ {
                if probs[i] > maxProb {
                        maxProb = probs[i]
                        maxAction = i
                }
        }

        return probs, maxAction, nil
}

// ScoreAndClassify runs both models and returns a comprehensive RiskResult.
// This is the main inference entry point for the TEE extension.
func (rs *RiskScorer) ScoreAndClassify(features RiskFeatures) (*RiskResult, error) {
        if !rs.initialized {
                return nil, fmt.Errorf("risk scorer not initialized")
        }

        // Run score model
        score, err := rs.Score(features)
        if err != nil {
                return nil, fmt.Errorf("score failed: %w", err)
        }

        // Run classification model
        probs, action, err := rs.Classify(features)
        if err != nil {
                return nil, fmt.Errorf("classification failed: %w", err)
        }

        // Compute feature contributions (simplified SHAP-like analysis)
        contribs := rs.computeFeatureContributions(features, score)

        result := &RiskResult{
                RiskScore:      score,
                Action:         action,
                ActionName:     ActionNames[action],
                ActionProb:     probs,
                Confidence:     probs[action],
                FeatureContrib: contribs,
        }

        return result, nil
}

// computeFeatureContributions computes a simplified feature contribution analysis.
// This provides SHAP-like interpretability by computing the marginal contribution
// of each feature to the risk score.
func (rs *RiskScorer) computeFeatureContributions(features RiskFeatures, baseScore float64) []FeatureContrib {
        vec := featuresToVector(features)
        contribs := make([]FeatureContrib, len(vec))

        if rs.featureConfig == nil {
                return contribs
        }

        featureNames := rs.featureConfig.FeatureNames

        for i := 0; i < len(vec) && i < len(featureNames); i++ {
                // Zero out this feature and measure the change in score
                modifiedVec := make([]float64, len(vec))
                copy(modifiedVec, vec)
                modifiedVec[i] = 0.0

                modifiedScore := predictEnsemble(rs.scoreModel, rs.baseScore, modifiedVec)
                modifiedScore = math.Max(0, math.Min(100, modifiedScore))

                contribution := baseScore - modifiedScore

                contribs[i] = FeatureContrib{
                        FeatureName:  featureNames[i],
                        Value:        vec[i],
                        Contribution: contribution,
                }
        }

        // Sort by absolute contribution (descending)
        for i := 0; i < len(contribs)-1; i++ {
                for j := i + 1; j < len(contribs); j++ {
                        if math.Abs(contribs[j].Contribution) > math.Abs(contribs[i].Contribution) {
                                contribs[i], contribs[j] = contribs[j], contribs[i]
                        }
                }
        }

        // Return top 5 features
        if len(contribs) > 5 {
                contribs = contribs[:5]
        }

        return contribs
}

// softmax applies the softmax function to convert logits to probabilities.
func softmax(logits []float64) []float64 {
        maxLogit := logits[0]
        for _, l := range logits {
                if l > maxLogit {
                        maxLogit = l
                }
        }

        expSum := 0.0
        probs := make([]float64, len(logits))
        for i, l := range logits {
                probs[i] = math.Exp(l - maxLogit)
                expSum += probs[i]
        }

        for i := range probs {
                probs[i] /= expSum
        }

        return probs
}

// parseFloat safely parses a float from a string.
func parseFloat(s string, defaultVal float64) float64 {
        var f float64
        _, err := fmt.Sscanf(s, "%e", &f)
        if err != nil {
                return defaultVal
        }
        return f
}

// GetModelMeta returns the model metadata.
func (rs *RiskScorer) GetModelMeta() *ModelMeta {
        return rs.modelMeta
}

// GetFeatureConfig returns the feature configuration.
func (rs *RiskScorer) GetFeatureConfig() *FeatureConfig {
        return rs.featureConfig
}

// IsInitialized returns whether the scorer is initialized.
func (rs *RiskScorer) IsInitialized() bool {
        return rs.initialized
}

// NTrees returns the number of trees in the score model.
func (rs *RiskScorer) NTrees() int {
        if rs.scoreModel == nil {
                return 0
        }
        return len(rs.scoreModel.Learner.GradientBooster.Model.Trees)
}

// Validate validates the risk scorer by running a test inference.
func (rs *RiskScorer) Validate() error {
        if !rs.initialized {
                return fmt.Errorf("risk scorer not initialized")
        }

        // Test with a safe feature vector (low risk)
        safeFeatures := RiskFeatures{
                XRPVol24h:          0.02,
                FLRVol24h:          0.03,
                BTCVol24h:          0.02,
                ETHVol24h:          0.025,
                XRPVol6h:           0.01,
                XRPVol1h:           0.005,
                XRPPriceChange1h:   0.001,
                XRPPriceChange6h:   0.003,
                XRPPriceChange24h:  0.005,
                FLRPriceChange24h:  0.008,
                LeverageRatio:      0.3,
                XRPConcentration:   0.5,
                FlareExposure:      0.85,
                CrossChainExposure: 0.15,
                HedgePnLPct:        0.001,
                HoursSinceRebalance: 24,
                XRPMomentum:        0.01,
                XRPFLRCorr:         0.7,
                XRPDrawdown:        0.01,
                VaR95:              -0.01,
        }

        score, err := rs.Score(safeFeatures)
        if err != nil {
                return fmt.Errorf("safe score prediction failed: %w", err)
        }
        if score < 0 || score > 100 {
                return fmt.Errorf("safe score out of range: %f", score)
        }

        probs, action, err := rs.Classify(safeFeatures)
        if err != nil {
                return fmt.Errorf("safe action classification failed: %w", err)
        }
        if action < 0 || action > 3 {
                return fmt.Errorf("safe action out of range: %d", action)
        }
        if len(probs) != 4 {
                return fmt.Errorf("expected 4 action probabilities, got %d", len(probs))
        }

        // Test with a risky feature vector (high risk)
        riskyFeatures := RiskFeatures{
                XRPVol24h:          0.20,
                FLRVol24h:          0.25,
                BTCVol24h:          0.15,
                ETHVol24h:          0.18,
                XRPVol6h:           0.12,
                XRPVol1h:           0.08,
                XRPPriceChange1h:   -0.08,
                XRPPriceChange6h:   -0.12,
                XRPPriceChange24h:  -0.20,
                FLRPriceChange24h:  -0.15,
                LeverageRatio:      0.9,
                XRPConcentration:   0.85,
                FlareExposure:      0.95,
                CrossChainExposure: 0.05,
                HedgePnLPct:        -0.03,
                HoursSinceRebalance: 120,
                XRPMomentum:        -0.25,
                XRPFLRCorr:         0.9,
                XRPDrawdown:        0.25,
                VaR95:              -0.08,
        }

        riskyScore, err := rs.Score(riskyFeatures)
        if err != nil {
                return fmt.Errorf("risky score prediction failed: %w", err)
        }
        if riskyScore < 0 || riskyScore > 100 {
                return fmt.Errorf("risky score out of range: %f", riskyScore)
        }

        // Risky score should be higher than safe score
        if riskyScore <= score {
                return fmt.Errorf("risky score (%f) should be higher than safe score (%f)", riskyScore, score)
        }

        _, riskyAction, err := rs.Classify(riskyFeatures)
        if err != nil {
                return fmt.Errorf("risky action classification failed: %w", err)
        }

        // Risky action should be rebalance, hedge, or deleverage (not hold)
        if riskyAction == ActionHold {
                return fmt.Errorf("risky action should not be hold, got action=%d", riskyAction)
        }

        return nil
}
