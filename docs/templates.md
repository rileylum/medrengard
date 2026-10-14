# Lightweight work and evidence templates

Status: PROPOSED manual contracts, not final machine schemas. Use only relevant detail; mandatory fields may use a reasoned N/A, never a fabricated PASS. Split records into files when useful.

## Specification

- ID / version / status: DRAFT or APPROVED; owner; actual approval reference.
- Problem, users, current workflow; observed evidence versus assumptions.
- Intended outcome and measurable success signal.
- In scope / out of scope; examples and acceptance themes.
- Behaviour, interfaces and nonfunctional constraints.
- Architecture options, trade-offs, recommended and rejected choices.
- Risk dimensions: ambiguity, UX, technical uncertainty, security/data, blast radius, reversibility.
- Design validation: mockup/prototype/spike links and feedback, or justified N/A.
- Quality and release expectations; recovery and observation plan.
- Open questions, delivery decomposition and dependencies.

## Work contract

- ID / title / version / cycle / stage / readiness.
- Goal and rationale.
- Context: exact spec version, approval reference, decisions, repository instructions.
- Done when: numbered observable criteria, each with verification method and evidence location.
- Constraints and non-goals.
- Dependencies and blockers.
- Risk/route and required approvals.
- Design evidence or explicit N/A reason.
- Quality profile: required unit/integration/E2E/visual/a11y/security/performance checks as applicable; commands or manual procedures; independent verifier.
- Release impact: config, migrations, rollout, rollback, monitoring or justified N/A.
- Outcome signal, observation owner/method/window.
- Claim: actor, branch/worktree, base/head SHA, policy version.
- Budget: standard completed / 2; adversarial completed / 1; separate infrastructure events.
- History: append stage changes, evidence, findings, owner decisions and next action.

## Implementation and verification result

- Work/version/cycle/run identity; role, runtime/model and relevant skill/policy versions.
- Outcome: completed / blocked / failed; exact commit and base.
- Summary, changed files, deviations and blockers.
- Checks actually executed: command/procedure, verifier, environment, time, SHA, exit/result and artifact path.
- Required missing checks: FAILED / BLOCKED / HUMAN-WAIVED with authority and reason where applicable.
- Artifact provenance and independent verification status. The worker's statement is a claim, not verified evidence.

## Independent review record

- Work/cycle; standard or adversarial; attempt ID; reviewer/runtime/model; policy version.
- Reviewed head/base SHA and exact contract version; fresh-context inputs.
- Checks independently executed or inspected and evidence paths.
- Verdict: PASS / FAIL; invalid/incomplete execution is an infrastructure event, not a quality verdict.
- Findings: ID, category/severity, file/line or criterion, reproducible evidence, disposition (confirmed/rejected/duplicate/uncertain), resolution/fix link and prevention hypothesis.
- Counters after the completed verdict; permitted next action or escalation.

## Human acceptance / escalation package

- Outcome and approved scope; commit, issue/spec version, PR or local review location.
- Acceptance matrix: each criterion → evidence → result → residual uncertainty.
- Required quality results, missing/waived checks and provenance.
- Review history/counters and finding dispositions.
- Demo or reproducible walkthrough; design comparison or justified N/A; distinguish real-user feedback from simulation.
- Risks, deviations, critical files and decisions needed.
- Release/recovery handoff.
- Explicit owner disposition and reference. For override/new cycle: original failure, rationale, exact authorised scope/budget and verification obligations.

## Release / outcome record

- Accepted/merged commit and immutable candidate/artifact; linked work.
- Release readiness: checks, configuration/migrations, compatibility, risks and approvals.
- Staging evidence or applicable exception; production authority, operator and procedure.
- Deployment environment/version/time; smoke and monitoring results.
- Rollback/forward-recovery procedure, triggers and responsible operator.
- Outcome signal, actual observations and window; unavailable data clearly marked.
- Incident or improvement links. Release failure does not reset delivery review budgets.

## Session handoff

- Work/cycle/stage; approval status and counters.
- Changes and exact checks/results; commit or explicit uncommitted status.
- Decisions made with authority; unresolved blockers and findings.
- One next action and files to read.
