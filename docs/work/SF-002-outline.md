# SF-002 — Proposed contract and fixture decomposition

Status: planning outline, **not READY**, no implementation authorised. Depends on explicit approval of the [SF-001 specification](../specs/delivery-lifecycle-v0.1.md), its Q1–Q4 choices and applicable quality-profile defaults (O-005). Child IDs below are reserved planning IDs, not completed contracts.

Keep each slice independently reviewable. TypeScript is accepted; package manager, schema validator and test runner remain to be selected before executable setup (SF-003). Do not introduce a database or runtime integration merely to specify a contract.

| Proposed slice | Bounded outcome and non-goals | Dependencies | Observable acceptance / evidence |
| --- | --- | --- | --- |
| SF-002A — Work readiness | Versioned spec/ticket/approval/profile fields with trivial-docs, UI and high-risk examples; no dispatch code | SF-001 approval; owner QA defaults and waiver policy | Each field has meaning; examples show READY vs missing design approval/missing required checks. Fixtures cover SC-09–13 and justified N/A; every Done when maps to a verifier |
| SF-002B — Execution and evidence | Vendor-neutral request/result/candidate/evidence contracts; no vendor SDK assumptions | SF-002A identity/context definitions | Valid development result plus absent artifacts, mismatched SHA, invalid provenance, FAILED/BLOCKED/HUMAN-WAIVED examples. Consumers can distinguish claims from verified checks (SC-07–08, 11–12, 30) |
| SF-002C — Cycles, review and decisions | Logical attempt/run/reservation, findings, verdict and revision decision shapes; no database implementation | SF-002B; Q1/Q2 approval | Happy path and failure/revision/stale-result fixtures specify counters, scope, authority and forbidden effects (SC-01–06, 14, 16–18). No reset field on worker results |
| SF-002D — Recovery event fixtures | Versioned command/event/launch-intent/lease and recovery observations; no process launcher | SF-002B/C; Q3 approval | Duplicate, rollback, ambiguous launch, lease expiry and cancellation fixtures identify idempotency keys and expected quarantine vs retry (SC-20–30). Include negative dispatch assertions |
| SF-002E — Acceptance and release handoff | Review package and separate release/outcome record; no merge/deploy adapter | SF-002A/C; Q4 and applicable release policy | Criterion matrix, walkthrough and actual merge lineage demonstrated; rejected deploy and failed smoke/outcome fixtures preserve review counters (SC-15, 19, 31–35) |

For each child, create a complete work contract before execution: risk, exact approved context, required checks, review budget, release impact, claim and evidence location. Proposed quality for these contract-only changes: schema/example consistency checks once tooling exists, negative fixtures, independent standard and adversarial review. Until then label manual checks accurately. No fabricated runtime or CI evidence.

SF-003 should then establish only enough tooling to validate these contracts and fixtures reproducibly. SF-004's fake adapter uses them before Pi or Claude Code integrations are attempted. SF-007 recovery implementation must turn the failure fixtures into transaction/process tests; a valid schema is not proof of safe execution.
