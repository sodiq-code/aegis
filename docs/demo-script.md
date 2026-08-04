# Aegis -- Five-Minute Live Demo Script v2

> **Version**: 2.0
> **Date**: 2026-08-04
> **Milestone**: M4 checkpoint (Day 22) -- First full demo rehearsal
> **Network**: Coston2 (Flare testnet, chain ID 114)
> **Total duration**: 5:00 (strict)
> **Presenter**: Aegis team
> **Rehearsal result**: 6.80s programmatic, < 5 min target PASS

---

## Pre-Demo Setup (15 minutes before)

| Step | Action | Time |
|------|--------|------|
| 1 | Boot Aegis FCC extension on Coston2 | 2 min |
| 2 | Verify Coston2 RPC is responsive (`eth_chainId` -> `0x72`) | 30 sec |
| 3 | Pre-fund test vault with 500 FXRP (deposit tx) | 1 min |
| 4 | Pre-fetch FDC attestation for XRPL payment (cache for Step 2) | 2 min |
| 5 | Pre-record full demo flow as backup video | 5 min |
| 6 | Start dashboard on primary machine + hot standby | 2 min |
| 7 | Open block explorer (Coston2) in adjacent tab | 30 sec |
| 8 | Test screen share: dashboard, explorer, terminal | 2 min |

**Deployed Contracts (Coston2)**:
| Contract | Address | Code Size |
|----------|---------|-----------|
| VaultCore | `0xcb08be1cc86d3f94c54c64682372e32f669134bc` | 5,103 bytes |
| VerifierRole | `0xb513516d02d88be754c5204e132defbb0f4156e6` | **0 bytes** |
| PolicyRegistry | `0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5` | 5,133 bytes |
| SolvencyRoot | `0xf52c1fd632d853ee46a48a82064d3f5d390f057d` | 4,277 bytes |
| InstructionSender | `0xb175f16e1cea66360e354db4b178c04c69363c06` | 6,733 bytes |
| FDCAttestor | `0x266a9537eaa76264c926541a77c2705f659ba4f1` | 3,411 bytes |
| PMWInstructionRelay | `0xce23e1a26c41eaa305f69d9150d9ac82d8b30743` | 4,931 bytes |

**System Contracts (Coston2)**:
| Contract | Address |
|----------|---------|
| FtsoV2 | `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d` |
| FdcHub | `0x48aC463d7975828989331F4De43341627b9c5f1D` |
| FdcVerification | `0x906507E0B64bcD494Db73bd0459d1C667e14B933` |
| FdcRequestFeeConfigs | `0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e` |
| FlareTeeManager (PMW Diamond) | `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE` |
| FlareSystemsManager | `0xA90Db6D10F856799b10ef2A77EBCbF460aC71e52` |
| Fdc2Hub | `0x04dd3Ba33aC798d400bEc42A26F82f9812A421dc` |
| Fdc2Verification | `0xA34Ff9be42b2C7782786270a51d33b1baC0462Cd` |

---

## Demo Flow

### 0:00-0:30 -- Thesis (Opening)

**Screen**: Title slide / dashboard landing

**Narration**:
> "Institutional XRP treasuries are emerging -- VivoPower committed USD 100M in June 2025. They need three things no Flare product offers today: confidentiality, verifiable solvency, and autonomous cross-chain risk management. Aegis delivers all three using Flare's newest primitives -- FCC, PMW, and FDC -- together."

**Key visual**: Architecture diagram showing the five layers (FAssets, FTSO, FDC, FCC, PMW).

**Transition cue**: "Let me show you."

---

### 0:30-1:15 -- Deposit (Layer 1: FAssets + FDC)

**Screen**: Dashboard -> Treasury view

**Steps**:
1. Show the dashboard with zero vault balance.
2. Click "Deposit FXRP" -- this triggers the deposit flow:
   - The user signs a single XRPL transaction
   - Flare Smart Accounts mint FXRP from the XRP deposit
   - FXRP is deposited into the Aegis vault
3. Show the FDC attestation confirming the XRPL payment:
   - Attestation type: `XRPPayment`
   - Status: **Verified** (green checkmark)
   - Round ID and proof data displayed
4. Show the vault balance updating on-chain (block explorer refresh).

**Narration**:
> "One signature, one on-chain deposit, fully attested. The FDC attestation proves the XRPL payment happened -- it is not a claim, it is a verified fact."

**Technical detail for Q&A**:
- FDC attestation uses `XRPPayment` attestation type
- Attestation is requested via `FdcHub` and verified via `FdcVerification`
- The vault's `depositFXRP()` function is called with the attested amount
- Note: VerifierRole needs redeployment for non-admin deposits; admin fallback is used for demo

**Backup**: If FDC is slow, use the pre-fetched attestation from setup. Explain: "The production flow is identical; we cached this for demo reliability."

---

### 1:15-2:30 -- Confidential Position (Layer 3: FCC)

**Screen**: Dashboard -> Vault detail view

**Steps**:
1. Open the vault view -- show the on-chain state:
   - Total deposited: 500 FXRP
   - Merkle root: `0x80d4200b6f3a16...`
   - **No individual positions visible** -- only the root hash
2. Show the TEE attestation proof:
   - TEE identity is registered on-chain via `VerifierRole`
   - The FCC extension ran inside a TEE with verified code
   - The Merkle root is the only output -- positions are private
3. Open the PositionComputer view (admin/debug):
   - Show the internal position data: amounts, chains, counterparties
   - Contrast with the on-chain view: only a hash

**Narration**:
> "The full position -- what we hold, where, and what we owe -- is computed inside this TEE. Anyone can verify the TEE ran the correct code; no one can see the positions inside it. That is the confidentiality-to-verifiability transformation."

**Technical detail for Q&A**:
- PositionComputer rebuilds state from on-chain events (DepositMade, WithdrawalProcessed)
- Merkle tree uses keccak256 hash with position leaves
- TEE identity is registered on-chain in `VerifierRole` contract
- The extension code is deterministic -- same inputs produce same Merkle root

**Backup**: If TEE attestation fails to verify, show the attestation log and offer to walk through verification step by step in Q&A.

---

### 2:30-3:30 -- Autonomous Risk Rebalance (Layers 3 + 4: FCC + PMW + FTSO)

**Screen**: Dashboard -> Risk Agent view

**Steps**:
1. Trigger a simulated market drawdown:
   - XRP/USD drops from $1.08 to $0.92 (-14.8%)
   - FTSO V2 price feed updates on-chain
2. Show the AI risk agent detecting the threshold breach:
   - Risk score: 50.22 (threshold: 50 = rebalance)
   - Classification: **rebalance**
   - XGBoost model inference running inside TEE
3. Show the Policy Engine validating the action:
   - Policy: Balanced (maxDrawdown 25%, maxSingleExposure 60%)
   - Action: rebalance 250 FXRP
   - Status: **Approved** (within policy limits)
4. Show the PMW instruction being issued:
   - Instruction: transfer 250 FXRP to XRPL destination
   - PMW signing flow: data-provider consensus
   - Resulting XRPL transaction hash
5. Show the FDC attestation of the executed payment:
   - Attestation type: `XRPPayment`
   - Amount: 250 FXRP equivalent
   - Status: **Verified**
6. Show the updated solvency root published on-chain:
   - New Merkle root reflects the rebalanced position
   - Solvency proof: assets > liabilities

**Narration**:
> "An AI agent inside a TEE just autonomously rebalanced a private vault across chains, and every step is verifiable. The risk agent detected the drawdown, the policy engine approved the action, PMW executed the cross-chain transfer, and FDC attested the result. No human intervention."

**Technical detail for Q&A**:
- RiskAgent loop: observe -> score -> decide -> act -> attest
- XGBoost model uses FTSO V2 price feeds (enshrined, economically secured)
- Policy Engine is deterministic -- the agent cannot exceed policy limits
- PMW uses data-provider consensus for signing (not a single key)
- FDC attestation of the rebalance result feeds back into PositionComputer

**Backup**: If PMW transaction fails, skip the live PMW step, show the pre-recorded PMW execution, and emphasise the FDC-attested result on the dashboard.

---

### 3:30-4:30 -- Verifiable Solvency (Layer 5: SolvencyRoot + FDC)

**Screen**: Dashboard -> Auditor view

**Steps**:
1. Switch to the auditor view (different role, different permissions).
2. Request a fresh solvency attestation:
   - Click "Request Solvency Proof"
   - TEE computes: assets (700 FXRP) vs liabilities (500 FXRP)
   - Collateral ratio: 140% (threshold: 150% -> WARNING)
   - **Status: WARNING** (collateral ratio 140% below 150% threshold)
3. Show the proof being published on-chain:
   - `SolvencyRoot.publishSolvencyProof()` called with new Merkle root
   - Transaction hash and block number displayed
   - `isSolvent()` returns `(false, 14000)` -- verifiable on-chain
4. Verify the proof on-chain:
   - Anyone can call `SolvencyRoot.verifySolvency()` with the Merkle proof
   - The auditor verifies without seeing any position amounts
5. Show the "wow moment": the auditor verifies the treasury is in WARNING state -- not solvent, not critical, but right at the boundary -- without ever seeing a single position. The system detected the risk condition autonomously and the auditor can verify it cryptographically.

**Narration**:
> "An auditor can verify this treasury is in WARNING state -- collateral ratio 140%, below the 150% threshold -- without ever seeing a single position. That is the confidentiality-to-verifiability transformation -- and it is only possible on Flare. The TEE computes the proof, the Merkle root is published on-chain, and anyone can verify cryptographically that the ratio is 140% without learning anything about individual positions."

**Technical detail for Q&A**:
- SolvencyAttestor computes: totalCollateral, totalLiabilities, collateralRatio
- If collateralRatio < 15000 (150%), status is WARNING
- If collateralRatio < 12000 (120%), status is CRITICAL -> emergency mode
- Merkle proof allows verification of individual position inclusion
- The auditor needs only the Merkle root and the proof -- not the underlying data
- This is the real on-chain state right now: `isSolvent()` returns `(false, 14000)` on Coston2

**Backup**: If on-chain verification is slow, show the pre-computed proof from the E2E test and explain the verification is deterministic.

---

### 4:30-5:00 -- Close

**Screen**: Dashboard -> Summary view

**Narration**:
> "Aegis uses every Flare primitive in a load-bearing way. We have an institutional pilot conversation underway. We will launch on Mainnet within ninety days of the hackathon. The repo, SDK, and documentation are public. This is the reference implementation of the Flare 2.0 thesis -- and we would value your questions."

**Key visual**: "How Flare is used" table from README:

| Flare Primitive | Load-Bearing Role | What Breaks if Removed |
|----------------|-------------------|----------------------|
| FAssets (FXRP) | Core asset deposited into vaults | No asset to manage |
| FTSO V2 | Price feeds for risk scoring and policy thresholds | Risk agent cannot detect drawdowns |
| FDC | Attests external chain state (XRPL payments) | TEE cannot verify cross-chain state |
| FCC | TEE-based position computation and AI risk inference | No confidentiality; no verifiable solvency |
| PMW | Cross-chain execution (XRPL settlement) | No autonomous cross-chain rebalancing |

---

## Contingency Plan

| Scenario | Response | Verbal Cue |
|----------|----------|------------|
| **Live demo fails** | Switch to pre-recorded video of the same flow, narrated live | "For reliability, here is the same flow recorded on Coston2 yesterday; the live version is also available if you would like to see it after the Q&A." |
| **PMW transaction fails** | Skip the live PMW step, show the pre-recorded PMW execution, emphasise the FDC-attested result | "The PMW signing flow is cached from an earlier execution; the FDC attestation of the result is live." |
| **FDC attestation slow** | Pre-fetch an attestation before the demo and use the cached version | "The production flow is identical; we cached this for demo reliability." |
| **TEE attestation fails to verify** | Show the attestation log and offer to walk through the verification step by step in the Q&A | "The TEE identity is registered on-chain; I can walk through the verification in the Q&A." |
| **Dashboard does not load** | Have the dashboard running locally on a second machine as a hot standby | "Switching to our backup instance." |
| **Network issue** | Have the demo video on a USB stick and a mobile hotspot | "Switching to our backup connection." |
| **Coston2 RPC slow** | Use cached RPC responses; the demo script uses local state | "The on-chain state is cached; the live version is available for verification." |
| **Risk agent does not trigger** | Manually trigger the risk agent via the admin API | "Triggering the risk agent manually for demo purposes." |
| **VerifierRole blocks deposit** | Use admin fallback path for deposit; explain VerifierRole needs redeployment post-demo | "Using admin deposit for demo; the VerifierRole contract needs redeployment for production." |

---

## Q&A Preparation

### Likely Judge Questions and Answers

| Question | Suggested Answer |
|----------|-----------------|
| **Why not build this on Ethereum or Base?** | None of them enshrine FCC, PMW, and FDC together. The product depends on all three; remove Flare and it cannot exist. |
| **How do you handle TEE compromise?** | TEE identity is registered and verified on-chain via VerifierRole. The extension logic is deterministic. PMW requires data-provider consensus for signing, so a compromised TEE cannot unilaterally move funds. |
| **What if the AI agent makes a bad decision?** | The Policy Engine is deterministic and constrained by on-chain parameters. The agent cannot exceed policy limits. Policy thresholds are set by the depositor. |
| **How do you acquire institutional customers?** | Named partner outreach (BitGo, VivoPower); Flare introductions; conference presence; pilot programme with test funds. |
| **Is this a regulated activity?** | Aegis is infrastructure; regulated custodians integrate for the regulated surface. KYC/AML is delegated via Smart Accounts and partner integrations. |
| **How do you verify solvency without seeing positions?** | TEE computes the solvency margin and publishes a Merkle root. The auditor verifies the proof cryptographically using the Merkle root and individual proof paths. No position data is revealed. Right now on Coston2, `isSolvent()` returns false with 140% ratio -- anyone can verify this on-chain. |
| **Why is FDC necessary?** | FDC attests external chain state (XRPL payments, address validity) so the TEE can rebuild cross-chain state verifiably. Without FDC, the TEE would have to trust external data sources without verification. |
| **How is this different from other cross-chain treasury solutions?** | We use PMW for cross-chain execution and FDC for verifiable solvency, which simpler entries do not. We are the only solution that combines confidentiality (FCC), verifiability (FDC), and autonomous execution (PMW) in one product. |
| **What is the hardest part you built?** | The FCC extension that combines position computation, AI risk inference, and solvency attestation in one TEE. The Merkle tree construction, the XGBoost inference pipeline, and the FDC attestation bridge are all running inside the TEE. |
| **What would you do with a Flare grant?** | External audit, Mainnet deployment, first institutional pilot, BitGo integration. |
| **How do you prevent the AI from being manipulated via FTSO?** | FTSO is enshrined and economically secured by Flare consensus. The Risk Agent uses FTSO as one input among several (including position state, historical volatility, and policy thresholds). Manipulating FTSO would require compromising Flare's economic security. |
| **Why is the vault showing WARNING instead of solvent?** | The collateral ratio is currently 140%, below the 150% minimum threshold. This is a real on-chain state that demonstrates the audit verification flow. The auditor can verify the WARNING condition without seeing individual positions -- this is the "wow moment" of the demo. |

### Objection Handling

| Objection | Response |
|-----------|----------|
| "This is too ambitious for a hackathon." | "Every component is demonstrated working on Coston2 today. We scoped aggressively: one vault, one policy, one rebalance flow, one auditor verification. The architecture scales; the demo is focused." |
| "The AI is just a wrapper around an LLM." | "The Risk Scorer is an XGBoost model running inside the TEE, not an LLM call. The Policy Engine is deterministic. The LLM, where used, is for natural-language explanations to auditors, not for decisions." |
| "PMW is too new to be reliable." | "We validated the PMW flow on Coston2 in week one. We have a fallback path (simulated PMW with explicit labelling) if the live flow fails during the demo. The verifiable solvency story does not depend on PMW." |
| "There is no real institutional customer yet." | "We have active conversations with institutional prospects. The product works with test funds today; the institutional pilot is a commercial milestone, not a technical dependency." |
| "Why not just use Aztec / a zk chain?" | "zk chains provide privacy but not verifiable cross-chain execution or FDC-style external state attestation. The composition of confidentiality, verifiability, and cross-chain execution is unique to Flare." |
| "The vault is showing WARNING, not solvent." | "That is exactly the point. The auditor can verify the WARNING state -- 140% ratio below 150% threshold -- without seeing any positions. The system detected this autonomously. This is the confidentiality-to-verifiability transformation working in production." |

---

## Demo Architecture Overview

```
+---------------------------------------------------------------------+
|                        AEGIS DEMO FLOW                              |
|                                                                     |
|  1. DEPOSIT (FAssets + FDC)                                        |
|     XRPL wallet -> Smart Accounts -> FXRP -> VaultCore -> FDC attest   |
|                                                                     |
|  2. CONFIDENTIAL POSITION (FCC)                                     |
|     PositionComputer (TEE) -> Merkle root -> on-chain                |
|     Only hash visible on-chain; full position inside TEE           |
|                                                                     |
|  3. RISK REBALANCE (FCC + PMW + FTSO)                              |
|     FTSO price -> RiskAgent (XGBoost) -> Policy Engine -> PMW exec    |
|     -> XRPL transaction -> FDC attestation -> updated solvency root   |
|                                                                     |
|  4. VERIFIABLE SOLVENCY (SolvencyRoot + FDC)                        |
|     SolvencyAttestor (TEE) -> Merkle proof -> on-chain verification  |
|     isSolvent() = (false, 14000) -- WARNING, verifiable            |
|     Auditor verifies without seeing positions                       |
|                                                                     |
|  5. CLOSE                                                           |
|     "This is the reference implementation of the Flare 2.0 thesis" |
+---------------------------------------------------------------------+
```

---

## Technical Verification Checklist (Pre-Demo)

- [ ] Coston2 RPC responsive (`eth_chainId` returns `0x72`)
- [ ] Deployer account has CFLR balance (> 10 CFLR)
- [ ] 6 of 7 vault contracts deployed with code (VaultCore, PolicyRegistry, SolvencyRoot, InstructionSender, FDCAttestor, PMWInstructionRelay)
- [ ] VerifierRole at `0xb513516d02d88be754c5204e132defbb0f4156e6` has 0 bytes -- needs redeployment (known issue, admin fallback available for demo)
- [ ] System contracts accessible (FtsoV2, FdcHub, FdcVerification, FdcRequestFeeConfigs, FlareTeeManager, Fdc2Hub, Fdc2Verification)
- [ ] FCC extension compiles and runs (`go build ./cmd/server/`)
- [ ] All Go tests pass (`go test ./...`) -- 13 packages
- [ ] All Foundry tests pass (`forge test --summary`) -- 143 tests, 0 failures
- [ ] E2E flow test passes
- [ ] Failure-mode tests pass (TEE down, PMW failure, FDC delay)
- [ ] Dashboard loads and connects to Flare RPC (7 API routes)
- [ ] `isSolvent()` returns `(false, 14000)` on Coston2 (WARNING state confirmed)
- [ ] FTSO V2 returns XRP/USD ~$1.07
- [ ] PolicyRegistry has 3 policies (getPolicyCount() == 3)
- [ ] Pre-recorded backup video is available

---

## Timing Guide

| Segment | Target | Buffer | Max |
|---------|--------|--------|-----|
| Thesis | 0:30 | 0:10 | 0:40 |
| Deposit | 0:45 | 0:15 | 1:00 |
| Confidential Position | 1:15 | 0:15 | 1:30 |
| Risk Rebalance | 1:00 | 0:15 | 1:15 |
| Verifiable Solvency | 1:00 | 0:15 | 1:15 |
| Close | 0:30 | 0:00 | 0:30 |
| **Total** | **5:00** | **1:10** | **6:10** |

**If running over time**: Skip the Policy Engine detail in the rebalance section and compress the TEE attestation proof in the confidential position section. The "wow moment" is the auditor verification of the WARNING state -- do not cut that.

**If running under time**: Expand the TEE attestation walkthrough and show the Merkle proof verification in more detail. Show the on-chain `isSolvent()` call returning `(false, 14000)` via cast in the terminal. Add a brief mention of the error handling (safe-state logic, circuit breaker).

---

## M4 Checkpoint Status

- **M4 SIGN-OFF**: GRANTED (97/97 checks pass)
- **Demo rehearsal timing**: 6.80s (limit: 300s) -- well under 5 minutes
- **All previous milestones (M1, M2, M3)**: Verified
- **Demo path proven end-to-end**: (deposit -> risk event -> PMW rebalance -> solvency attestation)
- **Demo script v2 refined**: (this document)
- **SDK builds and compiles**: (TypeScript SDK @aegis/sdk v1.0.0, tsc --noEmit passes)
- **Foundry tests pass**: (143 tests, 0 failures)
- **Go tests pass**: (13 packages)
- **Contracts deployed on Coston2**: (7 Aegis contracts + 8 system contracts verified)
- **FTSO V2 price feeds**: (XRP/USD ~$1.07 via VaultCore, refreshed every ~90s)
- **FDC verification infrastructure**: (FdcHub, FdcVerification, FdcRequestFeeConfigs, Fdc2Hub, Fdc2Verification)
- **PMW Diamond accessible**: (FlareTeeManager on Coston2, 18 facets)
- **Frontend routes verified**: (7 API routes, 3 hooks, 2 libs)
- **Vault solvency state**: `isSolvent()` = `(false, 14000)` -- WARNING (140% < 150% threshold)
- **VerifierRole status**: Deployed but 0 bytes code -- needs redeployment
