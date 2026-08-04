/**
 * API Route: Policy State
 * 
 * Reads risk policy data from the on-chain PolicyRegistry contract on Coston2.
 * Returns all policies, policy count, and action validation results.
 * 
 * This is the primary data source for the Policy view (configurator).
 * Uses correct keccak256 function selectors for PolicyRegistry.
 */

import { NextResponse } from 'next/server';
import { getFlareConfig, AEGIS_CONTRACTS } from '@/lib/flare-config';

interface JsonRpcResponse {
  result?: string;
  error?: { code: number; message: string };
}

async function rpcCall(method: string, params: unknown[] = []): Promise<string> {
  const config = getFlareConfig();
  const response = await fetch(config.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data: JsonRpcResponse = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.result || '0x0';
}

async function ethCall(to: string, data: string): Promise<string> {
  return rpcCall('eth_call', [{ to, data }, 'latest']);
}

// Correct keccak256 function selectors for PolicyRegistry
const SELECTORS = {
  getPolicyCount: '0xe59771d2',      // getPolicyCount()
  getPolicy: '0x2b07fce3',           // getPolicy(uint256)
  checkAction: '0x0415e2da',         // checkAction(uint256,uint8,uint256)
} as const;

const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const POLICY_ACTIONS = ['ALLOW', 'REQUIRE_APPROVAL', 'DELAY', 'BLOCK'] as const;

interface OnChainPolicy {
  policyId: number;
  owner: string;
  name: string;
  description: string;
  riskLevel: number;
  riskLevelName: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  maxDrawdownBps: number;
  maxSingleExposureBps: number;
  hedgeThresholdBps: number;
  allowedAssets: string[];
  maxDepositPerTx: number;
  maxWithdrawalPerTx: number;
  maxTotalExposure: number;
  minCollateralRatio: number;
  maxLeverage: number;
  withdrawalDelaySeconds: number;
  rebalanceThresholdBps: number;
  maxSlippageBps: number;
  onRiskBreach: number;
  onRiskBreachName: string;
  onSolvencyWarning: number;
  onSolvencyWarningName: string;
}

/**
 * Decode a Policy struct from ABI-encoded hex data.
 * The Policy struct contains dynamic types (string, address[]) which require
 * offset-based decoding.
 */
function decodePolicyStruct(result: string): OnChainPolicy | null {
  try {
    const hex = result.slice(2); // strip 0x
    const words: string[] = [];
    for (let i = 0; i < hex.length; i += 64) {
      words.push(hex.slice(i, i + 64));
    }

    const s = 1; // struct starts at word[1] (word[0] is the outer offset pointer)
    const parseU256 = (idx: number) => parseInt(words[s + idx], 16);
    const parseAddress = (idx: number) => '0x' + words[s + idx].slice(-40);
    const parseBool = (idx: number) => parseInt(words[s + idx], 16) !== 0;

    const policyId = parseU256(0);
    const owner = parseAddress(1);
    const nameOffset = parseU256(2);
    const descOffset = parseU256(3);
    const riskLevel = parseU256(4);
    const isActive = parseBool(5);
    const createdAt = parseU256(6);
    const updatedAt = parseU256(7);
    const maxDrawdownBps = parseU256(8);
    const maxSingleExposureBps = parseU256(9);
    const hedgeThresholdBps = parseU256(10);
    const allowedAssetsOffset = parseU256(11);
    const maxDepositPerTx = parseU256(12);
    const maxWithdrawalPerTx = parseU256(13);
    const maxTotalExposure = parseU256(14);
    const minCollateralRatio = parseU256(15);
    const maxLeverage = parseU256(16);
    const withdrawalDelaySeconds = parseU256(17);
    const rebalanceThresholdBps = parseU256(18);
    const maxSlippageBps = parseU256(19);
    const onRiskBreach = parseU256(20);
    const onSolvencyWarning = parseU256(21);

    // Decode name string (dynamic type via offset)
    const nameWordIdx = s + (nameOffset / 32);
    const nameLen = parseInt(words[nameWordIdx], 16);
    const nameNWords = Math.ceil(nameLen / 32);
    let nameHex = '';
    for (let i = 0; i < nameNWords; i++) {
      nameHex += words[nameWordIdx + 1 + i];
    }
    const name = Buffer.from(nameHex.slice(0, nameLen * 2), 'hex').toString('utf-8');

    // Decode description string (dynamic type via offset)
    const descWordIdx = s + (descOffset / 32);
    const descLen = parseInt(words[descWordIdx], 16);
    const descNWords = Math.ceil(descLen / 32);
    let descHex = '';
    for (let i = 0; i < descNWords; i++) {
      descHex += words[descWordIdx + 1 + i];
    }
    const description = Buffer.from(descHex.slice(0, descLen * 2), 'hex').toString('utf-8');

    // Decode allowedAssets (address[] - dynamic type via offset)
    const assetsWordIdx = s + (allowedAssetsOffset / 32);
    const assetsCount = parseInt(words[assetsWordIdx], 16);
    const allowedAssets: string[] = [];
    for (let i = 0; i < assetsCount; i++) {
      allowedAssets.push('0x' + words[assetsWordIdx + 1 + i].slice(-40));
    }

    return {
      policyId,
      owner,
      name,
      description,
      riskLevel,
      riskLevelName: RISK_LEVELS[riskLevel] || 'UNKNOWN',
      isActive,
      createdAt,
      updatedAt,
      maxDrawdownBps,
      maxSingleExposureBps,
      hedgeThresholdBps,
      allowedAssets,
      maxDepositPerTx,
      maxWithdrawalPerTx,
      maxTotalExposure,
      minCollateralRatio,
      maxLeverage,
      withdrawalDelaySeconds,
      rebalanceThresholdBps,
      maxSlippageBps,
      onRiskBreach,
      onRiskBreachName: POLICY_ACTIONS[onRiskBreach] || 'UNKNOWN',
      onSolvencyWarning,
      onSolvencyWarningName: POLICY_ACTIONS[onSolvencyWarning] || 'UNKNOWN',
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const policyId = searchParams.get('policyId');
    const checkDeposit = searchParams.get('checkDeposit');
    const checkWithdraw = searchParams.get('checkWithdraw');

    const policyRegistry = AEGIS_CONTRACTS.PolicyRegistry;

    // Get policy count
    const countHex = await ethCall(policyRegistry, SELECTORS.getPolicyCount);
    const policyCount = parseInt(countHex, 16);

    // If a specific policy ID is requested, return just that policy
    if (policyId) {
      const id = parseInt(policyId);
      const callData = SELECTORS.getPolicy + id.toString(16).padStart(64, '0');
      const result = await ethCall(policyRegistry, callData);
      const policy = decodePolicyStruct(result);

      if (!policy) {
        return NextResponse.json({ error: 'Failed to decode policy' }, { status: 500 });
      }

      // Optionally check deposit/withdrawal actions
      let depositCheck: { allowed: boolean; action: number; actionName: string } | null = null;
      let withdrawCheck: { allowed: boolean; action: number; actionName: string } | null = null;
      if (checkDeposit) {
        const amount = parseInt(checkDeposit);
        const data = SELECTORS.checkAction +
          id.toString(16).padStart(64, '0') +
          '0'.padStart(64, '0') + // actionType=0 (deposit)
          amount.toString(16).padStart(64, '0');
        const res = await ethCall(policyRegistry, data);
        const hex = res.slice(2);
        depositCheck = {
          allowed: parseInt(hex.slice(0, 64), 16) !== 0,
          action: parseInt(hex.slice(64, 128), 16),
          actionName: POLICY_ACTIONS[parseInt(hex.slice(64, 128), 16)] || 'UNKNOWN',
        };
      }
      if (checkWithdraw) {
        const amount = parseInt(checkWithdraw);
        const data = SELECTORS.checkAction +
          id.toString(16).padStart(64, '0') +
          '1'.padStart(64, '0') + // actionType=1 (withdraw)
          amount.toString(16).padStart(64, '0');
        const res = await ethCall(policyRegistry, data);
        const hex = res.slice(2);
        withdrawCheck = {
          allowed: parseInt(hex.slice(0, 64), 16) !== 0,
          action: parseInt(hex.slice(64, 128), 16),
          actionName: POLICY_ACTIONS[parseInt(hex.slice(64, 128), 16)] || 'UNKNOWN',
        };
      }

      return NextResponse.json({
        policyCount,
        policy,
        depositCheck,
        withdrawCheck,
        lastUpdated: new Date().toISOString(),
      });
    }

    // Get all policies
    const policies: OnChainPolicy[] = [];
    for (let i = 1; i <= policyCount; i++) {
      const callData = SELECTORS.getPolicy + i.toString(16).padStart(64, '0');
      const result = await ethCall(policyRegistry, callData);
      const policy = decodePolicyStruct(result);
      if (policy) policies.push(policy);
    }

    // Verify PolicyRegistry is deployed
    const code = await rpcCall('eth_getCode', [policyRegistry, 'latest']);
    const isDeployed = code.length > 10;

    return NextResponse.json({
      connected: true,
      policyCount,
      policies,
      policyRegistryDeployed: isDeployed,
      policyRegistryAddress: policyRegistry,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        error: error instanceof Error ? error.message : 'Failed to read policy state',
        policies: [],
        policyCount: 0,
      },
      { status: 503 }
    );
  }
}
