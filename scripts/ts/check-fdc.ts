import { JsonRpcProvider, keccak256, toUtf8Bytes, id } from 'ethers';
const provider = new JsonRpcProvider('https://coston2-api.flare.network/ext/C/rpc');

// The verify-proof route uses selector 0x3c70b357 for merkleRoot(uint256)
// Let me compute the actual selector
const computed = keccak256(toUtf8Bytes('merkleRoot(uint256)')).slice(0, 10);
console.log('Computed merkleRoot(uint256) selector:', computed);
console.log('Selector used in verify-proof route: 0x3c70b357');
console.log('Match:', computed === '0x3c70b357' ? 'YES' : 'NO — BUG FOUND');

// Try the correct selector on both FdcVerification addresses
const fdcAddrs = ['0x906507E0B64bcD494Db73bd0459d1C667e14B933', '0xA34Ff9be42b2C7782786270a51d33b1baC0462Cd'];
const round = 1416145;
const roundHex = round.toString(16).padStart(64, '0');

for (const addr of fdcAddrs) {
  console.log(`\n--- FdcVerification @ ${addr} ---`);
  // Try merkleRoot(uint256)
  const data1 = computed + roundHex;
  try {
    const r = await provider.call({ to: addr, data: data1 });
    console.log(`  merkleRoot(${round}):`, r);
  } catch (e: any) {
    console.log(`  merkleRoot(${round}) err:`, e.message?.slice(0, 150));
  }
  // Also try bodyMerkleRoot
  const sel2 = keccak256(toUtf8Bytes('bodyMerkleRoot(uint256)')).slice(0, 10);
  try {
    const r = await provider.call({ to: addr, data: sel2 + roundHex });
    console.log(`  bodyMerkleRoot(${round}):`, r);
  } catch (e: any) {
    console.log(`  bodyMerkleRoot(${round}) err:`, e.message?.slice(0, 100));
  }
}

// Check the Coston2 docs for the right function — let me also get the round for a proof that's already finalized
// Per Flare FDC docs, the merkle root is available after the voting round finalizes (usually +1 round)
// Let me try round - 2
console.log('\n--- Trying round - 2 ---');
const pastRound = round - 2;
const pastRoundHex = pastRound.toString(16).padStart(64, '0');
for (const addr of fdcAddrs) {
  const data = computed + pastRoundHex;
  try {
    const r = await provider.call({ to: addr, data });
    console.log(`  ${addr}.merkleRoot(${pastRound}):`, r);
  } catch (e: any) {
    console.log(`  ${addr}.merkleRoot(${pastRound}) err:`, e.message?.slice(0, 100));
  }
}
