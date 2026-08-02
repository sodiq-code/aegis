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

## Compliance Considerations

Aegis is positioned as decentralised infrastructure, not as a regulated financial entity. KYC/AML obligations attach to the integrating custodian (e.g., BitGo), not to Aegis itself. FDC's AddressValidity attestation type supports the compliance workflow by allowing the vault to refuse deposits from non-verified addresses. The auditor verification flow supports periodic regulatory reporting without compromising confidentiality. Legal counsel should review the specific jurisdictional classification before Mainnet launch.

## Responsible Disclosure

If you discover a security vulnerability, please report it privately by opening a GitHub Security Advisory. Do not file public issues for security vulnerabilities.

## Audit Status

- **Pre-hackathon**: Internal review, Foundry fuzz tests
- **Post-hackathon**: External audit planned (target: Trail of Bits or equivalent)
