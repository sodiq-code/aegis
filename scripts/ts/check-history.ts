import { keccak256, toUtf8Bytes, JsonRpcProvider } from 'ethers';
const provider = new JsonRpcProvider('https://coston2-api.flare.network/ext/C/rpc');
const SolvencyRoot = '0xf52c1fd632d853ee46a48a82064d3f5d390f057d';

// Compute selector
const sel = keccak256(toUtf8Bytes('getSolvencyHistory(uint256)')).slice(0, 10);
console.log(`getSolvencyHistory(uint256) selector: ${sel}`);

// Call it
const data = sel + (20).toString(16).padStart(64, '0');
const result = await provider.call({ to: SolvencyRoot, data });
console.log(`\nResult length: ${(result.length - 2) / 2} bytes`);

// Parse: offset (32) + length (32) + elements
const hex = result.slice(2);
const offset = parseInt(hex.slice(0, 64), 16);
const length = parseInt(hex.slice(64, 128), 16);
console.log(`Offset: ${offset}, Array length: ${length}`);

// Each struct is 9 words = 288 bytes = 576 hex chars
for (let i = 0; i < length; i++) {
  const start = 128 + i * 9 * 64;
  const words: string[] = [];
  for (let j = 0; j < 9; j++) words.push(hex.slice(start + j*64, start + (j+1)*64));
  const root = '0x' + words[0];
  const ratio = parseInt(words[4], 16);
  const round = parseInt(words[6], 16);
  const attestor = '0x' + words[7].slice(24);
  const valid = parseInt(words[8], 16) !== 0;
  console.log(`  [${i}] root=${root.slice(0,18)}... ratio=${ratio/100}% round=${round} valid=${valid}`);
}
