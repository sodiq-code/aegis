# Demo Script

## Five-Minute Live Demo

### 0:00–0:30 — Thesis

"Institutional XRP treasuries are emerging — VivoPower committed USD 100M in June 2025. They need three things no Flare product offers today: confidentiality, verifiable solvency, and autonomous cross-chain risk management. Aegis delivers all three using Flare's newest primitives — FCC, PMW, and FDC — together."

### 0:30–1:15 — Deposit (Layer 1)

Switch to the dashboard. Sign in with the XRPL wallet (Xaman). Sign a single XRPL transaction that mints FXRP via Flare Smart Accounts and deposits into the Aegis vault. Show the FDC attestation confirming the XRPL payment. Show the vault balance updating on-chain.

"One signature, one on-chain deposit, fully attested."

### 1:15–2:30 — Confidential Position (Layer 3)

Open the vault view. Show that the on-chain state shows only the deposit and a Merkle root — not the full position.

"The full position — what we hold, where, and what we owe — is computed inside this TEE."

Show the TEE attestation proof.

"Anyone can verify the TEE ran the correct code; no one can see the positions inside it."

### 2:30–3:30 — Autonomous Risk Rebalance (Layers 3 + 4)

Trigger a simulated market drawdown (or wait for one if timing permits). Show the AI risk agent — running inside the TEE — detect the threshold breach, compute a rebalance action, and issue a PMW instruction. Show the PMW signing flow (data-provider consensus) and the resulting XRPL transaction. Show the FDC attestation of the executed payment. Show the updated solvency root published on-chain.

"An AI agent inside a TEE just autonomously rebalanced a private vault across chains, and every step is verifiable."

### 3:30–4:30 — Verifiable Solvency (Layer 5)

Switch to the auditor view. Request a fresh solvency attestation. Show the TEE computing a proof that assets exceed liabilities by a stated margin, without revealing the underlying amounts. Verify the proof on-chain.

"An auditor can verify this treasury is solvent without ever seeing a single position. That is the confidentiality-to-verifiability transformation — and it is only possible on Flare."

### 4:30–5:00 — Close

"Aegis uses every Flare primitive in a load-bearing way. We have an institutional pilot conversation underway. We will launch on Mainnet within ninety days of the hackathon. The repo, SDK, and documentation are public. This is the reference implementation of the Flare 2.0 thesis — and we would value your questions."

## Contingency Plan

- **Live demo fails**: Switch to pre-recorded video of the same flow, narrated live
- **PMW transaction fails**: Skip the live PMW step, show the pre-recorded PMW execution
- **FDC attestation slow**: Pre-fetch an attestation before the demo and use the cached version
- **TEE attestation fails to verify**: Show the attestation log and offer to walk through the verification step by step in the Q&A
- **Dashboard does not load**: Have the dashboard running locally on a second machine as a hot standby
- **Network issue**: Have the demo video on a USB stick and a mobile hotspot
