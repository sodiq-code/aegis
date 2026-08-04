// Test the verify-proof route logic directly (without running the Next.js server)
import { keccak256, toUtf8Bytes, JsonRpcProvider } from 'ethers';

const provider = new JsonRpcProvider('https://coston2-api.flare.network/ext/C/rpc');
const SolvencyRoot = '0xf52c1fd632d853ee46a48a82064d3f5d390f057d';
const FlareSystemsManager = '0xA90Db6D10F856799b10ef2A77EBCbF460aC71e52';

async function safeEthCall(to: string, data: string): Promise<string | null> {
  try {
    const result = await provider.call({ to, data });
    if (result && result !== '0x' && result !== '0x0' && result.length > 10) return result;
    return null;
  } catch { return null; }
}

// Mode 2: status check
console.log('=== Mode 2: Status check ===');
const GET_CURRENT_PROOF = '0xbf0a32bb';
const IS_SOLVENT = '0x5ce23950';
const GET_MIN_RATIO = '0x4c8f35ab';
const GET_CURRENT_ROUND = '0x4134520b';

const [proofResult, isSolventResult, minRatioResult, roundResult] = await Promise.all([
  safeEthCall(SolvencyRoot, GET_CURRENT_PROOF),
  safeEthCall(SolvencyRoot, IS_SOLVENT),
  safeEthCall(SolvencyRoot, GET_MIN_RATIO),
  safeEthCall(FlareSystemsManager, GET_CURRENT_ROUND),
]);

if (proofResult) {
  const hex = proofResult.slice(2);
  const words: string[] = [];
  for (let i = 0; i < hex.length; i += 64) words.push(hex.slice(i, i + 64));
  const root = '0x' + words[0];
  const votingRound = parseInt(words[6], 16);
  const latestRound = roundResult ? parseInt(roundResult.slice(2, 66), 16) : 0;
  console.log(`  Root: ${root}`);
  console.log(`  Voting round: ${votingRound}`);
  console.log(`  Latest round: ${latestRound}`);
  console.log(`  FDC status: ${votingRound > 0 && votingRound <= latestRound ? 'finalized ✓' : 'pending/bogus ✗'}`);
}

// Mode 1: Merkle proof verification
console.log('\n=== Mode 1: Merkle proof verification ===');
const leaf0 = '0xf5deb7a26437507d9333130205360ba328d72da8488791593e8b27344948cb5b';
const proofForLeaf0 = [
  '0xb05d66fd11c39706a1b3c48e4e0f23e0bca2220d07bb1d2c3777df3a8f45a152',
  '0xac4fd4d4c3c822c003ac1778fd7c4f67b502c82abc0bc4bf2a9438404a8f8e79',
];

const selector = '0x06627f3b';
const offset = '0000000000000000000000000000000000000000000000000000000000000040';
const leafPadded = leaf0.slice(2).padStart(64, '0');
const length = proofForLeaf0.length.toString(16).padStart(64, '0');
const elements = proofForLeaf0.map(p => p.slice(2).padStart(64, '0')).join('');
const callData = selector + offset + leafPadded + length + elements;

const result = await safeEthCall(SolvencyRoot, callData);
const verified = result !== null && parseInt(result.slice(2, 66), 16) === 1;
console.log(`  verifySolvency(proof[2], leaf): ${verified ? '✓ VALID' : '✗ INVALID'}`);
console.log(`  Raw result: ${result}`);
