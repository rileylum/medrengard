# Manual bootstrap operating procedure

Status: bootstrap approach accepted by owner approval A-001 (2026-10-15). It applies the v0.3 methodology while the controller does not exist. Detailed policies explicitly marked proposed or pending remain unresolved; accepting the approach does not approve future specifications.

A-008 authorises drafting configurable product policy in lifecycle v0.2. It does NOT apply those proposed correction/retry loops to this manual procedure: each design revision still has its explicitly authorised 2+1 cap, adversarial FAIL stops, and infrastructure failure requires owner guidance. No worker may use the policy under design to extend its own review.

## Authority during bootstrap

The human operator performs scheduling and authorises stage changes; agents perform bounded reasoning, implementation and review. Local versioned work records temporarily replace Issues/PR metadata and the execution ledger. This is intentionally manual and single-work-item-first, not a claim of automation or crash-safe concurrency.

Use one active implementation item initially. Do not start parallel writers until Git isolation and ownership are established. Do not activate the factory against its own governing files unattended; manual authority remains until an explicitly approved cutover.

## One delivery cycle

1. **Intake and tailoring.** Record problem, intended outcome, evidence versus assumptions, risk dimensions and route (Fast/Routine/Design). Note why mockups, prototypes or spikes are required or unnecessary.
2. **Design where needed.** Draft a versioned spec with alternatives and unresolved questions. Obtain explicit owner approval of the exact version before declaring dependent implementation READY. Drafting is allowed without approval; implementing unapproved material design is not.
3. **Prepare the contract.** Use `docs/templates.md`. Map every Done when criterion to a credible independent check. Record dependencies, quality/release obligations and blockers. Classify readiness as READY, NEEDS_REFINEMENT or NEEDS_DESIGN_APPROVAL.
4. **Claim and implement.** Record actor, cycle, branch/worktree, base SHA, approved spec and policy version. One writer per branch. Implement only the contract, run self-checks, commit, and provide results with honest blockers. Material scope/architecture changes return to design.
5. **Verify independently.** Check the actual commit, required artifacts and executable results. A successful exit, session idle state or developer assertion is insufficient. Until CI exists, record who independently reran checks and in which environment; do not describe that as CI.
6. **Standard review.** Use a fresh context with the contract, diff, SHA, repository instructions and independent evidence—not the implementation transcript. Record one completed PASS/FAIL verdict and findings. First FAIL permits a bounded fix and second standard review; second FAIL stops and escalates. A PASS proceeds to adversarial review.
7. **Adversarial review.** Proposed initial policy: every change gets one independent adversarial attempt after standard PASS. Challenge acceptance, negative cases, security/data edges and assumptions. FAIL stops immediately; no automatic fix/re-review loop.
8. **Human acceptance.** Assemble the evidence package and walkthrough. Owner approves, requests changes or rejects/rethinks. No approval is inferred. A revision must name its scope and any explicitly authorised new cycle/budget; until reset semantics are agreed, stop for a decision.
9. **Release and learn.** Separately record merge/release disposition, environment and candidate, applicable smoke/recovery evidence, authority and outcome observation. Documentation-only work can state no deployable artifact and explain why deployment checks are N/A. Record friction and confirmed defects as proposed preventive work, not automatic policy edits.

## Review and recovery bookkeeping

- A cycle begins with counters standard `0/2`, adversarial `0/1`. Preserve attempts and findings, including failures, permanently in the work history.
- A completed valid quality verdict consumes an attempt. Failed launches, crashes and malformed results are separate infrastructure events; do not call them PASS or silently retry forever.
- Pending approval of retry ceilings: stop for operator guidance after an infrastructure failure rather than inventing an unlimited retry policy.
- New head/base changes invalidate affected evidence. Reverification is required; it does not erase consumed review attempts. If the remaining budget cannot cover valid gates, escalate.
- Reviewers may demand more evidence but cannot waive required checks. A waiver must identify human authority, reason, exact check, scope and residual risk.
- Policy/security changes require explicit owner approval and a baseline regression evaluation. During docs-only bootstrap, manual scenario walkthroughs may be proposed as the baseline; label them honestly, and do not claim an executable regression suite exists.

## Session startup and handoff

Read `AGENTS.md`, `docs/STATUS.md`, decisions and the active contract. Check the working tree and existing work before editing. Choose the smallest authorised next step; if the next action needs a decision, prepare that decision rather than guessing.

At session end record:

- Work ID, cycle, current stage and approval status.
- Files/commits changed; actual commands/checks and results; evidence locations.
- Standard/adversarial counters and any infrastructure events.
- Open findings, blockers and decisions needed from the owner.
- Exactly one suggested next action, with prerequisite context.

Update `docs/STATUS.md` as the current index; keep detailed historical evidence in the work record. Session summaries alone are not approvals or test evidence.
