/**
 * Flare RPC Client
 * 
 * Direct JSON-RPC connection to Flare Coston2 testnet.
 * Used for reading vault state, FTSO prices, and FDC attestations.
 */

import { getFlareConfig, AEGIS_CONTRACTS, FTSO_FEEDS } from './flare-config';

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

class FlareRpcClient {
  private rpcUrl: string;
  private nextId = 1;

  constructor(rpcUrl?: string) {
    this.rpcUrl = rpcUrl || getFlareConfig().rpcUrl;
  }

  /**
   * Make a JSON-RPC call to the Flare RPC endpoint
   */
  private async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.nextId++,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`Flare RPC error: HTTP ${response.status}`);
    }

    const data: JsonRpcResponse<T> = await response.json();

    if (data.error) {
      throw new Error(`Flare RPC error: ${data.error.code} - ${data.error.message}`);
    }

    if (data.result === undefined) {
      throw new Error('Flare RPC error: no result');
    }

    return data.result;
  }

  /**
   * Get the chain ID
   */
  async getChainId(): Promise<number> {
    const hex = await this.call<string>('eth_chainId');
    return parseInt(hex, 16);
  }

  /**
   * Get the latest block number
   */
  async getBlockNumber(): Promise<number> {
    const hex = await this.call<string>('eth_blockNumber');
    return parseInt(hex, 16);
  }

  /**
   * Get account balance
   */
  async getBalance(address: string): Promise<bigint> {
    const hex = await this.call<string>('eth_getBalance', [address, 'latest']);
    return BigInt(hex);
  }

  /**
   * Check if a contract is deployed at the given address
   */
  async isContractDeployed(address: string): Promise<boolean> {
    const code = await this.call<string>('eth_getCode', [address, 'latest']);
    return code.length > 10; // More than just "0x"
  }

  /**
   * Make an eth_call (read-only contract call)
   */
  async ethCall(to: string, data: string): Promise<string> {
    return this.call<string>('eth_call', [{ to, data }, 'latest']);
  }

  /**
   * Get VaultCore total FXRP deposited
   */
  async getVaultTotalDeposited(): Promise<bigint> {
    // getTotalFxrpDeposited() => 0xccec9b1d
    const result = await this.ethCall(AEGIS_CONTRACTS.VaultCore, '0xccec9b1d');
    return BigInt(result);
  }

  /**
   * Get VaultCore total valuation
   */
  async getVaultTotalValuation(): Promise<bigint> {
    // getTotalValuation() => 0x8467456b
    const result = await this.ethCall(AEGIS_CONTRACTS.VaultCore, '0x8467456b');
    return BigInt(result);
  }

  /**
   * Get VaultCore active position count
   */
  async getVaultPositionCount(): Promise<number> {
    // getActivePositionCount() => 0xc5b01a23
    const result = await this.ethCall(AEGIS_CONTRACTS.VaultCore, '0xc5b01a23');
    return parseInt(result, 16);
  }

  /**
   * Get XRP/USD price from FTSO V2 (via VaultCore)
   */
  async getXrpUsdPrice(): Promise<number> {
    // getXrpUsdPrice() => 0xf0ec455a
    const result = await this.ethCall(AEGIS_CONTRACTS.VaultCore, '0xf0ec455a');
    const raw = parseInt(result, 16);
    // FTSO V2 returns 6 decimals for USD pairs
    return raw / 1e6;
  }

  /**
   * Check if vault is in emergency mode
   */
  async isEmergencyMode(): Promise<boolean> {
    // isEmergencyMode() => 0x20a194b8
    const result = await this.ethCall(AEGIS_CONTRACTS.VaultCore, '0x20a194b8');
    return result !== '0x0000000000000000000000000000000000000000000000000000000000000000';
  }

  /**
   * Check if vault is in safe state
   */
  async isSafeState(): Promise<boolean> {
    try {
      // isSafeState() => 0x2473d898
      const result = await this.ethCall(AEGIS_CONTRACTS.VaultCore, '0x2473d898');
      return result !== '0x0000000000000000000000000000000000000000000000000000000000000000';
    } catch {
      // isSafeState may revert if not initialized
      return false;
    }
  }

  /**
   * Get solvency status from SolvencyRoot
   */
  async getSolvencyStatus(): Promise<{ solvent: boolean; ratio: number }> {
    try {
      // isSolvent() => 0x5ce23950, returns (bool, uint256)
      const result = await this.ethCall(AEGIS_CONTRACTS.SolvencyRoot, '0x5ce23950');
      const boolPart = result.slice(2, 66);
      const ratioPart = result.slice(66, 130);
      const solvent = parseInt(boolPart, 16) === 1;
      // ratio stored as basis points * 100 (e.g., 14000 = 140.00%)
      const ratio = parseInt(ratioPart, 16) / 100;
      return { solvent, ratio };
    } catch {
      return { solvent: false, ratio: 0 };
    }
  }

  // --- PolicyRegistry Methods ---

  /**
   * Get the total number of policies from PolicyRegistry
   */
  async getPolicyCount(): Promise<number> {
    // getPolicyCount() => 0xe59771d2
    const result = await this.ethCall(AEGIS_CONTRACTS.PolicyRegistry, '0xe59771d2');
    return parseInt(result, 16);
  }

  /**
   * Get a policy by ID from PolicyRegistry.
   * Decodes the ABI-encoded Policy struct (contains dynamic types: string, address[]).
   * 
   * Policy struct field order (matches IPolicyRegistry.sol):
   *   policyId, owner, name (string), description (string), riskLevel (uint8),
   *   isActive (bool), createdAt, updatedAt, maxDrawdownBps, maxSingleExposureBps,
   *   hedgeThresholdBps, allowedAssets (address[]), maxDepositPerTx, maxWithdrawalPerTx,
   *   maxTotalExposure, minCollateralRatio, maxLeverage, withdrawalDelaySeconds,
   *   rebalanceThresholdBps, maxSlippageBps, onRiskBreach (uint8), onSolvencyWarning (uint8)
   */
  async getPolicy(policyId: number): Promise<{
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
  } | null> {
    try {
      // getPolicy(uint256) => 0x2b07fce3
      const data = '0x2b07fce3' + policyId.toString(16).padStart(64, '0');
      const result = await this.ethCall(AEGIS_CONTRACTS.PolicyRegistry, data);

      // Parse ABI-encoded Policy struct
      const hex = result.slice(2); // strip 0x
      const words: string[] = [];
      for (let i = 0; i < hex.length; i += 64) {
        words.push(hex.slice(i, i + 64));
      }

      const s = 1; // struct starts at word[1] (word[0] is the offset pointer)
      const parseU256 = (idx: number) => parseInt(words[s + idx], 16);
      const parseAddress = (idx: number) => '0x' + words[s + idx].slice(-40);
      const parseBool = (idx: number) => parseInt(words[s + idx], 16) !== 0;

      // Static fields
      const pId = parseU256(0);
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

      // Decode name (string - dynamic type)
      const nameWordIdx = s + (nameOffset / 32);
      const nameLen = parseInt(words[nameWordIdx], 16);
      const nameNWords = Math.ceil(nameLen / 32);
      let nameHex = '';
      for (let i = 0; i < nameNWords; i++) {
        nameHex += words[nameWordIdx + 1 + i];
      }
      const name = Buffer.from(nameHex.slice(0, nameLen * 2), 'hex').toString('utf-8');

      // Decode description (string - dynamic type)
      const descWordIdx = s + (descOffset / 32);
      const descLen = parseInt(words[descWordIdx], 16);
      const descNWords = Math.ceil(descLen / 32);
      let descHex = '';
      for (let i = 0; i < descNWords; i++) {
        descHex += words[descWordIdx + 1 + i];
      }
      const description = Buffer.from(descHex.slice(0, descLen * 2), 'hex').toString('utf-8');

      // Decode allowedAssets (address[] - dynamic type)
      const assetsWordIdx = s + (allowedAssetsOffset / 32);
      const assetsCount = parseInt(words[assetsWordIdx], 16);
      const allowedAssets: string[] = [];
      for (let i = 0; i < assetsCount; i++) {
        allowedAssets.push('0x' + words[assetsWordIdx + 1 + i].slice(-40));
      }

      return {
        policyId: pId,
        owner,
        name,
        description,
        riskLevel,
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
        onSolvencyWarning,
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if an action is allowed under a policy
   * checkAction(uint256 policyId, uint8 actionType, uint256 amount)
   * Returns (bool allowed, uint8 policyAction)
   */
  async checkAction(policyId: number, actionType: number, amount: number): Promise<{ allowed: boolean; action: number }> {
    try {
      // checkAction(uint256,uint8,uint256) => 0x0415e2da
      const data = '0x0415e2da' +
        policyId.toString(16).padStart(64, '0') +
        actionType.toString(16).padStart(64, '0') +
        amount.toString(16).padStart(64, '0');
      const result = await this.ethCall(AEGIS_CONTRACTS.PolicyRegistry, data);
      const hex = result.slice(2);
      const allowed = parseInt(hex.slice(0, 64), 16) !== 0;
      const action = parseInt(hex.slice(64, 128), 16);
      return { allowed, action };
    } catch {
      return { allowed: false, action: 3 }; // BLOCK on error
    }
  }

  /**
   * Get all policies from PolicyRegistry
   */
  async getAllPolicies(): Promise<Array<NonNullable<Awaited<ReturnType<FlareRpcClient['getPolicy']>>>>> {
    const count = await this.getPolicyCount();
    const policies = [];
    for (let i = 1; i <= count; i++) {
      const policy = await this.getPolicy(i);
      if (policy) policies.push(policy);
    }
    return policies;
  }

  /**
   * Verify all Aegis contracts are deployed on Coston2
   */
  async verifyContractsDeployed(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    for (const [name, address] of Object.entries(AEGIS_CONTRACTS)) {
      results[name] = await this.isContractDeployed(address);
    }
    return results;
  }

  /**
   * Get comprehensive vault state for the dashboard
   */
  async getVaultState() {
    const [totalDeposited, totalValuation, positionCount, xrpPrice, isEmergency, isSafe, solvency, blockNumber] = 
      await Promise.all([
        this.getVaultTotalDeposited().catch(() => BigInt(0)),
        this.getVaultTotalValuation().catch(() => BigInt(0)),
        this.getVaultPositionCount().catch(() => 0),
        this.getXrpUsdPrice().catch(() => 0),
        this.isEmergencyMode().catch(() => false),
        this.isSafeState().catch(() => false),
        this.getSolvencyStatus().catch(() => ({ solvent: false, ratio: 0 })),
        this.getBlockNumber().catch(() => 0),
      ]);

    return {
      totalDeposited: Number(totalDeposited),
      totalValuation: Number(totalValuation),
      positionCount,
      xrpPrice,
      isEmergency,
      isSafe,
      solvency,
      blockNumber,
      lastUpdated: new Date().toISOString(),
    };
  }
}

// Singleton instance
let _client: FlareRpcClient | null = null;

export function getFlareRpcClient(rpcUrl?: string): FlareRpcClient {
  if (!_client || (rpcUrl && _client['rpcUrl'] !== rpcUrl)) {
    _client = new FlareRpcClient(rpcUrl);
  }
  return _client;
}

export { FlareRpcClient };
