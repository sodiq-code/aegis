import { keccak256, toUtf8Bytes, JsonRpcProvider } from 'ethers';
const provider = new JsonRpcProvider('https://coston2-api.flare.network/ext/C/rpc');

// Compute the real selector for verifySolvency(bytes32[],bytes32)
const sig = 'verifySolvency(bytes32[],bytes32)';
const sel = keccak256(toUtf8Bytes(sig)).slice(0, 10);
console.log(`keccak256("${sig}")[:4] = ${sel}`);

// Now test the actual call with the proof we just published
// Leaf 0 from our publish: 0xf5deb7a26437507d9333130205360ba328d72da8488791593e8b27344948cb5b
// Proof for leaf 0 (sibling at each level):
//   Level 0: sibling is leaf[1] = 0xb05d66fd11c39706a1b3c48e4e0f23e0bca2220d07bb1d2c3777df3a8f45a152
//   Level 1: sibling is leaf[2] = 0xd31facfc7f5720684b9367c6c6eefbe9c80187da9c260f811afeb6cacb90a03c
// (Since we pad to 4 with zeroHash, leaf[3] = zeroHash)

const leaf0 = '0xf5deb7a26437507d9333130205360ba328d72da8488791593e8b27344948cb5b';
const proof0 = [
  '0xb05d66fd11c39706a1b3c48e4e0f23e0bca2220d07bb1d2c3777df3a8f45a152', // sibling at level 0
  '0x956e3a1b3a7e5e7c8b9f1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3', // placeholder - need real level-1 sibling
];

// Actually let me just recompute the proof properly using the same logic as the publish script
function hashPair(a: string, b: string): string {
  const aBig = BigInt(a);
  const bBig = BigInt(b);
  if (aBig <= bBig) {
    return keccak256(a + b.slice(2));
  }
  return keccak256(b + a.slice(2));
}

const zeroHash = '0x' + '0'.repeat(64);
const leaves = [
  '0xf5deb7a26437507d9333130205360ba328d72da8488791593e8b27344948cb5b',
  '0xb05d66fd11c39706a1b3c48e4e0f23e0bca2220d07bb1d2c3777df3a8f45a152',
  '0xd31facfc7f5720684b9367c6c6eefbe9c80187da9c260f811afeb6cacb90a03c',
];
// Pad to 4
const padded = [...leaves, zeroHash];

// Level 0 → 1
const level1 = [
  hashPair(padded[0], padded[1]),
  hashPair(padded[2], padded[3]),
];
// Level 1 → 2 (root)
const root = hashPair(level1[0], level1[1]);

console.log('\n=== Merkle tree ===');
console.log(`Leaves: ${padded.length}`);
console.log(`  [0] ${padded[0]}`);
console.log(`  [1] ${padded[1]}`);
console.log(`  [2] ${padded[2]}`);
console.log(`  [3] ${padded[3]}`);
console.log(`Level 1:`);
console.log(`  [0] ${level1[0]} (parent of [0]+[1])`);
console.log(`  [1] ${level1[1]} (parent of [2]+[3])`);
console.log(`Root: ${root}`);

// Proof for leaf 0: sibling at level 0 is padded[1], sibling at level 1 is level1[1]
const proofForLeaf0 = [padded[1], level1[1]];
console.log(`\nProof for leaf[0]:`);
proofForLeaf0.forEach((p, i) => console.log(`  [${i}] ${p}`));

// Encode and call
const offset = '0000000000000000000000000000000000000000000000000000000000000040';
const leafPadded = leaf0.slice(2).padStart(64, '0');
const length = proofForLeaf0.length.toString(16).padStart(64, '0');
const elements = proofForLeaf0.map(p => p.slice(2).padStart(64, '0')).join('');
const callData = sel + offset + leafPadded + length + elements;
console.log(`\nCall data: ${callData}`);

const result = await provider.call({
  to: '0xf52c1fd632d853ee46a48a82064d3f5d390f057d',
  data: callData,
});
console.log(`\nverifySolvency result: ${result}`);
console.log(`Verified: ${parseInt(result.slice(2, 66), 16) === 1 ? 'YES ✓' : 'NO ✗'}`);
