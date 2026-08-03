/**
 * Aegis SDK — VaultClient
 *
 * Client for the Aegis VaultCore contract on Flare.
 * Methods: deposit, withdraw, query balance, solvency status, risk score.
 *
 * Contract: VaultCore on Coston2 (0xcb08be1cc86d3f94c54c64682372e32f669134bc)
 */

import { JsonRpcProvider } from './provider';
import { AegisContractAddresses, FlareSystemContractAddresses, FccExtensionConfig } from './config';

// --- Types ---

/** Full vault state snapshot */
export interface VaultState {
  totalDeposited: number;
  totalValuation: number;
  positionCount: number;
  xrpUsdPrice: number;
  isEmergencyMode: boolean;
  isSafeState: boolean;
  blockNumber: number;
  chainId: number;
  timestamp: string;
}

/** Solvency info from SolvencyRoot */
export interface SolvencyInfo {
  solvent: boolean;
  collateralRatio: number;
}

/** Risk score from the AI risk agent (via FCC extension or fallback) */
export interface RiskScore {
  score: number;
  action: string;
  confidence: number;
  thresholds: { hold: number; rebalance: number; hedge: number; deleverage: number };
  lastUpdated: string;
  source: 'extension' | 'on-chain' | 'fallback';
}

/** FCC extension position data */
export interface PositionData {
  totalCollateral: number;
  totalLiabilities: number;
  positionCount: number;
  merkleRoot: string;
  positions: Array<{
    id: number;
    depositor: string;
    amount: number;
    usdValue: number;
    chain: string;
    createdAt: string;
  }>;
}

// --- Function Selectors (keccak256 first 4 bytes) ---

const SEL = {
  getTotalFxrpDeposited: '0xccec9b1d',
  getTotalValuation: '0x8467456b',
  getActivePositionCount: '0xc5b01a23',
  getXrpUsdPrice: '0xf0ec455a',
  isEmergencyMode: '0x20a194b8',
  isSafeState: '0x2473d898',
  isSolvent: '0x5ce23950',
  getMinCollateralRatio: '0x4c8f35ab',
} as const;

const ZERO_WORD = '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * VaultClient — interact with the Aegis VaultCore contract
 *
 * @example
 * ```ts
 * import { VaultClient } from '@aegis/sdk';
 *
 * const vault = new VaultClient();
 * const state = await vault.getState();
 * console.log(`Total deposited: ${state.totalDeposited} FXRP`);
 * console.log(`XRP/USD: $${state.xrpUsdPrice}`);
 * ```
 */
export class VaultClient {
  private provider: JsonRpcProvider;
  private contracts: AegisContractAddresses;
  private systemContracts: FlareSystemContractAddresses;
  private fccConfig: FccExtensionConfig;
  private fetchFn: (input: string, init?: RequestInit) => Promise<Response>;

  constructor(
    provider: JsonRpcProvider,
    contracts: AegisContractAddresses,
    systemContracts: FlareSystemContractAddresses,
    fccConfig: FccExtensionConfig,
    fetchFn: (input: string, init?: RequestInit) => Promise<Response>
  ) {
    this.provider = provider;
    this.contracts = contracts;
    this.systemContracts = systemContracts;
    this.fccConfig = fccConfig;
    this.fetchFn = fetchFn;
  }

  // --- On-chain reads ---

  /** Total FXRP deposited into the vault */
  async getTotalDeposited(): Promise<number> {
    const result = await this.provider.ethCall(this.contracts.VaultCore, SEL.getTotalFxrpDeposited);
    return Number(BigInt(result));
  }

  /** Total USD valuation of vault positions */
  async getTotalValuation(): Promise<number> {
    const result = await this.provider.ethCall(this.contracts.VaultCore, SEL.getTotalValuation);
    return Number(BigInt(result));
  }

  /** Number of active positions in the vault */
  async getPositionCount(): Promise<number> {
    const result = await this.provider.ethCall(this.contracts.VaultCore, SEL.getActivePositionCount);
    return parseInt(result, 16);
  }

  /** XRP/USD price from FTSO V2 (via VaultCore) — 6-decimal USD */
  async getXrpUsdPrice(): Promise<number> {
    const result = await this.provider.ethCall(this.contracts.VaultCore, SEL.getXrpUsdPrice);
    return parseInt(result, 16) / 1e6;
  }

  /** Whether the vault is in emergency mode */
  async isEmergencyMode(): Promise<boolean> {
    const result = await this.provider.ethCall(this.contracts.VaultCore, SEL.isEmergencyMode);
    return result !== ZERO_WORD;
  }

  /** Whether the vault is in safe state */
  async isSafeState(): Promise<boolean> {
    try {
      const result = await this.provider.ethCall(this.contracts.VaultCore, SEL.isSafeState);
      return result !== ZERO_WORD;
    } catch {
      return false;
    }
  }

  /** Solvency status from SolvencyRoot: isSolvent() returns (bool, uint256) */
  async getSolvencyInfo(): Promise<SolvencyInfo> {
    try {
      const result = await this.provider.ethCall(this.contracts.SolvencyRoot, SEL.isSolvent);
      const hex = result.slice(2);
      const solvent = parseInt(hex.slice(0, 64), 16) === 1;
      const ratio = parseInt(hex.slice(64, 128), 16) / 100;
      return { solvent, collateralRatio: ratio };
    } catch {
      return { solvent: false, collateralRatio: 0 };
    }
  }

  /** Minimum collateral ratio from SolvencyRoot */
  async getMinCollateralRatio(): Promise<number> {
    try {
      const result = await this.provider.ethCall(this.contracts.SolvencyRoot, SEL.getMinCollateralRatio);
      return parseInt(result.slice(2), 16) / 100;
    } catch {
      return 120; // default fallback
    }
  }

  /** Verify all Aegis contracts are deployed */
  async verifyContractsDeployed(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    for (const [name, address] of Object.entries(this.contracts)) {
      results[name] = await this.provider.isContractDeployed(address);
    }
    return results;
  }

  // --- FCC Extension (TEE) reads ---

  /** Get position data from FCC extension (TEE) */
  async getPosition(): Promise<PositionData | null> {
    try {
      const resp = await this.fetchFn(`${this.fccConfig.proxyUrl}/api/position`, {
        signal: AbortSignal.timeout(this.fccConfig.timeout),
      });
      if (!resp.ok) return null;
      return resp.json() as Promise<PositionData>;
    } catch {
      return null;
    }
  }

  /** Get risk score from FCC extension (TEE) */
  async getRiskScore(): Promise<RiskScore | null> {
    try {
      const resp = await this.fetchFn(`${this.fccConfig.proxyUrl}/api/risk`, {
        signal: AbortSignal.timeout(this.fccConfig.timeout),
      });
      if (!resp.ok) return null;
      const data = await resp.json() as {
        lastScore: number;
        lastAction: string;
        confidence: number;
        thresholds: RiskScore['thresholds'];
        lastIteration: string;
      };
      return {
        score: data.lastScore,
        action: data.lastAction,
        confidence: data.confidence,
        thresholds: data.thresholds,
        lastUpdated: data.lastIteration,
        source: 'extension',
      };
    } catch {
      // Fallback: compute heuristic from on-chain
      return this.getFallbackRiskScore();
    }
  }

  /** Fallback risk score from on-chain solvency data */
  private async getFallbackRiskScore(): Promise<RiskScore> {
    const defaults = { hold: 25, rebalance: 50, hedge: 75, deleverage: 90 };
    try {
      const solvency = await this.getSolvencyInfo();
      const ratio = solvency.collateralRatio;
      let score: number;
      if (ratio >= 200) score = 5;
      else if (ratio >= 150) score = Math.round(25 + (200 - ratio) * 0.4);
      else if (ratio >= 120) score = Math.round(37 + (150 - ratio) * 0.77);
      else score = Math.round(60 + Math.max(0, 120 - ratio) * 1.75);
      score = Math.min(100, Math.max(0, score));

      let action: string;
      if (score < defaults.hold) action = 'Hold';
      else if (score < defaults.rebalance) action = 'Rebalance';
      else if (score < defaults.hedge) action = 'Hedge';
      else action = 'Deleverage';

      return { score, action, confidence: 0.7, thresholds: defaults, lastUpdated: new Date().toISOString(), source: 'fallback' };
    } catch {
      return { score: 0, action: 'Unknown', confidence: 0, thresholds: defaults, lastUpdated: new Date().toISOString(), source: 'fallback' };
    }
  }

  // --- Aggregate ---

  /** Full vault state (parallel on-chain reads) */
  async getState(): Promise<VaultState> {
    const [totalDeposited, totalValuation, positionCount, xrpPrice, isEmergency, isSafe, blockNumber, chainId] =
      await Promise.all([
        this.getTotalDeposited().catch(() => 0),
        this.getTotalValuation().catch(() => 0),
        this.getPositionCount().catch(() => 0),
        this.getXrpUsdPrice().catch(() => 0),
        this.isEmergencyMode().catch(() => false),
        this.isSafeState().catch(() => false),
        this.provider.getBlockNumber().catch(() => 0),
        this.provider.getChainId().catch(() => 0),
      ]);

    return {
      totalDeposited,
      totalValuation,
      positionCount,
      xrpUsdPrice: xrpPrice,
      isEmergencyMode: isEmergency,
      isSafeState: isSafe,
      blockNumber,
      chainId,
      timestamp: new Date().toISOString(),
    };
  }
}
