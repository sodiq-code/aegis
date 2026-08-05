/**
 * API Route: Policy Update
 *
 * Updates risk policy parameters on the on-chain PolicyRegistry contract.
 * Sends a signed transaction via the verifier key (which is the policy owner).
 *
 * Supported actions:
 * - setPolicyStatus(policyId, isActive) — activate/deactivate a policy
 * - updatePolicy(policyId, fieldChanged) — lightweight update (marks timestamp + event)
 *
 * The verifier key has DEFAULT_ADMIN role on VerifierRole and is the owner of
 * the default policies (created in the PolicyRegistry constructor).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFlareConfig, AEGIS_CONTRACTS } from '@/lib/flare-config';
import { ethers } from 'ethers';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { policyId, action, fieldChanged, isActive } = body as {
      policyId?: number;
      action?: string;
      fieldChanged?: string;
      isActive?: boolean;
    };

    if (policyId === undefined || policyId === null) {
      return NextResponse.json({ error: 'Missing policyId' }, { status: 400 });
    }

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

    const policyRegistryAbi = [
      'function setPolicyStatus(uint256 policyId, bool isActive) external',
      'function setPolicy(uint256 policyId, tuple(uint256 policyId, address owner, string name, string description, uint8 riskLevel, bool isActive, uint256 createdAt, uint256 updatedAt, uint256 maxDrawdownBps, uint256 maxSingleExposureBps, uint256 hedgeThresholdBps, address[] allowedAssets, uint256 maxDepositPerTx, uint256 maxWithdrawalPerTx, uint256 maxTotalExposure, uint256 minCollateralRatio, uint256 maxLeverage, uint256 withdrawalDelaySeconds, uint256 rebalanceThresholdBps, uint256 maxSlippageBps, uint8 onRiskBreach, uint8 onSolvencyWarning) policy) external',
      'function getPolicy(uint256) view returns (tuple(uint256,address,string,string,uint8,bool,uint256,uint256,uint256,uint256,uint256,address[],uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8,uint8))',
      'function getPolicyCount() view returns (uint256)',
      'event PolicyUpdated(uint256 indexed policyId, address indexed owner, string fieldChanged)',
      'event PolicyStatusChanged(uint256 indexed policyId, bool isActive)',
    ];
    const policyRegistry = new ethers.Contract(AEGIS_CONTRACTS.PolicyRegistry, policyRegistryAbi, wallet);

    // Action: set-status — activate or deactivate a policy
    if (action === 'set-status' && isActive !== undefined) {
      const tx = await policyRegistry.setPolicyStatus(policyId, isActive);
      const receipt = await tx.wait();
      return NextResponse.json({
        success: receipt?.status === 1,
        policyId,
        transactionHash: tx.hash,
        blockNumber: receipt?.blockNumber,
        method: 'setPolicyStatus',
        isActive,
        message: `Policy ${policyId} ${isActive ? 'activated' : 'deactivated'} on-chain`,
        lastUpdated: new Date().toISOString(),
      });
    }

    // Action: updatePolicy — read the current policy, update updatedAt + emit event
    // The contract's setPolicy requires the full Policy struct. We read the
    // current policy, then submit it back with the same values (just triggers
    // the PolicyUpdated event and updates updatedAt).
    if (action === 'update-policy' || fieldChanged) {
      const safeField = (fieldChanged || 'manual update').replace(/[^a-zA-Z0-9_: .-]/g, '');
      const currentPolicy = await policyRegistry.getPolicy(policyId);

      // Re-construct the tuple with the same values (the contract sets updatedAt = block.timestamp)
      const policyTuple = {
        policyId: currentPolicy[0],
        owner: currentPolicy[1],
        name: currentPolicy[2],
        description: currentPolicy[3],
        riskLevel: currentPolicy[4],
        isActive: currentPolicy[5],
        createdAt: currentPolicy[6],
        updatedAt: currentPolicy[7],
        maxDrawdownBps: currentPolicy[8],
        maxSingleExposureBps: currentPolicy[9],
        hedgeThresholdBps: currentPolicy[10],
        allowedAssets: currentPolicy[11],
        maxDepositPerTx: currentPolicy[12],
        maxWithdrawalPerTx: currentPolicy[13],
        maxTotalExposure: currentPolicy[14],
        minCollateralRatio: currentPolicy[15],
        maxLeverage: currentPolicy[16],
        withdrawalDelaySeconds: currentPolicy[17],
        rebalanceThresholdBps: currentPolicy[18],
        maxSlippageBps: currentPolicy[19],
        onRiskBreach: currentPolicy[20],
        onSolvencyWarning: currentPolicy[21],
      };

      const tx = await policyRegistry.setPolicy(policyId, policyTuple);
      const receipt = await tx.wait();
      return NextResponse.json({
        success: receipt?.status === 1,
        policyId,
        transactionHash: tx.hash,
        blockNumber: receipt?.blockNumber,
        method: 'setPolicy',
        fieldChanged: safeField,
        message: `Policy ${policyId} updated on-chain (field: ${safeField})`,
        lastUpdated: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      { error: 'Unknown action. Use action: "set-status" or "update-policy"' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Policy update failed' },
      { status: 500 }
    );
  }
}
