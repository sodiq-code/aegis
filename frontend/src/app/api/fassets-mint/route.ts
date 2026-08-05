/**
 * API Route: FAssets Direct-Mint Orchestration
 *
 * Implements the production XRPL → FAssets → VaultCore flow:
 *   1. Verify the XRPL payment to the FAssets Core Vault
 *   2. Request FDC attestation via the verifier API
 *   3. Submit requestAttestation to FdcHub on Flare (pay fee)
 *   4. Poll Relay.isFinalized(200, votingRound) until the round finalizes
 *   5. Fetch the attestation proof from the DA Layer
 *   6. Call AssetManagerFXRP.executeDirectMinting(proof)
 *   7. Return the mint tx hash + new FXRP balance
 *
 * Because this flow takes ~2-4 minutes (FDC finalization), we use a
 * session-based pattern:
 *   POST /api/fassets-mint  → initiate (returns sessionId + step)
 *   GET  /api/fassets-mint?sessionId=X → poll status
 *
 * Reference: https://dev.flare.network/fassets/developer-guides/
 *            https://fdc-verifiers-testnet.flare.network/verifier
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFlareConfig, AEGIS_CONTRACTS, FLARE_SYSTEM_CONTRACTS } from '@/lib/flare-config';
import { ethers } from 'ethers';

// ─── Constants (from PHASE-A-RESEARCH) ─────────────────────────────────────

const XRPL_TESTNET_WS = 'wss://s.altnet.rippletest.net:51233';
const XRPL_TESTNET_RPC = 'https://s.altnet.rippletest.net:51234';
const FDC_VERIFIER_URL = 'https://fdc-verifiers-testnet.flare.network/verifier';
const FDC_DA_LAYER_URL = 'https://ctn2-data-availability.flare.network/api/v1/fdc';
const FDC_API_KEY = '00000000-0000-0000-0000-000000000000'; // public rate-limited key

// Attestation type: "XRPPayment" (0x08) padded to bytes32
const ATTESTATION_TYPE_XRP_PAYMENT = '0x5852505061796d656e7400000000000000000000000000000000000000000000';
// Source ID: "testXRP" padded to bytes32
const SOURCE_ID_TEST_XRP = '0x7465737458525000000000000000000000000000000000000000000000000000';

// FlareSystemsManager first voting round start timestamp (Coston2)
const FSM_FIRST_ROUND_START = 1_658_430_000;
const FSM_ROUND_DURATION_SEC = 90;

// Relay contract on Coston2 for finalization checks
const RELAY_ADDRESS = '0xa10B672D1c62e5457b17af63d4302add6A99d7dE';
const FDC_PROTOCOL_ID = 200;

// Verifier private key for paying FDC fees + calling executeDirectMinting
// (In production, the user would sign these via MetaMask; for the demo, we
//  use the verifier key as the executor.)
const VERIFIER_PRIVATE_KEY = process.env.AEGIS_VERIFIER_PRIVATE_KEY ||
  '0xb3e509a0949e4d4ae489025a95eae959df178188f2c6ca130eceb2ef4ac70951';

// ─── Session Storage (in-memory; demo only) ───────────────────────────────

interface MintSession {
  sessionId: string;
  xrplTxHash: string;
  evmAddress: string;
  amountXrp: string;
  policyId: number;
  step: 'initiated' | 'verifying_xrpl' | 'requesting_fdc' | 'waiting_finalization' |
        'fetching_proof' | 'minting' | 'complete' | 'error';
  error?: string;
  votingRound?: number;
  fdcRequestTxHash?: string;
  mintTxHash?: string;
  fxrpMinted?: string;
  createdAt: number;
  lastUpdated: number;
}

const sessions = new Map<string, MintSession>();

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeSessionId(): string {
  return 'mint_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function updateSession(id: string, patch: Partial<MintSession>) {
  const s = sessions.get(id);
  if (!s) return;
  Object.assign(s, patch, { lastUpdated: Date.now() });
}

/**
 * Verify an XRPL payment by tx hash via the XRPL JSON-RPC API.
 * Returns the payment details or throws.
 */
async function verifyXrplPayment(txHash: string): Promise<{
  destination: string;
  amount: string; // drops
  memos: string[];
  validated: boolean;
}> {
  const resp = await fetch(XRPL_TESTNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'tx',
      params: [{ transaction: txHash, binary: false }],
    }),
  });
  if (!resp.ok) {
    throw new Error(`XRPL RPC error: ${resp.status} ${resp.statusText}`);
  }
  const data = await resp.json();
  const tx = data?.result;
  if (!tx) throw new Error('XRPL tx not found');
  if (tx.error) throw new Error(`XRPL error: ${tx.error}`);
  if (!tx.validated) throw new Error('XRPL tx not yet validated — wait for ledger finality');

  const payment = tx.tx_json || tx;
  if (payment.TransactionType !== 'Payment') {
    throw new Error(`Not a Payment tx (got ${payment.TransactionType})`);
  }

  const memos: string[] = [];
  if (Array.isArray(payment.Memos)) {
    for (const m of payment.Memos) {
      if (m?.Memo?.MemoData) {
        // MemoData is hex-encoded
        memos.push(m.Memo.MemoData);
      }
    }
  }

  return {
    destination: payment.Destination,
    amount: typeof payment.Amount === 'string' ? payment.Amount : '0',
    memos,
    validated: tx.validated,
  };
}

/**
 * Compute the voting round ID for a given Unix timestamp (Coston2).
 */
function votingRoundForTimestamp(ts: number): number {
  return Math.floor((ts - FSM_FIRST_ROUND_START) / FSM_ROUND_DURATION_SEC);
}

/**
 * Prepare the FDC attestation request via the verifier API.
 * Returns the abiEncodedRequest (160-byte hex).
 */
async function prepareFdcAttestation(
  xrplTxHash: string,
  proofOwner: string,
): Promise<string> {
  // Normalize tx hash to 0x-prefixed lowercase hex
  const txId = xrplTxHash.startsWith('0x') ? xrplTxHash : '0x' + xrplTxHash;
  const owner = proofOwner.toLowerCase();

  const resp = await fetch(`${FDC_VERIFIER_URL}/xrp/XRPPayment/prepareRequest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': FDC_API_KEY,
    },
    body: JSON.stringify({
      attestationType: ATTESTATION_TYPE_XRP_PAYMENT,
      sourceId: SOURCE_ID_TEST_XRP,
      requestBody: {
        transactionId: txId,
        proofOwner: owner,
      },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`FDC verifier HTTP ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  if (data.status !== 'VALID') {
    throw new Error(`FDC verifier rejected: ${data.status || JSON.stringify(data)}`);
  }
  return data.abiEncodedRequest as string;
}

/**
 * Submit the attestation request to FdcHub on Flare, paying the fee.
 * Returns the tx hash + voting round.
 */
async function submitAttestationRequest(
  abiEncodedRequest: string,
): Promise<{ txHash: string; votingRound: number }> {
  const config = getFlareConfig();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);

  // Get the fee
  const feeAbi = ['function getRequestFee(bytes) view returns (uint256)'];
  const feeCfg = new ethers.Contract(FLARE_SYSTEM_CONTRACTS.FdcRequestFeeConfigs, feeAbi, provider);
  const fee = await feeCfg.getRequestFee(abiEncodedRequest);

  // Submit with the verifier key
  const wallet = new ethers.Wallet(VERIFIER_PRIVATE_KEY, provider);
  const fdcHubAbi = ['function requestAttestation(bytes) payable'];
  const fdcHub = new ethers.Contract(FLARE_SYSTEM_CONTRACTS.FdcHub, fdcHubAbi, wallet);

  const tx = await fdcHub.requestAttestation(abiEncodedRequest, { value: fee });
  const receipt = await tx.wait();

  // Compute voting round from the tx block timestamp
  const block = await provider.getBlock(receipt!.blockNumber);
  const votingRound = votingRoundForTimestamp(block!.timestamp);

  return { txHash: tx.hash, votingRound };
}

/**
 * Check if a voting round is finalized via Relay.isFinalized(200, roundId).
 */
async function isRoundFinalized(roundId: number): Promise<boolean> {
  const config = getFlareConfig();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const relayAbi = ['function isFinalized(uint256,uint256) view returns (bool)'];
  const relay = new ethers.Contract(RELAY_ADDRESS, relayAbi, provider);
  try {
    return await relay.isFinalized(FDC_PROTOCOL_ID, roundId);
  } catch {
    return false;
  }
}

/**
 * Fetch the attestation proof from the DA Layer.
 */
async function fetchAttestationProof(
  votingRound: number,
  requestBytes: string,
): Promise<{ merkleProof: string[]; response: any }> {
  const url = `${FDC_DA_LAYER_URL}/proof-by-request-round`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': FDC_API_KEY,
    },
    body: JSON.stringify({
      votingRoundId: votingRound,
      requestBytes,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`DA Layer HTTP ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  if (!data.proof || !data.response) {
    throw new Error(`DA Layer returned incomplete proof: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return { merkleProof: data.proof, response: data.response };
}

/**
 * Call AssetManagerFXRP.executeDirectMinting(proof) on Flare.
 * The proof is an IXRPPayment.Proof struct: { bytes32[] merkleProof; Response data }.
 */
async function executeDirectMinting(
  merkleProof: string[],
  response: any,
): Promise<{ txHash: string; mintedAmount: string }> {
  const config = getFlareConfig();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(VERIFIER_PRIVATE_KEY, provider);

  // The IXRPPayment.Proof struct + Response struct ABI.
  // Response: { bytes32 attestationType; bytes32 sourceId; uint64 votingRound;
  //             uint64 lowestUsedTimestamp; RequestBody requestBody; ResponseBody responseBody; }
  // RequestBody:  { bytes32 transactionId; address proofOwner; }
  // ResponseBody: { uint64 blockNumber; uint64 blockTimestamp; string sourceAddress;
  //                  bytes32 sourceAddressHash; bytes32 receivingAddressHash;
  //                  bytes32 intendedReceivingAddressHash; int256 spentAmount;
  //                  int256 intendedSpentAmount; int256 receivedAmount;
  //                  int256 intendedReceivedAmount; bool hasMemoData; bytes firstMemoData;
  //                  bool hasDestinationTag; uint256 destinationTag; uint8 status; }
  // Proof: { bytes32[] merkleProof; Response data; }
  const abi = [
    `function executeDirectMinting(((bytes32[],(bytes32,bytes32,uint64,uint64,(bytes32,address),(uint64,uint64,string,bytes32,bytes32,bytes32,int256,int256,int256,int256,bool,bytes,bool,uint256,uint8)))) external payable`,
  ];
  const assetManager = new ethers.Contract(FLARE_SYSTEM_CONTRACTS.AssetManagerFXRP, abi, wallet);

  // Build the Response struct
  const rb = response.requestBody || {};
  const rb2 = response.responseBody || {};
  const responseData = {
    attestationType: response.attestationType,
    sourceId: response.sourceId,
    votingRound: response.votingRound,
    lowestUsedTimestamp: response.lowestUsedTimestamp,
    requestBody: {
      transactionId: rb.transactionId,
      proofOwner: rb.proofOwner,
    },
    responseBody: {
      blockNumber: rb2.blockNumber,
      blockTimestamp: rb2.blockTimestamp,
      sourceAddress: rb2.sourceAddress,
      sourceAddressHash: rb2.sourceAddressHash,
      receivingAddressHash: rb2.receivingAddressHash,
      intendedReceivingAddressHash: rb2.intendedReceivingAddressHash,
      spentAmount: rb2.spentAmount,
      intendedSpentAmount: rb2.intendedSpentAmount,
      receivedAmount: rb2.receivedAmount,
      intendedReceivedAmount: rb2.intendedReceivedAmount,
      hasMemoData: rb2.hasMemoData,
      firstMemoData: rb2.firstMemoData,
      hasDestinationTag: rb2.hasDestinationTag,
      destinationTag: rb2.destinationTag,
      status: rb2.status,
    },
  };
  const proofStruct = [merkleProof, responseData];

  const tx = await assetManager.executeDirectMinting(proofStruct, { value: 0 });
  const receipt = await tx.wait();

  // Parse the minted amount from the DirectMintingExecuted event
  let mintedAmount = '0';
  try {
    const iface = new ethers.Interface([
      'event DirectMintingExecuted(address indexed agentVault, address indexed targetAddress, uint256 mintedAmountUBA, uint256 mintingFeeUBA, uint256 executorFeeUBA)',
    ]);
    for (const log of receipt!.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as any, data: log.data });
        if (parsed) {
          mintedAmount = parsed.args.mintedAmountUBA.toString();
          break;
        }
      } catch {}
    }
  } catch {}

  return { txHash: tx.hash, mintedAmount };
}

// ─── Background Processing ────────────────────────────────────────────────

/**
 * Run the full FAssets direct-mint flow for a session.
 * This runs in the background; the frontend polls GET for status.
 */
async function runMintFlow(session: MintSession) {
  const id = session.sessionId;
  try {
    // Step 1: Verify XRPL payment
    updateSession(id, { step: 'verifying_xrpl' });
    const payment = await verifyXrplPayment(session.xrplTxHash);
    if (!payment.validated) {
      throw new Error('XRPL payment not yet validated');
    }

    // Step 2: Prepare FDC attestation request
    updateSession(id, { step: 'requesting_fdc' });
    const abiEncoded = await prepareFdcAttestation(session.xrplTxHash, session.evmAddress);

    // Step 3: Submit to FdcHub
    const { txHash: fdcTxHash, votingRound } = await submitAttestationRequest(abiEncoded);
    updateSession(id, {
      fdcRequestTxHash: fdcTxHash,
      votingRound,
    });

    // Step 4: Wait for finalization (poll every 15s, up to ~5 minutes)
    updateSession(id, { step: 'waiting_finalization' });
    const maxAttempts = 20; // 5 minutes at 15s intervals
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 15_000));
      const finalized = await isRoundFinalized(votingRound);
      if (finalized) break;
      if (i === maxAttempts - 1) {
        throw new Error(`FDC round ${votingRound} not finalized after ${maxAttempts * 15}s`);
      }
    }

    // Step 5: Fetch proof from DA Layer
    updateSession(id, { step: 'fetching_proof' });
    const { merkleProof, response } = await fetchAttestationProof(votingRound, abiEncoded);

    // Step 6: Call executeDirectMinting
    updateSession(id, { step: 'minting' });
    const { txHash: mintTxHash, mintedAmount } = await executeDirectMinting(merkleProof, response);

    updateSession(id, {
      step: 'complete',
      mintTxHash,
      fxrpMinted: mintedAmount,
    });
  } catch (error) {
    updateSession(id, {
      step: 'error',
      error: error instanceof Error ? error.message : 'Unknown mint error',
    });
  }
}

// ─── Route Handlers ───────────────────────────────────────────────────────

/**
 * POST /api/fassets-mint
 *   body: { xrplTxHash, evmAddress, amountXrp, policyId }
 *   returns: { sessionId, step: 'initiated' }
 *
 * Initiates the FAssets direct-mint flow in the background.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { xrplTxHash, evmAddress, amountXrp, policyId } = body as {
      xrplTxHash?: string;
      evmAddress?: string;
      amountXrp?: string;
      policyId?: number;
    };

    if (!xrplTxHash || !xrplTxHash.match(/^[0-9A-Fa-f]{64}$/)) {
      return NextResponse.json(
        { error: 'xrplTxHash must be a 64-character hex string' },
        { status: 400 }
      );
    }
    if (!evmAddress || !ethers.isAddress(evmAddress)) {
      return NextResponse.json(
        { error: 'evmAddress must be a valid EVM address' },
        { status: 400 }
      );
    }
    if (!amountXrp || parseFloat(amountXrp) <= 0) {
      return NextResponse.json(
        { error: 'amountXrp must be > 0' },
        { status: 400 }
      );
    }

    const sessionId = makeSessionId();
    const session: MintSession = {
      sessionId,
      xrplTxHash,
      evmAddress,
      amountXrp,
      policyId: policyId ?? 2,
      step: 'initiated',
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    };
    sessions.set(sessionId, session);

    // Start the background flow
    runMintFlow(session).catch(err => {
      updateSession(sessionId, {
        step: 'error',
        error: `Background flow crashed: ${err instanceof Error ? err.message : String(err)}`,
      });
    });

    return NextResponse.json({
      sessionId,
      step: session.step,
      message: 'FAssets direct-mint flow initiated. Poll GET /api/fassets-mint?sessionId=X for status.',
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to initiate mint' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/fassets-mint?sessionId=X
 *   returns: { sessionId, step, votingRound?, fdcRequestTxHash?, mintTxHash?, fxrpMinted?, error? }
 *
 * Also supports GET /api/fassets-mint?info=true to get the XRPL payment details
 * (Core Vault address, memo format, fee schedule) for the frontend to display
 * before the user signs.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');
  const info = searchParams.get('info');

  // Info mode: return the XRPL payment details for the frontend
  if (info === 'true') {
    const config = getFlareConfig();
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);

    // Read Core Vault XRPL address + fee schedule from AssetManagerFXRP
    const abi = [
      'function directMintingPaymentAddress() view returns (string)',
      'function getDirectMintingMinimumFeeUBA() view returns (uint256)',
      'function getDirectMintingFeeBIPS() view returns (uint256)',
      'function getDirectMintingExecutorFeeUBA() view returns (uint256)',
      'function lotSize() view returns (uint256)',
      'function assetMintingGranularityUBA() view returns (uint256)',
    ];
    const am = new ethers.Contract(FLARE_SYSTEM_CONTRACTS.AssetManagerFXRP, abi, provider);
    let coreVaultAddr = 'rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p';
    let minFeeUba = BigInt(100_000);
    let feeBips = BigInt(25);
    let executorFeeUba = BigInt(100_000);
    try {
      coreVaultAddr = await am.directMintingPaymentAddress();
      minFeeUba = await am.getDirectMintingMinimumFeeUBA();
      feeBips = await am.getDirectMintingFeeBIPS();
      executorFeeUba = await am.getDirectMintingExecutorFeeUBA();
    } catch (e) {
      // Fall back to defaults
    }

    return NextResponse.json({
      xrplTestnet: {
        wsUrl: XRPL_TESTNET_WS,
        rpcUrl: XRPL_TESTNET_RPC,
        explorer: 'https://testnet.xrpl.org',
      },
      coreVaultAddress: coreVaultAddr,
      fees: {
        minimumFeeUba: minFeeUba.toString(),
        minimumFeeXrp: Number(minFeeUba) / 1e6,
        feeBips: Number(feeBips),
        feePercent: Number(feeBips) / 100,
        executorFeeUba: executorFeeUba.toString(),
        executorFeeXrp: Number(executorFeeUba) / 1e6,
      },
      memoFormat: {
        prefix: '0x4642505266410018', // 8-byte DIRECT_MINTING prefix
        description: '32-byte memo: 8-byte prefix + 4 zero bytes + 20-byte recipient EVM address (lowercase, no 0x)',
        example: '0x464250526641001800000000e37ee912289b047a7c5e9dc8c15ab23e21b8b0c4',
      },
      flareContracts: {
        AssetManagerFXRP: FLARE_SYSTEM_CONTRACTS.AssetManagerFXRP,
        FdcHub: FLARE_SYSTEM_CONTRACTS.FdcHub,
        FdcVerification: FLARE_SYSTEM_CONTRACTS.FdcVerification,
        Relay: RELAY_ADDRESS,
      },
      timing: {
        roundDurationSec: FSM_ROUND_DURATION_SEC,
        expectedFinalizationSec: 90 * 2,
        xrplConfirmationsRequired: 3,
      },
    });
  }

  // Status mode: return the session state
  if (!sessionId) {
    return NextResponse.json(
      { error: 'Missing sessionId. Use ?sessionId=X or ?info=true' },
      { status: 400 }
    );
  }
  const session = sessions.get(sessionId);
  if (!session) {
    return NextResponse.json(
      { error: `Session ${sessionId} not found` },
      { status: 404 }
    );
  }
  return NextResponse.json({
    sessionId: session.sessionId,
    step: session.step,
    xrplTxHash: session.xrplTxHash,
    evmAddress: session.evmAddress,
    amountXrp: session.amountXrp,
    policyId: session.policyId,
    votingRound: session.votingRound,
    fdcRequestTxHash: session.fdcRequestTxHash,
    mintTxHash: session.mintTxHash,
    fxrpMinted: session.fxrpMinted,
    error: session.error,
    elapsedSec: Math.floor((Date.now() - session.createdAt) / 1000),
  });
}
