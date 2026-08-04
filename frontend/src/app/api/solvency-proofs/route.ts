/**
 * API Route: Solvency Proof History
 *
 * Reads the solvency proof history from the SolvencyRoot contract on Coston2.
 * Uses getSolvencyHistory(count) for the on-chain history (reliable, no log scanning),
 * and falls back to getCurrentSolvencyProof() for the current proof.
 *
 * Also scans recent blocks for SolvencyProofPublished events to get tx hashes.
 */

import { NextResponse } from 'next/server';
import { getFlareConfig, AEGIS_CONTRACTS, FLARE_SYSTEM_CONTRACTS } from '@/lib/flare-config';

interface JsonRpcResponse {
  result?: unknown;
  error?: { code: number; message: string };
}

async function rpcCall(method: string, params: unknown[] = []): Promise<unknown> {
  const config = getFlareConfig();
  const response = await fetch(config.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data: JsonRpcResponse = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

async function rpcCallString(method: string, params: unknown[] = []): Promise<string> {
  const result = await rpcCall(method, params);
  return (result as string) || '0x0';
}

async function safeEthCall(to: string, data: string): Promise<string | null> {
  try {
    const result = await rpcCallString('eth_call', [{ to, data }, 'latest']);
    if (result && result !== '0x' && result !== '0x0' && result.length > 10) {
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

async function getBlockNumber(): Promise<number> {
  const hex = await rpcCallString('eth_blockNumber');
  return parseInt(hex, 16);
}

async function getBlockTimestamp(blockNumber: number): Promise<number> {
  try {
    const block = await rpcCall('eth_getBlockByNumber', [`0x${blockNumber.toString(16)}`, false]);
    const parsed = block as Record<string, string> | null;
    if (parsed && parsed.timestamp) {
      return parseInt(parsed.timestamp, 16);
    }
  } catch {}
  return 0;
}

async function getCurrentVotingRound(): Promise<number> {
  try {
    const result = await safeEthCall(
      FLARE_SYSTEM_CONTRACTS.FlareSystemsManager,
      '0x4134520b' // getCurrentVotingEpochId()
    );
    if (result) return parseInt(result.slice(2, 66), 16);
  } catch {}
  return 0;
}

// Verified on-chain event topic for SolvencyProofPublished
// event SolvencyProofPublished(bytes32 indexed merkleRoot, uint256 surplusBps, uint256 totalFxrpCollateral, uint256 collateralRatio, uint256 votingRound, address indexed attestor)
const SOLVENCY_PROOF_TOPIC = '0x6cd2dab55978f0a59cda7b61611abc0e4edf4c44d09e857d7d33de669273be60';

interface ProofEntry {
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

/**
 * Parse a single SolvencyProof struct from ABI-encoded hex (9 words = 576 hex chars).
 * Struct order: merkleRoot, surplusBps, totalFxrpCollateral, totalLiabilities, collateralRatio, timestamp, votingRound, attestor, isValid
 */
function parseProofStruct(hex: string, startIndex = 0): {
  merkleRoot: string;
  surplusBps: number;
  totalFxrpCollateral: number;
  totalLiabilities: number;
  collateralRatio: number;
  timestamp: number;
  votingRound: number;
  attestor: string;
  isValid: boolean;
} | null {
  const words: string[] = [];
  const sliceStart = startIndex * 64;
  for (let i = sliceStart; i < sliceStart + 9 * 64 && i < hex.length; i += 64) {
    words.push(hex.slice(i, i + 64));
  }
  if (words.length < 9) return null;
  return {
    merkleRoot: '0x' + (words[0] || '0'.repeat(64)).slice(-64),
    surplusBps: parseInt(words[1] || '0', 16),
    totalFxrpCollateral: parseInt(words[2] || '0', 16),
    totalLiabilities: parseInt(words[3] || '0', 16),
    collateralRatio: parseInt(words[4] || '0', 16),
    timestamp: parseInt(words[5] || '0', 16),
    votingRound: parseInt(words[6] || '0', 16),
    attestor: '0x' + (words[7] || '0'.repeat(64)).slice(-40),
    isValid: parseInt(words[8] || '0', 16) !== 0,
  };
}

/**
 * Read SolvencyProofPublished logs to get tx hashes for the proofs.
 * Scans a range of blocks in 30-block chunks (Coston2 limit).
 */
async function getProofTxHashes(fromBlock: number, toBlock: number): Promise<Map<string, { txHash: string; blockNumber: number; timestamp: number }>> {
  const result = new Map<string, { txHash: string; blockNumber: number; timestamp: number }>();
  const CHUNK = 30;

  for (let start = fromBlock; start <= toBlock; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, toBlock);
    try {
      const logsRaw = await rpcCall('eth_getLogs', [{
        fromBlock: '0x' + start.toString(16),
        toBlock: '0x' + end.toString(16),
        address: AEGIS_CONTRACTS.SolvencyRoot,
        topics: [SOLVENCY_PROOF_TOPIC],
      }]);
      const logs = Array.isArray(logsRaw) ? logsRaw : [];
      for (const log of logs) {
        const topics = log.topics || [];
        const root = topics[1] || '';
        if (root) {
          const blockNum = parseInt(log.blockNumber || '0x0', 16);
          const ts = await getBlockTimestamp(blockNum);
          result.set(root.toLowerCase(), {
            txHash: log.transactionHash || '',
            blockNumber: blockNum,
            timestamp: ts,
          });
        }
      }
    } catch {
      // skip failed chunks
    }
  }
  return result;
}

export async function GET() {
  try {
    const currentBlock = await getBlockNumber();
    const currentVotingRound = await getCurrentVotingRound();

    // 1. Read the on-chain proof history via getSolvencyHistory(20)
    // Selector for getSolvencyHistory(uint256) = keccak256("getSolvencyHistory(uint256)")[:4] = 0x61a339a5
    const GET_HISTORY_SELECTOR = '0x61a339a5';
    const historyResult = await safeEthCall(
      AEGIS_CONTRACTS.SolvencyRoot,
      GET_HISTORY_SELECTOR + (20).toString(16).padStart(64, '0')
    );

    // 2. Read current proof and solvency status
    const IS_SOLVENT = '0x5ce23950';
    const GET_CURRENT_PROOF = '0xbf0a32bb';
    const GET_MIN_RATIO = '0x4c8f35ab';

    const [isSolventResult, currentProofResult, minRatioResult] = await Promise.all([
      safeEthCall(AEGIS_CONTRACTS.SolvencyRoot, IS_SOLVENT),
      safeEthCall(AEGIS_CONTRACTS.SolvencyRoot, GET_CURRENT_PROOF),
      safeEthCall(AEGIS_CONTRACTS.SolvencyRoot, GET_MIN_RATIO),
    ]);

    // Parse current proof
    const currentParsed = currentProofResult ? parseProofStruct(currentProofResult.slice(2)) : null;

    // Parse solvency status
    let solvent = false;
    let onChainRatio = 0;
    if (isSolventResult) {
      solvent = parseInt(isSolventResult.slice(2, 66), 16) === 1;
      onChainRatio = parseInt(isSolventResult.slice(66, 130), 16);
    }
    const minRatio = minRatioResult ? parseInt(minRatioResult.slice(2, 66), 16) : 15000;

    // 3. Parse the history array
    // The return is a dynamic array of SolvencyProof structs.
    // ABI encoding: offset (32) + length (32) + elements (each 9 words = 288 bytes)
    const proofs: ProofEntry[] = [];

    if (historyResult && historyResult.length > 10) {
      const hex = historyResult.slice(2);
      // First 32 bytes = offset (should be 0x40 = 64)
      // Next 32 bytes = length
      const lengthHex = hex.slice(64, 128);
      const arrayLen = parseInt(lengthHex, 16);

      for (let i = 0; i < arrayLen; i++) {
        const structStart = 128 + i * 9 * 64; // after offset + length, each struct is 9 words
        const parsed = parseProofStruct(hex, structStart / 64);
        if (parsed) {
          proofs.push({
            ...parsed,
            blockNumber: 0, // will be filled from logs if available
            transactionHash: '',
          });
        }
      }
    }

    // 4. Scan recent blocks for tx hashes (scan last 100,000 blocks in 30-block chunks — but that's 3333 requests)
    // Instead, scan a reasonable window: last 5000 blocks (~2.5 hours at ~3s blocks)
    // Plus the known publish block 33636533 (our recent publish)
    const knownPublishBlocks = [33636533]; // our recent publish
    const scanRanges = knownPublishBlocks.map(b => ({ from: b - 5, to: b + 5 }));
    // Also scan last 100 blocks
    scanRanges.push({ from: Math.max(0, currentBlock - 100), to: currentBlock });

    const txHashMap = new Map<string, { txHash: string; blockNumber: number; timestamp: number }>();
    for (const { from, to } of scanRanges) {
      const map = await getProofTxHashes(from, to);
      for (const [k, v] of map) txHashMap.set(k, v);
    }

    // 5. Enrich proofs with tx hash / block / timestamp from logs
    for (const proof of proofs) {
      const logData = txHashMap.get(proof.merkleRoot.toLowerCase());
      if (logData) {
        proof.transactionHash = logData.txHash;
        proof.blockNumber = logData.blockNumber;
        if (logData.timestamp > 0) proof.timestamp = logData.timestamp;
      }
    }

    // 6. If current proof is not in history, add it at the top
    if (currentParsed && currentParsed.merkleRoot && currentParsed.merkleRoot !== '0x' + '0'.repeat(64)) {
      const alreadyInHistory = proofs.some(p => p.merkleRoot.toLowerCase() === currentParsed.merkleRoot.toLowerCase());
      if (!alreadyInHistory) {
        const logData = txHashMap.get(currentParsed.merkleRoot.toLowerCase());
        proofs.unshift({
          ...currentParsed,
          blockNumber: logData?.blockNumber || currentBlock,
          transactionHash: logData?.txHash || '',
        });
      }
    }

    // Sort by block number descending (newest first); proofs without block go to end
    proofs.sort((a, b) => b.blockNumber - a.blockNumber);

    return NextResponse.json({
      proofs,
      currentBlock,
      currentVotingRound,
      solvent,
      collateralRatio: onChainRatio,
      minCollateralRatio: minRatio,
      contractAddress: AEGIS_CONTRACTS.SolvencyRoot,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to read proof history',
        proofs: [],
      },
      { status: 503 }
    );
  }
}
