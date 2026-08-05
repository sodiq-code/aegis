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

      // ethers returns a read-only Result; convert to a plain array so we can
      // reconstruct the tuple for setPolicy without read-only assignment errors.
      const p = currentPolicy.map((v: unknown) => v) as unknown[];
      // allowedAssets (index 11) is an array — deep-copy to a plain array too
      if (Array.isArray(p[11])) p[11] = Array.from(p[11] as unknown[]);

      // Re-construct the tuple with the same values (the contract sets updatedAt = block.timestamp)
      const policyTuple = [
        p[0],  // policyId
        p[1],  // owner
        p[2],  // name
        p[3],  // description
        p[4],  // riskLevel
        p[5],  // isActive
        p[6],  // createdAt
        p[7],  // updatedAt
        p[8],  // maxDrawdownBps
        p[9],  // maxSingleExposureBps
        p[10], // hedgeThresholdBps
        p[11], // allowedAssets
        p[12], // maxDepositPerTx
        p[13], // maxWithdrawalPerTx
        p[14], // maxTotalExposure
        p[15], // minCollateralRatio
        p[16], // maxLeverage
        p[17], // withdrawalDelaySeconds
        p[18], // rebalanceThresholdBps
        p[19], // maxSlippageBps
        p[20], // onRiskBreach
        p[21], // onSolvencyWarning
      ];

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
