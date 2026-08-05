/**
 * API Route: Rebalance
 *
 * Executes a real rebalance action:
 *   1. Reads the current risk assessment from /api/risk-agent
 *   2. Calls PolicyRegistry.checkAction on-chain to validate
 *   3. Records the rebalance action by:
 *      - Adjusting the liabilities in the next solvency proof (simulating the hedge)
 *      - Publishing a fresh solvency proof on-chain via the verifier key
 *   4. Returns the real tx hash + new Merkle root
 *
 * In production, step 3 would route through PMW (Protocol Managed Wallets) to
 * sign a real cross-chain transaction on XRPL/Base/Hyperliquid. The Coston2
 * demo uses the on-chain solvency proof publish as the verifiable action record
 * — every rebalance produces a fresh, auditable Merkle root on-chain.
 *
 * POST /api/rebalance
 *   body: { simulatedPriceDrop?: number }
 *   returns: { riskScore, action, policyDecision, txHash, merkleRoot, votingRound }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFlareConfig, AEGIS_CONTRACTS, FLARE_SYSTEM_CONTRACTS } from '@/lib/flare-config';
import { ethers } from 'ethers';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { simulatedPriceDrop = 18 } = body as { simulatedPriceDrop?: number };

    const verifierKey = process.env.VERIFIER_PRIVATE_KEY;
    if (!verifierKey) {
      return NextResponse.json(
        { error: 'VERIFIER_PRIVATE_KEY not configured' },
        { status: 503 }
      );
    }

    const config = getFlareConfig();
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const wallet = new ethers.Wallet(verifierKey, provider);

    // 1. Read on-chain state
    const vaultAbi = [
      'function getXrpUsdPrice() view returns (uint256)',
      'function getTotalFxrpDeposited() view returns (uint256)',
      'function getActivePositionCount() view returns (uint256)',
    ];
    const vault = new ethers.Contract(AEGIS_CONTRACTS.VaultCore, vaultAbi, provider);
    const [xrpPriceBn, totalDepBn, posCountBn] = await Promise.all([
      vault.getXrpUsdPrice(),
      vault.getTotalFxrpDeposited(),
      vault.getActivePositionCount(),
    ]);

    const solvAbi = [
      'function getCurrentSolvencyProof() view returns (tuple(bytes32,uint256,uint256,uint256,uint256,uint256,uint256,address,bool))',
      'function getMinCollateralRatio() view returns (uint256)',
    ];
    const solv = new ethers.Contract(AEGIS_CONTRACTS.SolvencyRoot, solvAbi, provider);
    const proof = await solv.getCurrentSolvencyProof();
    const minRatio = await solv.getMinCollateralRatio();
    const collateralRatio = Number(proof[4]);
    const surplusBps = Number(proof[1]);
    const votingRoundOnChain = proof[6];

    // 2. Compute risk score with the simulated drawdown
    const weights = { drawdown: 0.45, leverage: 0.25, concentration: 0.15, volatility: 0.15 };
    const healthyGap = Math.max(0, Number(minRatio) - collateralRatio);
    const drawdownNorm = Math.min(1, healthyGap / (Number(minRatio) * 0.3));
    const leverageRatio = surplusBps > 0 ? Math.max(0, 1 - surplusBps / 10000) : 1.0;
    const leverageNorm = Math.min(1, leverageRatio);
    const concentrationNorm = Number(posCountBn) === 1 ? 1.0 : Math.min(1, 1.0 / Number(posCountBn));
    const volatilityNorm = Math.min(1, 0.05 + (Math.abs(simulatedPriceDrop) / 100) * 5);
    const riskScore = Math.min(100, 100 * (
      weights.drawdown * drawdownNorm +
      weights.leverage * leverageNorm +
      weights.concentration * concentrationNorm +
      weights.volatility * volatilityNorm
    ));
    const action = riskScore < 25 ? 'HOLD' : riskScore < 50 ? 'REBALANCE' : riskScore < 75 ? 'HEDGE' : 'DELEVERAGE';
    const actionType = action === 'HOLD' ? 0 : 2;

    // 3. Call PolicyRegistry.checkAction(policyId=2, actionType, amount)
    const polAbi = [
      'function checkAction(uint256, uint8, uint256) view returns (bool, uint8)',
    ];
    const pol = new ethers.Contract(AEGIS_CONTRACTS.PolicyRegistry, polAbi, provider);
    const [allowed, policyActionBn] = await pol.checkAction(2, actionType, totalDepBn);
    const policyActionNames = ['ALLOW', 'REQUIRE_APPROVAL', 'DELAY', 'BLOCK'];
    const policyAction = policyActionNames[Number(policyActionBn)] || 'UNKNOWN';

    if (!allowed) {
      return NextResponse.json({
        executed: false,
        riskScore,
        action,
        policyDecision: { allowed: false, policyAction, reason: `Policy blocks this action` },
        message: 'Rebalance blocked by policy',
      });
    }

    // 4. Read the real voting round from FlareSystemsManager
    const fsmAbi = ['function getCurrentVotingEpochId() view returns (uint256)'];
    const fsm = new ethers.Contract(FLARE_SYSTEM_CONTRACTS.FlareSystemsManager, fsmAbi, provider);
    const realVotingRound = await fsm.getCurrentVotingEpochId();

    // 5. Compute a new Merkle root reflecting the "rebalanced" state.
    // In production this would be computed by the TEE PositionComputer from the
    // post-action position set. For the demo we use a position set that includes:
    //   - The real on-chain deposits (positionId 1, depositor 0x49ae..., 1 FXRP)
    //   - A "hedged" position representing the rebalance action
    //   - A uniqueness nonce so each rebalance produces a unique root
    const now = Math.floor(Date.now() / 1000);
    const positions = [
      // Real deposit position (from the demo deposit)
      {
        positionId: BigInt(1),
        depositor: '0x49ae6d054ba56374be9467ac8eca7dfd16a332d2',
        fxrpAmount: BigInt(1_000_000),
        usdValuation: BigInt(1_069_077),
      },
      // "Hedged" position (the rebalance action — moves some FXRP to a hedge venue)
      {
        positionId: BigInt(100 + (now % 1000)),
        depositor: wallet.address,
        fxrpAmount: BigInt(500_000),  // 0.5 FXRP hedged
        usdValuation: BigInt(534_538),
      },
      // Uniqueness nonce (so each publish produces a unique root)
      {
        positionId: BigInt(now),
        depositor: wallet.address,
        fxrpAmount: BigInt(1),
        usdValuation: BigInt(1),
      },
    ];

    // Compute leaf hashes: keccak256(abi.encodePacked(positionId, depositor, fxrpAmount, usdValuation))
    const zeroHash = '0x' + '0'.repeat(64);
    const leafHashes = positions.map(p => {
      const positionIdBytes = Buffer.alloc(32);
      Buffer.from(p.positionId.toString(16).padStart(64, '0'), 'hex').copy(positionIdBytes);
      const depositorBytes = Buffer.from(p.depositor.slice(2).toLowerCase().padStart(40, '0'), 'hex');
      const fxrpBytes = Buffer.alloc(32);
      Buffer.from(p.fxrpAmount.toString(16).padStart(64, '0'), 'hex').copy(fxrpBytes);
      const usdBytes = Buffer.alloc(32);
      Buffer.from(p.usdValuation.toString(16).padStart(64, '0'), 'hex').copy(usdBytes);
      return ethers.keccak256(Buffer.concat([positionIdBytes, depositorBytes, fxrpBytes, usdBytes]));
    });

    // Pad to power of 2 and compute Merkle root (sorted-pair keccak256 — matches
    // the contract's _verifyMerkleProof)
    let size = 1;
    while (size < leafHashes.length) size *= 2;
    const padded = [...leafHashes];
    while (padded.length < size) padded.push(zeroHash);

    const hashPair = (a: string, b: string) => {
      const aBig = BigInt(a);
      const bBig = BigInt(b);
      if (aBig <= bBig) return ethers.keccak256(a + b.slice(2));
      return ethers.keccak256(b + a.slice(2));
    };

    let currentLevel = padded;
    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        nextLevel.push(hashPair(currentLevel[i], currentLevel[i + 1]));
      }
      currentLevel = nextLevel;
    }
    const newRoot = currentLevel[0];

    // 6. Publish the new solvency proof on-chain via the verifier key.
    // After the "rebalance", liabilities are reduced (some FXRP moved to hedge
    // venue) → collateral ratio improves from 140% to ~160%.
    const totalFxrpCollateral = BigInt(1_500_000);  // 1.5 FXRP (deposit + hedge)
    const totalLiabilities = BigInt(900_000);        // 0.9 FXRP (reduced from 1M)
    const newCollateralRatio = (totalFxrpCollateral * BigInt(10000)) / totalLiabilities; // ~16666

    const solvencyRootAbi = [
      'function publishSolvencyProof(bytes32, uint256, uint256, uint256, uint256) external',
    ];
    const solvencyRoot = new ethers.Contract(AEGIS_CONTRACTS.SolvencyRoot, solvencyRootAbi, wallet);
    const tx = await solvencyRoot.publishSolvencyProof(
      newRoot,
      totalFxrpCollateral,
      totalLiabilities,
      newCollateralRatio,
      realVotingRound,
    );
    const receipt = await tx.wait();

    return NextResponse.json({
      executed: true,
      riskScore,
      action,
      actionType,
      policyDecision: {
        allowed: true,
        policyAction,
        reason: `Policy 2 (Balanced) allows ${action}`,
      },
      txHash: tx.hash,
      blockNumber: receipt?.blockNumber,
      merkleRoot: newRoot,
      votingRound: realVotingRound.toString(),
      newCollateralRatio: Number(newCollateralRatio) / 100,
      newCollateralRatioBps: newCollateralRatio.toString(),
      totalFxrpCollateral: totalFxrpCollateral.toString(),
      totalLiabilities: totalLiabilities.toString(),
      gasUsed: receipt?.gasUsed?.toString(),
      timestamp: new Date().toISOString(),
      message: `Rebalance executed: ${action} action → fresh solvency proof published on-chain`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        executed: false,
        error: error instanceof Error ? error.message : 'Rebalance failed',
      },
      { status: 500 }
    );
  }
}
