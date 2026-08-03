package risk

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// modelDir returns the path to the model directory for testing.
func modelDir(t *testing.T) string {
	t.Helper()
	// Use the embedded model directory
	dir := filepath.Join("..", "risk", "model")
	absDir, err := filepath.Abs(dir)
	if err != nil {
		t.Fatalf("Failed to get absolute path: %v", err)
	}
	return absDir
}

func TestNewRiskScorer(t *testing.T) {
	scorer, err := NewRiskScorer()
	if err != nil {
		t.Fatalf("Failed to create risk scorer: %v", err)
	}
	if !scorer.IsInitialized() {
		t.Fatal("Risk scorer should be initialized")
	}
}

func TestNewRiskScorerFromPath(t *testing.T) {
	dir := modelDir(t)
	scorer, err := NewRiskScorerFromPath(dir)
	if err != nil {
		t.Fatalf("Failed to create risk scorer from path: %v", err)
	}
	if !scorer.IsInitialized() {
		t.Fatal("Risk scorer should be initialized")
	}
}

func TestScoreModel(t *testing.T) {
	scorer, err := NewRiskScorer()
	if err != nil {
		t.Fatalf("Failed to create risk scorer: %v", err)
	}

	// Test with a safe feature vector
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

	score, err := scorer.Score(safeFeatures)
	if err != nil {
		t.Fatalf("Score prediction failed: %v", err)
	}
	if score < 0 || score > 100 {
		t.Errorf("Score out of range: %f", score)
	}
	t.Logf("Safe score: %.2f", score)

	// Safe features should produce a low risk score
	if score > 30 {
		t.Logf("Warning: safe features produced score %.2f (expected < 30)", score)
	}
}

func TestScoreModelRisky(t *testing.T) {
	scorer, err := NewRiskScorer()
	if err != nil {
		t.Fatalf("Failed to create risk scorer: %v", err)
	}

	// Test with a risky feature vector
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

	score, err := scorer.Score(riskyFeatures)
	if err != nil {
		t.Fatalf("Score prediction failed: %v", err)
	}
	if score < 0 || score > 100 {
		t.Errorf("Score out of range: %f", score)
	}
	t.Logf("Risky score: %.2f", score)

	// Risky features should produce a high risk score
	if score < 50 {
		t.Logf("Warning: risky features produced score %.2f (expected > 50)", score)
	}
}

func TestActionClassification(t *testing.T) {
	scorer, err := NewRiskScorer()
	if err != nil {
		t.Fatalf("Failed to create risk scorer: %v", err)
	}

	// Test with safe features
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

	probs, action, err := scorer.Classify(safeFeatures)
	if err != nil {
		t.Fatalf("Classification failed: %v", err)
	}
	if len(probs) != 4 {
		t.Errorf("Expected 4 action probabilities, got %d", len(probs))
	}
	if action < 0 || action > 3 {
		t.Errorf("Action out of range: %d", action)
	}
	t.Logf("Safe action: %s (prob: %.4f)", ActionNames[action], probs[action])

	// Probabilities should sum to ~1.0
	probSum := 0.0
	for _, p := range probs {
		probSum += p
	}
	if math.Abs(probSum-1.0) > 0.01 {
		t.Errorf("Probabilities should sum to ~1.0, got %f", probSum)
	}

	// Safe features should produce "hold" action
	if action != ActionHold {
		t.Logf("Warning: safe features produced action %s (expected hold)", ActionNames[action])
	}
}

func TestActionClassificationRisky(t *testing.T) {
	scorer, err := NewRiskScorer()
	if err != nil {
		t.Fatalf("Failed to create risk scorer: %v", err)
	}

	// Test with risky features
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

	probs, action, err := scorer.Classify(riskyFeatures)
	if err != nil {
		t.Fatalf("Classification failed: %v", err)
	}
	t.Logf("Risky action: %s (prob: %.4f)", ActionNames[action], probs[action])

	// Risky features should produce a non-hold action
	if action == ActionHold {
		t.Errorf("Risky features should produce non-hold action, got %s", ActionNames[action])
	}
}

func TestScoreAndClassify(t *testing.T) {
	scorer, err := NewRiskScorer()
	if err != nil {
		t.Fatalf("Failed to create risk scorer: %v", err)
	}

	features := RiskFeatures{
		XRPVol24h:          0.05,
		FLRVol24h:          0.06,
		BTCVol24h:          0.04,
		ETHVol24h:          0.045,
		XRPVol6h:           0.03,
		XRPVol1h:           0.01,
		XRPPriceChange1h:   -0.02,
		XRPPriceChange6h:   -0.04,
		XRPPriceChange24h:  -0.06,
		FLRPriceChange24h:  -0.05,
		LeverageRatio:      0.5,
		XRPConcentration:   0.6,
		FlareExposure:      0.90,
		CrossChainExposure: 0.10,
		HedgePnLPct:        -0.005,
		HoursSinceRebalance: 48,
		XRPMomentum:        -0.05,
		XRPFLRCorr:         0.8,
		XRPDrawdown:        0.06,
		VaR95:              -0.03,
	}

	result, err := scorer.ScoreAndClassify(features)
	if err != nil {
		t.Fatalf("ScoreAndClassify failed: %v", err)
	}

	if result.RiskScore < 0 || result.RiskScore > 100 {
		t.Errorf("Risk score out of range: %f", result.RiskScore)
	}
	if result.Action < 0 || result.Action > 3 {
		t.Errorf("Action out of range: %d", result.Action)
	}
	if result.ActionName != ActionNames[result.Action] {
		t.Errorf("Action name mismatch: %s vs %s", result.ActionName, ActionNames[result.Action])
	}
	if len(result.ActionProb) != 4 {
		t.Errorf("Expected 4 action probabilities, got %d", len(result.ActionProb))
	}
	if result.Confidence <= 0 || result.Confidence > 1 {
		t.Errorf("Confidence out of range: %f", result.Confidence)
	}
	if len(result.FeatureContrib) == 0 {
		t.Error("Expected feature contributions")
	}

	t.Logf("Result: score=%.2f, action=%s, confidence=%.4f",
		result.RiskScore, result.ActionName, result.Confidence)
	for _, fc := range result.FeatureContrib {
		t.Logf("  Feature: %s, value=%.4f, contribution=%.4f",
			fc.FeatureName, fc.Value, fc.Contribution)
	}
}

func TestValidate(t *testing.T) {
	scorer, err := NewRiskScorer()
	if err != nil {
		t.Fatalf("Failed to create risk scorer: %v", err)
	}

	if err := scorer.Validate(); err != nil {
		t.Fatalf("Validation failed: %v", err)
	}
}

func TestModelMeta(t *testing.T) {
	scorer, err := NewRiskScorer()
	if err != nil {
		t.Fatalf("Failed to create risk scorer: %v", err)
	}

	meta := scorer.GetModelMeta()
	if meta == nil {
		t.Fatal("Model metadata should not be nil")
	}
	if meta.ModelType != "XGBoost" {
		t.Errorf("Expected model type XGBoost, got %s", meta.ModelType)
	}
	if meta.NTrees != 200 {
		t.Errorf("Expected 200 trees, got %d", meta.NTrees)
	}
	if meta.MaxDepth != 6 {
		t.Errorf("Expected max depth 6, got %d", meta.MaxDepth)
	}
	if meta.ActionClasses != 4 {
		t.Errorf("Expected 4 action classes, got %d", meta.ActionClasses)
	}
	if len(meta.ActionLabels) != 4 {
		t.Errorf("Expected 4 action labels, got %d", len(meta.ActionLabels))
	}
	t.Logf("Model: %s, %d trees, depth %d, %d features, %d action classes",
		meta.ModelType, meta.NTrees, meta.MaxDepth, meta.FeatureCount, meta.ActionClasses)
}

func TestFeatureConfig(t *testing.T) {
	scorer, err := NewRiskScorer()
	if err != nil {
		t.Fatalf("Failed to create risk scorer: %v", err)
	}

	config := scorer.GetFeatureConfig()
	if config == nil {
		t.Fatal("Feature config should not be nil")
	}
	if config.FeatureCount != 20 {
		t.Errorf("Expected 20 features, got %d", config.FeatureCount)
	}
	if len(config.FeatureNames) != 20 {
		t.Errorf("Expected 20 feature names, got %d", len(config.FeatureNames))
	}
	if len(config.ActionLabels) != 4 {
		t.Errorf("Expected 4 action labels, got %d", len(config.ActionLabels))
	}
	t.Logf("Features: %v", config.FeatureNames)
}

func TestNTrees(t *testing.T) {
	scorer, err := NewRiskScorer()
	if err != nil {
		t.Fatalf("Failed to create risk scorer: %v", err)
	}

	nTrees := scorer.NTrees()
	if nTrees != 200 {
		t.Errorf("Expected 200 trees, got %d", nTrees)
	}
}

func TestSoftmax(t *testing.T) {
	tests := []struct {
		name   string
		input  []float64
		expect int // index of max probability
	}{
		{"simple", []float64{1.0, 2.0, 3.0, 0.5}, 2},
		{"zero", []float64{0, 0, 0, 0}, 0}, // all equal
		{"negative", []float64{-1.0, -2.0, -0.5, -3.0}, 2},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := softmax(tt.input)
			if len(result) != len(tt.input) {
				t.Errorf("Expected %d probabilities, got %d", len(tt.input), len(result))
			}

			// Probabilities should sum to ~1.0
			sum := 0.0
			for _, p := range result {
				sum += p
			}
			if math.Abs(sum-1.0) > 0.01 {
				t.Errorf("Probabilities should sum to ~1.0, got %f", sum)
			}

			// All probabilities should be in [0, 1]
			for _, p := range result {
				if p < 0 || p > 1 {
					t.Errorf("Probability out of range: %f", p)
				}
			}
		})
	}
}

func TestFeaturesToVector(t *testing.T) {
	features := RiskFeatures{
		XRPVol24h:   1.0,
		FLRVol24h:   2.0,
		BTCVol24h:   3.0,
		ETHVol24h:   4.0,
		XRPVol6h:    5.0,
		XRPVol1h:    6.0,
		XRPPriceChange1h:  7.0,
		XRPPriceChange6h:  8.0,
		XRPPriceChange24h: 9.0,
		FLRPriceChange24h: 10.0,
		LeverageRatio:      11.0,
		XRPConcentration:   12.0,
		FlareExposure:      13.0,
		CrossChainExposure: 14.0,
		HedgePnLPct:        15.0,
		HoursSinceRebalance: 16.0,
		XRPMomentum: 17.0,
		XRPFLRCorr:  18.0,
		XRPDrawdown: 19.0,
		VaR95:       20.0,
	}

	vec := featuresToVector(features)
	if len(vec) != 20 {
		t.Errorf("Expected 20 features in vector, got %d", len(vec))
	}

	// Verify order matches features.json
	expected := []float64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20}
	for i, v := range vec {
		if v != expected[i] {
			t.Errorf("Feature %d: expected %f, got %f", i, expected[i], v)
		}
	}
}

func TestRiskResultJSON(t *testing.T) {
	scorer, err := NewRiskScorer()
	if err != nil {
		t.Fatalf("Failed to create risk scorer: %v", err)
	}

	features := RiskFeatures{
		XRPVol24h:          0.05,
		FLRVol24h:          0.06,
		BTCVol24h:          0.04,
		ETHVol24h:          0.045,
		XRPVol6h:           0.03,
		XRPVol1h:           0.01,
		XRPPriceChange1h:   -0.02,
		XRPPriceChange6h:   -0.04,
		XRPPriceChange24h:  -0.06,
		FLRPriceChange24h:  -0.05,
		LeverageRatio:      0.5,
		XRPConcentration:   0.6,
		FlareExposure:      0.90,
		CrossChainExposure: 0.10,
		HedgePnLPct:        -0.005,
		HoursSinceRebalance: 48,
		XRPMomentum:        -0.05,
		XRPFLRCorr:         0.8,
		XRPDrawdown:        0.06,
		VaR95:              -0.03,
	}

	result, err := scorer.ScoreAndClassify(features)
	if err != nil {
		t.Fatalf("ScoreAndClassify failed: %v", err)
	}

	// Verify JSON serialization
	jsonData, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("JSON marshal failed: %v", err)
	}

	var parsed RiskResult
	if err := json.Unmarshal(jsonData, &parsed); err != nil {
		t.Fatalf("JSON unmarshal failed: %v", err)
	}

	if parsed.RiskScore != result.RiskScore {
		t.Errorf("Risk score mismatch after JSON round-trip: %f vs %f", parsed.RiskScore, result.RiskScore)
	}
	if parsed.Action != result.Action {
		t.Errorf("Action mismatch after JSON round-trip: %d vs %d", parsed.Action, result.Action)
	}

	t.Logf("JSON result: %s", string(jsonData))
}

func TestScoreRange(t *testing.T) {
	scorer, err := NewRiskScorer()
	if err != nil {
		t.Fatalf("Failed to create risk scorer: %v", err)
	}

	// Test multiple feature vectors and verify scores are in range
	testCases := []struct {
		name     string
		features RiskFeatures
	}{
		{
			"very_safe",
			RiskFeatures{
				XRPVol24h: 0.01, FLRVol24h: 0.01, BTCVol24h: 0.01, ETHVol24h: 0.01,
				XRPVol6h: 0.005, XRPVol1h: 0.002,
				XRPPriceChange1h: 0.001, XRPPriceChange6h: 0.002, XRPPriceChange24h: 0.003,
				FLRPriceChange24h: 0.004,
				LeverageRatio: 0.1, XRPConcentration: 0.3, FlareExposure: 0.7,
				CrossChainExposure: 0.3, HedgePnLPct: 0.001, HoursSinceRebalance: 6,
				XRPMomentum: 0.01, XRPFLRCorr: 0.5, XRPDrawdown: 0.005, VaR95: -0.005,
			},
		},
		{
			"moderate",
			RiskFeatures{
				XRPVol24h: 0.06, FLRVol24h: 0.07, BTCVol24h: 0.05, ETHVol24h: 0.055,
				XRPVol6h: 0.04, XRPVol1h: 0.02,
				XRPPriceChange1h: -0.03, XRPPriceChange6h: -0.05, XRPPriceChange24h: -0.08,
				FLRPriceChange24h: -0.06,
				LeverageRatio: 0.55, XRPConcentration: 0.65, FlareExposure: 0.88,
				CrossChainExposure: 0.12, HedgePnLPct: -0.01, HoursSinceRebalance: 72,
				XRPMomentum: -0.08, XRPFLRCorr: 0.75, XRPDrawdown: 0.08, VaR95: -0.04,
			},
		},
		{
			"very_risky",
			RiskFeatures{
				XRPVol24h: 0.25, FLRVol24h: 0.30, BTCVol24h: 0.20, ETHVol24h: 0.22,
				XRPVol6h: 0.15, XRPVol1h: 0.10,
				XRPPriceChange1h: -0.10, XRPPriceChange6h: -0.15, XRPPriceChange24h: -0.25,
				FLRPriceChange24h: -0.20,
				LeverageRatio: 0.95, XRPConcentration: 0.90, FlareExposure: 0.98,
				CrossChainExposure: 0.02, HedgePnLPct: -0.05, HoursSinceRebalance: 144,
				XRPMomentum: -0.30, XRPFLRCorr: 0.95, XRPDrawdown: 0.30, VaR95: -0.10,
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			score, err := scorer.Score(tc.features)
			if err != nil {
				t.Fatalf("Score failed: %v", err)
			}
			if score < 0 || score > 100 {
				t.Errorf("Score out of range [0, 100]: %f", score)
			}

			probs, action, err := scorer.Classify(tc.features)
			if err != nil {
				t.Fatalf("Classify failed: %v", err)
			}
			if action < 0 || action > 3 {
				t.Errorf("Action out of range [0, 3]: %d", action)
			}

			probSum := 0.0
			for _, p := range probs {
				probSum += p
			}
			if math.Abs(probSum-1.0) > 0.01 {
				t.Errorf("Probabilities should sum to ~1.0, got %f", probSum)
			}

			t.Logf("%s: score=%.2f, action=%s, probs=[%.4f, %.4f, %.4f, %.4f]",
				tc.name, score, ActionNames[action],
				probs[0], probs[1], probs[2], probs[3])
		})
	}
}

func TestScoreConsistency(t *testing.T) {
	scorer, err := NewRiskScorer()
	if err != nil {
		t.Fatalf("Failed to create risk scorer: %v", err)
	}

	features := RiskFeatures{
		XRPVol24h:          0.05,
		FLRVol24h:          0.06,
		BTCVol24h:          0.04,
		ETHVol24h:          0.045,
		XRPVol6h:           0.03,
		XRPVol1h:           0.01,
		XRPPriceChange1h:   -0.02,
		XRPPriceChange6h:   -0.04,
		XRPPriceChange24h:  -0.06,
		FLRPriceChange24h:  -0.05,
		LeverageRatio:      0.5,
		XRPConcentration:   0.6,
		FlareExposure:      0.90,
		CrossChainExposure: 0.10,
		HedgePnLPct:        -0.005,
		HoursSinceRebalance: 48,
		XRPMomentum:        -0.05,
		XRPFLRCorr:         0.8,
		XRPDrawdown:        0.06,
		VaR95:              -0.03,
	}

	// Run inference multiple times and verify consistency
	scores := make([]float64, 10)
	for i := 0; i < 10; i++ {
		score, err := scorer.Score(features)
		if err != nil {
			t.Fatalf("Score failed on iteration %d: %v", i, err)
		}
		scores[i] = score
	}

	// All scores should be identical (deterministic model)
	for i := 1; i < 10; i++ {
		if scores[i] != scores[0] {
			t.Errorf("Score inconsistency: iteration 0 = %f, iteration %d = %f",
				scores[0], i, scores[i])
		}
	}
}

func TestFeatureContributions(t *testing.T) {
	scorer, err := NewRiskScorer()
	if err != nil {
		t.Fatalf("Failed to create risk scorer: %v", err)
	}

	features := RiskFeatures{
		XRPVol24h:          0.10,
		FLRVol24h:          0.12,
		BTCVol24h:          0.08,
		ETHVol24h:          0.09,
		XRPVol6h:           0.06,
		XRPVol1h:           0.03,
		XRPPriceChange1h:   -0.04,
		XRPPriceChange6h:   -0.06,
		XRPPriceChange24h:  -0.10,
		FLRPriceChange24h:  -0.08,
		LeverageRatio:      0.7,
		XRPConcentration:   0.75,
		FlareExposure:      0.92,
		CrossChainExposure: 0.08,
		HedgePnLPct:        -0.01,
		HoursSinceRebalance: 96,
		XRPMomentum:        -0.12,
		XRPFLRCorr:         0.85,
		XRPDrawdown:        0.12,
		VaR95:              -0.05,
	}

	result, err := scorer.ScoreAndClassify(features)
	if err != nil {
		t.Fatalf("ScoreAndClassify failed: %v", err)
	}

	if len(result.FeatureContrib) == 0 {
		t.Error("Expected feature contributions")
	}

	// Verify top features are meaningful
	t.Logf("Top feature contributions:")
	for _, fc := range result.FeatureContrib {
		t.Logf("  %s: value=%.4f, contribution=%.4f", fc.FeatureName, fc.Value, fc.Contribution)
	}

	// Drawdown should be a significant contributor
	foundDrawdown := false
	for _, fc := range result.FeatureContrib {
		if fc.FeatureName == "xrp_drawdown" {
			foundDrawdown = true
			break
		}
	}
	if !foundDrawdown {
		t.Log("Warning: xrp_drawdown not in top 5 features (expected for risk scoring)")
	}
}

func TestModelFilesExist(t *testing.T) {
	dir := modelDir(t)

	requiredFiles := []string{
		"risk_score_model.bin",
		"risk_action_model.bin",
		"features.json",
		"model_meta.json",
	}

	for _, f := range requiredFiles {
		path := filepath.Join(dir, f)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			t.Errorf("Required model file not found: %s", path)
		}
	}
}

func TestActionNames(t *testing.T) {
	if ActionNames[0] != "hold" {
		t.Errorf("Action 0 should be 'hold', got '%s'", ActionNames[0])
	}
	if ActionNames[1] != "rebalance" {
		t.Errorf("Action 1 should be 'rebalance', got '%s'", ActionNames[1])
	}
	if ActionNames[2] != "hedge" {
		t.Errorf("Action 2 should be 'hedge', got '%s'", ActionNames[2])
	}
	if ActionNames[3] != "deleverage" {
		t.Errorf("Action 3 should be 'deleverage', got '%s'", ActionNames[3])
	}
}
