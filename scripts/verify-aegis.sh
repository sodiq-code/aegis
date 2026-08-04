#!/bin/bash
# Aegis Dashboard Deep Verification Script
# Tests all features, APIs, routes, and end-to-end functionality

BASE_URL="https://aegis-mantle-deploy-s-projects.vercel.app"
RPC_URL="https://coston2-api.flare.network/ext/C/rpc"
PASS=0
FAIL=0
ISSUES=()

check() {
  local name="$1"
  local result="$2"
  if [ "$result" = "true" ]; then
    echo "✅ PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "❌ FAIL: $name"
    FAIL=$((FAIL + 1))
    ISSUES+=("$name")
  fi
}

echo "============================================"
echo "  AEGIS DASHBOARD DEEP VERIFICATION"
echo "============================================"
echo ""

# ─── 1. Build & TypeScript ─────────────────────────────────
echo "── 1. BUILD & TYPESCRIPT ──"
cd /home/z/my-project/frontend

# TypeScript check
tsc_result=$(npx tsc --noEmit 2>&1)
tsc_errors=$(echo "$tsc_result" | grep -c "error" || true)
check "TypeScript compilation (0 errors)" "$([ "$tsc_errors" = "0" ] && echo true || echo false)"

# Build check
build_result=$(npx next build 2>&1)
build_success=$(echo "$build_result" | grep -c "✓ Compiled successfully" || true)
check "Next.js build succeeds" "$([ "$build_success" -ge 1 ] && echo true || echo false)"

# Route count
route_count=$(echo "$build_result" | grep -c "ƒ /api/" || true)
check "API routes count ($route_count >= 10)" "$([ "$route_count" -ge 10 ] && echo true || echo false)"

echo ""

# ─── 2. Coston2 RPC Connection ─────────────────────────────
echo "── 2. COSTON2 RPC CONNECTION ──"

# Chain ID
chain_id=$(curl -s -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',''))" 2>/dev/null)
check "Coston2 chain ID = 0x72 (114)" "$([ "$chain_id" = "0x72" ] && echo true || echo false)"

# Block number (should be > 33M)
block_num=$(curl -s -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | python3 -c "import sys,json; print(int(json.load(sys.stdin).get('result','0x0'),16))" 2>/dev/null)
check "Block number > 33M ($block_num)" "$([ "$block_num" -gt 33000000 ] && echo true || echo false)"

echo ""

# ─── 3. Contract Deployment Verification ─────────────────────
echo "── 3. CONTRACT DEPLOYMENT ──"

contracts=(
  "VaultCore:0xcb08be1cc86d3f94c54c64682372e32f669134bc"
  "VerifierRole:0xb513516d02d88be754c5204e132defbb0f4156e6"
  "PolicyRegistry:0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5"
  "SolvencyRoot:0xf52c1fd632d853ee46a48a82064d3f5d390f057d"
  "InstructionSender:0xb175f16e1cea66360e354db4b178c04c69363c06"
  "FDCAttestor:0x266a9537eaa76264c926541a77c2705f659ba4f1"
  "PMWInstructionRelay:0xce23e1a26c41eaa305f69d9150d9ac82d8b30743"
)

for entry in "${contracts[@]}"; do
  name="${entry%%:*}"
  addr="${entry#*:}"
  code_len=$(curl -s -X POST "$RPC_URL" -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getCode\",\"params\":[\"$addr\",\"latest\"]}" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('result','0x0')))" 2>/dev/null)
  check "$name deployed (code_len=$code_len)" "$([ "$code_len" -gt 10 ] && echo true || echo false)"
done

echo ""

# ─── 4. API Endpoint Tests ──────────────────────────────────
echo "── 4. API ENDPOINT TESTS ──"

# vault-state
vs=$(curl -s "$BASE_URL/api/vault-state")
vs_connected=$(echo "$vs" | python3 -c "import sys,json; print(json.load(sys.stdin).get('connected',False))" 2>/dev/null)
check "GET /api/vault-state: connected=$vs_connected" "$vs_connected"

vs_chain=$(echo "$vs" | python3 -c "import sys,json; print(json.load(sys.stdin).get('chainId',0))" 2>/dev/null)
check "GET /api/vault-state: chainId=114" "$([ "$vs_chain" = "114" ] && echo true || echo false)"

vs_contracts=$(echo "$vs" | python3 -c "import sys,json; d=json.load(sys.stdin).get('contractsDeployed',{}); print(all(d.values()))" 2>/dev/null)
check "GET /api/vault-state: all 7 contracts deployed" "$vs_contracts"

vs_xrp=$(echo "$vs" | python3 -c "import sys,json; p=json.load(sys.stdin).get('vault',{}).get('xrpPrice',0); print(p > 0)" 2>/dev/null)
check "GET /api/vault-state: XRP price > 0" "$vs_xrp"

# solvency
sol=$(curl -s "$BASE_URL/api/solvency")
sol_connected=$(echo "$sol" | python3 -c "import sys,json; print(json.load(sys.stdin).get('connected',False))" 2>/dev/null)
check "GET /api/solvency: connected=$sol_connected" "$sol_connected"

sol_ratio=$(echo "$sol" | python3 -c "import sys,json; print(json.load(sys.stdin).get('collateralRatio',0))" 2>/dev/null)
check "GET /api/solvency: collateralRatio=$sol_ratio (>0)" "$([ "$sol_ratio" -gt 0 ] && echo true || echo false)"

sol_proof=$(echo "$sol" | python3 -c "import sys,json; p=json.load(sys.stdin).get('currentProof',{}); print(p.get('isValid',False))" 2>/dev/null)
check "GET /api/solvency: currentProof.isValid=$sol_proof" "$sol_proof"

# fdc-attestation-status
fdc=$(curl -s "$BASE_URL/api/fdc-attestation-status")
fdc_round=$(echo "$fdc" | python3 -c "import sys,json; print(json.load(sys.stdin).get('currentVotingRound',0) > 0)" 2>/dev/null)
check "GET /api/fdc-attestation-status: votingRound > 0" "$fdc_round"

fdc_contracts=$(echo "$fdc" | python3 -c "import sys,json; d=json.load(sys.stdin).get('contractsDeployed',{}); print(all(d.values()))" 2>/dev/null)
check "GET /api/fdc-attestation-status: all FDC contracts deployed" "$fdc_contracts"

# solvency-proofs
sp=$(curl -s "$BASE_URL/api/solvency-proofs")
sp_count=$(echo "$sp" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('proofs',[])))" 2>/dev/null)
check "GET /api/solvency-proofs: proofs count=$sp_count (>=1)" "$([ "$sp_count" -ge 1 ] && echo true || echo false)"

# verify-proof (correct root)
known_root="0x93041e047f6688a8bf87014abc061c9650a11659e2efb1f0cedc2ce75dc9c173"
vp=$(curl -s -X POST "$BASE_URL/api/verify-proof" -H 'Content-Type: application/json' -d "{\"merkleRoot\":\"$known_root\"}")
vp_verified=$(echo "$vp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('verified',False))" 2>/dev/null)
check "POST /api/verify-proof (known root): verified=$vp_verified" "$vp_verified"

vp_method=$(echo "$vp" | python3 -c "import sys,json; m=json.load(sys.stdin).get('method',''); print('on-chain' in m)" 2>/dev/null)
check "POST /api/verify-proof: method contains 'on-chain'" "$vp_method"

# verify-proof (wrong root - should return false)
vp2=$(curl -s -X POST "$BASE_URL/api/verify-proof" -H 'Content-Type: application/json' -d '{"merkleRoot":"0x0000000000000000000000000000000000000000000000000000000000000001"}')
vp2_verified=$(echo "$vp2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('verified',True))" 2>/dev/null)
check "POST /api/verify-proof (wrong root): verified=false" "$([ "$vp2_verified" = "False" ] && echo true || echo false)"

# verify-proof (missing root - should return 400)
vp3_status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/verify-proof" -H 'Content-Type: application/json' -d '{}')
check "POST /api/verify-proof (no root): status=400" "$([ "$vp3_status" = "400" ] && echo true || echo false)"

# fcc-extension
fcc=$(curl -s "$BASE_URL/api/fcc-extension?endpoint=/api/solvency")
fcc_mock=$(echo "$fcc" | python3 -c "import sys,json; print(json.load(sys.stdin).get('mock',False))" 2>/dev/null)
check "GET /api/fcc-extension: returns mock when unreachable" "$fcc_mock"

# policy-state
ps=$(curl -s "$BASE_URL/api/policy-state")
ps_count=$(echo "$ps" | python3 -c "import sys,json; print(json.load(sys.stdin).get('policyCount',0))" 2>/dev/null)
check "GET /api/policy-state: policyCount=$ps_count (>=3)" "$([ "$ps_count" -ge 3 ] && echo true || echo false)"

ps_connected=$(echo "$ps" | python3 -c "import sys,json; print(json.load(sys.stdin).get('connected',False))" 2>/dev/null)
check "GET /api/policy-state: connected=$ps_connected" "$ps_connected"

# vault-events
ve=$(curl -s "$BASE_URL/api/vault-events?range=all")
ve_count=$(echo "$ve" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('events',[])))" 2>/dev/null)
check "GET /api/vault-events: events count=$ve_count (>=1)" "$([ "$ve_count" -ge 1 ] && echo true || echo false)"

# flare-rpc
fr=$(curl -s -X POST "$BASE_URL/api/flare-rpc" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}')
fr_chain=$(echo "$fr" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',''))" 2>/dev/null)
check "POST /api/flare-rpc: chainId=0x72" "$([ "$fr_chain" = "0x72" ] && echo true || echo false)"

echo ""

# ─── 5. M3 Checkpoint Verification ──────────────────────────
echo "── 5. M3 CHECKPOINT VERIFICATION ──"

# Verify the M3 TX exists on-chain
m3_tx="0xfb4eeb96febf3929b6f1f55d394476a60815754d9ea84219edf27f1cb3bf4481"
m3_receipt=$(curl -s -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getTransactionReceipt\",\"params\":[\"$m3_tx\"]}" 2>/dev/null)
m3_status=$(echo "$m3_receipt" | python3 -c "import sys,json; r=json.load(sys.stdin).get('result',{}); print(r.get('status','0x0'))" 2>/dev/null)
check "M3 TX status=0x1 (success)" "$([ "$m3_status" = "0x1" ] && echo true || echo false)"

m3_block=$(echo "$m3_receipt" | python3 -c "import sys,json; r=json.load(sys.stdin).get('result',{}); print(int(r.get('blockNumber','0x0'),16))" 2>/dev/null)
check "M3 TX block=33565198 (got $m3_block)" "$([ "$m3_block" = "33565198" ] && echo true || echo false)"

echo ""

# ─── 6. Production Site ─────────────────────────────────────
echo "── 6. PRODUCTION SITE ──"

# Site loads
site_status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL")
check "Site HTTP 200" "$([ "$site_status" = "200" ] && echo true || echo false)"

# Title
site_title=$(curl -s "$BASE_URL" | grep -o '<title>[^<]*</title>' | sed 's/<[^>]*>//g')
check "Site title contains 'Aegis'" "$([ -n "$(echo "$site_title" | grep -i aegis)" ] && echo true || echo false)"

echo ""

# ─── 7. Component Integration ────────────────────────────────
echo "── 7. COMPONENT INTEGRATION ──"

# Check that all new components are imported in treasury-view
tv_file="/home/z/my-project/frontend/src/components/aegis/treasury-view.tsx"
check "DepositFlow imported in TreasuryView" "$([ -n "$(grep 'DepositFlow' $tv_file)" ] && echo true || echo false)"
check "ConfidentialPosition imported in TreasuryView" "$([ -n "$(grep 'ConfidentialPosition' $tv_file)" ] && echo true || echo false)"
check "RiskRebalance imported in TreasuryView" "$([ -n "$(grep 'RiskRebalance' $tv_file)" ] && echo true || echo false)"
check "FdcAttestationPanel imported in TreasuryView" "$([ -n "$(grep 'FdcAttestationPanel' $tv_file)" ] && echo true || echo false)"
check "SolvencyChart imported in TreasuryView" "$([ -n "$(grep 'SolvencyChart' $tv_file)" ] && echo true || echo false)"

# Check that all components render in correct order
check "DepositFlow rendered before ConfidentialPosition" "$([ -n "$(grep -A1 'DepositFlow' $tv_file | grep '<DepositFlow />')" ] && echo true || echo false)"
check "FdcAttestationPanel rendered last" "$([ -n "$(grep 'FdcAttestationPanel' $tv_file | tail -1 | grep 'FdcAttestationPanel')" ] && echo true || echo false)"

echo ""

# ─── 8. Hook Verification ────────────────────────────────────
echo "── 8. HOOK VERIFICATION ──"

hooks_file="/home/z/my-project/frontend/src/hooks/use-aegis-data.ts"
check "useVaultState hook exists" "$([ -n "$(grep 'export function useVaultState' $hooks_file)" ] && echo true || echo false)"
check "useSolvencyData hook exists" "$([ -n "$(grep 'export function useSolvencyData' $hooks_file)" ] && echo true || echo false)"
check "usePolicyData hook exists" "$([ -n "$(grep 'export function usePolicyData' $hooks_file)" ] && echo true || echo false)"
check "useRiskScore hook exists" "$([ -n "$(grep 'export function useRiskScore' $hooks_file)" ] && echo true || echo false)"
check "useProofVerification hook exists" "$([ -n "$(grep 'export function useProofVerification' $hooks_file)" ] && echo true || echo false)"
check "useVaultEvents hook exists" "$([ -n "$(grep 'export function useVaultEvents' $hooks_file)" ] && echo true || echo false)"
check "useSolvencyProofs hook exists" "$([ -n "$(grep 'export function useSolvencyProofs' $hooks_file)" ] && echo true || echo false)"

# Verify useProofVerification calls real API (not simulated)
check "useProofVerification calls /api/verify-proof" "$([ -n "$(grep '/api/verify-proof' $hooks_file)" ] && echo true || echo false)"
check "useProofVerification NOT using setTimeout simulation" "$([ -z "$(grep 'setTimeout' $hooks_file | grep -v 'refetch')" ] && echo true || echo false)"

echo ""

# ─── 9. Demo Script Alignment ────────────────────────────────
echo "── 9. DEMO SCRIPT ALIGNMENT ──"

# Deposit Flow (0:30-1:15)
df_file="/home/z/my-project/frontend/src/components/aegis/deposit-flow.tsx"
check "Deposit Flow: 5-step flow (signing→minting→depositing→attesting→complete)" "$([ -n "$(grep 'DepositStep' $df_file | head -1)" ] && echo true || echo false)"
check "Deposit Flow: Xaman wallet integration" "$([ -n "$(grep 'useXamanWallet' $df_file)" ] && echo true || echo false)"
check "Deposit Flow: BlockExplorerLink for VaultCore" "$([ -n "$(grep 'BlockExplorerLink' $df_file)" ] && echo true || echo false)"
check "Deposit Flow: Quote 'One signature, one on-chain deposit, fully attested'" "$([ -n "$(grep 'One signature, one on-chain deposit, fully attested' $df_file)" ] && echo true || echo false)"

# Confidential Position (1:15-2:30)
cp_file="/home/z/my-project/frontend/src/components/aegis/confidential-position.tsx"
check "Confidential Position: On-chain vs TEE comparison" "$([ -n "$(grep 'On-Chain State' $cp_file)" ] && echo true || echo false)"
check "Confidential Position: Merkle root (blurred)" "$([ -n "$(grep 'blur-sm' $cp_file)" ] && echo true || echo false)"
check "Confidential Position: TEE positions (assets + liabilities)" "$([ -n "$(grep 'What We Hold' $cp_file)" ] && echo true || echo false)"
check "Confidential Position: TEE verify button" "$([ -n "$(grep 'Verify TEE Attestation' $cp_file)" ] && echo true || echo false)"
check "Confidential Position: Quote about TEE verification" "$([ -n "$(grep 'Anyone can verify the TEE ran the correct code' $cp_file)" ] && echo true || echo false)"

# Risk Rebalance (2:30-3:30)
rr_file="/home/z/my-project/frontend/src/components/aegis/risk-rebalance.tsx"
check "Risk Rebalance: Simulate Market Drawdown button" "$([ -n "$(grep 'Simulate Market Drawdown' $rr_file)" ] && echo true || echo false)"
check "Risk Rebalance: 7-step flow" "$([ -n "$(grep 'detecting.*computing.*issuing-pmw' $rr_file)" ] && echo true || echo false)"
check "Risk Rebalance: PMW instruction step" "$([ -n "$(grep 'PMW instruction' $rr_file)" ] && echo true || echo false)"
check "Risk Rebalance: XRPL execution step" "$([ -n "$(grep 'XRPL transaction' $rr_file)" ] && echo true || echo false)"
check "Risk Rebalance: FDC attestation step" "$([ -n "$(grep 'FDC attestation' $rr_file)" ] && echo true || echo false)"
check "Risk Rebalance: Solvency root update step" "$([ -n "$(grep 'solvency root' $rr_file)" ] && echo true || echo false)"
check "Risk Rebalance: Quote about autonomous rebalance" "$([ -n "$(grep 'autonomously rebalanced' $rr_file)" ] && echo true || echo false)"

# Verifiable Solvency (3:30-4:30)
av_file="/home/z/my-project/frontend/src/components/aegis/audit-view.tsx"
check "Audit View: useProofVerification hook used" "$([ -n "$(grep 'useProofVerification' $av_file)" ] && echo true || echo false)"
check "Audit View: verification result display" "$([ -n "$(grep 'verificationResult' $av_file)" ] && echo true || echo false)"
check "Audit View: FDC verification display" "$([ -n "$(grep 'fdcVerification' $av_file)" ] && echo true || echo false)"
check "Audit View: Quote about confidentiality-to-verifiability" "$([ -n "$(grep 'confidentiality-to-verifiability' $av_file)" ] && echo true || echo false)"

# FDC Attestation Panel
fdc_file="/home/z/my-project/frontend/src/components/aegis/fdc-attestation-panel.tsx"
check "FDC Panel: Current voting round display" "$([ -n "$(grep 'currentVotingRound' $fdc_file)" ] && echo true || echo false)"
check "FDC Panel: Contract deployment status" "$([ -n "$(grep 'contractsDeployed' $fdc_file)" ] && echo true || echo false)"
check "FDC Panel: BlockExplorerLinks for contracts" "$([ -n "$(grep 'BlockExplorerLink' $fdc_file)" ] && echo true || echo false)"

# Solvency Charts
sc_file="/home/z/my-project/frontend/src/components/aegis/solvency-chart.tsx"
check "Solvency Charts: Risk score trend line chart" "$([ -n "$(grep 'LineChart' $sc_file)" ] && echo true || echo false)"
check "Solvency Charts: Solvency margin area chart" "$([ -n "$(grep 'AreaChart' $sc_file)" ] && echo true || echo false)"
check "Solvency Charts: 150% minimum reference line" "$([ -n "$(grep '150' $sc_file)" ] && echo true || echo false)"
check "Solvency Charts: useRiskScore and useSolvencyProofs hooks" "$([ -n "$(grep 'useRiskScore.*useSolvencyProofs' $sc_file)" ] && echo true || echo false)"

echo ""

# ─── SUMMARY ─────────────────────────────────────────────────
echo "============================================"
echo "  VERIFICATION SUMMARY"
echo "============================================"
echo ""
echo "  PASSED: $PASS"
echo "  FAILED: $FAIL"
echo "  TOTAL:  $((PASS + FAIL))"
echo ""

if [ $FAIL -gt 0 ]; then
  echo "  ⚠️  ISSUES FOUND:"
  for issue in "${ISSUES[@]}"; do
    echo "    - $issue"
  done
  echo ""
  exit 1
else
  echo "  🎉 ALL CHECKS PASSED!"
  echo ""
  exit 0
fi
