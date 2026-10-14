# BOOT-001 — Source review and bootstrap steering

Version: 0.1. Stage: bootstrap direction accepted in A-001; independent reviews not performed.
Authority: user requested reading the source and beginning a plan and session-steering documents. This authorises drafting, not acceptance of new architecture/policy decisions.

## Goal and scope

Translate the source methodology into a usable manual bootstrap and durable starting context for future sessions. No application code, runtime integrations, deployments or external service setup.

## Acceptance matrix

| Criterion | Evidence | Current result |
| --- | --- | --- |
| Read the architecture document, including roadmap and acceptance tests | All 760 non-empty extracted body/table paragraphs read; both embedded architecture images inspected | Author completed; not independent verification |
| Preserve decided/proposed/open distinctions | `docs/architecture/baseline.md`, `docs/decisions.md` | Draft prepared for owner review |
| Define manual execution of the methodology | `docs/manual-workflow.md`, `docs/templates.md` | Proposed, not approved |
| Establish incremental delivery plan and bounded next task | `docs/plan.md`, `docs/work/SF-001.md` | Draft prepared; no implementation ticket declared READY |
| Provide reliable session restart and handoff | `AGENTS.md`, `README.md`, `docs/STATUS.md` | Files created; local links checked in author self-check |

## Tailoring

Route: Design/documentation. Governing-process implications require owner review. No UI or executable artifact: mockups, browser tests, deployment, migrations and runtime benchmarks are N/A. Source fidelity, policy distinctions, navigability and honest approval/evidence status are the relevant checks. The first draft was prepared before a formal bootstrap procedure existed; it has not retrospectively passed that procedure's independent gates.

## Session record

- Inspected the directory: only the source DOCX existed; no `.git`, application or tests.
- Extracted Word XML text with Python standard-library ZIP/XML tools to a temporary file outside the project, preserving paragraph/table order. Read the complete text and inspected both extracted images. No source changes.
- Created the steering packet and initial work records. Source external references were not independently researched; vendor capabilities remain unverified.
- Author self-check: Python local Markdown link-target validation; not a semantic, independent or executable controller test.
- No Git commit/SHA exists. Commit-bound independent review remains pending Git setup and a frozen candidate. No independent standard or adversarial review has been performed.
- Counters: standard 0/2; adversarial 0/1. Infrastructure events: none.
- Owner acceptance: pending. Release impact: documentation only; no deployment.
- Outcome observation: next session should recover the active task and approval boundaries from the packet without relying on this conversation. Ask the owner/next session whether that worked; no observation yet.

## Subsequent owner decision — 2026-10-15

A-001 accepts the manual contracts-first approach, TypeScript + SQLite, Pi and Claude Code as initial targets, and local execution. This resolves the initial direction questions; it does not retroactively supply independent reviews or approve a future lifecycle specification. The session record above preserves the original drafting status.

## Next action

Draft SF-001's lifecycle specification and failure scenarios. Establish Git tracking before commit-bound delivery/review; remote setup and publication require separate agreement.
