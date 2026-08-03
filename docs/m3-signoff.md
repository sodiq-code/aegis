# Aegis — M3 Checkpoint Sign-Off

> **Date**: 2026-08-03T04:19:00Z
> **Milestone**: M3 — Demo Path Proven End-to-End
> **Network**: Coston2 (Flare testnet, chain ID 114)
> **Status**: GRANTED

---

## M3 Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| FCC extension processes deposit flow | PASS | E2E test confirms deposit processing |
| FCC extension processes rebalance flow | PASS | RiskAgent → PolicyEngine → PMW instruction issued |
| FCC extension processes attestation flow | PASS | FDC attestation verified on Coston2 |
| Demo path proven end-to-end | PASS | deposit → risk event → PMW rebalance → solvency attestation |
| Demo script v1 drafted | PASS | docs/demo-script.md complete with all 5 sections |
| All Foundry tests pass | PASS | 143+ tests pass |
| All Go tests pass | PASS | 11+ packages pass |
| Failure-mode tests pass | PASS | TEE down, PMW failure, FDC delay tested |
| Error handling + safe-state logic | PASS | Emergency exit, circuit breaker, fallback paths |
| All contracts deployed on Coston2 | PASS | 7 Aegis contracts + 9 system contracts verified |

---

## M3 Decision

**M3 SIGN-OFF: GRANTED** — All criteria met. Demo path proven end-to-end on Coston2. Demo script v1 complete.
