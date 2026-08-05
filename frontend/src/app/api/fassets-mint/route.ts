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
import { getFlareConfig, FLARE_SYSTEM_CONTRACTS } from '@/lib/flare-config';
import { ethers } from 'ethers';
import {
  sendPaymentToCoreVault,
  isServerWalletConfigured,
  getServerWalletAddress,
  getServerWalletBalance,
} from '@/lib/xrpl-server-wallet';

// ─── Vercel Serverless Config ──────────────────────────────────────────────
// Phase 1 (XRPL payment + FDC attestation request) takes ~30s. Phase 2 polls
// are fast. Allow up to 300s so the mint flow never times out on Vercel.
// Without this, Vercel uses the plan default (10s Hobby / 15s Pro) and the
// mint hangs forever ("processing for a while, no result").
export const maxDuration = 300;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

// ─── Stateless Design ─────────────────────────────────────────────────────
//
// Vercel serverless functions are stateless — each request may hit a
// different instance, so in-memory session storage does NOT persist.
// Instead, the flow is split into stateless phases:
//
// Phase 1 (POST /api/fassets-mint with autoSend=true):
//   - Sends XRPL payment via server wallet
//   - Verifies it on XRPL
//   - Requests FDC attestation + submits to FdcHub
//   - Returns: { phase: 'waiting_finalization', xrplTxHash, votingRound,
//                abiEncodedRequest, fdcRequestTxHash }
//
// Phase 2 (POST /api/fassets-mint with phase='finalize'):
//   - Client passes back { votingRound, abiEncodedRequest, evmAddress }
//   - Server checks if the round is finalized
//   - If not: returns { phase: 'waiting_finalization', finalized: false }
//   - If yes: fetches proof, calls executeDirectMinting
//     Returns: { phase: 'complete', mintTxHash, fxrpMinted }
//
// The client polls Phase 2 every ~15s until phase='complete'.

interface MintState {
  phase: 'initiated' | 'waiting_finalization' | 'complete' | 'error';
  xrplTxHash?: string;
  evmAddress: string;
  amountXrp: string;
  votingRound?: number;
  abiEncodedRequest?: string;
  fdcRequestTxHash?: string;
  mintTxHash?: string;
  fxrpMinted?: string;
  error?: string;
  elapsedSec?: number;
  // For backwards-compat with the old session-based polling
  step?: string;
  autoSend?: boolean;
  sessionId?: string;
}

// In-memory session store (used only when the same instance is warm;
// the stateless phase-based design is the primary path)
const sessions = new Map<string, MintState>();

// ─── Helpers ──────────────────────────────────────────────────────────────

function updateSession(id: string, patch: Partial<MintState>) {
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

  // The IXRPPayment.Proof struct + Response struct ABI in JSON format
  // (human-readable tuple syntax doesn't parse reliably for deep nesting)
  const abi = [
    {
      "inputs": [
        {
          "components": [
            {
              "internalType": "bytes32[]",
              "name": "merkleProof",
              "type": "bytes32[]"
            },
            {
              "components": [
                { "internalType": "bytes32", "name": "attestationType", "type": "bytes32" },
                { "internalType": "bytes32", "name": "sourceId", "type": "bytes32" },
                { "internalType": "uint64", "name": "votingRound", "type": "uint64" },
                { "internalType": "uint64", "name": "lowestUsedTimestamp", "type": "uint64" },
                {
                  "components": [
                    { "internalType": "bytes32", "name": "transactionId", "type": "bytes32" },
                    { "internalType": "address", "name": "proofOwner", "type": "address" }
                  ],
                  "internalType": "struct IXRPPayment.RequestBody",
                  "name": "requestBody",
                  "type": "tuple"
                },
                {
                  "components": [
                    { "internalType": "uint64", "name": "blockNumber", "type": "uint64" },
                    { "internalType": "uint64", "name": "blockTimestamp", "type": "uint64" },
                    { "internalType": "string", "name": "sourceAddress", "type": "string" },
                    { "internalType": "bytes32", "name": "sourceAddressHash", "type": "bytes32" },
                    { "internalType": "bytes32", "name": "receivingAddressHash", "type": "bytes32" },
                    { "internalType": "bytes32", "name": "intendedReceivingAddressHash", "type": "bytes32" },
                    { "internalType": "int256", "name": "spentAmount", "type": "int256" },
                    { "internalType": "int256", "name": "intendedSpentAmount", "type": "int256" },
                    { "internalType": "int256", "name": "receivedAmount", "type": "int256" },
                    { "internalType": "int256", "name": "intendedReceivedAmount", "type": "int256" },
                    { "internalType": "bool", "name": "hasMemoData", "type": "bool" },
                    { "internalType": "bytes", "name": "firstMemoData", "type": "bytes" },
                    { "internalType": "bool", "name": "hasDestinationTag", "type": "bool" },
                    { "internalType": "uint256", "name": "destinationTag", "type": "uint256" },
                    { "internalType": "uint8", "name": "status", "type": "uint8" }
                  ],
                  "internalType": "struct IXRPPayment.ResponseBody",
                  "name": "responseBody",
                  "type": "tuple"
                }
              ],
              "internalType": "struct IXRPPayment.Response",
              "name": "data",
              "type": "tuple"
            }
          ],
          "internalType": "struct IXRPPayment.Proof",
          "name": "_proof",
          "type": "tuple"
        }
      ],
      "name": "executeDirectMinting",
      "outputs": [],
      "stateMutability": "payable",
      "type": "function"
    }
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

// ─── Phase 1: Send XRPL payment + request FDC attestation ────────────────

/**
 * Phase 1 (synchronous): Sends the XRPL payment, verifies it, requests
 * FDC attestation, and submits to FdcHub. Returns the voting round +
 * abiEncodedRequest for the client to poll Phase 2.
 *
 * This runs synchronously within a single request (takes ~10-30s).
 */
async function runPhase1(evmAddress: string, amountXrp: string): Promise<{
  phase: 'waiting_finalization';
  xrplTxHash: string;
  votingRound: number;
  abiEncodedRequest: string;
  fdcRequestTxHash: string;
}> {
  if (!isServerWalletConfigured()) {
    throw new Error(
      'Auto-send mode requires AEGIS_XRPL_WALLET_SEED env var. ' +
      'Generate a wallet with: node scripts/generate-xrpl-wallet.mjs'
    );
  }

  // Fetch the Core Vault address + fee schedule
  const config = getFlareConfig();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const abi = [
    'function directMintingPaymentAddress() view returns (string)',
    'function getDirectMintingMinimumFeeUBA() view returns (uint256)',
    'function getDirectMintingFeeBIPS() view returns (uint256)',
    'function getDirectMintingExecutorFeeUBA() view returns (uint256)',
  ];
  const am = new ethers.Contract(FLARE_SYSTEM_CONTRACTS.AssetManagerFXRP, abi, provider);
  const coreVaultAddr = await am.directMintingPaymentAddress().catch(
    () => 'rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p'
  );
  const minFeeUba = await am.getDirectMintingMinimumFeeUBA().catch(() => BigInt(100_000));
  const feeBips = await am.getDirectMintingFeeBIPS().catch(() => BigInt(25));
  const executorFeeUba = await am.getDirectMintingExecutorFeeUBA().catch(() => BigInt(100_000));

  // Compute gross amount (net + fees)
  const netXrp = parseFloat(amountXrp);
  const feeDecimal = Number(feeBips) / 10000; // BIPS → decimal
  const fee = Math.max(netXrp * feeDecimal, Number(minFeeUba) / 1e6);
  const grossXrp = netXrp + fee + Number(executorFeeUba) / 1e6;
  const amountDrops = String(Math.round(grossXrp * 1_000_000));

  // Build the 32-byte memo hex: 8-byte prefix + 4 zero bytes + 20-byte EVM address
  const memoPrefix = '4642505266410018'; // DIRECT_MINTING prefix
  const recipient = evmAddress.slice(2).toLowerCase();
  const memoHex = '0x' + memoPrefix + '00000000' + recipient;

  // Check server wallet balance first
  const walletBal = await getServerWalletBalance();
  if (walletBal < grossXrp + 1) {
    throw new Error(
      `Server XRPL wallet has insufficient balance: ${walletBal} XRP ` +
      `(needs ~${grossXrp.toFixed(4)} XRP). Fund the wallet at ` +
      `https://faucet.altnet.rippletest.net/ — address: ${getServerWalletAddress()}`
    );
  }

  // Send the payment
  const sendResult = await sendPaymentToCoreVault(coreVaultAddr, amountDrops, memoHex);
  const xrplTxHash = sendResult.txHash;

  // Wait for XRPL ledger to propagate + be visible to the FDC verifier.
  // The FDC verifier queries the XRPL testnet, so we need to give it time.
  await new Promise(r => setTimeout(r, 8000));

  // Verify XRPL payment (with retries — XRPL RPC may lag behind the
  // submitAndWait confirmation by a few seconds)
  let payment: { validated: boolean };
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      payment = await verifyXrplPayment(xrplTxHash);
      if (payment.validated) break;
    } catch {}
    await new Promise(r => setTimeout(r, 3000));
  }
  if (!payment! || !payment.validated) {
    throw new Error('XRPL payment not yet validated after retries — try again in a few seconds');
  }

  // Prepare FDC attestation request (with retries — the FDC verifier may
  // not see the XRPL transaction immediately after ledger finalization)
  let abiEncoded: string;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      abiEncoded = await prepareFdcAttestation(xrplTxHash, evmAddress);
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('TRANSACTION DOES NOT EXIST') || msg.includes('INVALID')) {
        // FDC verifier hasn't indexed the XRPL tx yet — wait + retry
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      throw e;
    }
  }
  if (!abiEncoded!) {
    throw new Error('FDC verifier could not find the XRPL transaction after retries');
  }

  // Submit to FdcHub
  const { txHash: fdcTxHash, votingRound } = await submitAttestationRequest(abiEncoded);

  return {
    phase: 'waiting_finalization',
    xrplTxHash,
    votingRound,
    abiEncodedRequest: abiEncoded,
    fdcRequestTxHash: fdcTxHash,
  };
}

// ─── Phase 2: Check finalization + execute direct minting ────────────────

/**
 * Phase 2 (synchronous): Checks if the voting round is finalized.
 * If finalized, fetches the proof and calls executeDirectMinting.
 * If not, returns phase='waiting_finalization' so the client polls again.
 *
 * Note: Even after the round finalizes, the DA Layer may take a few extra
 * seconds to index the proof. If fetchAttestationProof returns "not found",
 * we return 'waiting_finalization' instead of an error so the client keeps
 * polling.
 */
async function runPhase2(
  votingRound: number,
  abiEncodedRequest: string,
): Promise<{
  phase: 'waiting_finalization' | 'complete';
  finalized: boolean;
  mintTxHash?: string;
  fxrpMinted?: string;
}> {
  const finalized = await isRoundFinalized(votingRound);
  if (!finalized) {
    return { phase: 'waiting_finalization', finalized: false };
  }

  // Round is finalized — fetch proof from DA Layer.
  // The DA Layer may not have indexed the proof immediately after
  // finalization, so we treat "not found" as "still waiting".
  let merkleProof: string[];
  let response: any;
  try {
    const proofResult = await fetchAttestationProof(votingRound, abiEncodedRequest);
    merkleProof = proofResult.merkleProof;
    response = proofResult.response;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('not found') || msg.includes('400') || msg.includes('404')) {
      // DA Layer hasn't indexed the proof yet — keep waiting
      return { phase: 'waiting_finalization', finalized: true };
    }
    throw e;
  }

  // Call executeDirectMinting.
  // If it fails with PaymentAlreadyConfirmed (0x18dce79f), the payment was
  // already minted (possibly by a bot or a previous attempt). In that case,
  // check the user's FXRP balance — if they have FXRP, allow them to proceed.
  try {
    const { txHash: mintTxHash, mintedAmount } = await executeDirectMinting(merkleProof, response);
    return {
      phase: 'complete',
      finalized: true,
      mintTxHash,
      fxrpMinted: mintedAmount,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // PaymentAlreadyConfirmed = 0x18dce79f
    if (msg.includes('0x18dce79f') || msg.includes('PaymentAlreadyConfirmed')) {
      // The payment was already confirmed. Check if the user has FXRP.
      // Extract the evmAddress from the abiEncodedRequest (last 20 bytes)
      const evmAddress = '0x' + abiEncodedRequest.slice(-40);
      const config = getFlareConfig();
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const fxrpAbi = ['function balanceOf(address) view returns (uint256)'];
      const fxrp = new ethers.Contract(FLARE_SYSTEM_CONTRACTS.FXRP, fxrpAbi, provider);
      const balance = await fxrp.balanceOf(evmAddress);
      if (balance > 0) {
        // User has FXRP (from this mint or a prior one) — allow proceeding
        return {
          phase: 'complete',
          finalized: true,
          mintTxHash: '',
          fxrpMinted: balance.toString(),
        };
      }
      throw new Error('PaymentAlreadyConfirmed: The XRPL payment was already minted, and your address has 0 FXRP. Try with a new XRPL payment.');
    }
    throw e;
  }
}

// ─── Route Handlers ───────────────────────────────────────────────────────

/**
 * POST /api/fassets-mint
 *
 * PHASE 1 (initiate auto-send mint):
 *   body: { autoSend: true, evmAddress, amountXrp }
 *   - Sends XRPL payment via server wallet
 *   - Verifies payment on XRPL
 *   - Requests FDC attestation + submits to FdcHub
 *   - Returns: { phase: 'waiting_finalization', xrplTxHash, votingRound,
 *                abiEncodedRequest, fdcRequestTxHash }
 *
 * PHASE 2 (poll finalization + execute mint):
 *   body: { phase: 'finalize', votingRound, abiEncodedRequest }
 *   - Checks if the voting round is finalized
 *   - If not: returns { phase: 'waiting_finalization', finalized: false }
 *   - If yes: fetches proof, calls executeDirectMinting
 *     Returns: { phase: 'complete', mintTxHash, fxrpMinted }
 *
 * The client calls Phase 1 once, then polls Phase 2 every ~15s until complete.
 * This stateless design works on Vercel serverless (no in-memory session needed).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      // Phase 1 inputs
      autoSend, evmAddress, amountXrp,
      // Phase 2 inputs
      phase, votingRound, abiEncodedRequest,
    } = body as {
      xrplTxHash?: string;
      evmAddress?: string;
      amountXrp?: string;
      policyId?: number;
      autoSend?: boolean;
      phase?: string;
      votingRound?: number;
      abiEncodedRequest?: string;
    };

    // ─── Phase 2: Finalize ────────────────────────────────────────────────
    if (phase === 'finalize') {
      if (typeof votingRound !== 'number' || !abiEncodedRequest) {
        return NextResponse.json(
          { error: 'votingRound (number) and abiEncodedRequest are required for phase=finalize' },
          { status: 400 }
        );
      }
      try {
        const result = await runPhase2(votingRound, abiEncodedRequest);
        return NextResponse.json({
          phase: result.phase,
          finalized: result.finalized,
          ...(result.mintTxHash ? { mintTxHash: result.mintTxHash } : {}),
          ...(result.fxrpMinted ? { fxrpMinted: result.fxrpMinted } : {}),
        });
      } catch (error) {
        return NextResponse.json({
          phase: 'error',
          finalized: false,
          error: error instanceof Error ? error.message : 'Phase 2 failed',
        }, { status: 500 });
      }
    }

    // ─── Phase 1: Initiate auto-send mint ─────────────────────────────────
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

    if (!autoSend) {
      return NextResponse.json(
        { error: 'autoSend: true is required (or provide phase: "finalize" for Phase 2)' },
        { status: 400 }
      );
    }

    if (!isServerWalletConfigured()) {
      return NextResponse.json(
        {
          error: 'Auto-send mode is not available: AEGIS_XRPL_WALLET_SEED env var is not set on the server.',
          hint: 'Generate a wallet with: node scripts/generate-xrpl-wallet.mjs',
        },
        { status: 503 }
      );
    }

    // Run Phase 1 synchronously (sends XRPL payment + submits FDC attestation)
    // This takes ~10-30s
    const result = await runPhase1(evmAddress, amountXrp);

    return NextResponse.json({
      phase: result.phase,
      xrplTxHash: result.xrplTxHash,
      votingRound: result.votingRound,
      abiEncodedRequest: result.abiEncodedRequest,
      fdcRequestTxHash: result.fdcRequestTxHash,
      message: 'XRPL payment sent + FDC attestation submitted. Poll POST with phase=finalize every 15s.',
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
      // Auto-send mode availability + server wallet status
      autoSendAvailable: isServerWalletConfigured(),
      serverWalletAddress: isServerWalletConfigured() ? getServerWalletAddress() : null,
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

  // Legacy status mode: return the session state if it exists in memory
  // (The stateless design uses POST phase=finalize instead, but this is
  //  kept for backwards compatibility with warm instances.)
  if (!sessionId) {
    return NextResponse.json(
      { error: 'Missing sessionId. Use ?sessionId=X or ?info=true' },
      { status: 400 }
    );
  }
  const session = sessions.get(sessionId);
  if (!session) {
    return NextResponse.json(
      { error: `Session ${sessionId} not found (serverless functions are stateless — use POST phase=finalize for the stateless flow)` },
      { status: 404 }
    );
  }
  return NextResponse.json({
    sessionId,
    phase: session.phase,
    step: session.step,
    autoSend: session.autoSend,
    xrplTxHash: session.xrplTxHash,
    evmAddress: session.evmAddress,
    amountXrp: session.amountXrp,
    votingRound: session.votingRound,
    abiEncodedRequest: session.abiEncodedRequest,
    fdcRequestTxHash: session.fdcRequestTxHash,
    mintTxHash: session.mintTxHash,
    fxrpMinted: session.fxrpMinted,
    error: session.error,
  });
}
