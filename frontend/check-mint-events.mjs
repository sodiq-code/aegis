import { ethers } from 'ethers';
const RPC = 'https://coston2-api.flare.network/ext/C/rpc';
const AM = '0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA';
const FXRP = '0x0b6A3645c240605887a5532109323A3E12273dc7';
const VERIFIER = '0xe37Ee912289B047A7C5e9DC8c15ab23E21b8b0C4';
const p = new ethers.JsonRpcProvider(RPC);

const iface = new ethers.Interface([
  'event DirectMintingExecuted(address indexed agentVault, address indexed targetAddress, uint256 mintedAmountUBA, uint256 mintingFeeUBA, uint256 executorFeeUBA)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

const cur = await p.getBlockNumber();
console.log('Current block:', cur);

// Search backward in chunks of 30 blocks for DirectMintingExecuted to verifier
const TARGET_TOPIC = ethers.id('DirectMintingExecuted(address,address,uint256,uint256,uint256)');
const VERIFIER_PADDED = ethers.zeroPadValue(VERIFIER, 32);
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

let foundMints = [];
let foundTransfers = [];
const startBlock = 33651000;  // around when run1 ran
let from = startBlock;
let to = Math.min(from + 29, cur);
while (from <= cur) {
  try {
    const logs = await p.getLogs({
      address: AM,
      topics: [TARGET_TOPIC, null, VERIFIER_PADDED],
      fromBlock: from,
      toBlock: to,
    });
    if (logs.length) foundMints.push(...logs);
  } catch (e) { /* skip */ }
  try {
    const transferLogs = await p.getLogs({
      address: FXRP,
      topics: [TRANSFER_TOPIC, null, VERIFIER_PADDED],
      fromBlock: from,
      toBlock: to,
    });
    if (transferLogs.length) foundTransfers.push(...transferLogs);
  } catch (e) { /* skip */ }
  from = to + 1;
  to = Math.min(from + 29, cur);
}

console.log(`\nFound ${foundMints.length} DirectMintingExecuted events targeting verifier (since block ${startBlock}):`);
for (const l of foundMints) {
  const b = await p.getBlock(l.blockNumber);
  const parsed = iface.parseLog({ topics: l.topics, data: l.data });
  console.log(`  block ${l.blockNumber} ts ${b.timestamp} ${new Date(b.timestamp*1000).toISOString()}`);
  console.log(`    agentVault: ${parsed.args.agentVault}`);
  console.log(`    targetAddress: ${parsed.args.targetAddress}`);
  console.log(`    mintedAmountUBA: ${parsed.args.mintedAmountUBA} (${ethers.formatUnits(parsed.args.mintedAmountUBA, 6)} FXRP)`);
  console.log(`    mintingFeeUBA: ${parsed.args.mintingFeeUBA} (${ethers.formatUnits(parsed.args.mintingFeeUBA, 6)} FXRP)`);
  console.log(`    executorFeeUBA: ${parsed.args.executorFeeUBA} (${ethers.formatUnits(parsed.args.executorFeeUBA, 6)} FXRP)`);
  console.log(`    txHash: ${l.transactionHash}`);
}

console.log(`\nFound ${foundTransfers.length} FXRP transfers to verifier (since block ${startBlock}):`);
for (const l of foundTransfers) {
  const b = await p.getBlock(l.blockNumber);
  const parsed = iface.parseLog({ topics: l.topics, data: l.data });
  console.log(`  block ${l.blockNumber} ts ${new Date(b.timestamp*1000).toISOString()}: from ${parsed.args.from} → ${ethers.formatUnits(parsed.args.value, 6)} FXRP (tx ${l.transactionHash})`);
}

const erc20 = new ethers.Contract(FXRP, ['function balanceOf(address) view returns (uint256)'], p);
console.log('\nCurrent FXRP balance of verifier:', ethers.formatUnits(await erc20.balanceOf(VERIFIER), 6));
