/**
 * Aegis On-Chain State Reader
 *
 * Reads the current state of all Aegis contracts on Coston2.
 * Used for verification before and after publishing solvency proofs.
 */

import { JsonRpcProvider, Contract, formatEther, keccak256, toUtf8Bytes, id } from 'ethers';

const RPC = 'https://coston2-api.flare.network/ext/C/rpc';
const provider = new JsonRpcProvider(RPC);

const AEGIS = {
  VaultCore: '0xcb08be1cc86d3f94c54c64682372e32f669134bc',
  VerifierRole: '0xb513516d02d88be754c5204e132defbb0f4156e6',
  PolicyRegistry: '0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5',
  SolvencyRoot: '0xf52c1fd632d853ee46a48a82064d3f5d390f057d',
  InstructionSender: '0xb175f16e1cea66360e354db4b178c04c69363c06',
  FDCAttestor: '0x266a9537eaa76264c926541a77c2705f659ba4f1',
  PMWInstructionRelay: '0xce23e1a26c41eaa305f69d9150d9ac82d8b30743',
};

const FLARE_SYSTEM = {
  FtsoV2: '0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d',
  FdcVerification: '0x906507E0B64bcD494Db73bd0459d1C667e14B933',
  FlareSystemsManager: '0xA90Db6D10F856799b10ef2A77EBCbF460aC71e52',
  FdcHub: '0x48aC463d7975828989331F4De43341627b9c5f1D',
};

const SOLVENCY_ROOT_ABI = [
  'function getCurrentSolvencyProof() view returns (tuple(bytes32 merkleRoot, uint256 surplusBps, uint256 totalFxrpCollateral, uint256 totalLiabilities, uint256 collateralRatio, uint256 timestamp, uint256 votingRound, address attestor, bool isValid))',
  'function isSolvent() view returns (bool, uint256)',
  'function getMinCollateralRatio() view returns (uint256)',
  'function getSolvencyHistory(uint256 count) view returns (tuple(bytes32 merkleRoot, uint256 surplusBps, uint256 totalFxrpCollateral, uint256 totalLiabilities, uint256 collateralRatio, uint256 timestamp, uint256 votingRound, address attestor, bool isValid)[])',
  'function verifySolvency(bytes32[] proof, bytes32 leaf) view returns (bool)',
  'function verifyPosition(uint256 positionId, address depositor, uint256 fxrpAmount, uint256 usdValuation, bytes32[] merkleProof) view returns (bool)',
];

const FLARE_SYSTEMS_MANAGER_ABI = [
  'function getCurrentVotingEpochId() view returns (uint256)',
  'function getFirstVotingRoundStartTs() view returns (uint256)',
];

const FTSO_V2_ABI = [
  'function getFeedByIdInWei(bytes21 feedId) view returns (uint256 price, int8 decimals, uint64 timestamp)',
];

const VERIFIER_ROLE_ABI = [
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function VERIFIER_ROLE() view returns (bytes32)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  'function isVerifier(address) view returns (bool)',
];

async function main() {
  const block = await provider.getBlockNumber();
  console.log(`\n=== Coston2 Block ${block} ===\n`);

  // 1. Current solvency proof
  const solvencyRoot = new Contract(AEGIS.SolvencyRoot, SOLVENCY_ROOT_ABI, provider);
  const proof = await solvencyRoot.getCurrentSolvencyProof();
  console.log('=== SolvencyRoot.getCurrentSolvencyProof() ===');
  console.log(`  merkleRoot:          ${proof.merkleRoot}`);
  console.log(`  surplusBps:          ${proof.surplusBps.toString()} (${(Number(proof.surplusBps)/100).toFixed(2)}%)`);
  console.log(`  totalFxrpCollateral: ${proof.totalFxrpCollateral.toString()}`);
  console.log(`  totalLiabilities:    ${proof.totalLiabilities.toString()}`);
  console.log(`  collateralRatio:     ${proof.collateralRatio.toString()} (${(Number(proof.collateralRatio)/100).toFixed(2)}%)`);
  console.log(`  timestamp:           ${proof.timestamp.toString()} (${new Date(Number(proof.timestamp)*1000).toISOString()})`);
  console.log(`  votingRound:         ${proof.votingRound.toString()}`);
  console.log(`  attestor:            ${proof.attestor}`);
  console.log(`  isValid:             ${proof.isValid}`);

  // 2. isSolvent
  const [solvent, ratio] = await solvencyRoot.isSolvent();
  console.log(`\n=== SolvencyRoot.isSolvent() ===`);
  console.log(`  solvent: ${solvent}, ratio: ${ratio.toString()} (${(Number(ratio)/100).toFixed(2)}%)`);

  // 3. Min collateral ratio
  const minRatio = await solvencyRoot.getMinCollateralRatio();
  console.log(`\n=== SolvencyRoot.getMinCollateralRatio() ===`);
  console.log(`  ${minRatio.toString()} (${(Number(minRatio)/100).toFixed(2)}%)`);

  // 4. Real current voting round from FlareSystemsManager
  const fsm = new Contract(FLARE_SYSTEM.FlareSystemsManager, FLARE_SYSTEMS_MANAGER_ABI, provider);
  const realRound = await fsm.getCurrentVotingEpochId();
  console.log(`\n=== FlareSystemsManager.getCurrentVotingEpochId() ===`);
  console.log(`  Real voting round: ${realRound.toString()}`);
  console.log(`  On-chain votingRound field: ${proof.votingRound.toString()}`);
  console.log(`  MATCH: ${realRound.toString() === proof.votingRound.toString() ? 'YES ✓' : 'NO ✗ (bogus)'}`);

  // 5. FDC merkle root for the real voting round
  try {
    const fdcVerification = new Contract(FLARE_SYSTEM.FdcVerification,
      ['function merkleRoot(uint256 votingRoundId) view returns (bytes32)'],
      provider);
    const fdcRoot = await fdcVerification.merkleRoot(realRound);
    console.log(`\n=== FdcVerification.merkleRoot(${realRound}) ===`);
    console.log(`  ${fdcRoot}`);
  } catch (e: any) {
    console.log(`\n=== FdcVerification.merkleRoot(${realRound}) ===`);
    console.log(`  ERROR: ${e.message?.slice(0, 200)}`);
  }

  // 6. FTSO V2 XRP/USD price
  const ftso = new Contract(FLARE_SYSTEM.FtsoV2, FTSO_V2_ABI, provider);
  const XRP_USD_FEED = '0x015852502f555344000000000000000000000000000000000000000000000000';
  try {
    const feed = await ftso.getFeedByIdInWei(XRP_USD_FEED);
    console.log(`\n=== FTSO V2 XRP/USD ===`);
    console.log(`  price: ${feed[0].toString()} (${Number(feed[0]) / 1e6} USD)`);
    console.log(`  decimals: ${feed[1]}`);
    console.log(`  timestamp: ${feed[2].toString()}`);
  } catch (e: any) {
    console.log(`\n=== FTSO V2 XRP/USD ===`);
    console.log(`  ERROR: ${e.message?.slice(0, 200)}`);
  }

  // 7. Verifier role check
  const verifierRole = new Contract(AEGIS.VerifierRole, VERIFIER_ROLE_ABI, provider);
  const verifierAddr = '0xe37Ee912289B047A7C5e9DC8c15ab23E21b8b0C4';
  try {
    const VERIFIER_ROLE = await verifierRole.VERIFIER_ROLE();
    const hasRole = await verifierRole.hasRole(VERIFIER_ROLE, verifierAddr);
    console.log(`\n=== VerifierRole ===`);
    console.log(`  VERIFIER_ROLE hash: ${VERIFIER_ROLE}`);
    console.log(`  hasRole(VERIFIER, ${verifierAddr}): ${hasRole}`);
  } catch (e: any) {
    console.log(`\n=== VerifierRole ===`);
    console.log(`  Standard hasRole not available: ${e.message?.slice(0, 100)}`);
    try {
      const isVer = await verifierRole.isVerifier(verifierAddr);
      console.log(`  isVerifier(${verifierAddr}): ${isVer}`);
    } catch (e2: any) {
      console.log(`  isVerifier not available either: ${e2.message?.slice(0, 100)}`);
    }
  }

  // 8. Verifier wallet balance
  const balance = await provider.getBalance(verifierAddr);
  const nonce = await provider.getTransactionCount(verifierAddr);
  console.log(`\n=== Verifier Wallet ===`);
  console.log(`  address: ${verifierAddr}`);
  console.log(`  balance: ${formatEther(balance)} C2FLR`);
  console.log(`  nonce:   ${nonce}`);

  // 9. Solvency history (last 5)
  try {
    const history = await solvencyRoot.getSolvencyHistory(5);
    console.log(`\n=== SolvencyRoot.getSolvencyHistory(5) ===`);
    console.log(`  ${history.length} proofs in history:`);
    history.forEach((p: any, i: number) => {
      console.log(`  [${i}] root=${p.merkleRoot} ratio=${p.collateralRatio.toString()} round=${p.votingRound.toString()} valid=${p.isValid}`);
    });
  } catch (e: any) {
    console.log(`\n=== getSolvencyHistory ERROR: ${e.message?.slice(0, 200)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
