/**
 * Aegis SDK Example — Audit Verification Flow
 *
 * Demonstrates the full audit/verification flow:
 *   1. Connect to Coston2 via AuditClient
 *   2. Query current solvency proof
 *   3. Verify the proof on-chain
 *   4. Check FDC attestation infrastructure
 *   5. Request a fresh attestation
 *   6. Query proof history
 *
 * Run: npx tsx examples/audit-verify.ts
 */

import { AegisSDK } from '../src/index';

async function main() {
  console.log('=== Aegis SDK — Audit Verification Example ===\n');

  const sdk = new AegisSDK();
  console.log(`Network: ${sdk.config.network.name} (chain ID ${sdk.config.network.chainId})\n`);

  // 1. Query current solvency proof
  console.log('--- Current Solvency Proof ---');
  const proof = await sdk.audit.getCurrentProof();
  if (proof) {
    console.log(`  Merkle Root:      ${proof.merkleRoot}`);
    console.log(`  Surplus (bps):    ${proof.surplusBps}`);
    console.log(`  Collateral:       ${proof.totalFxrpCollateral} FXRP`);
    console.log(`  Liabilities:      ${proof.totalLiabilities} FXRP`);
    console.log(`  Ratio:            ${proof.collateralRatio.toFixed(2)}%`);
    console.log(`  Voting Round:     ${proof.votingRound}`);
    console.log(`  Attestor:         ${proof.attestor}`);
    console.log(`  Valid:            ${proof.isValid}`);
  } else {
    console.log('  No solvency proof found on-chain');
  }
  console.log();

  // 2. Is solvent?
  console.log('--- Solvency Check ---');
  const solvent = await sdk.audit.isSolvent();
  console.log(`  Is Solvent: ${solvent}`);
  console.log();

  // 3. Verify the proof
  console.log('--- Proof Verification ---');
  if (proof) {
    const result = await sdk.audit.verifyProof(proof.merkleRoot);
    console.log(`  Verified:   ${result.verified}`);
    console.log(`  Method:     ${result.method}`);
    console.log(`  Details:    ${result.details}`);
    console.log(`  Timestamp:  ${result.timestamp}`);
  } else {
    console.log('  No proof to verify');
  }

  // Verify with wrong root
  console.log('\n--- Verify with Invalid Root ---');
  const badResult = await sdk.audit.verifyProof('0x0000000000000000000000000000000000000000000000000000000000000001');
  console.log(`  Verified:  ${badResult.verified}`);
  console.log(`  Details:   ${badResult.details}`);
  console.log();

  // 4. FDC attestation infrastructure
  console.log('--- FDC Attestation Infrastructure ---');
  const fdcStatus = await sdk.audit.getFdcStatus();
  console.log(`  Current Voting Round: ${fdcStatus.currentVotingRound}`);
  console.log(`  FDC Merkle Root:     ${fdcStatus.merkleRoot.slice(0, 18)}...`);
  console.log(`  Contracts Deployed:`);
  for (const [name, deployed] of Object.entries(fdcStatus.contractsDeployed)) {
    console.log(`    ${name}: ${deployed ? '✓' : '✗'}`);
  }
  console.log();

  // 5. Request fresh attestation
  console.log('--- Request Fresh Attestation ---');
  const attResult = await sdk.audit.requestAttestation();
  console.log(`  Requested:    ${attResult.requested}`);
  console.log(`  Voting Round: ${attResult.votingRound}`);
  console.log(`  Message:      ${attResult.message}`);
  console.log();

  // 6. Proof history
  console.log('--- Proof History ---');
  const history = await sdk.audit.getProofHistory();
  console.log(`  Total proofs: ${history.length}`);
  if (history.length > 0) {
    const latest = history[history.length - 1];
    console.log(`  Latest proof:`);
    console.log(`    Merkle Root:  ${latest.merkleRoot.slice(0, 18)}...`);
    console.log(`    Ratio:        ${latest.collateralRatio.toFixed(2)}%`);
    console.log(`    Block:        ${latest.blockNumber}`);
    console.log(`    Tx:           ${latest.transactionHash.slice(0, 18)}...`);
  }

  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
