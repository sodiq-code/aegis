/**
 * Aegis SDK Example — Deposit Flow
 *
 * Demonstrates the full deposit flow:
 *   1. Connect to Coston2 via VaultClient
 *   2. Query vault state (balances, positions, prices)
 *   3. Query solvency status
 *   4. Query risk score
 *   5. Verify contracts deployed
 *
 * Run: npx tsx examples/deposit-flow.ts
 */

import { AegisSDK } from '../src/index';

async function main() {
  console.log('=== Aegis SDK — Deposit Flow Example ===\n');

  const sdk = new AegisSDK();
  console.log(`Network: ${sdk.config.network.name} (chain ID ${sdk.config.network.chainId})`);
  console.log(`RPC: ${sdk.config.rpcUrl}\n`);

  // 1. Verify contracts deployed
  console.log('--- Contract Deployment ---');
  const deployed = await sdk.vault.verifyContractsDeployed();
  for (const [name, isDeployed] of Object.entries(deployed)) {
    console.log(`  ${name}: ${isDeployed ? '✓ deployed' : '✗ NOT deployed'}`);
  }
  console.log();

  // 2. Query vault state
  console.log('--- Vault State ---');
  const state = await sdk.vault.getState();
  console.log(`  Total FXRP Deposited: ${state.totalDeposited}`);
  console.log(`  Total USD Valuation:  ${state.totalValuation}`);
  console.log(`  Active Positions:     ${state.positionCount}`);
  console.log(`  XRP/USD Price:        $${state.xrpUsdPrice.toFixed(4)}`);
  console.log(`  Emergency Mode:       ${state.isEmergencyMode}`);
  console.log(`  Safe State:           ${state.isSafeState}`);
  console.log(`  Block Number:         ${state.blockNumber}`);
  console.log();

  // 3. Query solvency
  console.log('--- Solvency ---');
  const solvency = await sdk.vault.getSolvencyInfo();
  console.log(`  Solvent:              ${solvency.solvent}`);
  console.log(`  Collateral Ratio:     ${solvency.collateralRatio.toFixed(2)}%`);
  const minRatio = await sdk.vault.getMinCollateralRatio();
  console.log(`  Min Collateral Ratio: ${minRatio.toFixed(2)}%`);
  console.log();

  // 4. Risk score (from FCC extension or fallback)
  console.log('--- Risk Score ---');
  const risk = await sdk.vault.getRiskScore();
  if (risk) {
    console.log(`  Score:        ${risk.score.toFixed(1)}/100`);
    console.log(`  Action:       ${risk.action}`);
    console.log(`  Confidence:   ${(risk.confidence * 100).toFixed(0)}%`);
    console.log(`  Source:       ${risk.source}`);
    console.log(`  Thresholds:   Hold<${risk.thresholds.hold} Rebalance<${risk.thresholds.rebalance} Hedge<${risk.thresholds.hedge} Deleverage≥${risk.thresholds.deleverage}`);
  } else {
    console.log('  Risk score unavailable (FCC extension not reachable)');
  }
  console.log();

  // 5. Position data from FCC extension (TEE)
  console.log('--- Position Data (TEE) ---');
  const position = await sdk.vault.getPosition();
  if (position) {
    console.log(`  Total Collateral:  ${position.totalCollateral}`);
    console.log(`  Total Liabilities: ${position.totalLiabilities}`);
    console.log(`  Merkle Root:       ${position.merkleRoot.slice(0, 18)}...`);
    console.log(`  Positions:         ${position.positionCount}`);
  } else {
    console.log('  Position data unavailable (FCC extension not reachable)');
  }

  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
