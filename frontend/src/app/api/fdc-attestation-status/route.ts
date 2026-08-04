/**
 * API Route: FDC Attestation Status
 *
 * Reads FDC (Flare Data Connector) attestation infrastructure status from Coston2:
 *   - Current voting round from FlareSystemsManager.getCurrentVotingEpochId()
 *   - FDC contract deployment status
 *   - Round finalization check for the on-chain solvency proof's votingRound
 *
 * NOTE: FdcVerification does NOT expose a merkleRoot(uint256) view function.
 * It exposes verifyPayment(attestation), verifyEVMTransaction(attestation), etc.
 * Each attestation struct carries its own Merkle proof; you verify a specific
 * attestation by calling the corresponding verify* function with the full struct.
 * The FDC "Merkle root" for a round is internal to the FdcVerification contract
 * and is checked implicitly when you call verifyPayment/verifyEVMTransaction.
 *
 * So this route reports:
 *   - currentVotingRound (the real one)
 *   - proofVotingRound (from SolvencyRoot.getCurrentSolvencyProof)
 *   - isFinalized (proofVotingRound <= currentVotingRound)
 *   - contract deployment status
 */

import { NextResponse } from 'next/server';
import { getFlareConfig, AEGIS_CONTRACTS, FLARE_SYSTEM_CONTRACTS } from '@/lib/flare-config';

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

async function safeEthCall(to: string, data: string): Promise<string | null> {
  try {
    const result = await rpcCall('eth_call', [{ to, data }, 'latest']);
    if (result && result !== '0x' && result !== '0x0' && result.length > 10) {
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

async function isContractDeployed(address: string): Promise<boolean> {
  const code = await rpcCall('eth_getCode', [address, 'latest']);
  return code.length > 10;
}

export async function GET() {
  try {
    // 1. Read the REAL current voting round from FlareSystemsManager
    let currentVotingRound = 0;
    const currentRoundResult = await safeEthCall(
      FLARE_SYSTEM_CONTRACTS.FlareSystemsManager,
      '0x4134520b' // getCurrentVotingEpochId()
    );
    if (currentRoundResult) {
      currentVotingRound = parseInt(currentRoundResult.slice(2, 66), 16);
    }

    // 2. Read the on-chain solvency proof's votingRound
    let proofVotingRound = 0;
    let proofMerkleRoot = '';
    let proofIsValid = false;
    const proofResult = await safeEthCall(
      AEGIS_CONTRACTS.SolvencyRoot,
      '0xbf0a32bb' // getCurrentSolvencyProof()
    );
    if (proofResult && proofResult.length > 10) {
      const hex = proofResult.slice(2);
      const words: string[] = [];
      for (let i = 0; i < hex.length; i += 64) words.push(hex.slice(i, i + 64));
      if (words.length >= 9) {
        proofMerkleRoot = '0x' + (words[0] || '0'.repeat(64)).slice(-64);
        proofVotingRound = parseInt(words[6] || '0', 16);
        proofIsValid = parseInt(words[8] || '0', 16) !== 0;
      }
    }

    // 3. Determine if the proof's voting round has finalized
    // An FDC voting round is "finalized" once currentVotingRound > proofVotingRound.
    // (Within the same round, votes are still being collected.)
    const isFinalized = proofVotingRound > 0 && currentVotingRound > proofVotingRound;
    const isCurrentRound = proofVotingRound === currentVotingRound && currentVotingRound > 0;
    const isBogus = proofVotingRound > 100_000_000; // looks like a Unix timestamp, not a round id (real rounds are ~1.4M)

    const fdcStatus = isBogus ? 'invalid (voting round looks like a timestamp — republish with correct round)'
                    : isFinalized ? 'finalized (proof round has closed, attestations can be verified)'
                    : isCurrentRound ? 'current (proof is from the active voting round — wait for next round to finalize)'
                    : 'pending';

    // 4. Check contract deployments
    const [fdcHubDeployed, fdcVerificationDeployed, fdcAttestorDeployed, fdc2HubDeployed, fdc2VerificationDeployed] = await Promise.all([
      isContractDeployed(FLARE_SYSTEM_CONTRACTS.FdcHub),
      isContractDeployed(FLARE_SYSTEM_CONTRACTS.FdcVerification),
      isContractDeployed(AEGIS_CONTRACTS.FDCAttestor),
      isContractDeployed(FLARE_SYSTEM_CONTRACTS.Fdc2Hub).catch(() => false),
      isContractDeployed(FLARE_SYSTEM_CONTRACTS.Fdc2Verification).catch(() => false),
    ]);

    // 5. Read FdcVerification implementation address (it's an EIP-1967 proxy)
    let fdcVerificationImpl = '';
    try {
      const proxySlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
      const implRaw = await rpcCall('eth_getStorage', [FLARE_SYSTEM_CONTRACTS.FdcVerification, proxySlot, 'latest']);
      if (implRaw && implRaw !== '0x' + '0'.repeat(64)) {
        fdcVerificationImpl = '0x' + implRaw.slice(26);
      }
    } catch {}

    return NextResponse.json({
      currentVotingRound,
      proofVotingRound,
      proofMerkleRoot,
      proofIsValid,
      isFinalized,
      isCurrentRound,
      isBogus,
      fdcStatus,
      contractsDeployed: {
        FdcHub: fdcHubDeployed,
        FdcVerification: fdcVerificationDeployed,
        FDCAttestor: fdcAttestorDeployed,
        Fdc2Hub: fdc2HubDeployed,
        Fdc2Verification: fdc2VerificationDeployed,
      },
      fdcHubAddress: FLARE_SYSTEM_CONTRACTS.FdcHub,
      fdcVerificationAddress: FLARE_SYSTEM_CONTRACTS.FdcVerification,
      fdcVerificationImplementation: fdcVerificationImpl,
      fdcAttestorAddress: AEGIS_CONTRACTS.FDCAttestor,
      fdc2HubAddress: FLARE_SYSTEM_CONTRACTS.Fdc2Hub,
      fdc2VerificationAddress: FLARE_SYSTEM_CONTRACTS.Fdc2Verification,
      note: 'FdcVerification does not expose merkleRoot(uint256). To verify a specific attestation, use FdcVerification.verifyPayment(attestation) or verifyEVMTransaction(attestation) with the full attestation struct (which includes its own Merkle proof).',
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to read FDC attestation status',
        currentVotingRound: 0,
        proofVotingRound: 0,
        isFinalized: false,
        contractsDeployed: {},
      },
      { status: 503 }
    );
  }
}
