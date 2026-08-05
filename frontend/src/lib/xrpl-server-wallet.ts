/**
 * XRPL Server Wallet Helper
 *
 * Sends XRPL payments from a pre-funded server-side testnet wallet.
 * Used by the "auto-send" mode of the FAssets direct-mint flow so the
 * user doesn't need to manually send an XRPL payment — the backend
 * does it for them.
 *
 * The wallet seed is stored in the AEGIS_XRPL_WALLET_SEED env var.
 * Generate a new wallet with: node scripts/generate-xrpl-wallet.mjs
 *
 * Reference: https://js.xrpl.org/
 */

import { Wallet, Client } from 'xrpl';

const XRPL_TESTNET_WS = 'wss://s.altnet.rippletest.net:51233';

const WALLET_SEED = process.env.AEGIS_XRPL_WALLET_SEED || '';
const WALLET_ADDRESS = process.env.AEGIS_XRPL_WALLET_ADDRESS || '';

let cachedClient: Client | null = null;
let cachedWallet: Wallet | null = null;

/**
 * Get the server-side XRPL wallet (singleton).
 * Throws if AEGIS_XRPL_WALLET_SEED is not set.
 */
export function getServerWallet(): Wallet {
  if (!WALLET_SEED) {
    throw new Error(
      'AEGIS_XRPL_WALLET_SEED env var is not set. ' +
      'Generate a wallet with: node scripts/generate-xrpl-wallet.mjs'
    );
  }
  if (!cachedWallet) {
    cachedWallet = Wallet.fromSeed(WALLET_SEED);
  }
  return cachedWallet;
}

/**
 * Get the server wallet address (for display / health checks).
 */
export function getServerWalletAddress(): string {
  return WALLET_ADDRESS || getServerWallet().address;
}

/**
 * Check if the server wallet is configured.
 */
export function isServerWalletConfigured(): boolean {
  return !!WALLET_SEED;
}

/**
 * Get a singleton XRPL client connection.
 */
async function getClient(): Promise<Client> {
  if (cachedClient && cachedClient.isConnected()) {
    return cachedClient;
  }
  cachedClient = new Client(XRPL_TESTNET_WS);
  await cachedClient.connect();
  return cachedClient;
}

export interface SendPaymentResult {
  txHash: string;
  dropsSent: string;
  destination: string;
  validated: boolean;
}

/**
 * Send an XRPL Payment from the server wallet to the FAssets Core Vault,
 * with a memo encoding the recipient EVM address (for FAssets direct-mint).
 *
 * @param destination - The XRPL address of the FAssets Core Vault
 * @param amountDrops - The amount to send, in drops (1 XRP = 1,000,000 drops)
 * @param memoHex - 32-byte memo hex (0x-prefixed) encoding the recipient EVM address
 * @returns The transaction hash + details
 */
export async function sendPaymentToCoreVault(
  destination: string,
  amountDrops: string,
  memoHex: string,
): Promise<SendPaymentResult> {
  const wallet = getServerWallet();
  const client = await getClient();

  // Strip 0x prefix from memo for the XRPL MemoData field
  const memoData = memoHex.startsWith('0x') ? memoHex.slice(2) : memoHex;

  // Build the payment transaction
  const payment: any = {
    TransactionType: 'Payment',
    Account: wallet.address,
    Destination: destination,
    Amount: amountDrops,
    Memos: [{
      Memo: {
        MemoData: memoData.toUpperCase(),
        MemoType: '4642505266410018000000000000000000000000000000000000000000000000',
      },
    }],
  };

  // Autofill fee, sequence, lastLedgerSequence
  const prepared = await client.autofill(payment);

  // Sign
  const signed = wallet.sign(prepared);

  // Submit
  const result = await client.submitAndWait(signed.tx_blob);

  if (result.result.meta.TransactionResult !== 'tesSUCCESS') {
    throw new Error(`XRPL payment failed: ${result.result.meta.TransactionResult}`);
  }

  return {
    txHash: signed.hash,
    dropsSent: amountDrops,
    destination,
    validated: true,
  };
}

/**
 * Get the balance of the server wallet (in XRP).
 */
export async function getServerWalletBalance(): Promise<number> {
  const client = await getClient();
  try {
    const info = await client.request({
      command: 'account_info',
      account: getServerWalletAddress(),
      ledger_index: 'validated',
    });
    return Number((info.result as any).account_data.Balance) / 1e6;
  } catch {
    return 0;
  }
}
