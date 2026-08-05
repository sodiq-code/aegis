/**
 * API Route: Deposit Prepare
 *
 * Returns the calldata and contract metadata the frontend needs to construct
 * two MetaMask-signed transactions:
 *   1. FXRP.approve(VaultCore, amount)
 *   2. VaultCore.depositFXRP(amount, policyId)
 *
 * The frontend signs both via MetaMask (window.ethereum). After the deposit
 * is mined, the frontend should call POST /api/solvency to publish a fresh
 * solvency proof that includes the new deposit.
 *
 * POST /api/deposit
 *   body: { amount: "1000", policyId: 1 }
 *   returns: { approveTx, depositTx, vaultCore, fxrp, amount }
 *
 * GET /api/deposit
 *   returns: { vaultCore, fxrp, policies, minDeposit, maxDeposit }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFlareConfig, AEGIS_CONTRACTS, FLARE_SYSTEM_CONTRACTS } from '@/lib/flare-config';
import { ethers } from 'ethers';

/**
 * Compute the ERC20 approve(address,uint256) calldata.
 * selector: 0x095ea7b3
 */
function encodeApprove(spender: string, amount: bigint): string {
  const selector = '0x095ea7b3';
  const spenderPadded = spender.slice(2).toLowerCase().padStart(64, '0');
  const amountPadded = amount.toString(16).padStart(64, '0');
  return selector + spenderPadded + amountPadded;
}

/**
 * Compute the depositFXRP(uint256,uint256) calldata.
 * selector: keccak256("depositFXRP(uint256,uint256)")[:4] = 0xeafc80f6
 * (Verified against the VaultCore contract bytecode on Coston2.)
 */
function encodeDepositFXRP(amount: bigint, policyId: bigint): string {
  const selector = '0xeafc80f6';
  const amountPadded = amount.toString(16).padStart(64, '0');
  const policyIdPadded = policyId.toString(16).padStart(64, '0');
  return selector + amountPadded + policyIdPadded;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, policyId } = body as { amount?: string; policyId?: number };

    if (!amount || parseFloat(amount) <= 0) {
      return NextResponse.json({ error: 'Amount must be > 0' }, { status: 400 });
    }
    if (policyId === undefined || policyId < 1) {
      return NextResponse.json({ error: 'policyId must be >= 1' }, { status: 400 });
    }

    const config = getFlareConfig();
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);

    // Validate policy exists on-chain (named tuple fields for clarity)
    const policyAbi = ['function getPolicy(uint256) view returns (tuple(uint256 policyId, address owner, string name, string description, uint8 riskLevel, bool isActive, uint256 createdAt, uint256 updatedAt, uint256 maxDrawdownBps, uint256 maxSingleExposureBps, uint256 hedgeThresholdBps, address[] allowedAssets, uint256 maxDepositPerTx, uint256 maxWithdrawalPerTx, uint256 maxTotalExposure, uint256 minCollateralRatio, uint256 maxLeverage, uint256 withdrawalDelaySeconds, uint256 rebalanceThresholdBps, uint256 maxSlippageBps, uint8 onRiskBreach, uint8 onSolvencyWarning))'];
    const policyRegistry = new ethers.Contract(AEGIS_CONTRACTS.PolicyRegistry, policyAbi, provider);
    let policy;
    try {
      policy = await policyRegistry.getPolicy(policyId);
    } catch {
      return NextResponse.json(
        { error: `Policy ${policyId} does not exist on-chain` },
        { status: 400 }
      );
    }
    if (!policy.isActive) {
      return NextResponse.json(
        { error: `Policy ${policyId} is not active` },
        { status: 400 }
      );
    }

    // Read VaultCore min/max deposit
    const vaultAbi = [
      'function config() view returns (address,address,address,address,address,address,address,uint256,uint256,uint256)',
    ];
    const vault = new ethers.Contract(AEGIS_CONTRACTS.VaultCore, vaultAbi, provider);
    const vaultConfig = await vault.config();
    const minDeposit = BigInt(vaultConfig[7].toString());
    const maxDeposit = BigInt(vaultConfig[8].toString());

    // FXRP has 6 decimals
    const amountAtomic = BigInt(Math.floor(parseFloat(amount) * 1e6));

    if (amountAtomic < minDeposit) {
      return NextResponse.json(
        {
          error: `Amount below minimum deposit (${Number(minDeposit) / 1e6} FXRP)`,
          minDeposit: minDeposit.toString(),
        },
        { status: 400 }
      );
    }
    if (amountAtomic > maxDeposit) {
      return NextResponse.json(
        {
          error: `Amount above maximum deposit (${Number(maxDeposit) / 1e6} FXRP)`,
          maxDeposit: maxDeposit.toString(),
        },
        { status: 400 }
      );
    }

    // Check the policy's maxDepositPerTx constraint
    const maxDepositPerTx = BigInt(policy.maxDepositPerTx.toString());
    if (amountAtomic > maxDepositPerTx) {
      return NextResponse.json(
        {
          error: `Amount exceeds policy ${policyId} max deposit per tx (${Number(maxDepositPerTx) / 1e6} FXRP)`,
        },
        { status: 400 }
      );
    }

    // Build the two transactions for the frontend to sign via MetaMask
    const approveData = encodeApprove(AEGIS_CONTRACTS.VaultCore, amountAtomic);
    const depositData = encodeDepositFXRP(amountAtomic, BigInt(policyId));

    return NextResponse.json({
      approve: {
        to: FLARE_SYSTEM_CONTRACTS.FXRP,
        data: approveData,
        value: '0x0',
        description: `Approve VaultCore to spend ${amount} FXRP`,
      },
      deposit: {
        to: AEGIS_CONTRACTS.VaultCore,
        data: depositData,
        value: '0x0',
        description: `Deposit ${amount} FXRP into vault with policy ${policyId} (${policy.name})`,
      },
      amount,
      amountAtomic: amountAtomic.toString(),
      policyId,
      policyName: policy.name,
      fxrpToken: FLARE_SYSTEM_CONTRACTS.FXRP,
      vaultCore: AEGIS_CONTRACTS.VaultCore,
      chainId: config.chainId,
      chainIdHex: config.chainIdHex,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to prepare deposit' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/deposit — returns metadata for the deposit form
 */
export async function GET() {
  try {
    const config = getFlareConfig();
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);

    // Read policies (named tuple fields)
    const policyAbi = [
      'function getPolicyCount() view returns (uint256)',
      'function getPolicy(uint256) view returns (tuple(uint256 policyId, address owner, string name, string description, uint8 riskLevel, bool isActive, uint256 createdAt, uint256 updatedAt, uint256 maxDrawdownBps, uint256 maxSingleExposureBps, uint256 hedgeThresholdBps, address[] allowedAssets, uint256 maxDepositPerTx, uint256 maxWithdrawalPerTx, uint256 maxTotalExposure, uint256 minCollateralRatio, uint256 maxLeverage, uint256 withdrawalDelaySeconds, uint256 rebalanceThresholdBps, uint256 maxSlippageBps, uint8 onRiskBreach, uint8 onSolvencyWarning))',
    ];
    const policyRegistry = new ethers.Contract(AEGIS_CONTRACTS.PolicyRegistry, policyAbi, provider);

    const count = await policyRegistry.getPolicyCount();
    const policies: Array<{
      id: number;
      name: string;
      description: string;
      riskLevel: string;
      isActive: boolean;
      maxDrawdownBps: number;
      maxSingleExposureBps: number;
      hedgeThresholdBps: number;
      maxDepositPerTx: number;
      minCollateralRatio: number;
    }> = [];

    const riskLevelNames = ['Conservative', 'Balanced', 'Aggressive', 'Critical'];
    for (let i = 1; i <= Number(count); i++) {
      try {
        const p = await policyRegistry.getPolicy(i);
        policies.push({
          id: Number(p.policyId),
          name: p.name,
          description: p.description,
          riskLevel: riskLevelNames[Number(p.riskLevel)] || 'Unknown',
          isActive: p.isActive,
          maxDrawdownBps: Number(p.maxDrawdownBps),
          maxSingleExposureBps: Number(p.maxSingleExposureBps),
          hedgeThresholdBps: Number(p.hedgeThresholdBps),
          maxDepositPerTx: Number(p.maxDepositPerTx),
          minCollateralRatio: Number(p.minCollateralRatio),
        });
      } catch (e) {
        // Skip invalid policies
      }
    }

    // Read VaultCore config (named tuple fields)
    const vaultAbi = [
      'function config() view returns (tuple(address assetManagerFXRP, address fxrpToken, address ftsoV2, address policyRegistry, address solvencyRoot, address instructionSender, address verifierRole, uint256 minDepositAmount, uint256 maxDepositAmount, uint256 withdrawalWaitPeriod))',
    ];
    const vault = new ethers.Contract(AEGIS_CONTRACTS.VaultCore, vaultAbi, provider);
    const vaultConfig = await vault.config();

    // Read current XRP/USD price
    const xrpUsdAbi = ['function getXrpUsdPrice() view returns (uint256)'];
    const xrpPriceCall = new ethers.Contract(AEGIS_CONTRACTS.VaultCore, xrpUsdAbi, provider);
    let xrpUsdPrice = 0;
    try {
      const p = await xrpPriceCall.getXrpUsdPrice();
      xrpUsdPrice = Number(p) / 1e6;
    } catch {}

    return NextResponse.json({
      vaultCore: AEGIS_CONTRACTS.VaultCore,
      fxrpToken: FLARE_SYSTEM_CONTRACTS.FXRP,
      minDeposit: Number(vaultConfig.minDepositAmount) / 1e6,
      maxDeposit: Number(vaultConfig.maxDepositAmount) / 1e6,
      policies,
      xrpUsdPrice,
      chainId: config.chainId,
      chainIdHex: config.chainIdHex,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read deposit metadata' },
      { status: 500 }
    );
  }
}
