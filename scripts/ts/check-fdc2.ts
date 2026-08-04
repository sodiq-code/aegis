import { JsonRpcProvider, keccak256, toUtf8Bytes } from 'ethers';
const provider = new JsonRpcProvider('https://coston2-api.flare.network/ext/C/rpc');

// FdcVerification on Coston2 — let me check code and try several round values
const fdcAddr = '0x906507E0B64bcD494Db73bd0459d1C667e14B933';
const code = await provider.getCode(fdcAddr);
console.log(`FdcVerification code length: ${(code.length - 2) / 2} bytes`);

// The "missing revert data" with data=null usually means the function doesn't exist 
// or the contract reverted without revert string. Let me check eth_call with explicit error.
// Try rounds: 0, 1, 100, 1000000, 1400000, 1416145, 1416100
const sel = keccak256(toUtf8Bytes('merkleRoot(uint256)')).slice(0, 10);
const rounds = [0, 1, 100, 10000, 100000, 1000000, 1400000, 1410000, 1416100, 1416145, 1416144, 1416143];
for (const r of rounds) {
  const data = sel + r.toString(16).padStart(64, '0');
  try {
    const result = await provider.call({ to: fdcAddr, data });
    console.log(`  merkleRoot(${r}):`, result === '0x' ? 'EMPTY' : result);
  } catch (e: any) {
    // Check if it's "missing revert data" (function doesn't exist) vs actual revert
    const msg = e.message || '';
    if (msg.includes('missing revert data')) {
      console.log(`  merkleRoot(${r}): missing revert data (function may not exist)`);
    } else if (msg.includes('revert')) {
      console.log(`  merkleRoot(${r}): REVERT - ${msg.slice(0, 150)}`);
    } else {
      console.log(`  merkleRoot(${r}): err - ${msg.slice(0, 100)}`);
    }
  }
}

// Let me also check if there's a "merkleRoot" that takes no args, or "currentMerkleRoot"
const altFns = ['merkleRoots(uint256)', 'getMerkleRoot(uint256)', 'merkleRootForRound(uint256)', 'currentRoundId()', 'getCurrentRoundId()'];
for (const fn of altFns) {
  const s = keccak256(toUtf8Bytes(fn)).slice(0, 10);
  const data = s + (1416145).toString(16).padStart(64, '0');
  try {
    const r = await provider.call({ to: fdcAddr, data });
    console.log(`  ${fn}(1416145):`, r === '0x' ? 'EMPTY' : r);
  } catch (e: any) {
    console.log(`  ${fn}: missing`);
  }
}
