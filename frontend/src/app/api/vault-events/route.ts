/**
 * API Route: Vault Events
 * 
 * Reads recent on-chain events from VaultCore and SolvencyRoot on Coston2.
 * Returns recent deposits, position revaluations, solvency proofs, and
 * other vault actions for display in the Treasury view.
 * 
 * Coston2 limits eth_getLogs to 30 blocks per request, so we scan in chunks.
 */

import { NextResponse } from 'next/server';
import { getFlareConfig, AEGIS_CONTRACTS } from '@/lib/flare-config';

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

// Event topic0 signatures (keccak256 of event signatures)
// These are verified against real on-chain events on Coston2
const EVENT_TOPICS = {
  // SolvencyProofPublished(bytes32 indexed merkleRoot, uint256 surplusBps, uint256 totalFxrpCollateral, uint256 collateralRatio, uint256 votingRound, address indexed attestor)
  // Verified on-chain at block 33,565,198 on Coston2
  SolvencyProofPublished: '0x6cd2dab55978f0a59cda7b61611abc0e4edf4c44d09e857d7d33de669273be60',
  // SolvencyProofVerified(bytes32 indexed merkleRoot, bool isValid, uint256 collateralRatio)
  SolvencyProofVerified: '0xc6df40680784542e8461993c1e6c5c4dca0ae5ac8e37352c6cf679a2df15ffcf',
  // DepositMade(uint256 indexed positionId, address indexed depositor, uint256 amount, uint256 policyId)
  DepositMade: '0xf7748ed362ae6427631c778e495f7eb63b00c0794b6066744a0cba2c59135a65',
  // PositionRevalued(uint256 indexed positionId, uint256 newValuation, uint256 timestamp)
  PositionRevalued: '0x4cdb25a2be20563cd5111483810c6262c3f2a2dd2a1c2f60aa33404f089770c5',
  // WithdrawalCompleted(uint256 indexed positionId, address indexed depositor, uint256 amount)
  WithdrawalCompleted: '0xcd7211ce885c480c8874fe7e69383ad2d60ec453bdb417e7f45222bf44e47266',
  // EmergencyModeEntered(address indexed triggeredBy)
  EmergencyModeEntered: '0x61f653d17bce5d89badcfaa56cc5044c08efe1a77a1cc5d8020588602f2da28b',
  // SafeStateEntered(address indexed triggeredBy)
  SafeStateEntered: '0xe52c6a6ea80a6cb927747fafc3fd0bd9578b70c42f4de60c99fe6fe40c8c4f7c',
} as const;

// Known activity block (verified on-chain)
const KNOWN_ACTIVITY_BLOCK = 33565198;

// Known transaction hash (verified on-chain)
// Used for reference; real tx hashes are fetched from on-chain events
const _KNOWN_M3_TX_HASH = '0xfb4eeb96febf3929b6f1f55d394476a60815754d9ea84219edf27f1cb3bf4481';

interface VaultEvent {
  type: string;
  blockNumber: number;
  transactionHash: string;
  contract: string;
  timestamp?: number;
  details: Record<string, string>;
}

/**
 * Fetch logs in 30-block chunks (Coston2 limit)
 */
async function fetchLogsInChunks(
  address: string,
  fromBlock: number,
  toBlock: number,
  topic0?: string
): Promise<Array<{ blockNumber: string; transactionHash: string; topics: string[]; data: string }>> {
  const allLogs: Array<{ blockNumber: string; transactionHash: string; topics: string[]; data: string }> = [];
  const CHUNK = 30;

  for (let start = fromBlock; start <= toBlock; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, toBlock);
    const filter: Record<string, unknown> = {
      fromBlock: `0x${start.toString(16)}`,
      toBlock: `0x${end.toString(16)}`,
      address,
    };
    if (topic0) {
      filter.topics = [topic0];
    }

    try {
      const logs = await rpcCall('eth_getLogs', [filter]);
      if (Array.isArray(logs)) {
        allLogs.push(...logs);
      }
    } catch {
      // Skip failed chunks
    }
  }

  return allLogs;
}

/**
 * Decode an address from a topic (32-byte padded)
 */
function decodeAddress(topic: string): string {
  return '0x' + topic.slice(26);
}

/**
 * Decode a uint256 from hex data at a given offset
 */
function decodeUint256(data: string, offset: number): bigint {
  const start = 2 + offset * 64; // skip 0x, each word is 64 hex chars
  if (start + 64 > data.length) return BigInt(0);
  return BigInt('0x' + data.slice(start, start + 64));
}

/**
 * Get block timestamp for a given block number
 */
async function getBlockTimestamp(blockNumber: number): Promise<number> {
  try {
    const block = await rpcCall('eth_getBlockByNumber', [`0x${blockNumber.toString(16)}`, false]) as Record<string, string>;
    if (block && block.timestamp) {
      return parseInt(block.timestamp, 16);
    }
  } catch {}
  return 0;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rangeParam = url.searchParams.get('range') || 'recent';
    
    // Determine block range to scan
    const currentBlockHex = await rpcCall('eth_blockNumber') as string;
    const currentBlock = parseInt(currentBlockHex as string, 16);
    
    if (rangeParam === 'all') {
      const events: VaultEvent[] = [];
      
      // Scan 1: Known activity area (±30 blocks around the verified proof block)
      const historicEvents = await scanBlockRange(
        KNOWN_ACTIVITY_BLOCK - 30,
        KNOWN_ACTIVITY_BLOCK + 30
      );
      events.push(...historicEvents);
      
      // Scan 2: Recent 60 blocks
      const recentFrom = currentBlock - 60;
      if (recentFrom > KNOWN_ACTIVITY_BLOCK + 30) {
        const recentEvents = await scanBlockRange(recentFrom, currentBlock);
        events.push(...recentEvents);
      }
      
      // Sort by block number descending (most recent first)
      events.sort((a, b) => b.blockNumber - a.blockNumber);
      
      return NextResponse.json({
        events: events.slice(0, 50),
        scannedRange: { 
          from: KNOWN_ACTIVITY_BLOCK - 30, 
          to: Math.max(currentBlock, KNOWN_ACTIVITY_BLOCK + 30), 
          currentBlock 
        },
      });
    }
    
    // Recent: scan last ~60 blocks only (fast)
    const fromBlock = currentBlock - 60;
    const events = await scanBlockRange(fromBlock, currentBlock);
    events.sort((a, b) => b.blockNumber - a.blockNumber);
    
    return NextResponse.json({
      events: events.slice(0, 50),
      scannedRange: { from: fromBlock, to: currentBlock, currentBlock },
    });
  } catch (error) {
    return NextResponse.json(
      {
        events: [],
        error: error instanceof Error ? error.message : 'Failed to fetch vault events',
      },
      { status: 503 }
    );
  }
}

async function scanBlockRange(fromBlock: number, toBlock: number): Promise<VaultEvent[]> {
  const events: VaultEvent[] = [];
  const vaultCore = AEGIS_CONTRACTS.VaultCore;
  const solvencyRoot = AEGIS_CONTRACTS.SolvencyRoot;
  
  // Fetch SolvencyProofPublished events from SolvencyRoot (primary event)
  const solvencyLogs = await fetchLogsInChunks(solvencyRoot, fromBlock, toBlock, EVENT_TOPICS.SolvencyProofPublished);
  for (const log of solvencyLogs) {
    const merkleRoot = log.topics[1] || '0x0';
    const attestor = log.topics[2] ? decodeAddress(log.topics[2]) : '0x0';
    const surplusBps = decodeUint256(log.data, 0);
    const _totalFxrpCollateral = decodeUint256(log.data, 1);
    const collateralRatio = decodeUint256(log.data, 2);
    const votingRound = decodeUint256(log.data, 3);
    
    const blockNum = parseInt(log.blockNumber, 16);
    const timestamp = await getBlockTimestamp(blockNum);
    
    events.push({
      type: 'Solvency Proof Published',
      blockNumber: blockNum,
      transactionHash: log.transactionHash,
      contract: 'SolvencyRoot',
      timestamp,
      details: {
        merkleRoot: `${merkleRoot.slice(0, 10)}...${merkleRoot.slice(-4)}`,
        attestor: `${attestor.slice(0, 8)}...${attestor.slice(-4)}`,
        collateralRatio: `${(Number(collateralRatio) / 100).toFixed(0)}%`,
        surplusBps: Number(surplusBps).toString(),
        votingRound: Number(votingRound).toString(),
      },
    });
  }

  // Fetch SolvencyProofVerified events
  const verifiedLogs = await fetchLogsInChunks(solvencyRoot, fromBlock, toBlock, EVENT_TOPICS.SolvencyProofVerified);
  for (const log of verifiedLogs) {
    const merkleRoot = log.topics[1] || '0x0';
    const isValid = decodeUint256(log.data, 0);
    const collateralRatio = decodeUint256(log.data, 1);
    
    const blockNum = parseInt(log.blockNumber, 16);
    const timestamp = await getBlockTimestamp(blockNum);
    
    events.push({
      type: 'Solvency Proof Verified',
      blockNumber: blockNum,
      transactionHash: log.transactionHash,
      contract: 'SolvencyRoot',
      timestamp,
      details: {
        merkleRoot: `${merkleRoot.slice(0, 10)}...${merkleRoot.slice(-4)}`,
        isValid: Number(isValid) === 1 ? 'true' : 'false',
        collateralRatio: `${(Number(collateralRatio) / 100).toFixed(0)}%`,
      },
    });
  }
  
  // Fetch DepositMade events from VaultCore
  const depositLogs = await fetchLogsInChunks(vaultCore, fromBlock, toBlock, EVENT_TOPICS.DepositMade);
  for (const log of depositLogs) {
    const positionId = log.topics[1] ? parseInt(log.topics[1], 16) : 0;
    const depositor = log.topics[2] ? decodeAddress(log.topics[2]) : '0x0';
    const amount = decodeUint256(log.data, 0);
    const policyId = decodeUint256(log.data, 1);
    
    const blockNum = parseInt(log.blockNumber, 16);
    const timestamp = await getBlockTimestamp(blockNum);
    
    events.push({
      type: 'FXRP Deposit',
      blockNumber: blockNum,
      transactionHash: log.transactionHash,
      contract: 'VaultCore',
      timestamp,
      details: {
        positionId: positionId.toString(),
        depositor: `${depositor.slice(0, 8)}...${depositor.slice(-4)}`,
        depositorFull: depositor,
        amount: (Number(amount) / 1e6).toFixed(2) + ' FXRP',
        policyId: policyId.toString(),
      },
    });
  }
  
  // Fetch PositionRevalued events from VaultCore
  const revalueLogs = await fetchLogsInChunks(vaultCore, fromBlock, toBlock, EVENT_TOPICS.PositionRevalued);
  for (const log of revalueLogs) {
    const positionId = log.topics[1] ? parseInt(log.topics[1], 16) : 0;
    const newValuation = decodeUint256(log.data, 0);
    const timestampVal = decodeUint256(log.data, 1);
    
    events.push({
      type: 'Position Revalued',
      blockNumber: parseInt(log.blockNumber, 16),
      transactionHash: log.transactionHash,
      contract: 'VaultCore',
      timestamp: Number(timestampVal),
      details: {
        positionId: positionId.toString(),
        valuation: (Number(newValuation) / 1e6).toFixed(2) + ' USD',
      },
    });
  }
  
  // Fetch EmergencyModeEntered events
  const emergencyLogs = await fetchLogsInChunks(vaultCore, fromBlock, toBlock, EVENT_TOPICS.EmergencyModeEntered);
  for (const log of emergencyLogs) {
    const triggeredBy = log.topics[1] ? decodeAddress(log.topics[1]) : '0x0';
    
    events.push({
      type: 'Emergency Mode Entered',
      blockNumber: parseInt(log.blockNumber, 16),
      transactionHash: log.transactionHash,
      contract: 'VaultCore',
      details: {
        triggeredBy: `${triggeredBy.slice(0, 8)}...${triggeredBy.slice(-4)}`,
      },
    });
  }
  
  // Fetch SafeStateEntered events
  const safeStateLogs = await fetchLogsInChunks(vaultCore, fromBlock, toBlock, EVENT_TOPICS.SafeStateEntered);
  for (const log of safeStateLogs) {
    const triggeredBy = log.topics[1] ? decodeAddress(log.topics[1]) : '0x0';
    
    events.push({
      type: 'Safe State Entered',
      blockNumber: parseInt(log.blockNumber, 16),
      transactionHash: log.transactionHash,
      contract: 'VaultCore',
      details: {
        triggeredBy: `${triggeredBy.slice(0, 8)}...${triggeredBy.slice(-4)}`,
      },
    });
  }
  
  // Also scan all events (without topic filter) to catch any uncategorized events
  const allVaultLogs = await fetchLogsInChunks(vaultCore, fromBlock, toBlock);
  for (const log of allVaultLogs) {
    const topic0 = log.topics[0] || '';
    const isKnown = Object.values(EVENT_TOPICS).some(t => t === topic0);
    if (!isKnown) {
      const blockNum = parseInt(log.blockNumber, 16);
      const timestamp = await getBlockTimestamp(blockNum);
      events.push({
        type: 'Vault Event',
        blockNumber: blockNum,
        transactionHash: log.transactionHash,
        contract: 'VaultCore',
        timestamp,
        details: {
          topic0: `${topic0.slice(0, 10)}...`,
        },
      });
    }
  }
  
  const allSolvencyLogs = await fetchLogsInChunks(solvencyRoot, fromBlock, toBlock);
  for (const log of allSolvencyLogs) {
    const topic0 = log.topics[0] || '';
    const isKnown = Object.values(EVENT_TOPICS).some(t => t === topic0);
    if (!isKnown) {
      const blockNum = parseInt(log.blockNumber, 16);
      const timestamp = await getBlockTimestamp(blockNum);
      events.push({
        type: 'Solvency Event',
        blockNumber: blockNum,
        transactionHash: log.transactionHash,
        contract: 'SolvencyRoot',
        timestamp,
        details: {
          topic0: `${topic0.slice(0, 10)}...`,
          data: log.data ? `${log.data.slice(0, 10)}...` : '',
        },
      });
    }
  }
  
  // Deduplicate events
  const seen = new Set<string>();
  return events.filter(e => {
    const key = `${e.blockNumber}-${e.transactionHash}-${e.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
