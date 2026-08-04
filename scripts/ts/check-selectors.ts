import { keccak256, toUtf8Bytes } from 'ethers';
const sigs = [
  'getCurrentSolvencyProof()',
  'isSolvent()',
  'getMinCollateralRatio()',
  'verifySolvency(bytes32[],bytes32)',
  'verifyPosition(uint256,address,uint256,uint256,bytes32[])',
  'getCurrentVotingEpochId()',
  'publishSolvencyProof(bytes32,uint256,uint256,uint256,uint256)',
];
for (const s of sigs) {
  console.log(`${s} => ${keccak256(toUtf8Bytes(s)).slice(0, 10)}`);
}
