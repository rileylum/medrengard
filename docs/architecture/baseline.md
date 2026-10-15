# Architecture baseline

Status: source-derived summary; implementation choices remain subject to approval.
Source: architecture and implementation plan v0.3, sections 1–15 and appendices A–C. Consult the original for full details; this summary does not supersede it.

## Problem and desired outcome

The source reports three largely successful coding streams whose orchestration requires repeated human stage advancement. That is source-reported context, not a measurement made in this repository.

The intended improvement is to concentrate owner attention on discovery/design and demonstrated outcomes, while a durable deterministic controller advances approved work through implementation and independent verification. The controller is not another supervisory LLM.

Initial users: the owner/operator and agents implementing and reviewing bounded work. Enterprise operators are a later validation context; their permissions and runtime support are not yet established.

First measurable automated outcome: one eligible READY issue reaches a reviewable PR without manual stage kicking, including a safe, recoverable failure path. Baseline timing, interruption counts and throughput have not yet been measured.

## Source-decided boundaries

| Capability | Owns | Must not do |
| --- | --- | --- |
| Design Studio | Problem discovery, exploration, approved specifications, decomposition | Silently change approved intent or schedule workers |
| Factory | Lifecycle, queue, leases, dispatch, independent verification, budgets, recovery | Reinterpret acceptance criteria or delegate transition authority to agents |
| Review Desk | Evidence presentation and explicit owner disposition | Infer human acceptance from green tests |
| Continuous Improvement | Evidence analysis and proposed preventive work | Autonomously change skills, policy, permissions or evaluation rules |

These are conceptual capabilities, not four required applications.

- Runtime, model and worker role are independent dimensions. Domain models must be vendor-neutral.
- Target resource pools: three developers, two or three standard reviewers, at most one concurrent adversarial reviewer. These are maximum concurrency, not permanent teams.
- Source v0.3 limits a delivery cycle to two standard-review attempts and one adversarial attempt. A-008/D-010 supersedes these numerical product ceilings with owner-approved, cycle-pinned configuration and bounded correction; the manual bootstrap retains its explicit 2+1 authorisations. Terminal failure still escalates.
- Final PR acceptance, substantive intent changes and governing-rule changes require explicit human approval.
- Personal and corporate execution domains must keep credentials, repositories, state, logs and artifacts separate.
- Full SDLC is in scope, proportionate to risk; automatic production deployment is not in the initial release.

## Technical direction

Owner-approved in A-001 (2026-10-15): TypeScript core, SQLite persistence, Pi and Claude Code as initial runtime targets, and local execution. Runtime capabilities remain to be validated.

Other source proposals: GitHub Issues/PRs as human-facing records; isolated Git worktrees; machine-readable results and commit-bound evidence; portable skills and Git-backed knowledge; search before embeddings; PR-based review before a custom dashboard.

Target authority split: GitHub holds human-visible work and approval history; the controller database holds operational state, leases, attempts, counters and reconciliation. Webhooks wake reconciliation; labels are not locks. During bootstrap, local work records stand in for those systems and are explicitly not a durable concurrent controller. A-008/D-011 selects a local CLI over structured authenticated controller commands as the initial owner handoff, before GitHub/UI integrations. Design Studio output or an LLM interpretation is not execution authority; READY is derived by the controller.

## Required contracts and invariants

1. **Specification:** intent, scope, behaviour, architecture, decisions, risks, discovery/design evidence, quality/release expectations and approval version.
2. **Ready ticket:** goal, observable Done when checks, constraints, context, non-goals, dependencies, risk/approvals, verification, design evidence or justified N/A, outcome signal, quality profile and release impact.
3. **Worker result:** identity, role/runtime/model, outcome, commit, artifacts, checks and blockers. A completion claim is not proof.
4. **Review:** fresh context, exact reviewed SHA, structured findings, reproducible evidence and PASS/FAIL. Findings retain confirmed/rejected/duplicate/uncertain dispositions.
5. **Acceptance package:** criterion-to-evidence matrix, independent quality evidence, review history, demonstration, residual risks, walkthrough and release handoff.
6. **Release:** separately permissioned post-merge states, immutable candidate, readiness, staging where configured, explicit production authority, smoke checks and recovery evidence.

The controller must enforce atomic guarded transitions, idempotency and state-version checks. Invalid/missing results, stale evidence, duplicate events or idle processes cannot advance work. Retry/cancellation/lease recovery must not allow duplicate writers or reset quality budgets.

Risk tailoring considers ambiguity, UX impact, technical uncertainty, security/data sensitivity, blast radius and reversibility—not code size. Relevant UI work requires approved UX evidence; risky technical work may require a spike. Irrelevant activities get a rationale, not fabricated evidence. Missing mandatory checks are FAILED, BLOCKED or explicitly HUMAN-WAIVED, never inferred PASS.

## Non-goals and deferred work

No new agent runtime, shared credential service, unrestricted merges, automatic production deployment, large cross-repository scheduler, general semantic-memory service or autonomous governance changes. No custom dashboard or vector database without demonstrated need.

## Important unresolved semantics

The source does not fully specify handling of stale reviews after a passing attempt, infrastructure retry ceilings, human-authorised cycle resets, waiver authority or release ownership. These must be resolved through design examples and explicit decisions, not hidden in implementation defaults. See `docs/decisions.md`.
