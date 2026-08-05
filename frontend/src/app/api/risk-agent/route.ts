/**
 * API Route: Risk Agent
 *
 * Computes a real risk score from on-chain data:
 *   - XRP/USD price from FTSO V2 (via VaultCore.getXrpUsdPrice)
 *   - Vault state (totalDeposited, activePositionCount)
 *   - Solvency proof (collateralRatio, surplusBps)
 *   - Policy thresholds from PolicyRegistry
 *
 * The score uses a real (simple) model:
 *   risk_score = w1*drawdown + w2*leverage + w3*concentration + w4*volatility
 *
 * Where:
 *   drawdown     = how far below the healthy collateral ratio we are
 *   leverage     = totalLiabilities / totalFxrpCollateral (capped 0-1)
 *   concentration = 1.0 if all deposits are in one position, lower if diversified
 *   volatility   = |price_change_pct| over a short window (we use a deterministic
 *                   derived value because Coston2 FTSO doesn't expose historical
 *                   feeds via the standard interface — in production this comes
 *                   from a rolling window of FTSO V2 finalization rounds)
 *
 * GET /api/risk-agent
 *   Returns: { riskScore, action, policy, lastUpdate, sources }
 *
 * POST /api/risk-agent
 *   body: { action: "evaluate", simulatedPriceDrop?: number }
 *   Returns: { riskScore, action, policyDecision, modelExplanation }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFlareConfig, AEGIS_CONTRACTS, FLARE_SYSTEM_CONTRACTS } from '@/lib/flare-config';
import { ethers } from 'ethers';

interface RiskSources {
  xrpUsdPrice: number;
  totalFxrpDeposited: number;
  activePositionCount: number;
  collateralRatio: number;       // bps
  surplusBps: number;
  minCollateralRatio: number;    // bps
  maxDrawdownBps: number;
  hedgeThresholdBps: number;
  rebalanceThresholdBps: number;
  votingRound: number;
}

interface RiskAssessment {
  riskScore: number;             // 0-100
  action: 'HOLD' | 'REBALANCE' | 'HEDGE' | 'DELEVERAGE';
  actionType: number;            // 0=deposit,1=withdraw,2=rebalance
  policyDecision: {
    allowed: boolean;
    policyAction: string;        // ALLOW, REQUIRE_APPROVAL, DELAY, BLOCK
    reason: string;
  };
  modelExplanation: {
    drawdownComponent: number;
    leverageComponent: number;
    concentrationComponent: number;
    volatilityComponent: number;
    weights: { drawdown: number; leverage: number; concentration: number; volatility: number };
  };
  sources: RiskSources;
  timestamp: number;
  votingRound: number;
}

/**
 * Read all on-chain state needed for the risk assessment.
 */
async function readOnChainState(provider: ethers.JsonRpcProvider): Promise<RiskSources> {
  // VaultCore: getXrpUsdPrice, getTotalFxrpDeposited, getActivePositionCount, config
  const vaultAbi = [
    'function getXrpUsdPrice() view returns (uint256)',
    'function getTotalFxrpDeposited() view returns (uint256)',
    'function getActivePositionCount() view returns (uint256)',
    'function config() view returns (tuple(address,address,address,address,address,address,address,uint256,uint256,uint256))',
  ];
  const vault = new ethers.Contract(AEGIS_CONTRACTS.VaultCore, vaultAbi, provider);
  const [xrpPriceBn, totalDepBn, posCountBn, vaultConfig] = await Promise.all([
    vault.getXrpUsdPrice(),
    vault.getTotalFxrpDeposited(),
    vault.getActivePositionCount(),
    vault.config(),
  ]);

  // SolvencyRoot: getCurrentSolvencyProof, getMinCollateralRatio
  const solvAbi = [
    'function getCurrentSolvencyProof() view returns (tuple(bytes32,uint256,uint256,uint256,uint256,uint256,uint256,address,bool))',
    'function getMinCollateralRatio() view returns (uint256)',
  ];
  const solv = new ethers.Contract(AEGIS_CONTRACTS.SolvencyRoot, solvAbi, provider);
  const [proof, minRatio] = await Promise.all([
    solv.getCurrentSolvencyProof(),
    solv.getMinCollateralRatio(),
  ]);
  // proof fields: merkleRoot, surplusBps, totalFxrpCollateral, totalLiabilities, collateralRatio, timestamp, votingRound, attestor, isValid
  const collateralRatio = Number(proof[4]);
  const surplusBps = Number(proof[1]);
  const votingRound = Number(proof[6]);

  // PolicyRegistry: getPolicyCount, getPolicy(1) (use Conservative as reference)
  const polAbi = [
    'function getPolicyCount() view returns (uint256)',
    'function getPolicy(uint256) view returns (tuple(uint256,address,string,string,uint8,bool,uint256,uint256,uint256,uint256,uint256,address[],uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8,uint8))',
  ];
  const pol = new ethers.Contract(AEGIS_CONTRACTS.PolicyRegistry, polAbi, provider);
  const polCount = await pol.getPolicyCount();
  // Default to policy 2 (Balanced) — the policy the demo deposit uses
  const policyId = Number(polCount) >= 2 ? 2 : 1;
  const policy = await pol.getPolicy(policyId);

  return {
    xrpUsdPrice: Number(xrpPriceBn) / 1e6,
    totalFxrpDeposited: Number(totalDepBn),
    activePositionCount: Number(posCountBn),
    collateralRatio,
    surplusBps,
    minCollateralRatio: Number(minRatio),
    maxDrawdownBps: Number(policy[8]),
    hedgeThresholdBps: Number(policy[10]),
    rebalanceThresholdBps: Number(policy[18]),
    votingRound,
  };
}

/**
 * Compute risk score from on-chain sources.
 *
 * Simple linear model (would be XGBoost in production):
 *   risk_score = 100 * (w_d * drawdown_norm + w_l * leverage_norm + w_c * concentration_norm + w_v * volatility_norm)
 *
 * Weights chosen so that a healthy vault (CR >= 150%, low leverage, diversified) scores < 25 (HOLD),
 * and a vault at the warning threshold (CR = 140%) scores around 50-60 (REBALANCE/HEDGE).
 */
function computeRiskScore(sources: RiskSources, simulatedPriceDropPct: number = 0): {
  score: number;
  action: 'HOLD' | 'REBALANCE' | 'HEDGE' | 'DELEVERAGE';
  modelExplanation: RiskAssessment['modelExplanation'];
} {
  const weights = { drawdown: 0.45, leverage: 0.25, concentration: 0.15, volatility: 0.15 };

  // Drawdown component: how far below the healthy ratio we are.
  // healthy = minCollateralRatio. At healthy → 0. At 80% of healthy → 1.0.
  const healthyGap = Math.max(0, sources.minCollateralRatio - sources.collateralRatio);
  const drawdownNorm = Math.min(1, healthyGap / (sources.minCollateralRatio * 0.3));

  // Leverage component: liabilities / collateral.
  // We use the surplusBps inverse: surplus=0 → max leverage, surplus=100% → no leverage.
  // surplusBps is in bps, so 4000 = 40% surplus → leverage = 1 - 0.4 = 0.6
  const leverageRatio = sources.surplusBps > 0 ? Math.max(0, 1 - sources.surplusBps / 10000) : 1.0;
  const leverageNorm = Math.min(1, leverageRatio);

  // Concentration: 1.0 if only 1 active position, lower with more positions.
  // In production this would weigh each position's USD value vs total.
  const concentrationNorm = sources.activePositionCount === 0
    ? 0
    : sources.activePositionCount === 1
      ? 1.0
      : Math.min(1, 1.0 / sources.activePositionCount);

  // Volatility: simulated from the price drop percentage (in production:
  // rolling stddev of FTSO V2 finalization rounds).
  // We add a small baseline (0.05) so even at rest there's some volatility signal.
  const volatilityPct = Math.abs(simulatedPriceDropPct) / 100;
  const volatilityNorm = Math.min(1, 0.05 + volatilityPct * 5);

  const score = Math.min(100, 100 * (
    weights.drawdown * drawdownNorm +
    weights.leverage * leverageNorm +
    weights.concentration * concentrationNorm +
    weights.volatility * volatilityNorm
  ));

  // Action thresholds (match the dashboard UI buckets):
  //   < 25  → HOLD
  //   < 50  → REBALANCE
  //   < 75  → HEDGE
  //   >= 75 → DELEVERAGE
  let action: 'HOLD' | 'REBALANCE' | 'HEDGE' | 'DELEVERAGE';
  if (score < 25) action = 'HOLD';
  else if (score < 50) action = 'REBALANCE';
  else if (score < 75) action = 'HEDGE';
  else action = 'DELEVERAGE';

  return {
    score,
    action,
    modelExplanation: {
      drawdownComponent: weights.drawdown * drawdownNorm,
      leverageComponent: weights.leverage * leverageNorm,
      concentrationComponent: weights.concentration * concentrationNorm,
      volatilityComponent: weights.volatility * volatilityNorm,
      weights,
    },
  };
}

/**
 * Call PolicyRegistry.checkAction(policyId, actionType, amount) on-chain to get
 * the real policy decision. actionType=2 means REBALANCE.
 */
async function checkPolicy(
  provider: ethers.JsonRpcProvider,
  policyId: number,
  actionType: number,
  amount: bigint,
): Promise<{ allowed: boolean; policyAction: string; reason: string }> {
  const polAbi = [
    'function checkAction(uint256 policyId, uint8 actionType, uint256 amount) view returns (bool allowed, uint8 policyAction)',
  ];
  const pol = new ethers.Contract(AEGIS_CONTRACTS.PolicyRegistry, polAbi, provider);
  const [allowed, policyActionBn] = await pol.checkAction(policyId, actionType, amount);
  const policyAction = Number(policyActionBn);
  const actionNames = ['ALLOW', 'REQUIRE_APPROVAL', 'DELAY', 'BLOCK'];
  return {
    allowed,
    policyAction: actionNames[policyAction] || 'UNKNOWN',
    reason: allowed
      ? `Policy ${policyId} allows this action (${actionNames[policyAction]})`
      : `Policy ${policyId} blocks this action (${actionNames[policyAction]})`,
  };
}

export async function GET() {
  try {
    const config = getFlareConfig();
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const sources = await readOnChainState(provider);
    const { score, action, modelExplanation } = computeRiskScore(sources);

    // Map action to actionType for PolicyRegistry
    const actionTypeMap = { HOLD: 0, REBALANCE: 2, HEDGE: 2, DELEVERAGE: 2 } as const;
    const actionType = actionTypeMap[action];
    const policyDecision = await checkPolicy(provider, 2, actionType, BigInt(sources.totalFxrpDeposited));

    const assessment: RiskAssessment = {
      riskScore: score,
      action,
      actionType,
      policyDecision,
      modelExplanation,
      sources,
      timestamp: Math.floor(Date.now() / 1000),
      votingRound: sources.votingRound,
    };

    return NextResponse.json(assessment);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Risk agent failed' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, simulatedPriceDrop } = body as { action?: string; simulatedPriceDrop?: number };

    if (action === 'evaluate') {
      const config = getFlareConfig();
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const sources = await readOnChainState(provider);
      const drop = simulatedPriceDrop || 0;
      const { score, action: riskAction, modelExplanation } = computeRiskScore(sources, drop);

      const actionTypeMap = { HOLD: 0, REBALANCE: 2, HEDGE: 2, DELEVERAGE: 2 } as const;
      const actionType = actionTypeMap[riskAction];
      const policyDecision = await checkPolicy(provider, 2, actionType, BigInt(sources.totalFxrpDeposited));

      const assessment: RiskAssessment = {
        riskScore: score,
        action: riskAction,
        actionType,
        policyDecision,
        modelExplanation,
        sources,
        timestamp: Math.floor(Date.now() / 1000),
        votingRound: sources.votingRound,
      };

      return NextResponse.json(assessment);
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Risk agent evaluate failed' },
      { status: 500 }
    );
  }
}
