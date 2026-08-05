import { keccak256 } from 'ethers';

// The latest publish used positions with a timestamp nonce.
// The tx was at block 33637002. Let me compute the leaf and proof for position[0].
// We need to know the nonce (timestamp) used. From the tx, votingRound was 1416160.
// The nonce was Math.floor(Date.now()/1000) at the time of the API call.
// From the response timestamp: "2026-08-04T23:00:54.959Z" → epoch = 1785883454
// But wait — the deploy environment might have a different clock. Let me just
// compute for the FIRST publish (block 33636533) which used a known position set
// without the nonce.

// First publish positions (no nonce):
const positions = [
  { positionId: 1n, depositor: '0xe37Ee912289B047A7C5e9DC8c15ab23E21b8b0C4', fxrpAmount: 450_000_000n, usdValuation: 483_922_350n },
  { positionId: 2n, depositor: '0xe37Ee912289B047A7C5e9DC8c15ab23E21b8b0C4', fxrpAmount: 200_000_000n, usdValuation: 215_076_600n },
  { positionId: 3n, depositor: '0xe37Ee912289B047A7C5e9DC8c15ab23E21b8b0C4', fxrpAmount: 50_000_000n,  usdValuation: 53_769_150n },
];

function computeLeafHash(p: typeof positions[0]): string {
  const positionIdBytes = Buffer.alloc(32);
  Buffer.from(p.positionId.toString(16).padStart(64, '0'), 'hex').copy(positionIdBytes);
  const depositorBytes = Buffer.from(p.depositor.slice(2).toLowerCase().padStart(40, '0'), 'hex');
  const fxrpBytes = Buffer.alloc(32);
  Buffer.from(p.fxrpAmount.toString(16).padStart(64, '0'), 'hex').copy(fxrpBytes);
  const usdBytes = Buffer.alloc(32);
  Buffer.from(p.usdValuation.toString(16).padStart(64, '0'), 'hex').copy(usdBytes);
  return keccak256(Buffer.concat([positionIdBytes, depositorBytes, fxrpBytes, usdBytes]));
}

const zeroHash = '0x' + '0'.repeat(64);
const leaves = positions.map(computeLeafHash);
console.log('Leaves:');
leaves.forEach((l, i) => console.log(`  [${i}] ${l}`));

// Pad to 4
const padded = [...leaves, zeroHash];

function hashPair(a: string, b: string): string {
  const aBig = BigInt(a);
  const bBig = BigInt(b);
  if (aBig <= bBig) return keccak256(a + b.slice(2));
  return keccak256(b + a.slice(2));
}

// Compute tree and proofs
const level1 = [hashPair(padded[0], padded[1]), hashPair(padded[2], padded[3])];
const root = hashPair(level1[0], level1[1]);
console.log(`\nRoot: ${root}`);
console.log(`Expected: 0xac24639dbd42eda67fd60161d478065003613cef931321759996f8ded7d65d8e`);

// Proof for leaf 0: sibling at level 0 = padded[1], sibling at level 1 = level1[1]
console.log(`\nProof for leaf[0]:`);
console.log(`  [0] ${padded[1]}`);
console.log(`  [1] ${level1[1]}`);

console.log(`\nLeaf[0]: ${leaves[0]}`);
console.log(`\nTo verify in the UI, paste:`);
console.log(`  leaf: ${leaves[0]}`);
console.log(`  proof: ["${padded[1]}", "${level1[1]}"]`);
