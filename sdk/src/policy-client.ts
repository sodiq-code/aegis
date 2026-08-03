/**
 * Aegis SDK — PolicyClient
 *
 * Client for the Aegis PolicyRegistry contract on Flare.
 * Methods: set and inspect risk policies, checkAction validation.
 *
 * Contract: PolicyRegistry on Coston2 (0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5)
 */

import { JsonRpcProvider } from './provider';
import { AegisContractAddresses } from './config';

// --- Types ---

/** Risk level enum — matches IPolicyRegistry.sol RiskLevel */
export enum RiskLevel {
  LOW = 0,        // Conservative: low risk tolerance
  MEDIUM = 1,     // Balanced: moderate risk tolerance
  HIGH = 2,       // Aggressive: high risk tolerance
  CRITICAL = 3,   // Emergency: maximum restrictions
}

/** Policy action enum */
export enum PolicyAction {
  ALLOW = 0,
  WARN = 1,
  THROTTLE = 2,
  BLOCK = 3,
}

/** Action types for checkAction */
export enum ActionType {
  DEPOSIT = 0,
  WITHDRAWAL = 1,
  REBALANCE = 2,
  HEDGE = 3,
}

/** Full policy struct matching IPolicyRegistry.sol */
export interface Policy {
  policyId: number;
  owner: string;
  name: string;
  description: string;
  riskLevel: number;
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
  onSolvencyWarning: number;
}

/** Result of checkAction() */
export interface ActionCheckResult {
  allowed: boolean;
  action: PolicyAction;
}

// --- Function Selectors ---

const SEL = {
  getPolicyCount: '0xe59771d2',
  getPolicy: '0x2b07fce3',
  checkAction: '0x0415e2da',
} as const;

/**
 * PolicyClient — interact with the Aegis PolicyRegistry contract
 *
 * @example
 * ```ts
 * import { PolicyClient } from '@aegis/sdk';
 *
 * const policy = new PolicyClient(provider, contracts);
 * const all = await policy.listPolicies();
 * console.log(`Policies: ${all.length}`);
 *
 * const check = await policy.checkAction(1, ActionType.DEPOSIT, 100);
 * console.log(`Deposit allowed: ${check.allowed}, action: ${PolicyAction[check.action]}`);
 * ```
 */
export class PolicyClient {
  private provider: JsonRpcProvider;
  private contracts: AegisContractAddresses;

  constructor(provider: JsonRpcProvider, contracts: AegisContractAddresses) {
    this.provider = provider;
    this.contracts = contracts;
  }

  /** Total number of policies */
  async getPolicyCount(): Promise<number> {
    const result = await this.provider.ethCall(this.contracts.PolicyRegistry, SEL.getPolicyCount);
    return parseInt(result, 16);
  }

  /** Get a single policy by ID, decoding the full ABI-encoded struct */
  async getPolicy(policyId: number): Promise<Policy | null> {
    try {
      const data = SEL.getPolicy + policyId.toString(16).padStart(64, '0');
      const result = await this.provider.ethCall(this.contracts.PolicyRegistry, data);

      // Parse ABI-encoded Policy struct (contains dynamic types: string, address[])
      const hex = result.slice(2);
      const words: string[] = [];
      for (let i = 0; i < hex.length; i += 64) {
        words.push(hex.slice(i, i + 64));
      }

      const s = 1; // struct starts at word[1] (word[0] is offset pointer)
      const u = (idx: number) => parseInt(words[s + idx], 16);
      const addr = (idx: number) => '0x' + words[s + idx].slice(-40);
      const bool = (idx: number) => parseInt(words[s + idx], 16) !== 0;

      const nameOffset = u(2);
      const descOffset = u(3);
      const allowedAssetsOffset = u(11);

      // Decode name (string — dynamic)
      const nameIdx = s + (nameOffset / 32);
      const nameLen = parseInt(words[nameIdx], 16);
      let nameHex = '';
      for (let i = 0; i < Math.ceil(nameLen / 32); i++) nameHex += words[nameIdx + 1 + i];
      const name = hexToUtf8(nameHex.slice(0, nameLen * 2));

      // Decode description (string — dynamic)
      const descIdx = s + (descOffset / 32);
      const descLen = parseInt(words[descIdx], 16);
      let descHex = '';
      for (let i = 0; i < Math.ceil(descLen / 32); i++) descHex += words[descIdx + 1 + i];
      const description = hexToUtf8(descHex.slice(0, descLen * 2));

      // Decode allowedAssets (address[] — dynamic)
      const assetsIdx = s + (allowedAssetsOffset / 32);
      const assetsCount = parseInt(words[assetsIdx], 16);
      const allowedAssets: string[] = [];
      for (let i = 0; i < assetsCount; i++) {
        allowedAssets.push('0x' + words[assetsIdx + 1 + i].slice(-40));
      }

      return {
        policyId: u(0),
        owner: addr(1),
        name,
        description,
        riskLevel: u(4),
        isActive: bool(5),
        createdAt: u(6),
        updatedAt: u(7),
        maxDrawdownBps: u(8),
        maxSingleExposureBps: u(9),
        hedgeThresholdBps: u(10),
        allowedAssets,
        maxDepositPerTx: u(12),
        maxWithdrawalPerTx: u(13),
        maxTotalExposure: u(14),
        minCollateralRatio: u(15),
        maxLeverage: u(16),
        withdrawalDelaySeconds: u(17),
        rebalanceThresholdBps: u(18),
        maxSlippageBps: u(19),
        onRiskBreach: u(20),
        onSolvencyWarning: u(21),
      };
    } catch {
      return null;
    }
  }

  /** Get all policies */
  async listPolicies(): Promise<Policy[]> {
    const count = await this.getPolicyCount();
    const policies: Policy[] = [];
    for (let i = 1; i <= count; i++) {
      const p = await this.getPolicy(i);
      if (p) policies.push(p);
    }
    return policies;
  }

  /** Check if an action is allowed under a policy */
  async checkAction(policyId: number, actionType: ActionType, amount: number): Promise<ActionCheckResult> {
    try {
      const data = SEL.checkAction +
        policyId.toString(16).padStart(64, '0') +
        actionType.toString(16).padStart(64, '0') +
        amount.toString(16).padStart(64, '0');
      const result = await this.provider.ethCall(this.contracts.PolicyRegistry, data);
      const hex = result.slice(2);
      const allowed = parseInt(hex.slice(0, 64), 16) !== 0;
      const action = parseInt(hex.slice(64, 128), 16) as PolicyAction;
      return { allowed, action };
    } catch {
      return { allowed: false, action: PolicyAction.BLOCK };
    }
  }

  /** Get risk level name for a policy */
  getRiskLevelName(level: number): string {
    return RiskLevel[level] || `Unknown(${level})`;
  }

  /** Get policy action name */
  getActionName(action: number): string {
    return PolicyAction[action] || `Unknown(${action})`;
  }
}

/** Hex string to UTF-8 (works without Buffer in browser) */
function hexToUtf8(hex: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  // Use TextDecoder if available, otherwise Buffer
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(new Uint8Array(bytes));
  }
  return Buffer.from(bytes).toString('utf-8');
}
