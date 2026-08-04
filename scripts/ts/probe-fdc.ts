import { JsonRpcProvider, keccak256, toUtf8Bytes } from 'ethers';
const provider = new JsonRpcProvider('https://coston2-api.flare.network/ext/C/rpc');

// Call through the proxy at 0x906507...
const fdcProxy = '0x906507E0B64bcD494Db73bd0459d1C667e14B933';
const impl = '0x6e33205293ae1c6dcc91249951a5a67c863918a7';

// Try common FDC function signatures
const fns = [
  'merkleRoot(uint256)',
  'bodyMerkleRoot(uint256)',
  'merkleRoots(uint256)',
  'getMerkleRoot(uint256)',
  'getRoundData(uint256)',
  'getDataForRound(uint256)',
  'attestationWindow(uint256)',
  'finalizedTimeSec(uint256)',
  'votesForRound(uint256)',
  'getVotesForRound(uint256)',
  'isFinalized(uint256)',
];

const round = 1416145;
for (const fn of fns) {
  const sel = keccak256(toUtf8Bytes(fn)).slice(0, 10);
  const data = sel + round.toString(16).padStart(64, '0');
  for (const addr of [fdcProxy, impl]) {
    try {
      const r = await provider.call({ to: addr, data });
      console.log(`  ${fn}(${round}) @ ${addr.slice(0,10)}: ${r === '0x' ? 'EMPTY' : r.slice(0, 80)}`);
    } catch (e: any) {
      const m = e.message || '';
      if (m.includes('missing revert data')) {
        // function doesn't exist
      } else {
        console.log(`  ${fn}(${round}) @ ${addr.slice(0,10)}: REVERT ${m.slice(0,100)}`);
      }
    }
  }
}

// Also try no-arg functions
const noArgFns = ['getCurrentVotingEpochId()', 'currentRoundId()', 'getCurrentRoundId()', 'getRoundId()', 'votingRoundId()'];
for (const fn of noArgFns) {
  const sel = keccak256(toUtf8Bytes(fn)).slice(0, 10);
  for (const addr of [fdcProxy, impl]) {
    try {
      const r = await provider.call({ to: addr, data: sel });
      if (r !== '0x') console.log(`  ${fn} @ ${addr.slice(0,10)}: ${r.slice(0, 80)}`);
    } catch {}
  }
}
