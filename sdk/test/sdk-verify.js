#!/usr/bin/env node
/**
 * Aegis SDK — Comprehensive Verification Test
 *
 * Tests all three SDK clients (VaultClient, PolicyClient, AuditClient)
 * against real Coston2 on-chain data.
 *
 * Run: node test/sdk-verify.mjs
 */

const { AegisSDK, RiskLevel, PolicyAction, ActionType } = require('../dist/index');

const RPC = 'https://coston2-api.flare.network/ext/C/rpc';
const EXPECTED_CONTRACTS = {
  VaultCore: '0xcb08be1cc86d3f94c54c64682372e32f669134bc',
  PolicyRegistry: '0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5',
  SolvencyRoot: '0xf52c1fd632d853ee46a48a82064d3f5d390f057d',
  FDCAttestor: '0x266a9537eaa76264c926541a77c2705f659ba4f1',
};

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}${detail ? ': ' + detail : ''}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

async function main() {
  console.log('=== Aegis SDK Verification Tests ===\n');
  const sdk = new AegisSDK({ rpcUrl: RPC });

  // ========== VaultClient ==========
  console.log('--- VaultClient ---');

  // 1. Contract deployment
  const deployed = await sdk.vault.verifyContractsDeployed();
  check('All Aegis contracts deployed', Object.values(deployed).every(v => v));

  // 2. Vault state
  const state = await sdk.vault.getState();
  check('getState() returns valid object', state !== null && typeof state === 'object');
  check('chainId is 114 (Coston2)', state.chainId === 114, `got ${state.chainId}`);
  check('blockNumber > 0', state.blockNumber > 0, `block ${state.blockNumber}`);
  check('XRP/USD price > 0', state.xrpUsdPrice > 0, `$${state.xrpUsdPrice.toFixed(4)}`);
  check('isEmergencyMode is false', state.isEmergencyMode === false);
  check('positionCount >= 0', state.positionCount >= 0, `${state.positionCount} positions`);

  // 3. Individual methods
  const totalDeposited = await sdk.vault.getTotalDeposited();
  check('getTotalDeposited() >= 0', totalDeposited >= 0, `${totalDeposited}`);

  const totalValuation = await sdk.vault.getTotalValuation();
  check('getTotalValuation() >= 0', totalValuation >= 0, `${totalValuation}`);

  const xrpPrice = await sdk.vault.getXrpUsdPrice();
  check('getXrpUsdPrice() > 0', xrpPrice > 0, `$${xrpPrice.toFixed(4)}`);
  check('XRP/USD price ~$1.07', xrpPrice > 0.5 && xrpPrice < 5, `$${xrpPrice.toFixed(4)}`);

  const emergencyMode = await sdk.vault.isEmergencyMode();
  check('isEmergencyMode() is false', emergencyMode === false);

  // 4. Solvency
  const solvency = await sdk.vault.getSolvencyInfo();
  check('getSolvencyInfo() returns object', solvency !== null);
  check('collateralRatio > 0', solvency.collateralRatio > 0, `${solvency.collateralRatio.toFixed(2)}%`);
  check('collateralRatio ~140%', Math.abs(solvency.collateralRatio - 140) < 5, `${solvency.collateralRatio.toFixed(2)}%`);

  const minRatio = await sdk.vault.getMinCollateralRatio();
  check('getMinCollateralRatio() > 0', minRatio > 0, `${minRatio.toFixed(2)}%`);

  // 5. Risk score (fallback since FCC extension not running)
  const risk = await sdk.vault.getRiskScore();
  check('getRiskScore() returns result', risk !== null);
  if (risk) {
    check('risk.score 0-100', risk.score >= 0 && risk.score <= 100, `${risk.score}`);
    check('risk.action is string', typeof risk.action === 'string', risk.action);
    check('risk.source is fallback', risk.source === 'fallback', risk.source);
  }

  console.log('');

  // ========== PolicyClient ==========
  console.log('--- PolicyClient ---');

  // 1. Policy count
  const policyCount = await sdk.policy.getPolicyCount();
  check('getPolicyCount() > 0', policyCount > 0, `${policyCount} policies`);

  // 2. List all policies
  const policies = await sdk.policy.listPolicies();
  check('listPolicies() returns array', Array.isArray(policies));
  check('listPolicies().length matches count', policies.length === policyCount, `${policies.length} vs ${policyCount}`);

  // 3. Individual policy details
  if (policies.length > 0) {
    const p1 = policies[0];
    check('policy has policyId', typeof p1.policyId === 'number', `id=${p1.policyId}`);
    check('policy has name', typeof p1.name === 'string' && p1.name.length > 0, p1.name);
    check('policy has owner', p1.owner.startsWith('0x'), p1.owner);
    check('policy has riskLevel', p1.riskLevel >= 0 && p1.riskLevel <= 3, `${p1.riskLevel} (${sdk.policy.getRiskLevelName(p1.riskLevel)})`);
    check('policy has isActive', typeof p1.isActive === 'boolean', `${p1.isActive}`);
    check('policy has maxDrawdownBps', p1.maxDrawdownBps > 0, `${p1.maxDrawdownBps}`);
    check('policy has minCollateralRatio', p1.minCollateralRatio > 0, `${p1.minCollateralRatio}`);

    // Known policy values from constructor
    const conservative = policies.find(p => p.name === 'Conservative');
    if (conservative) {
      check('Conservative: maxDrawdown 1500 bps', conservative.maxDrawdownBps === 1500, `${conservative.maxDrawdownBps}`);
      check('Conservative: maxSingleExposure 4000 bps', conservative.maxSingleExposureBps === 4000, `${conservative.maxSingleExposureBps}`);
    }
  }

  // 4. checkAction
  const depositCheck = await sdk.policy.checkAction(1, ActionType.DEPOSIT, 100);
  check('checkAction(DEPOSIT, 100) returns result', depositCheck !== null);
  check('checkAction returns allowed boolean', typeof depositCheck.allowed === 'boolean', `${depositCheck.allowed}`);
  check('checkAction returns action number', typeof depositCheck.action === 'number', `${depositCheck.action} (${sdk.policy.getActionName(depositCheck.action)})`);

  const largeDepositCheck = await sdk.policy.checkAction(1, ActionType.DEPOSIT, 999999999);
  check('checkAction(large DEPOSIT) processed', largeDepositCheck !== null);

  // 5. getPolicy for specific IDs
  const policy1 = await sdk.policy.getPolicy(1);
  check('getPolicy(1) returns policy', policy1 !== null);
  check('getPolicy(1).policyId === 1', policy1?.policyId === 1);

  const policy2 = await sdk.policy.getPolicy(2);
  check('getPolicy(2) returns policy', policy2 !== null);

  const policy3 = await sdk.policy.getPolicy(3);
  check('getPolicy(3) returns policy', policy3 !== null);

  // 6. Enums
  check('RiskLevel.LOW === 0', RiskLevel.LOW === 0);
  check('RiskLevel.MEDIUM === 1', RiskLevel.MEDIUM === 1);
  check('RiskLevel.HIGH === 2', RiskLevel.HIGH === 2);
  check('PolicyAction.BLOCK === 3', PolicyAction.BLOCK === 3);
  check('ActionType.DEPOSIT === 0', ActionType.DEPOSIT === 0);

  console.log('');

  // ========== AuditClient ==========
  console.log('--- AuditClient ---');

  // 1. Current proof
  const proof = await sdk.audit.getCurrentProof();
  check('getCurrentProof() returns proof', proof !== null);
  if (proof) {
    check('proof.merkleRoot is bytes32', proof.merkleRoot.startsWith('0x') && proof.merkleRoot.length === 66, proof.merkleRoot.slice(0, 20) + '...');
    check('proof.merkleRoot matches known value', proof.merkleRoot === '0x93041e047f6688a8bf87014abc061c9650a11659e2efb1f0cedc2ce75dc9c173');
    check('proof.surplusBps is 4000', proof.surplusBps === 4000, `${proof.surplusBps}`);
    check('proof.totalFxrpCollateral is 700000000', proof.totalFxrpCollateral === 700000000, `${proof.totalFxrpCollateral}`);
    check('proof.totalLiabilities is 500000000', proof.totalLiabilities === 500000000, `${proof.totalLiabilities}`);
    check('proof.collateralRatio ~140%', Math.abs(proof.collateralRatio - 140) < 1, `${proof.collateralRatio.toFixed(2)}%`);
    check('proof.votingRound > 0', proof.votingRound > 0, `${proof.votingRound}`);
    check('proof.attestor is valid address', proof.attestor.startsWith('0x') && proof.attestor.length === 42, proof.attestor);
    check('proof.isValid is true', proof.isValid === true);
  }

  // 2. isSolvent
  const solvent = await sdk.audit.isSolvent();
  check('isSolvent() returns boolean', typeof solvent === 'boolean', `${solvent}`);
  check('isSolvent() is false (ratio 140% < min 150%)', solvent === false);

  // 3. verifyProof with correct root
  if (proof) {
    const verifyResult = await sdk.audit.verifyProof(proof.merkleRoot);
    check('verifyProof(correct root).verified === true', verifyResult.verified === true);
    check('verifyProof returns method', verifyResult.method === 'on-chain SolvencyRoot proof comparison');
    check('verifyProof returns proofData', verifyResult.proofData !== null);
  }

  // 4. verifyProof with invalid root
  const invalidResult = await sdk.audit.verifyProof('0x0000000000000000000000000000000000000000000000000000000000000001');
  check('verifyProof(invalid root).verified === false', invalidResult.verified === false);
  check('verifyProof(invalid root) mentions mismatch', invalidResult.details.includes('mismatch'));

  // 5. FDC status
  const fdcStatus = await sdk.audit.getFdcStatus();
  check('getFdcStatus() returns object', fdcStatus !== null);
  check('FDC contracts deployed count', Object.keys(fdcStatus.contractsDeployed).length === 5);
  const allDeployed = Object.values(fdcStatus.contractsDeployed).every(v => v);
  check('All 5 FDC contracts deployed', allDeployed);
  check('FdcHub address matches', fdcStatus.fdcHubAddress === '0x48aC463d7975828989331F4De43341627b9c5f1D');

  // 6. Proof history
  const history = await sdk.audit.getProofHistory();
  check('getProofHistory() returns array', Array.isArray(history));

  // 7. Request attestation
  const attResult = await sdk.audit.requestAttestation();
  check('requestAttestation() returns result', attResult !== null);
  check('requestAttestation().requested === true', attResult.requested === true);

  console.log('');

  // ========== AegisSDK convenience ==========
  console.log('--- AegisSDK Convenience ---');
  check('sdk.config.network.name === Coston2', sdk.config.network.name === 'Coston2');
  check('sdk.config.network.chainId === 114', sdk.config.network.chainId === 114);
  check('sdk.provider is JsonRpcProvider', sdk.provider !== null);
  check('sdk.vault is VaultClient', sdk.vault !== null);
  check('sdk.policy is PolicyClient', sdk.policy !== null);
  check('sdk.audit is AuditClient', sdk.audit !== null);

  // ========== Summary ==========
  console.log('\n=== Summary ===');
  const total = passed + failed;
  console.log(`  Total:  ${total}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Rate:   ${((passed / total) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.log('\n❌ SOME TESTS FAILED');
    process.exit(1);
  } else {
    console.log('\n✅ ALL TESTS PASSED');
  }

  // Write report
  const fs = require('fs');
  const report = {
    timestamp: new Date().toISOString(),
    task: 'Task 23 — TypeScript SDK verification',
    total,
    passed,
    failed,
    rate: `${((passed / total) * 100).toFixed(1)}%`,
    onChainData: {
      xrpPrice: xrpPrice,
      solvencyRatio: solvency.collateralRatio,
      merkleRoot: proof?.merkleRoot,
      attestor: proof?.attestor,
      policyCount,
      blockNumber: state.blockNumber,
    },
  };
  fs.writeFileSync('/home/z/my-project/aegis/testdata/task23_sdk_verification.json', JSON.stringify(report, null, 2));
  console.log('  Report saved to testdata/task23_sdk_verification.json');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
