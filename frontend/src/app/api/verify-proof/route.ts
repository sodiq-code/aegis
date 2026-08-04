/**
 * API Route: Verify Solvency Proof
 *
 * Verifies a solvency proof on-chain using the SolvencyRoot contract.
 *
 * Two verification modes:
 *   1. Merkle proof verification: caller provides { proof: string[], leaf: string }
 *      → calls SolvencyRoot.verifySolvency(proof, leaf) on-chain
 *   2. Current proof status check: caller provides { merkleRoot }
 *      → reads getCurrentSolvencyProof() and confirms the root matches
 *
 * Also performs an FDC round finalization check by reading
 * FlareSystemsManager.getCurrentVotingEpochId() and comparing it to the
 * proof's votingRound field. A proof with votingRound <= currentEpochId
 * is considered "FDC-finalizable" (the round has closed).
 */

import { NextRequest, NextResponse } from 'next/server';
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

// Helper: encode bytes32[] proof + bytes32 leaf for verifySolvency(bytes32[], bytes32)
function encodeVerifySolvency(proof: string[], leaf: string): string {
  // selector for verifySolvency(bytes32[],bytes32) = keccak256("verifySolvency(bytes32[],bytes32)")[:4]
  // = 0x06627f3b (verified against on-chain contract)
  const selector = '0x06627f3b';
  // offset to dynamic array data (after selector + 2 offsets = 0x40 + 0x40 = 0x80... actually)
  // ABI encoding: selector + offset_array (32) + offset_leaf (32) + length_array (32) + array_elements + leaf
  // Wait — leaf is bytes32 (static), so the layout is:
  //   selector + offset_array (32 bytes, = 0x40) + leaf (32 bytes) + length (32 bytes) + elements
  // Actually for (bytes32[], bytes32): first arg is dynamic, second is static.
  // Encoding: head = [offset_to_dynamic (32), leaf (32)] = 64 bytes, then tail = [length (32), elements...]
  const leafBytes = leaf.toLowerCase().startsWith('0x') ? leaf.slice(2) : leaf;
  const leafPadded = leafBytes.padStart(64, '0');
  const offset = '0000000000000000000000000000000000000000000000000000000000000040'; // 0x40 = 64 (after head)
  const length = (proof.length).toString(16).padStart(64, '0');
  const elements = proof.map(p => {
    const b = p.toLowerCase().startsWith('0x') ? p.slice(2) : p;
    return b.padStart(64, '0');
  }).join('');
  return selector + offset + leafPadded + length + elements;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { merkleRoot, proof, leaf } = body;

    // --- Mode 1: Real Merkle proof verification on-chain ---
    if (proof && leaf) {
      if (!Array.isArray(proof) || proof.length === 0) {
        return NextResponse.json(
          { error: 'proof must be a non-empty array of bytes32' },
          { status: 400 }
        );
      }
      if (typeof leaf !== 'string' || !leaf.startsWith('0x')) {
        return NextResponse.json(
          { error: 'leaf must be a 0x-prefixed bytes32 hex string' },
          { status: 400 }
        );
      }

      const callData = encodeVerifySolvency(proof, leaf);
      const result = await safeEthCall(AEGIS_CONTRACTS.SolvencyRoot, callData);

      const verifiedOnChain = result !== null && parseInt(result.slice(2, 66), 16) === 1;

      // Also read the current proof for context
      const GET_CURRENT_PROOF = '0xbf0a32bb'; // getCurrentSolvencyProof()
      const currentProofResult = await safeEthCall(AEGIS_CONTRACTS.SolvencyRoot, GET_CURRENT_PROOF);
      let currentMerkleRoot = '';
      let currentVotingRound = 0;
      if (currentProofResult && currentProofResult.length > 10) {
        const hex = currentProofResult.slice(2);
        const words: string[] = [];
        for (let i = 0; i < hex.length; i += 64) words.push(hex.slice(i, i + 64));
        if (words.length >= 7) {
          currentMerkleRoot = '0x' + (words[0] || '0'.repeat(64)).slice(-64);
          currentVotingRound = parseInt(words[6] || '0', 16);
        }
      }

      // Read the real current voting round
      const latestRoundResult = await safeEthCall(
        FLARE_SYSTEM_CONTRACTS.FlareSystemsManager,
        '0x4134520b' // getCurrentVotingEpochId()
      );
      const latestVotingRound = latestRoundResult ? parseInt(latestRoundResult.slice(2, 66), 16) : 0;

      const details: string[] = [
        `On-chain call: SolvencyRoot.verifySolvency(proof[${proof.length}], leaf)`,
        `Result: ${verifiedOnChain ? '✓ VALID — leaf is included in current Merkle root' : '✗ INVALID — leaf NOT in current root'}`,
        `Current on-chain root: ${currentMerkleRoot}`,
        `Leaf provided: ${leaf}`,
        `Proof voting round: ${currentVotingRound}`,
        `Latest voting round: ${latestVotingRound}`,
        `FDC round status: ${currentVotingRound > 0 && currentVotingRound <= latestVotingRound ? 'finalized (round has closed)' : 'pending or invalid'}`,
      ];

      return NextResponse.json({
        verified: verifiedOnChain,
        method: 'on-chain SolvencyRoot.verifySolvency(bytes32[], bytes32)',
        details: details.join('\n'),
        proofData: {
          merkleRoot: currentMerkleRoot,
          votingRound: currentVotingRound,
          latestVotingRound,
          leafProvided: leaf,
          proofLength: proof.length,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // --- Mode 2: Current proof status check (existing behavior, cleaned up) ---
    if (!merkleRoot) {
      return NextResponse.json(
        { error: 'Either { proof, leaf } for Merkle verification, or { merkleRoot } for status check, is required' },
        { status: 400 }
      );
    }

    const GET_CURRENT_PROOF = '0xbf0a32bb'; // getCurrentSolvencyProof()
    const IS_SOLVENT = '0x5ce23950';        // isSolvent() -> (bool, uint256)
    const GET_MIN_RATIO = '0x4c8f35ab';     // getMinCollateralRatio() -> uint256

    const [currentProofResult, isSolventResult, minRatioResult, latestRoundResult] = await Promise.all([
      safeEthCall(AEGIS_CONTRACTS.SolvencyRoot, GET_CURRENT_PROOF),
      safeEthCall(AEGIS_CONTRACTS.SolvencyRoot, IS_SOLVENT),
      safeEthCall(AEGIS_CONTRACTS.SolvencyRoot, GET_MIN_RATIO),
      safeEthCall(FLARE_SYSTEM_CONTRACTS.FlareSystemsManager, '0x4134520b'),
    ]);

    let currentMerkleRoot = '';
    let currentIsValid = false;
    let currentCollateralRatio = 0;
    let currentTimestamp = 0;
    let currentAttestor = '';
    let currentSurplusBps = 0;
    let currentTotalCollateral = 0;
    let currentTotalLiabilities = 0;
    let currentVotingRound = 0;

    if (currentProofResult && currentProofResult.length > 10) {
      const hex = currentProofResult.slice(2);
      const words: string[] = [];
      for (let i = 0; i < hex.length; i += 64) words.push(hex.slice(i, i + 64));
      if (words.length >= 9) {
        currentMerkleRoot = '0x' + (words[0] || '0'.repeat(64)).slice(-64);
        currentSurplusBps = parseInt(words[1] || '0', 16);
        currentTotalCollateral = parseInt(words[2] || '0', 16);
        currentTotalLiabilities = parseInt(words[3] || '0', 16);
        currentCollateralRatio = parseInt(words[4] || '0', 16);
        currentTimestamp = parseInt(words[5] || '0', 16);
        currentVotingRound = parseInt(words[6] || '0', 16);
        currentAttestor = '0x' + (words[7] || '0'.repeat(64)).slice(-40);
        currentIsValid = parseInt(words[8] || '0', 16) !== 0;
      }
    }

    let solvent = false;
    let onChainRatio = 0;
    if (isSolventResult) {
      solvent = parseInt(isSolventResult.slice(2, 66), 16) === 1;
      onChainRatio = parseInt(isSolventResult.slice(66, 130), 16);
    }
    const minRatio = minRatioResult ? parseInt(minRatioResult.slice(2, 66), 16) : 15000;
    const latestVotingRound = latestRoundResult ? parseInt(latestRoundResult.slice(2, 66), 16) : 0;

    const merkleRootLower = merkleRoot.toLowerCase();
    const currentRootLower = currentMerkleRoot.toLowerCase();
    const rootMatches = currentMerkleRoot !== '' && merkleRootLower === currentRootLower;
    const proofIsValid = rootMatches && currentIsValid;

    // FDC round finalization check (replaces the broken merkleRoot(round) call)
    // A proof is "FDC-finalizable" if its votingRound is in the past relative to the current epoch
    const fdcRoundStatus =
      currentVotingRound === 0 ? 'no voting round on proof' :
      currentVotingRound > latestVotingRound ? `pending (proof round ${currentVotingRound} > current ${latestVotingRound})` :
      `finalized (proof round ${currentVotingRound} <= current ${latestVotingRound})`;
    const fdcVerified = currentVotingRound > 0 && currentVotingRound <= latestVotingRound;

    const verificationDetails: string[] = [];
    if (rootMatches) {
      verificationDetails.push('Merkle root matches current on-chain proof in SolvencyRoot');
    } else if (currentMerkleRoot !== '') {
      verificationDetails.push(`Merkle root does NOT match current on-chain proof (current: ${currentMerkleRoot.slice(0, 18)}...)`);
    } else {
      verificationDetails.push('No current proof found on SolvencyRoot contract');
    }
    if (currentIsValid) {
      verificationDetails.push('Current proof is marked valid on-chain');
    } else if (currentMerkleRoot !== '') {
      verificationDetails.push('Current proof has been invalidated on-chain');
    }
    if (solvent) {
      verificationDetails.push(`Vault is SOLVENT — collateral ratio ${(onChainRatio / 100).toFixed(0)}% >= min ${(minRatio / 100).toFixed(0)}%`);
    } else if (onChainRatio > 0) {
      verificationDetails.push(`Vault is INSOLVENT — collateral ratio ${(onChainRatio / 100).toFixed(0)}% < min ${(minRatio / 100).toFixed(0)}%`);
    }
    if (currentSurplusBps > 0) {
      verificationDetails.push(`Surplus: ${(currentSurplusBps / 100).toFixed(2)}% above liabilities`);
    }
    verificationDetails.push(`FDC round: ${fdcRoundStatus}`);
    if (currentAttestor && currentAttestor !== '0x' + '0'.repeat(40)) {
      verificationDetails.push(`Attestor: ${currentAttestor}`);
    }
    verificationDetails.push(`SolvencyRoot contract: ${AEGIS_CONTRACTS.SolvencyRoot}`);
    verificationDetails.push(`Network: Coston2 (chain ID 114)`);
    verificationDetails.push(`Current voting round: ${latestVotingRound}`);

    return NextResponse.json({
      verified: proofIsValid,
      method: rootMatches ? 'on-chain SolvencyRoot proof comparison' : 'no matching on-chain proof',
      details: verificationDetails.join('\n'),
      proofData: {
        merkleRoot: currentMerkleRoot,
        surplusBps: currentSurplusBps,
        totalFxrpCollateral: currentTotalCollateral,
        totalLiabilities: currentTotalLiabilities,
        collateralRatio: currentCollateralRatio,
        timestamp: currentTimestamp,
        votingRound: currentVotingRound,
        attestor: currentAttestor,
        isValid: currentIsValid,
        solvent,
        onChainRatio,
        minRatio,
      },
      fdcVerification: {
        verified: fdcVerified,
        votingRound: currentVotingRound,
        latestVotingRound,
        status: fdcRoundStatus,
        note: 'FDC cross-check uses FlareSystemsManager.getCurrentVotingEpochId() to verify the proof\'s voting round has finalized. For full attestation verification, use FdcVerification.verifyPayment(attestation) with a specific attestation struct.',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        verified: false,
        method: 'error',
        details: error instanceof Error ? error.message : 'Verification failed',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
