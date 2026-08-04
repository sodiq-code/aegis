/**
 * API Route: Policy Update
 * 
 * Updates risk policy parameters on the on-chain PolicyRegistry contract.
 * Sends a signed transaction to PolicyRegistry on Coston2.
 * 
 * Only the policy owner (deployer) can call these functions.
 * This route delegates signing to a Python helper script.
 * The private key is only used server-side — never exposed to the client.
 * 
 * Supported actions:
 * - updatePolicy(policyId, fieldChanged) — lightweight update (marks timestamp + event)
 * - setPolicyStatus(policyId, isActive) — activate/deactivate a policy
 * - setPolicy(policyId, Policy) — full struct update with all fields
 */

import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { policyId, action, fieldChanged, isActive } = body;

    if (policyId === undefined || policyId === null) {
      return NextResponse.json(
        { error: 'Missing policyId' },
        { status: 400 }
      );
    }

    const { execSync } = await import('child_process');
    const scriptPath = '/home/z/my-project/aegis/frontend/scripts/policy-tx.py';

    // Action: set-status — activate or deactivate a policy
    if (action === 'set-status' && isActive !== undefined) {
      const statusStr = isActive ? 'true' : 'false';
      const result = execSync(
        `python3 ${scriptPath} set-status ${policyId} ${statusStr}`,
        { timeout: 120000, encoding: 'utf-8' }
      );
      const txResult = JSON.parse(result);

      return NextResponse.json({
        success: true,
        policyId: parseInt(policyId),
        transactionHash: txResult.txHash,
        blockNumber: txResult.blockNumber,
        method: 'setPolicyStatus',
        isActive,
        message: `Policy ${policyId} ${isActive ? 'activated' : 'deactivated'} on-chain`,
        lastUpdated: new Date().toISOString(),
      });
    }

    // Action: updatePolicy — lightweight update (timestamp + event)
    if (fieldChanged) {
      // Sanitize fieldChanged to prevent command injection
      const safeField = fieldChanged.replace(/[^a-zA-Z0-9_: .-]/g, '');
      const result = execSync(
        `python3 ${scriptPath} update-policy ${policyId} "${safeField}"`,
        { timeout: 120000, encoding: 'utf-8' }
      );
      const txResult = JSON.parse(result);

      return NextResponse.json({
        success: true,
        policyId: parseInt(policyId),
        transactionHash: txResult.txHash,
        blockNumber: txResult.blockNumber,
        method: 'updatePolicy',
        fieldChanged: safeField,
        message: `Policy ${policyId} updated on-chain (field: ${safeField})`,
        lastUpdated: new Date().toISOString(),
      });
    }

    // Full setPolicy mode — requires complete policy object
    const { policyData } = body;
    if (!policyData) {
      return NextResponse.json(
        { error: 'Missing action, fieldChanged, or policyData' },
        { status: 400 }
      );
    }

    const fs = await import('fs/promises');
    const tmpFile = `/tmp/aegis_policy_update_${policyId}.json`;
    await fs.writeFile(tmpFile, JSON.stringify(policyData));

    const result = execSync(
      `python3 ${scriptPath} set-policy ${policyId} ${tmpFile}`,
      { timeout: 120000, encoding: 'utf-8' }
    );
    const txResult = JSON.parse(result);

    // Clean up temp file
    await fs.unlink(tmpFile).catch(() => {});

    return NextResponse.json({
      success: true,
      policyId: parseInt(policyId),
      transactionHash: txResult.txHash,
      blockNumber: txResult.blockNumber,
      method: 'setPolicy',
      message: `Policy ${policyId} fully updated on-chain`,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update policy',
      },
      { status: 500 }
    );
  }
}
