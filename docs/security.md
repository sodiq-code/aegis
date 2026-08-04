# Security

## Threat Model

| Threat Vector | Impact | Mitigation | Residual Risk |
|---|---|---|---|
| Smart contract exploit | Loss of deposited funds | OpenZeppelin libs, Foundry fuzz tests, internal review, timelocked multisig | Medium (pre-audit) |
| TEE compromise | Position disclosure or false attestation | FCC attestation, deterministic logic, frequent key rotation | Low (TEE model is mature) |
| AI agent misbehaviour | Excessive rebalancing; losses | Deterministic Policy Engine, on-chain policy constraints, fail-safe | Low |
| PMW key compromise | Unauthorised cross-chain tx | TEE key custody, data-provider consensus signers | Low |
| FDC attestation delay | Stale position state | Safe-state logic; cached attestations; fallback to last-known-good | Low |
| Frontend compromise | XSS, supply chain, DNS hijack | CSP/HSTS, SRI, wallet-based auth (no custodial keys), signed releases | Low |
| Economic attack | Manipulation of FTSO or vault markets | FTSO is enshrined and economically secured; multi-source risk inputs; policy bounds | Low |
| Governance attack | Malicious multisig signer | Timelocked upgrades; multisig threshold; public governance forum | Low |
| Access control contract deployment failure | Role-based functions inaccessible; deposits blocked for non-admin users | Deployment verification checklist checks code size at each address; redeploy immediately if 0 bytes; admin fallback path for demo; VaultCore config can be updated with new VerifierRole address | Medium (currently affecting VerifierRole on Coston2) |

## Deployment Failure Threat (VerifierRole)

The VerifierRole contract at `0xb513516d02d88be754c5204e132defbb0f4156e6` on Coston2 is deployed with 0 bytes of code. This is a real deployment failure that affects the system's access control layer. The specific impacts are:

1. **Deposit blocking**: The `depositFXRP()` function in VaultCore requires VerifierRole verification for non-admin callers. With VerifierRole having no code, any call that references VerifierRole will revert. This means only admin-path deposits work.

2. **PMWInstructionRelay access control**: The `onlyVerifier` modifier in PMWInstructionRelay calls `verifierRole.hasRole()`. With no code at the VerifierRole address, all PMW actions are blocked for non-admin callers.

3. **Auditor verification**: Functions that require the verifier role for auditor operations cannot be called. Auditors cannot register or verify TEE identities.

**Mitigation steps**:
- Redeploy VerifierRole with the correct constructor arguments
- Update the VaultConfig in VaultCore with the new VerifierRole address
- Update the PMWInstructionRelay constructor reference
- Run the deployment verification checklist (`cast codesize` for each address) to confirm all contracts have non-zero code
- Add the code-size check to the CI/CD pipeline to prevent silent deployment failures in the future

**Root cause analysis**: The deployment transaction was submitted and the address was recorded, but the constructor either did not execute or the bytecode was empty. This can happen if the deployment script records the expected address before the transaction confirms, or if the constructor reverts silently (e.g., due to a require failure in a dependency address).

**Prevention**: The deployment verification checklist now includes a code-size check for every deployed contract. Any contract with 0 bytes at its expected address triggers an immediate alert. Future deployments should use `forge script --verify` to confirm code deployment before recording addresses.

## Compliance Considerations

Aegis is positioned as decentralised infrastructure, not as a regulated financial entity. KYC/AML obligations attach to the integrating custodian, not to Aegis itself. FDC's AddressValidity attestation type supports the compliance workflow by allowing the vault to refuse deposits from non-verified addresses. The auditor verification flow supports periodic regulatory reporting without compromising confidentiality. Legal counsel should review the specific jurisdictional classification before Mainnet launch.

## Solvency Monitoring

The system continuously monitors solvency via the `isSolvent()` function on SolvencyRoot. The current on-chain state is:

- `isSolvent()` returns `(false, 14000)` -- collateral ratio is 140% (14,000 basis points)
- Minimum threshold is 150% (15,000 basis points)
- The vault is in **WARNING** state: the ratio is below threshold but above the critical level (120%)
- At 120% or below, the vault enters **CRITICAL** state and triggers emergency mode

If the collateral ratio continues to decline and reaches the critical threshold, the system automatically:
1. Triggers `emergencyExit()` on VaultCore, allowing depositors to withdraw
2. Pauses new deposits via the Policy Engine
3. Notifies the risk agent to initiate deleverage actions
4. Publishes the state change on-chain via SolvencyRoot

The WARNING state is currently the real on-chain state on Coston2. This demonstrates the audit verification flow: an auditor can verify the WARNING condition by calling `isSolvent()` on-chain without seeing any individual position data.

## Responsible Disclosure

If you discover a security vulnerability, please report it privately by opening a GitHub Security Advisory. Do not file public issues for security vulnerabilities.

## Audit Status

- **Current**: Internal review, Foundry fuzz tests (143 tests, 0 failures)
- **Planned**: External audit (target: Trail of Bits or equivalent) prior to Mainnet launch
- **Deployment verification**: Automated verification script reports all checks green; code-size verification identifies VerifierRole deployment issue
