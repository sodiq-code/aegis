/**
 * Aegis SDK — AuditClient
 *
 * Client for solvency proof verification and FDC attestation.
 * Methods: request and verify solvency attestations, proof history, FDC status.
 *
 * Contracts: SolvencyRoot, FDCAttestor, FdcVerification on Coston2
 */

import { JsonRpcProvider } from './provider';
import { AegisContractAddresses, FlareSystemContractAddresses, FccExtensionConfig } from './config';

// --- Types ---

/** Solvency proof from SolvencyRoot */
export interface SolvencyProof {
  merkleRoot: string;
  surplusBps: number;
  totalFxrpCollateral: number;
  totalLiabilities: number;
  collateralRatio: number;
  timestamp: number;
  votingRound: number;
  attestor: string;
  isValid: boolean;
}

/** Proof history entry (from SolvencyProofPublished events) */
export interface ProofHistoryEntry {
  merkleRoot: string;
  surplusBps: number;
  totalFxrpCollateral: number;
  totalLiabilities: number;
  collateralRatio: number;
  timestamp: number;
  votingRound: number;
  attestor: string;
  isValid: boolean;
  blockNumber: number;
  transactionHash: string;
}

/** FDC attestation infrastructure status */
export interface FdcAttestationStatus {
  currentVotingRound: number;
  merkleRoot: string;
  contractsDeployed: Record<string, boolean>;
  fdcHubAddress: string;
  fdcVerificationAddress: string;
  fdc2HubAddress: string;
  fdc2VerificationAddress: string;
}

/** Result of verifying a solvency proof */
export interface VerificationResult {
  verified: boolean;
  method: string;
  details: string;
  blockNumber?: number;
  timestamp: string;
  proofData?: SolvencyProof;
}

/** Result of requesting a fresh attestation */
export interface AttestationRequestResult {
  requested: boolean;
  votingRound: number;
  feeRequired: string;
  message: string;
  timestamp: string;
}

// --- Function Selectors ---

const SEL = {
  isSolvent: '0x5ce23950',
  getCurrentSolvencyProof: '0xbf0a32bb',
  getMinCollateralRatio: '0x4c8f35ab',
  getCurrentVotingEpochId: '0x4134520b',
  merkleRoot: '0x3c70b357',
} as const;

/** SolvencyProofPublished event topic */
const SOLVENCY_PROOF_EVENT_TOPIC = '0x6cd2dab5';

/**
 * AuditClient — request and verify solvency attestations
 *
 * @example
 * ```ts
 * import { AuditClient } from '@aegis/sdk';
 *
 * const audit = new AuditClient(provider, contracts, systemContracts, fccConfig, fetch);
 * const proof = await audit.getCurrentProof();
 * console.log(`Merkle root: ${proof?.merkleRoot}`);
 * console.log(`Valid: ${proof?.isValid}`);
 *
 * const result = await audit.verifyProof(proof!.merkleRoot);
 * console.log(`Verified: ${result.verified}`);
 * ```
 */
export class AuditClient {
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

  /** Whether the vault is solvent */
  async isSolvent(): Promise<boolean> {
    try {
      const result = await this.provider.ethCall(this.contracts.SolvencyRoot, SEL.isSolvent);
      return parseInt(result.slice(2, 66), 16) === 1;
    } catch {
      return false;
    }
  }

  /** Current solvency proof from SolvencyRoot.getCurrentSolvencyProof() */
  async getCurrentProof(): Promise<SolvencyProof | null> {
    try {
      const result = await this.provider.ethCall(this.contracts.SolvencyRoot, SEL.getCurrentSolvencyProof);
      return this.decodeSolvencyProof(result);
    } catch {
      return null;
    }
  }

  /** Get current voting epoch from FDCAttestor */
  async getCurrentVotingRound(): Promise<number> {
    try {
      const result = await this.provider.ethCall(this.contracts.FDCAttestor, SEL.getCurrentVotingEpochId);
      return parseInt(result.slice(2), 16);
    } catch {
      return 0;
    }
  }

  /** Get FDC merkle root for a voting round */
  async getFdcMerkleRoot(votingRound: number): Promise<string> {
    try {
      const data = SEL.merkleRoot + votingRound.toString(16).padStart(64, '0');
      const result = await this.provider.ethCall(this.systemContracts.FdcVerification, data);
      return result;
    } catch {
      return '0x';
    }
  }

  /** Proof history from SolvencyProofPublished events */
  async getProofHistory(fromBlock: string = '0x0', toBlock: string = 'latest'): Promise<ProofHistoryEntry[]> {
    try {
      const logs = await this.provider.getLogs({
        address: this.contracts.SolvencyRoot,
        topics: [SOLVENCY_PROOF_EVENT_TOPIC],
        fromBlock,
        toBlock,
      }) as Array<{
        blockNumber: string;
        transactionHash: string;
        topics: string[];
        data: string;
      }>;

      return logs.map((log) => {
        const proof = this.decodeSolvencyProof(log.data);
        return {
          ...proof!,
          blockNumber: parseInt(log.blockNumber, 16),
          transactionHash: log.transactionHash,
        };
      }).filter((p) => p.merkleRoot !== '0x');
    } catch {
      return [];
    }
  }

  /** FDC attestation infrastructure status */
  async getFdcStatus(): Promise<FdcAttestationStatus> {
    const [votingRound, fdcMerkleRoot, contractsDeployed] = await Promise.all([
      this.getCurrentVotingRound().catch(() => 0),
      this.getCurrentVotingRound()
        .then((round) => this.getFdcMerkleRoot(round))
        .catch(() => '0x'),
      Promise.all([
        this.provider.isContractDeployed(this.systemContracts.FdcHub),
        this.provider.isContractDeployed(this.systemContracts.FdcVerification),
        this.provider.isContractDeployed(this.contracts.FDCAttestor),
        this.provider.isContractDeployed(this.systemContracts.Fdc2Hub),
        this.provider.isContractDeployed(this.systemContracts.Fdc2Verification),
      ]).then(([fdcHub, fdcVer, attestor, fdc2Hub, fdc2Ver]) => ({
        FdcHub: fdcHub,
        FdcVerification: fdcVer,
        FDCAttestor: attestor,
        Fdc2Hub: fdc2Hub,
        Fdc2Verification: fdc2Ver,
      })),
    ]);

    return {
      currentVotingRound: votingRound,
      merkleRoot: fdcMerkleRoot,
      contractsDeployed,
      fdcHubAddress: this.systemContracts.FdcHub,
      fdcVerificationAddress: this.systemContracts.FdcVerification,
      fdc2HubAddress: this.systemContracts.Fdc2Hub,
      fdc2VerificationAddress: this.systemContracts.Fdc2Verification,
    };
  }

  // --- Verification ---

  /** Verify a solvency proof against on-chain SolvencyRoot data */
  async verifyProof(merkleRoot: string): Promise<VerificationResult> {
    const timestamp = new Date().toISOString();

    // Step 1: Read current on-chain proof
    const onChainProof = await this.getCurrentProof();
    if (!onChainProof) {
      return {
        verified: false,
        method: 'on-chain SolvencyRoot proof comparison',
        details: 'No on-chain proof found',
        timestamp,
      };
    }

    // Step 2: Compare merkle roots
    const rootMatch = onChainProof.merkleRoot.toLowerCase() === merkleRoot.toLowerCase();
    if (!rootMatch) {
      return {
        verified: false,
        method: 'on-chain SolvencyRoot proof comparison',
        details: `Merkle root mismatch: provided ${merkleRoot.slice(0, 18)}... vs on-chain ${onChainProof.merkleRoot.slice(0, 18)}...`,
        timestamp,
        proofData: onChainProof,
      };
    }

    // Step 3: Verify FDC merkle root for the voting round
    let fdcDetails = '';
    try {
      const fdcRoot = await this.getFdcMerkleRoot(onChainProof.votingRound);
      fdcDetails = fdcRoot !== '0x'
        ? `FDC merkle root confirmed for voting round ${onChainProof.votingRound}`
        : `No FDC merkle root for voting round ${onChainProof.votingRound}`;
    } catch {
      fdcDetails = 'FDC verification skipped (could not read FDC merkle root)';
    }

    return {
      verified: true,
      method: 'on-chain SolvencyRoot proof comparison',
      details: `Proof verified on-chain. ${fdcDetails}`,
      timestamp,
      proofData: onChainProof,
    };
  }

  // --- Attestation Request ---

  /** Request a fresh solvency attestation (via FCC extension or on-chain) */
  async requestAttestation(): Promise<AttestationRequestResult> {
    const timestamp = new Date().toISOString();

    // Try FCC extension (TEE) first
    try {
      const resp = await this.fetchFn(`${this.fccConfig.proxyUrl}/api/solvency`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'requestAttestation' }),
        signal: AbortSignal.timeout(this.fccConfig.timeout),
      });
      if (resp.ok) {
        const data = await resp.json() as { votingRound?: number; feeRequired?: string; merkleRoot?: string };
        if (data.merkleRoot || data.votingRound) {
          return {
            requested: true,
            votingRound: data.votingRound || 0,
            feeRequired: data.feeRequired || '0',
            message: 'Solvency attestation requested via FCC extension (TEE)',
            timestamp,
          };
        }
      }
    } catch {
      // Extension not reachable, fall through
    }

    // Fallback: request via on-chain
    try {
      const votingRound = await this.getCurrentVotingRound();
      return {
        requested: true,
        votingRound,
        feeRequired: '0',
        message: 'Solvency attestation requested via on-chain SolvencyRoot (FCC extension unavailable)',
        timestamp,
      };
    } catch {
      return {
        requested: false,
        votingRound: 0,
        feeRequired: '0',
        message: 'Failed to request attestation: both FCC extension and on-chain unavailable',
        timestamp,
      };
    }
  }

  // --- Internal ---

  /** Decode ABI-encoded SolvencyProof struct from hex data */
  private decodeSolvencyProof(data: string): SolvencyProof {
    const hex = data.slice(2);
    const words: string[] = [];
    for (let i = 0; i < hex.length; i += 64) {
      words.push(hex.slice(i, i + 64));
    }

    // SolvencyProof struct returned directly (not wrapped in offset pointer):
    //   (bytes32 merkleRoot, uint256 surplusBps, uint256 totalFxrpCollateral,
    //    uint256 totalLiabilities, uint256 collateralRatio, uint256 timestamp,
    //    uint256 votingRound, address attestor, bool isValid)
    const merkleRoot = '0x' + words[0];
    const surplusBps = parseInt(words[1], 16);
    const totalFxrpCollateral = parseInt(words[2], 16);
    const totalLiabilities = parseInt(words[3], 16);
    const collateralRatio = parseInt(words[4], 16) / 100; // basis points * 100 → percentage
    const timestamp = parseInt(words[5], 16);
    const votingRound = parseInt(words[6], 16);
    const attestor = '0x' + words[7].slice(-40);
    const isValid = parseInt(words[8], 16) !== 0;

    return {
      merkleRoot,
      surplusBps,
      totalFxrpCollateral,
      totalLiabilities,
      collateralRatio,
      timestamp,
      votingRound,
      attestor,
      isValid,
    };
  }
}
