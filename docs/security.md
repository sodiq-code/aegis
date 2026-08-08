# Security

## Threat Model

| Threat Vector | Impact | Mitigation | Residual Risk |
|---|---|---|---|
| Smart contract exploit | Loss of deposited funds | OpenZeppelin libs, Foundry fuzz tests, internal review, timelocked multisig | Low (mitigations in place; external audit pending) |
| TEE compromise | Position disclosure or false attestation | FCC attestation, deterministic logic, frequent key rotation | Low (TEE model is mature) |
| AI agent misbehaviour | Excessive rebalancing; losses | Deterministic Policy Engine, on-chain policy constraints, fail-safe | Low |
| PMW key compromise | Unauthorised cross-chain tx | TEE key custody, data-provider consensus signers | Low |
| FDC attestation delay | Stale position state | Safe-state logic; cached attestations; fallback to last-known-good | Low |
| Frontend compromise | XSS, supply chain, DNS hijack | CSP/HSTS, SRI, wallet-based auth (no custodial keys), signed releases | Low |
| Economic attack | Manipulation of FTSO or vault markets | FTSO is enshrined and economically secured; multi-source risk inputs; policy bounds | Low |
| Governance attack | Malicious multisig signer | Timelocked upgrades; multisig threshold; public governance forum | Low |

## Deployment Integrity

All seven Aegis contracts are deployed on Coston2 with non-zero runtime code, verified on-chain via `cast codesize` (or `eth_getCode`) for each address. The deployment pipeline enforces a code-size check for every contract immediately after broadcast, and the automated verification script (`scripts/verify-aegis.sh`) fails the build if any contract returns 0 bytes. This guardrail prevents the silent deployment failures that can occur when a deployment script records an expected address before the transaction confirms.

## Compliance Considerations

Aegis is positioned as decentralised infrastructure, not as a regulated financial entity. KYC/AML obligations attach to the integrating custodian, not to Aegis itself. FDC's AddressValidity attestation type supports the compliance workflow by allowing the vault to refuse deposits from non-verified addresses. The auditor verification flow supports periodic regulatory reporting without compromising confidentiality. Legal counsel should review the specific jurisdictional classification before Mainnet launch.

## Solvency Monitoring

The system continuously monitors solvency via the `isSolvent()` function on SolvencyRoot. The current on-chain state is:

- `isSolvent()` returns `(true, 16666)` -- collateral ratio is ~166% (16,666 basis points)
- Minimum threshold is 150% (15,000 basis points)
- The vault is **SOLVENT**: the ratio is above the 150% threshold

If the collateral ratio declines below the 150% threshold, the system automatically:
1. Emits a `SolvencyWarning` event on `SolvencyRoot`
2. Pauses new deposits via the Policy Engine
3. Notifies the risk agent to initiate deleverage actions
4. Publishes the state change on-chain via `SolvencyRoot`

If solvency continues to deteriorate, `triggerEmergencyFromSolvencyBreach()` on `VaultCore` enables `emergencyExit()` so depositors can withdraw. The vault is currently SOLVENT on Coston2 (~166% collateral ratio). An auditor can verify the current solvency state by calling `isSolvent()` on-chain without seeing any individual position data.

## Responsible Disclosure

If you discover a security vulnerability, please report it privately by opening a GitHub Security Advisory. Do not file public issues for security vulnerabilities.

## Audit Status

- **Current**: Internal review, Foundry fuzz tests (360 tests, 0 failures)
- **Planned**: External audit (target: Trail of Bits or equivalent) prior to Mainnet launch
- **Deployment verification**: Automated verification script reports all checks green; every contract has non-zero code on Coston2
