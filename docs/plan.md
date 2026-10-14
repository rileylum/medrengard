# Implementation plan

Status: bootstrap approach and opening sequence accepted in A-001 (2026-10-15); later milestones remain planning targets, not blanket authorisation to implement. Stack: TypeScript + SQLite. Initial runtime targets: Pi and Claude Code. Hosting: local.

## Strategy

Build the factory through its own contracts and manual gates, then automate one responsibility at a time. Preserve manual recovery and human authority until each automated replacement has been demonstrated. Prefer vertical slices over building all subsystems in isolation.

The source roadmap remains the target. This plan narrows its opening work: contract semantics and fake-runtime scenarios first, then real-runtime feasibility and a durable end-to-end slice. It does not defer bounded review or safety until after unattended operation.

## Milestones and exit evidence

| Milestone | Scope | Exit evidence / dependencies |
| --- | --- | --- |
| B0 — Bootstrap steering | Source reading, knowledge map, manual procedure, decision register, initial contract | Owner reviews this packet; outstanding choices remain explicit. No runtime claims. |
| M0 — Contracts and SDLC baseline | Approved state-machine spec, ticket/result/review/evidence/release contracts, tailored quality profiles and representative fixtures | Trivial docs, UI and high-risk work have defensible routes and gates. Success/failure/stale/duplicate/retry scenarios have expected outcomes. Owner accepts exact spec version. |
| M1 — Fake runtime and portability seam | Minimal project setup after stack approval; adapter interface, fake adapter, eligibility/cancellation/result contract tests; real backend feasibility spikes | Fake passes contract suite; same bounded task demonstrated across two permitted real backends. Do not assume any vendor's capabilities. Corporate proof only in an authorised environment. |
| M2 — One durable end-to-end slice | One repository, one developer slot, GitHub integration, worktree, durable transitions/leases, independent checks, standard and adversarial gates, evidence package | READY → human-reviewable PR without stage kicking; first standard failure/fix, terminal failures, restart, duplicate input and changed SHA demonstrated safely. No auto-merge/deploy. |
| M3 — Design Studio workflow | Discovery, versioned approval, conditional mockup/prototype/spike support, decomposition | Approved interaction design produces linked ready tickets; trivial path stays lightweight. |
| M4 — QA and Review Desk depth | Broader risk profiles, design comparison, visual/a11y/security/performance evidence as applicable, UAT and PR package | User-facing change demonstrates design conformance, executable checks and hands-on acceptance; mandatory checks cannot be replaced by review PASS. |
| M5 — Scheduling pools | Three dev slots, 2–3 standard review slots, one adversarial slot, dependencies and backpressure | Isolation, single-writer safety, fairness, duplicate dispatch prevention and stale evidence tested under concurrency. |
| M6 — Release tracking | Separate release state machine, readiness/staging/smoke/recovery records and permissions | One accepted change has traceable release and verification evidence; no unauthorised production action. |
| M7 — Improvement feedback | Structured findings, repository health, recurring-defect proposals, outcome observations and evaluation set | Confirmed problems yield bounded preventive tickets; policy proposals require evaluation and approval. |
| M8 — Hardening and portability | Operational controls, pause/cancel/quarantine/shutdown, observability, cost/retry ceilings, recovery and operator docs | Sustained personal deployment and separately authorised corporate validation, without data leakage. |

Safety invariants, structured findings, release-impact fields and approval records start at M0; later milestones expand automation rather than introduce those obligations for the first time. Stop/cancel and safe failure are prerequisites for unattended execution, not optional M8 polish.

## Opening backlog

Only the bootstrap has been carried out. The following are proposed bounded work units, not READY tickets:

| ID | Outcome | Depends on |
| --- | --- | --- |
| BOOT-001 | Read source and establish session steering packet | Approach accepted in A-001; independent reviews not performed |
| SF-001 | Specify delivery-cycle semantics and evidence boundaries with worked scenarios | Owner confirms bootstrap approach; see drafted work contract |
| SF-002 | Define versioned contracts and trivial/UI/high-risk fixtures with quality/release tailoring | Approved SF-001 specification and agreed quality defaults |
| SF-003 | Establish minimal project/check setup and executable contract validation | Stack/toolchain approval; SF-002 |
| SF-004 | Fake adapter demonstrates normal, malformed, timeout, cancellation and duplicate-result paths | SF-003 and approved adapter semantics |
| SF-005 | Prove a first real runtime integration in an isolated test repository | Runtime/environment permission and SF-004 |
| SF-006 | Prove a second backend against the same task/contract suite | SF-005 lessons; separately approved backend |
| SF-007 | Specify and implement a narrow durable transition/claim/recovery slice | Persistence choice, fixtures, fake adapter; decompose after design |

Do not treat SF-007 as one large implementation PR: its design must produce small tickets for transactions, idempotency, leases and recovery. GitHub, workspace and complete review-loop integration follow as separately contracted slices toward M2.

## Acceptance coverage to preserve

The executable suite should eventually cover every source Appendix B scenario. Initial scenario design must include:

- Happy path; standard FAIL → fix → PASS; second standard FAIL; adversarial FAIL.
- Missing/malformed artifacts, zero exit without evidence and unsupported completion claims.
- Restart, duplicate event/result, stale lease and prevention of duplicate writers/counters.
- Changed head/base and stale verdicts; no automatic budget reset.
- Scope/policy injection; forbidden runtime/log sink; permissioned cancellation.
- Required UX approval versus justified N/A; missing mandatory risk checks; independent evidence.
- Finding persistence/disposition; human-authorised improvements and evaluation.
- Reviewable walkthrough; separate release approval; no unauthorised deploy; product outcome distinct from deployment success.

## Measuring the bootstrap

Collect observed stage waits, manual interventions, review attempts, confirmed defects and handoff problems per work item. Do not invent a productivity baseline. After a few completed items, propose which repeated manual step is worth automating next. The first cutover requires owner approval backed by M2 evidence; the factory's own governing files remain protected by human review.
