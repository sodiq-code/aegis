/**
 * Aegis SDK — Main Entry Point
 *
 * Re-exports all client classes, types, and configuration utilities.
 *
 * @example
 * ```ts
 * import { AegisSDK, VaultClient, PolicyClient, AuditClient } from '@aegis/sdk';
 *
 * // Quick start with defaults (Coston2)
 * const sdk = new AegisSDK();
 * const vault = sdk.vault;
 * const policy = sdk.policy;
 * const audit = sdk.audit;
 *
 * // Or configure manually
 * const sdk2 = new AegisSDK({
 *   rpcUrl: 'https://coston2-api.flare.network/ext/C/rpc',
 *   fccProxyUrl: 'http://localhost:8080',
 * });
 * ```
 */

// Configuration
export {
  resolveConfig,
  NETWORKS,
  DEFAULT_AEGIS_CONTRACTS,
  DEFAULT_FLARE_SYSTEM_CONTRACTS,
  FTSO_FEEDS,
} from './config';

export type {
  AegisSdkConfig,
  ResolvedConfig,
  FlareNetworkConfig,
  AegisContractAddresses,
  FlareSystemContractAddresses,
  FccExtensionConfig,
} from './config';

// Provider
export { JsonRpcProvider } from './provider';

// VaultClient
export { VaultClient } from './vault-client';
export type { VaultState, SolvencyInfo, RiskScore, PositionData } from './vault-client';

// PolicyClient
export { PolicyClient, RiskLevel, PolicyAction, ActionType } from './policy-client';
export type { Policy, ActionCheckResult } from './policy-client';

// AuditClient
export { AuditClient } from './audit-client';
export type {
  SolvencyProof,
  ProofHistoryEntry,
  FdcAttestationStatus,
  VerificationResult,
  AttestationRequestResult,
} from './audit-client';

// --- Convenience: AegisSDK class ---

import { resolveConfig, ResolvedConfig, AegisSdkConfig } from './config';
import { JsonRpcProvider } from './provider';
import { VaultClient } from './vault-client';
import { PolicyClient } from './policy-client';
import { AuditClient } from './audit-client';

/**
 * AegisSDK — convenience wrapper that creates all three clients
 *
 * @example
 * ```ts
 * const sdk = new AegisSDK(); // defaults to Coston2
 *
 * // Vault operations
 * const state = await sdk.vault.getState();
 *
 * // Policy operations
 * const policies = await sdk.policy.listPolicies();
 *
 * // Audit operations
 * const proof = await sdk.audit.getCurrentProof();
 * const verified = await sdk.audit.verifyProof(proof!.merkleRoot);
 * ```
 */
export class AegisSDK {
  /** Resolved configuration */
  readonly config: ResolvedConfig;

  /** JSON-RPC provider */
  readonly provider: JsonRpcProvider;

  /** Vault client (deposit, withdraw, query balance) */
  readonly vault: VaultClient;

  /** Policy client (set and inspect risk policies) */
  readonly policy: PolicyClient;

  /** Audit client (request and verify solvency attestations) */
  readonly audit: AuditClient;

  constructor(config: AegisSdkConfig = {}) {
    this.config = resolveConfig(config);
    this.provider = new JsonRpcProvider(this.config.rpcUrl, this.config.fetch);
    this.vault = new VaultClient(
      this.provider,
      this.config.contracts,
      this.config.systemContracts,
      this.config.fccExtension,
      this.config.fetch,
    );
    this.policy = new PolicyClient(this.provider, this.config.contracts);
    this.audit = new AuditClient(
      this.provider,
      this.config.contracts,
      this.config.systemContracts,
      this.config.fccExtension,
      this.config.fetch,
    );
  }
}
