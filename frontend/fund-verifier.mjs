/**
 * fund-verifier.mjs
 * =================
 * Task: FUND-VERIFIER-FXRP
 *
 * Mints real FXRP on Flare Coston2 testnet via the FAssets direct-mint
 * workflow. The minted FXRP lands in the verifier EVM wallet
 * (0xe37Ee912289B047A7C5e9DC8c15ab23E21b8b0C4), funding it for the
 * Aegis faucet AND verifying the full XRPL → FAssets production path
 * end-to-end.
 *
 * Flow:
 *   1. Generate a fresh XRPL testnet wallet (xrpl v5 Wallet.generate)
 *   2. Fund it via the XRPL testnet faucet (POST /accounts)
 *   3. Send 12 XRP payment → FAssets Core Vault (rDhpmiPq4...) with the
 *      32-byte direct-mint memo (prefix + zeros + verifier EVM address)
 *   4. Submit requestAttestation to FdcHub (using the FDC verifier API
 *      to prepare the abi-encoded request body)
 *   5. Poll Relay.isFinalized(200, votingRound) until finalized
 *   6. Fetch the attestation proof from the DA Layer
 *   7. Call AssetManagerFXRP.executeDirectMinting(proof)
 *   8. Verify FXRP balance of verifier increased
 *
 * Run: cd frontend && node fund-verifier.mjs
 */

import { Client, Wallet, xrpToDrops } from 'xrpl';
import { ethers } from 'ethers';

// ─── Constants ────────────────────────────────────────────────────────────

const XRPL_TESTNET_WS = 'wss://s.altnet.rippletest.net:51233';
const XRPL_TESTNET_RPC = 'https://s.altnet.rippletest.net:51234';
const XRPL_FAUCET_URL = 'https://faucet.altnet.rippletest.net/accounts';

const COSTON2_RPC = 'https://coston2-api.flare.network/ext/C/rpc';

// Verifier EVM wallet — receives the minted FXRP and pays the FDC fee + gas.
const VERIFIER_EVM = '0xe37Ee912289B047A7C5e9DC8c15ab23E21b8b0C4';
const VERIFIER_PRIVATE_KEY = process.env.AEGIS_VERIFIER_PRIVATE_KEY;
if (!VERIFIER_PRIVATE_KEY) {
  console.error('ERROR: AEGIS_VERIFIER_PRIVATE_KEY environment variable is not set.');
  process.exit(1);
}

// FAssets Core Vault (XRPL testnet) — destination for the direct-mint payment.
const FASSETS_CORE_VAULT = 'rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p';

// Direct-mint memo: 8-byte prefix + 4 zero bytes + 20-byte EVM recipient (lowercase, no 0x)
const MEMO_PREFIX = '4642505266410018'; // "FBPRfA\x00\x18"
const MEMO_ZEROES = '00000000';
const VERIFIER_EVM_LOWER = VERIFIER_EVM.toLowerCase().slice(2);
const DIRECT_MINT_MEMO_HEX = `${MEMO_PREFIX}${MEMO_ZEROES}${VERIFIER_EVM_LOWER}`;

// Amount to send to the Core Vault. Needs to cover:
//   0.25% minting fee + 0.1 XRP executor fee + 0.1 XRP minimum fee
//   on top of the FXRP we want minted. 12 XRP gives ~11.5 FXRP after fees.
const PAYMENT_XRP = 12;
const PAYMENT_DROPS = xrpToDrops(PAYMENT_XRP); // '12000000'

// Coston2 contract addresses
const FSM_ADDRESS = '0xA90Db6D10F856799b10ef2A77EBCbF460aC71e52';
const RELAY_ADDRESS = '0xa10B672D1c62e5457b17af63d4302add6A99d7dE';
const FDC_HUB_ADDRESS = '0x48aC463d7975828989331F4De43341627b9c5f1D';
const FDC_FEE_CONFIGS_ADDRESS = '0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e';
const ASSET_MANAGER_FXRP_ADDRESS = '0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA';
const FXRP_TOKEN_ADDRESS = '0x0b6A3645c240605887a5532109323A3E12273dc7';

// FDC verifier API
const FDC_VERIFIER_URL = 'https://fdc-verifiers-testnet.flare.network/verifier';
const FDC_API_KEY = '00000000-0000-0000-0000-000000000000'; // public rate-limited key

// Attestation type "XRPPayment" padded to bytes32 (hex)
const ATTESTATION_TYPE_XRP_PAYMENT =
  '0x5852505061796d656e7400000000000000000000000000000000000000000000';
// Source id "testXRP" padded to bytes32 (hex)
const SOURCE_ID_TEST_XRP =
  '0x7465737458525000000000000000000000000000000000000000000000000000';

// DA Layer (Coston2) — supports a POST proof-by-request-round endpoint
// and a GET verify/<type>/<round>/<requestHash> endpoint.
const DA_LAYER_POST_URL =
  'https://ctn2-data-availability.flare.network/api/v1/fdc/proof-by-request-round';
const DA_LAYER_GET_BASE = 'https://coston2-da-layer.flare.network';

// Flare timing (Coston2): 90s rounds, first round started 2022-07-21 16:20:00 UTC
const FSM_FIRST_ROUND_START = 1_658_430_000;
const FSM_ROUND_DURATION_SEC = 90;
const FDC_PROTOCOL_ID = 200;

// ─── Helpers ──────────────────────────────────────────────────────────────

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function votingRoundForTimestamp(ts) {
  return Math.floor((ts - FSM_FIRST_ROUND_START) / FSM_ROUND_DURATION_SEC);
}

// ─── Step 1: Generate XRPL testnet wallet ──────────────────────────────────

async function generateXrplWallet() {
  // xrpl v5 Wallet.generate() returns { classicAddress, publicKey, privateKey, seed }
  const wallet = Wallet.generate();
  log('Generated XRPL wallet:');
  log('  address:', wallet.address);
  log('  public key:', wallet.publicKey);
  log('  seed:', wallet.seed);
  return wallet;
}

// ─── Step 2: Fund via XRPL testnet faucet ──────────────────────────────────

async function fundViaFaucet(address, maxAttempts = 8) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(`Faucet attempt ${attempt}/${maxAttempts} → funding ${address}`);
    try {
      const resp = await fetch(XRPL_FAUCET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: address }),
      });
      const text = await resp.text();
      if (resp.ok) {
        log(`  Faucet accepted: ${text.slice(0, 200)}`);
        return true;
      }
      log(`  Faucet HTTP ${resp.status}: ${text.slice(0, 200)}`);
      if (resp.status === 429 || /rate|limit|too many/i.test(text)) {
        // backoff
        const wait = 30_000 * attempt;
        log(`  Rate-limited — backing off ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }
      // Other error — wait a bit and retry
      await sleep(15_000);
    } catch (e) {
      log(`  Faucet error: ${e.message}`);
      await sleep(15_000);
    }
  }
  throw new Error('Faucet funding failed after all retries');
}

// ─── Step 3: Poll XRPL balance until non-zero ─────────────────────────────

async function waitForXrp(client, address, maxAttempts = 30) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const info = await client.request({
        command: 'account_info',
        account: address,
      });
      const drops = info.result?.account_data?.Balance;
      if (drops && BigInt(drops) > 0n) {
        const xrp = Number(drops) / 1_000_000;
        log(`  XRP arrived: ${xrp} XRP (${drops} drops)`);
        return drops;
      }
    } catch (e) {
      // account not found yet — keep polling
    }
    await sleep(5_000);
  }
  throw new Error('XRP never arrived from faucet');
}

// ─── Step 4: Send payment to FAssets Core Vault with direct-mint memo ────

async function sendDirectMintPayment(client, wallet) {
  const tx = {
    TransactionType: 'Payment',
    Account: wallet.address,
    Destination: FASSETS_CORE_VAULT,
    Amount: PAYMENT_DROPS,
    Memos: [
      {
        Memo: {
          MemoType: Buffer.from('text/plain', 'utf8')
            .toString('hex')
            .toUpperCase(),
          MemoData: DIRECT_MINT_MEMO_HEX.toUpperCase(),
        },
      },
    ],
  };

  log('Preparing direct-mint payment:');
  log('  From:', wallet.address);
  log('  To:  ', FASSETS_CORE_VAULT);
  log('  Amount:', PAYMENT_XRP, 'XRP (', PAYMENT_DROPS, 'drops )');
  log('  Memo (hex):', DIRECT_MINT_MEMO_HEX);

  // Autofill Fee, Sequence, LastLedgerSequence, SigningPubKey fields
  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);

  log('  Signed tx hash:', signed.hash);
  log('  Submitting...');
  const submitResp = await client.submit(signed.tx_blob);

  // xrpl v5 wraps the response: { result: { engine_result, engine_result_message, tx_json: { hash }, ... } }
  const r = submitResp.result || submitResp;
  const hash = signed.hash;
  log('  Submit result:', r.engine_result, '-', r.engine_result_message);

  if (r.engine_result !== 'tesSUCCESS') {
    throw new Error(`XRPL submit failed: ${r.engine_result} ${r.engine_result_message}`);
  }

  // Wait for validation
  log('  Waiting for ledger validation...');
  for (let i = 0; i < 30; i++) {
    await sleep(4_000);
    try {
      const r = await client.request({ command: 'tx', transaction: hash });
      if (r.result?.validated) {
        log('  Tx validated in ledger', r.result.ledger_index);
        return { hash, ledgerIndex: r.result.ledger_index };
      }
    } catch {
      // not yet
    }
  }
  throw new Error('XRPL tx not validated after 2 minutes');
}

// ─── Step 5: Prepare FDC attestation request via verifier API ────────────

async function prepareFdcRequest(xrplTxHash, proofOwner) {
  // Normalize tx hash to 0x-prefixed lowercase hex
  const txId = xrplTxHash.startsWith('0x') ? xrplTxHash : '0x' + xrplTxHash;
  const owner = proofOwner.toLowerCase();

  const url = `${FDC_VERIFIER_URL}/xrp/XRPPayment/prepareRequest`;
  log('Calling FDC verifier:', url);
  log('  transactionId:', txId);
  log('  proofOwner:  ', owner);

  const resp = await fetch(url, {
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

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`FDC verifier HTTP ${resp.status}: ${text.slice(0, 400)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`FDC verifier returned non-JSON: ${text.slice(0, 200)}`);
  }

  // Response shape from Flare FDC verifier API:
  //   { status: "VALID" | "INVALID" | "NOT_FOUND", response: { abiEncodedRequest: "0x...", ... }, ... }
  if (data.status !== 'VALID') {
    throw new Error(`FDC verifier status ${data.status}: ${JSON.stringify(data).slice(0, 400)}`);
  }

  const abiEncoded =
    data.response?.abiEncodedRequest || data.abiEncodedRequest || data.response?.data;

  if (!abiEncoded || typeof abiEncoded !== 'string') {
    throw new Error(`FDC verifier did not return abiEncodedRequest: ${JSON.stringify(data).slice(0, 400)}`);
  }

  log('  abiEncodedRequest:', abiEncoded.slice(0, 80), '...');
  return abiEncoded;
}

// ─── Step 6: Submit requestAttestation to FdcHub ─────────────────────────

async function submitAttestationRequest(provider, abiEncoded) {
  const feeCfg = new ethers.Contract(
    FDC_FEE_CONFIGS_ADDRESS,
    ['function getRequestFee(bytes) view returns (uint256)'],
    provider
  );
  let fee;
  try {
    fee = await feeCfg.getRequestFee(abiEncoded);
    log('  FDC request fee:', fee.toString(), 'wei');
  } catch (e) {
    throw new Error(`getRequestFee failed: ${e.message}`);
  }

  const wallet = new ethers.Wallet(VERIFIER_PRIVATE_KEY, provider);
  const fdcHub = new ethers.Contract(
    FDC_HUB_ADDRESS,
    ['function requestAttestation(bytes) payable'],
    wallet
  );

  log('  Submitting requestAttestation to FdcHub...');
  const tx = await fdcHub.requestAttestation(abiEncoded, { value: fee });
  log('  FdcHub tx hash:', tx.hash);
  const receipt = await tx.wait();
  log('  FdcHub tx mined in block', receipt.blockNumber, 'gas', receipt.gasUsed.toString());

  const block = await provider.getBlock(receipt.blockNumber);
  const submitRound = votingRoundForTimestamp(block.timestamp);
  log('  Block timestamp:', block.timestamp, '→ voting round', submitRound);

  // The attestation will be available in the round(s) AFTER the submission round.
  // On Flare FDC, requests submitted in round R are attested in round R+1
  // (and isFinalized(R+1) becomes true at the end of round R+2).
  return { txHash: tx.hash, submitRound, blockTimestamp: block.timestamp };
}

// ─── Step 7: Poll Relay.isFinalized(200, votingRound) ───────────────────

async function waitForFinalization(provider, targetRound, maxAttempts = 30) {
  const relay = new ethers.Contract(
    RELAY_ADDRESS,
    ['function isFinalized(uint256,uint256) view returns (bool)'],
    provider
  );
  log(`Polling Relay.isFinalized(200, ${targetRound}) every 30s...`);
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const finalized = await relay.isFinalized(FDC_PROTOCOL_ID, targetRound);
      if (finalized) {
        log(`  Round ${targetRound} finalized after ${i} poll(s) (~${i * 30}s)`);
        return true;
      }
    } catch (e) {
      log(`  isFinalized call error (attempt ${i}): ${e.message}`);
    }
    await sleep(30_000);
  }
  return false;
}

// ─── Step 8: Fetch the proof from the DA Layer ──────────────────────────

/**
 * Try multiple DA Layer endpoints + multiple voting rounds until we find
 * a non-empty proof.
 *
 * Endpoints:
 *   1. POST https://ctn2-data-availability.flare.network/api/v1/fdc/proof-by-request-round
 *        body: { votingRoundId, requestBytes }  → returns { proof: [...], response: {...} }
 *   2. GET  https://coston2-da-layer.flare.network/verify/IXRPPayment/{round}/{requestBodyHash}
 *        → returns { data: { proof: [...], response: {...} } } or { proof, response }
 */
async function fetchProof(requestBytes, candidateRounds) {
  const requestBodyHash = ethers.keccak256(requestBytes);
  log('  requestBytes (first 80 chars):', requestBytes.slice(0, 80));
  log('  requestBodyHash:', requestBodyHash);

  for (const round of candidateRounds) {
    log(`  Trying round ${round}...`);

    // --- Endpoint 1: POST proof-by-request-round ---
    try {
      const resp = await fetch(DA_LAYER_POST_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': FDC_API_KEY,
        },
        body: JSON.stringify({
          votingRoundId: round,
          requestBytes,
        }),
      });
      const text = await resp.text();
      if (resp.ok) {
        const data = JSON.parse(text);
        if (data.proof && data.response) {
          log(`    [POST] Found proof at round ${round}! (${data.proof.length} merkle hashes)`);
          return { round, merkleProof: data.proof, response: data.response };
        }
        log(`    [POST] Round ${round}: empty proof`);
      } else {
        log(`    [POST] Round ${round}: HTTP ${resp.status} ${text.slice(0, 100)}`);
      }
    } catch (e) {
      log(`    [POST] Round ${round} error: ${e.message}`);
    }

    // --- Endpoint 2: GET verify/IXRPPayment/{round}/{requestBodyHash} ---
    try {
      const url = `${DA_LAYER_GET_BASE}/verify/IXRPPayment/${round}/${requestBodyHash.slice(2)}`;
      const resp = await fetch(url, {
        headers: { 'X-API-KEY': FDC_API_KEY },
      });
      const text = await resp.text();
      if (resp.ok) {
        const data = JSON.parse(text);
        const proofArr = data.proof || data.data?.proof;
        const respObj = data.response || data.data?.response;
        if (Array.isArray(proofArr) && proofArr.length > 0 && respObj) {
          log(`    [GET] Found proof at round ${round}! (${proofArr.length} merkle hashes)`);
          return { round, merkleProof: proofArr, response: respObj };
        }
        log(`    [GET] Round ${round}: empty proof (${text.slice(0, 100)})`);
      } else {
        log(`    [GET] Round ${round}: HTTP ${resp.status} ${text.slice(0, 100)}`);
      }
    } catch (e) {
      log(`    [GET] Round ${round} error: ${e.message}`);
    }
  }

  throw new Error(`No proof found in any candidate round: ${candidateRounds.join(', ')}`);
}

// ─── Step 9: Call AssetManagerFXRP.executeDirectMinting(proof) ──────────

async function executeDirectMinting(provider, merkleProof, response) {
  const wallet = new ethers.Wallet(VERIFIER_PRIVATE_KEY, provider);

  // The on-chain ABI takes an IXRPPayment.Proof struct:
  //   struct Proof { bytes32[] merkleProof; Response data; }
  // The Response struct shape must match what the DA Layer returns.
  const abi = [
    'function executeDirectMinting((bytes32[],(bytes32,bytes32,uint64,uint64,(bytes32,address),(uint64,uint64,string,bytes32,bytes32,bytes32,int256,int256,int256,int256,bool,bytes,bool,uint256,uint8)))) external payable',
    'event DirectMintingExecuted(address indexed agentVault, address indexed targetAddress, uint256 mintedAmountUBA, uint256 mintingFeeUBA, uint256 executorFeeUBA)',
  ];

  const assetManager = new ethers.Contract(
    ASSET_MANAGER_FXRP_ADDRESS,
    abi,
    wallet
  );

  // Build the Response struct as a PLAIN ARRAY (not a named object) because
  // the ABI uses unnamed tuple components. Ethers.js cannot map named object
  // properties to unnamed components — it throws "cannot use object value
  // with unnamed components".
  // Response layout (must match the ABI exactly):
  //   (bytes32 attestationType, bytes32 sourceId, uint64 votingRound,
  //    uint64 lowestUsedTimestamp,
  //    (bytes32 transactionId, address proofOwner) requestBody,
  //    (uint64 blockNumber, uint64 blockTimestamp, string sourceAddress,
  //     bytes32 sourceAddressHash, bytes32 receivingAddressHash,
  //     bytes32 intendedReceivingAddressHash, int256 spentAmount,
  //     int256 intendedSpentAmount, int256 receivedAmount,
  //     int256 intendedReceivedAmount, bool hasMemoData, bytes firstMemoData,
  //     bool hasDestinationTag, uint256 destinationTag, uint8 status) responseBody)
  const rb = response.requestBody || {};
  const rb2 = response.responseBody || {};
  const requestBodyArr = [rb.transactionId, rb.proofOwner];
  const responseBodyArr = [
    rb2.blockNumber,
    rb2.blockTimestamp,
    rb2.sourceAddress,
    rb2.sourceAddressHash,
    rb2.receivingAddressHash,
    rb2.intendedReceivingAddressHash,
    rb2.spentAmount,
    rb2.intendedSpentAmount,
    rb2.receivedAmount,
    rb2.intendedReceivedAmount,
    rb2.hasMemoData,
    rb2.firstMemoData,
    rb2.hasDestinationTag,
    rb2.destinationTag,
    rb2.status,
  ];
  const responseData = [
    response.attestationType,
    response.sourceId,
    response.votingRound,
    response.lowestUsedTimestamp,
    requestBodyArr,
    responseBodyArr,
  ];

  const proofStruct = [merkleProof, responseData];

  log('  Calling AssetManagerFXRP.executeDirectMinting...');
  log('  Merkle proof length:', merkleProof.length);
  log('  Response.sourceAddress:', rb2.sourceAddress);
  log('  Response.receivedAmount:', rb2.receivedAmount);

  const tx = await assetManager.executeDirectMinting(proofStruct, { value: 0 });
  log('  executeDirectMinting tx hash:', tx.hash);
  const receipt = await tx.wait();
  log('  executeDirectMinting mined in block', receipt.blockNumber, 'gas', receipt.gasUsed.toString());
  log('  status:', receipt.status === 1 ? 'SUCCESS' : 'FAILED');

  // Parse the DirectMintingExecuted event for the minted amount.
  let mintedAmount = '0';
  let mintingFee = '0';
  let executorFee = '0';
  const iface = new ethers.Interface(abi);
  for (const lg of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: lg.topics, data: lg.data });
      if (parsed && parsed.name === 'DirectMintingExecuted') {
        mintedAmount = parsed.args.mintedAmountUBA.toString();
        mintingFee = parsed.args.mintingFeeUBA.toString();
        executorFee = parsed.args.executorFeeUBA.toString();
        log('  DirectMintingExecuted:');
        log('    agentVault:', parsed.args.agentVault);
        log('    targetAddress:', parsed.args.targetAddress);
        log('    mintedAmountUBA:', mintedAmount, `(${Number(mintedAmount) / 1e6} FXRP)`);
        log('    mintingFeeUBA:', mintingFee, `(${Number(mintingFee) / 1e6} FXRP)`);
        log('    executorFeeUBA:', executorFee, `(${Number(executorFee) / 1e6} FXRP)`);
        break;
      }
    } catch {}
  }

  return { txHash: tx.hash, mintedAmount, mintingFee, executorFee, receipt };
}

// ─── Main orchestration ─────────────────────────────────────────────────

async function main() {
  log('='.repeat(72));
  log('FUND-VERIFIER-FXRP — Mint FXRP via FAssets direct-mint flow');
  log('='.repeat(72));

  // Connect to Coston2 first (we'll need it for many steps)
  const provider = new ethers.JsonRpcProvider(COSTON2_RPC);
  log('Coston2 connected. Verifier EVM:', VERIFIER_EVM);

  // 0. Read FXRP balance before mint
  const fxrpContract = new ethers.Contract(
    FXRP_TOKEN_ADDRESS,
    ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'],
    provider
  );
  const balanceBefore = await fxrpContract.balanceOf(VERIFIER_EVM);
  log('Verifier FXRP balance BEFORE:', ethers.formatUnits(balanceBefore, 6));

  // Allow skipping the XRPL portion if XRPL_TX_HASH is provided (e.g. when
  // a previous run already sent the payment and we want to continue with FDC).
  const skipXrpl = process.env.XRPL_TX_HASH;
  let xrplTxHash;
  let ledgerIndex;

  if (skipXrpl) {
    xrplTxHash = skipXrpl.startsWith('0x') ? skipXrpl.slice(2).toUpperCase() : skipXrpl.toUpperCase();
    log('\n--- Skipping XRPL steps (XRPL_TX_HASH env var set) ---');
    log('Reusing XRPL tx hash:', xrplTxHash);

    // Verify the tx is validated by querying XRPL RPC
    const resp = await fetch(XRPL_TESTNET_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'tx',
        params: [{ transaction: xrplTxHash, binary: false }],
      }),
    });
    const data = await resp.json();
    const txInfo = data?.result;
    if (!txInfo || txInfo.error) {
      throw new Error(`XRPL tx ${xrplTxHash} not found: ${JSON.stringify(txInfo).slice(0, 200)}`);
    }
    if (!txInfo.validated) {
      throw new Error(`XRPL tx ${xrplTxHash} not yet validated`);
    }
    ledgerIndex = txInfo.ledger_index;
    log('  Validated in ledger', ledgerIndex);
    log('  Destination:', txInfo.tx_json?.Destination || txInfo.Destination);
    log('  Amount (drops):', txInfo.tx_json?.Amount || txInfo.Amount);
    const memos = txInfo.tx_json?.Memos || txInfo.Memos || [];
    for (const m of memos) {
      log('  Memo data:', m?.Memo?.MemoData);
    }
  } else {
    // 1. Generate XRPL wallet
    log('\n--- Step 1: Generate XRPL testnet wallet ---');
    const wallet = await generateXrplWallet();

    // 2. Fund via faucet
    log('\n--- Step 2: Fund via XRPL testnet faucet ---');
    await fundViaFaucet(wallet.address);

    // 3. Connect XRPL client + wait for XRP to arrive
    log('\n--- Step 3: Wait for XRP to arrive ---');
    const client = new Client(XRPL_TESTNET_WS);
    await client.connect();
    log('XRPL client connected to', XRPL_TESTNET_WS);
    await waitForXrp(client, wallet.address);

    // 4. Send direct-mint payment
    log('\n--- Step 4: Send 12 XRP to FAssets Core Vault with direct-mint memo ---');
    const sent = await sendDirectMintPayment(client, wallet);
    xrplTxHash = sent.hash;
    ledgerIndex = sent.ledgerIndex;
    log('XRPL payment tx hash:', xrplTxHash);
    log('XRPL payment ledger index:', ledgerIndex);

    // Don't disconnect yet — we may need to inspect the tx later
    await client.disconnect();
  }

  // 5. Prepare FDC attestation request via verifier API
  log('\n--- Step 5: Prepare FDC attestation request ---');
  let abiEncoded;
  try {
    abiEncoded = await prepareFdcRequest(xrplTxHash, VERIFIER_EVM);
  } catch (e) {
    log('FDC verifier prepareRequest failed:', e.message);
    log('Continuing to wait — the verifier may need a few ledgers to see the tx');
    // Try again after a delay
    for (let i = 0; i < 5; i++) {
      await sleep(20_000);
      try {
        abiEncoded = await prepareFdcRequest(xrplTxHash, VERIFIER_EVM);
        break;
      } catch (e2) {
        log(`  Retry ${i + 1} failed: ${e2.message}`);
      }
    }
    if (!abiEncoded) {
      throw new Error('Could not prepare FDC attestation request — verifier API exhausted');
    }
  }

  // 5.5. SHORTCUT: Before submitting a new requestAttestation (which costs a
  // fee + ~4 minutes of waiting), check whether a proof for this exact
  // request already exists in any recently-finalized voting round. This lets
  // us resume from a previous run that submitted the attestation but failed
  // at the executeDirectMinting step.
  log('\n--- Step 5.5: Check DA Layer for existing proof (resume shortcut) ---');
  const fsmContract = new ethers.Contract(
    FSM_ADDRESS,
    ['function getCurrentVotingEpochId() view returns (uint256)'],
    provider
  );
  const currentRound = Number(await fsmContract.getCurrentVotingEpochId());
  log('  Current voting round:', currentRound);

  const resumeRounds = [];
  for (let r = currentRound; r >= currentRound - 12 && r >= 0; r--) {
    resumeRounds.push(r);
  }

  let proof = null;
  try {
    proof = await fetchProof(abiEncoded, resumeRounds);
    log('  ✓ Found existing proof — skipping FDC submission.');
  } catch (e) {
    log('  No existing proof found (will submit a new attestation request).');
    log('  Reason:', e.message);
  }

  let submitRound;
  let fdcTxHash;
  if (!proof) {
    // 6. Submit requestAttestation to FdcHub
    log('\n--- Step 6: Submit requestAttestation to FdcHub ---');
    const submitted = await submitAttestationRequest(provider, abiEncoded);
    fdcTxHash = submitted.txHash;
    submitRound = submitted.submitRound;
    log('FdcHub requestAttestation tx hash:', fdcTxHash);
    log('Submission voting round:', submitRound);

    // 7. Wait for finalization of the attestation round (R+1) + also try R, R+2
    const attestationRoundsToTry = [submitRound + 1, submitRound + 2, submitRound];
    log('\n--- Step 7: Wait for finalization of round', submitRound + 1, '---');
    let finalized = await waitForFinalization(provider, submitRound + 1, 30);
    if (!finalized) {
      log('Round', submitRound + 1, 'not finalized after 15 minutes. Trying R+2...');
      finalized = await waitForFinalization(provider, submitRound + 2, 20);
    }

    // Also poll isFinalized for all candidate rounds — we'll fetch proof for whichever is finalized
    const relay = new ethers.Contract(
      RELAY_ADDRESS,
      ['function isFinalized(uint256,uint256) view returns (bool)'],
      provider
    );
    const finalizedRounds = [];
    for (const r of attestationRoundsToTry) {
      try {
        const f = await relay.isFinalized(FDC_PROTOCOL_ID, r);
        log(`  isFinalized(200, ${r}) = ${f}`);
        if (f) finalizedRounds.push(r);
      } catch (e) {
        log(`  isFinalized(200, ${r}) error: ${e.message}`);
      }
    }
    if (finalizedRounds.length === 0) {
      log('No candidate rounds finalized. Continuing to attempt proof fetch anyway...');
    }

    // 8. Fetch proof from DA Layer (try rounds in order of likelihood: R+1, R+2, R)
    log('\n--- Step 8: Fetch attestation proof from DA Layer ---');
    const candidateRounds = finalizedRounds.length
      ? finalizedRounds
      : attestationRoundsToTry;
    proof = await fetchProof(abiEncoded, candidateRounds);
  }

  const { round: proofRound, merkleProof, response } = proof;
  log('Proof fetched for voting round:', proofRound);
  log('Response sourceAddress:', response.responseBody?.sourceAddress);
  log('Response receivedAmount:', response.responseBody?.receivedAmount);
  log('Response hasMemoData:', response.responseBody?.hasMemoData);

  // 9. Execute direct minting
  log('\n--- Step 9: Execute direct minting via AssetManagerFXRP ---');
  const { txHash: mintTxHash, mintedAmount, mintingFee, executorFee } =
    await executeDirectMinting(provider, merkleProof, response);

  // 10. Verify FXRP balance increased
  log('\n--- Step 10: Verify FXRP balance increased ---');
  const balanceAfter = await fxrpContract.balanceOf(VERIFIER_EVM);
  const delta = balanceAfter - balanceBefore;
  log('Verifier FXRP balance BEFORE:', ethers.formatUnits(balanceBefore, 6));
  log('Verifier FXRP balance AFTER: ', ethers.formatUnits(balanceAfter, 6));
  log('Delta:', ethers.formatUnits(delta, 6), 'FXRP');

  // ─── Final report ────────────────────────────────────────────────────
  log('\n' + '='.repeat(72));
  log('FINAL REPORT');
  log('='.repeat(72));
  log('XRPL testnet wallet address:', skipXrpl ? '(reused from previous run)' : '(see Step 1 above)');
  log('XRPL payment tx hash:      ', xrplTxHash);
  log('XRPL ledger index:         ', ledgerIndex);
  log('FdcHub requestAttestation: ', fdcTxHash || '(skipped — used existing proof)');
  log('Submission voting round:   ', submitRound ?? '(skipped)');
  log('Attestation voting round:  ', proofRound);
  log('Direct mint tx hash:       ', mintTxHash);
  log('Minted amount (UBA):       ', mintedAmount, `(${Number(mintedAmount) / 1e6} FXRP)`);
  log('Minting fee (UBA):         ', mintingFee, `(${Number(mintingFee) / 1e6} FXRP)`);
  log('Executor fee (UBA):        ', executorFee, `(${Number(executorFee) / 1e6} FXRP)`);
  log('FXRP balance before:       ', ethers.formatUnits(balanceBefore, 6));
  log('FXRP balance after:        ', ethers.formatUnits(balanceAfter, 6));
  log('FXRP delta:                ', ethers.formatUnits(delta, 6));
  log('='.repeat(72));
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    log('FATAL ERROR:', err.message);
    if (err.stack) log(err.stack);
    process.exit(1);
  });
