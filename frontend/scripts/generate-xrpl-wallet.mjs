/**
 * Generate + fund a server-side XRPL testnet wallet for the Aegis auto-send flow.
 *
 * Usage: node scripts/generate-xrpl-wallet.mjs
 *
 * Output: prints the wallet address + seed (to be set as AEGIS_XRPL_WALLET_SEED env var)
 */

import { Wallet, Client } from 'xrpl';

async function fundWallet(address) {
  // The XRPL testnet faucet
  const faucetUrl = 'https://faucet.altnet.rippletest.net/accounts';
  console.log(`Funding ${address} via XRPL testnet faucet...`);
  const resp = await fetch(faucetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ destination: address }),
  });
  if (!resp.ok) {
    throw new Error(`Faucet HTTP ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();
  return data;
}

async function checkBalance(client, address) {
  try {
    const info = await client.request({
      command: 'account_info',
      account: address,
      ledger_index: 'validated',
    });
    return Number(info.result.account_data.Balance) / 1e6;
  } catch {
    return 0;
  }
}

async function main() {
  console.log('=== Generating new XRPL testnet wallet ===\n');

  // Generate a new wallet
  const wallet = Wallet.generate();
  console.log(`Address: ${wallet.address}`);
  console.log(`Seed:    ${wallet.seed}`);
  console.log(`Public:  ${wallet.publicKey}\n`);

  // Connect to the XRPL testnet
  const client = new Client('wss://s.altnet.rippletest.net:51233');
  console.log('Connecting to XRPL testnet...');
  await client.connect();
  console.log('Connected.\n');

  // Check initial balance
  let balance = await checkBalance(client, wallet.address);
  console.log(`Initial balance: ${balance} XRP`);

  // Fund the wallet if empty
  if (balance < 10) {
    try {
      const fundResult = await fundWallet(wallet.address);
      console.log('Faucet response:', JSON.stringify(fundResult, null, 2).slice(0, 500));
      console.log('\nWaiting 15 seconds for funds to arrive...');
      await new Promise(r => setTimeout(r, 15000));
      balance = await checkBalance(client, wallet.address);
      console.log(`Balance after funding: ${balance} XRP`);
    } catch (e) {
      console.error('Faucet funding failed:', e.message);
      console.log('You can manually fund this address at https://faucet.altnet.rippletest.net/');
    }
  }

  // Test sending a small payment to verify the wallet works
  if (balance > 20) {
    console.log('\n=== Wallet is ready ===');
    console.log('Set this as the AEGIS_XRPL_WALLET_SEED env var on Vercel:');
    console.log(`AEGIS_XRPL_WALLET_SEED=${wallet.seed}`);
    console.log(`AEGIS_XRPL_WALLET_ADDRESS=${wallet.address}`);
  } else {
    console.log('\n=== Wallet needs more funding ===');
    console.log('Fund manually at https://faucet.altnet.rippletest.net/');
    console.log(`Address: ${wallet.address}`);
  }

  await client.disconnect();
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
