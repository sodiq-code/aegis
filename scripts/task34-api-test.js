/**
 * Task 34: End-to-end API route verification script
 * Tests all 10 API routes against real Coston2 data
 */

const BASE = 'https://aegis-mantle-deploy-s-projects.vercel.app';
const ROUTES = [
  { path: '/api/vault-state', method: 'GET', description: 'VaultCore state (deposits, valuation, positions, price)' },
  { path: '/api/solvency', method: 'GET', description: 'Current solvency proof from SolvencyRoot' },
  { path: '/api/solvency-proofs', method: 'GET', description: 'Proof history via SolvencyProofPublished events' },
  { path: '/api/vault-events', method: 'GET', description: 'Recent on-chain events (deposits, revaluations, proofs)' },
  { path: '/api/verify-proof', method: 'POST', description: 'On-chain proof verification', body: { merkleRoot: '0x93041e047f6688a8bf87014abc061c9650a11659e2efb1f0cedc2ce75dc9c173' } },
  { path: '/api/fdc-attestation-status', method: 'GET', description: 'FDC voting round, Merkle root, contract status' },
  { path: '/api/fcc-extension', method: 'POST', description: 'FCC extension proxy (TEE)', body: { endpoint: 'attestation', data: {} } },
  { path: '/api/policy-state', method: 'GET', description: 'Read all policies from PolicyRegistry' },
  { path: '/api/policy-update', method: 'POST', description: 'Update policy params', body: { policyId: 0, maxDrawdownBps: 1500, maxLeverage: 200, rebalanceThresholdBps: 500 } },
  { path: '/api/flare-rpc', method: 'POST', description: 'Generic Flare RPC proxy', body: { method: 'eth_blockNumber', params: [] } },
];

async function testRoute(route) {
  const url = `${BASE}${route.path}`;
  const options = {
    method: route.method,
    headers: { 'Content-Type': 'application/json' },
    ...(route.body ? { body: JSON.stringify(route.body) } : {}),
  };

  try {
    const start = Date.now();
    const res = await fetch(url, options);
    const elapsed = Date.now() - start;
    const data = await res.json();

    const status = res.ok ? '✅' : '❌';
    const summary = res.ok
      ? JSON.stringify(data).substring(0, 200)
      : `Error: ${data.error || data.message || 'Unknown'}`;

    console.log(`${status} ${route.method} ${route.path} [${res.status}] ${elapsed}ms`);
    console.log(`   → ${route.description}`);
    console.log(`   → ${summary}\n`);

    return { route: route.path, ok: res.ok, status: res.status, elapsed, hasData: !!data };
  } catch (err) {
    console.log(`❌ ${route.method} ${route.path} FAILED: ${err.message}\n`);
    return { route: route.path, ok: false, error: err.message };
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('AEGIS API Route End-to-End Verification (Task 34)');
  console.log(`Target: ${BASE}`);
  console.log('='.repeat(60));
  console.log();

  const results = [];
  for (const route of ROUTES) {
    const result = await testRoute(route);
    results.push(result);
  }

  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    console.log('\nFailed routes:');
    results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.route}: ${r.error || `HTTP ${r.status}`}`));
  }

  // Exit with error code if any failed
  process.exit(failed > 0 ? 1 : 0);
}

main();
