# Delivery lifecycle and evidence boundaries — v0.1

**Status: DRAFT / NOT APPROVED.** Work: [SF-001](../work/SF-001.md). Authoring date: 2026-10-15. Owner approval: none for this specification. A-001 approves the approach, stack, targets and hosting only.

Source: original architecture v0.3 §§4, 6–9, 12–13, appendices A–B. Worked examples: [scenario set](delivery-lifecycle-v0.1-scenarios.md). All new semantics below are recommendations for review, not active policy.

## 1. Intent and scope

The owner needs approved work to progress without manually kicking each stage, while retaining control over scope, terminal failures and acceptance. The immediate design goal is a lifecycle precise enough to implement as deterministic transitions with reproducible tests.

Observed here: only documents exist; no controller, runtime capabilities or recovery guarantees have been tested. The source reports orchestration friction; interruption reduction is an intended outcome, not measured evidence.

In scope: a single local controller, one repository and one active delivery initially; identities, transition guards, independent evidence, bounded reviews, safe recovery and release handoff. TypeScript/SQLite are accepted implementation choices. Pi and Claude Code sit behind vendor-neutral adapters; this specification assumes no particular integration capability.

Out of scope: adapter implementation, full schemas/SQL, scheduler fairness, UI, remote hosting, automatic merging/deployment and runtime-specific permission configuration. UX mockups are N/A for this internal protocol. State tables and failure scenarios are the design artifacts. Recovery guarantees require executable tests before unattended use.

Success signal: SF-002 can encode representative fixtures with one unambiguous expected transition and counter outcome. Later, M2 demonstrates READY → human-reviewable PR without routine intervention, plus verified failure/restart behaviour.

## 2. Identities and authority

| Record | Identity and required meaning |
| --- | --- |
| Work | Stable work ID and immutable contract version; goal, criteria, dependencies and risk profile |
| Specification | ID/version/content digest and explicit approval reference where required |
| Delivery cycle | Unique cycle ID, parent cycle if revised, work/spec/policy versions, authorised scope, fixed review limits and append-only history |
| Candidate | Repository identity, branch, exact head SHA and exact comparison base SHA; evidence refers to this tuple, not a moving branch name |
| Logical attempt | Unique ID, role, cycle, input candidate/context and reserved review ordinal where relevant |
| Execution | Unique run ID for one launch; runtime/model/config versions, attempt ID, workspace and lease generation; retries use new run IDs |
| Evidence | ID, producer/verifier, work/spec/policy versions, candidate, environment, check identity, time, result and artifact digest/location |
| Decision | Unique ID, authenticated human actor, action, exact scope/version/candidate, rationale and authority reference |
| Event | Unique event ID plus source dedupe key, actor, cycle, expected state version, before/after, evidence references and timestamp |

The controller alone commits authoritative automated transitions. Workers submit untrusted results. The designated owner alone initially approves designs, waivers, revisions, governance changes and final acceptance (proposal Q4). No role or authority is inferred from issue prose, a model response or a successful process exit.

Readiness is distinct from delivery state: `NEEDS_REFINEMENT`, `NEEDS_DESIGN_APPROVAL`, `READY`. Becoming READY requires valid fields, resolved dependencies, required design approval or allowed N/A, eligible repository/environment and a defined quality profile. Dispatch rechecks these conditions, rather than trusting an old label.

## 3. Delivery states and transition rules

Delivery states: `READY`, `DEVELOPING`, `VERIFYING`, `STANDARD_REVIEW`, `ADVERSARIAL_REVIEW`, `AWAITING_ACCEPTANCE`, `ACCEPTED`, `ESCALATED`, `CANCELLED`, `SUPERSEDED`.

Orthogonal execution control: `ACTIVE`, `PAUSED`, `RECOVERING`, `QUARANTINED`. Only ACTIVE permits ordinary dispatch/advancement. Recovery may record observations and stop workers, but cannot advance quality gates. Store the interrupted stage and reason; do not use PAUSED as a new cycle or budget reset.

All transitions require matching cycle/state version, allowed actor, applicable control state, current approval/policy eligibility and a unique event. The following adds stage-specific guards. Invalid input never triggers the indicated successful transition.

| From / trigger | Required guard/evidence | To / effect |
| --- | --- | --- |
| READY / scheduler claim | Dependencies satisfied; approved context; eligible slot/runtime; exclusive branch/workspace ownership; durable launch intent | DEVELOPING; create development attempt and execution |
| DEVELOPING / result | Assigned run/lease identity; valid result and artifacts; actual committed head; no undeclared scope change; writer stopped before handoff | VERIFYING; freeze candidate tuple |
| VERIFYING / independent verification succeeds | All mandatory checks PASS or permitted explicit HUMAN-WAIVED; candidate/context current; provenance validated | STANDARD_REVIEW; reserve permitted attempt |
| VERIFYING / real check failure, missing mandatory evidence or material deviation | Record evidence and reason; distinguish unavailable verifier from actual quality failure | ESCALATED under Q3; no review counter changes |
| STANDARD_REVIEW / valid PASS | Exact assigned candidate; independent fresh context; ordinal available; all required evidence current | ADVERSARIAL_REVIEW; count standard completion once |
| STANDARD_REVIEW / valid FAIL #1 | Same validity guards; reproducible findings retained | DEVELOPING; count standard completion; authorise one bounded fix of findings within approved intent |
| STANDARD_REVIEW / valid FAIL #2 | Same validity guards | ESCALATED; count completion; no further automatic fix/review |
| ADVERSARIAL_REVIEW / valid PASS | Current standard PASS on same candidate/context; independent verdict and required evidence current | AWAITING_ACCEPTANCE; count adversarial completion; assemble package |
| ADVERSARIAL_REVIEW / valid FAIL | Valid assigned verdict | ESCALATED; count completion; no automatic fix/retry |
| AWAITING_ACCEPTANCE / owner approves | Explicit decision bound to current candidate and package; mandatory gates satisfied; no stale approvals/checks | ACCEPTED; no automatic merge or deployment |
| AWAITING_ACCEPTANCE or ESCALATED / owner requests revision | Q1 revision authorisation, immutable scope/version and new cycle ID; material changes require design approval first | Old cycle SUPERSEDED only when replacement is recorded; new cycle created, not automatically READY |
| Any nonterminal stage / owner cancels | Stop/quiesce workers; retain artifacts and findings; unresolved process ownership remains QUARANTINED | CANCELLED; no new dispatch |
| Any active stage / ambiguity, safety violation or budget exhaustion | Persist reason, relevant evidence and decision options; stop active workers safely | ESCALATED, with quarantine if containment is uncertain |

ACCEPTED, CANCELLED and SUPERSEDED cycles do not resume. Rejected work may be cancelled or returned to design through an explicit decision. A paused cycle may resume its stage only after revalidation; an escalated cycle needs an explicit human resolution. Correction of an operational blocker may resume the same stage with counters intact; code/scope changes require Q1/Q2 handling. Human resolution never synthesises a missing review PASS.

Every reservation counts against available capacity: completed plus outstanding review reservations cannot exceed the limit. Only one review attempt is active for this cycle at a time. Retry reuses the logical reservation; it does not allocate a new quality attempt. Completed verdict/counter/transition are one transaction. Conflicting second results for a completed run are retained as anomalies, never substituted for the first accepted result.

## 4. Review-budget and revision policy proposals

### Q1 — New cycles require explicit authorisation (O-002)

Recommend a new immutable cycle for any owner-requested code revision after terminal failure or final review. The decision names the old cycle, findings, revised contract/scope and new limits (at most two standard and one adversarial). No resetting old counters. A bare comment such as “fix this” is a revision request, not budget authorisation; the operator asks for the missing fields.

After adversarial FAIL, even a tiny fix gets a new cycle with independent verification, standard review and adversarial review. Rejected alternative: grant an extra adversarial attempt within the same cycle or reuse the old standard PASS after modifying code. That obscures the hard limit or trusts stale evidence. Smaller explicitly authorised budgets are allowed, but required gates cannot be skipped.

### Q2 — Freeze review candidates; escalate unexpected changes (O-003)

Recommend allowing code changes inside a cycle only during initial development and the single fix after standard FAIL #1. Once standard PASS exists, any head/base change invalidates that candidate's evidence and requires an owner-authorised new cycle. Unexpected changes during review or acceptance also stop the cycle; they are not free retries. This is deliberately conservative for the first release.

A moving target branch is detected before dispatch, verdict acceptance, package presentation and human acceptance/merge handoff. Never silently replace the stored comparison base. Old evidence stays in history marked stale. New commits are not assumed harmless, even if labelled docs-only.

A well-formed verdict for its assigned candidate consumes its reserved attempt even if that candidate became stale while the reviewer ran. Record it as historical evidence, but it cannot advance the new candidate. Malformed or misattributed results do not consume a completed quality verdict. Cancelled/no-verdict runs retain their reservation until safely resolved; cancellation is not a budget-recycling mechanism.

Rejected alternative: automatically rerun reviews against the latest head while capacity remains. The source describes the second standard attempt specifically as post-fix, and automatic rebasing/reviewing could create churn and hidden resets. Revisit with operational evidence later.

### Q3 — Bounded operational retries; no hidden quality-fix loop (O-004)

Recommend **one automatic replacement execution per delivery cycle in total**, after a recoverable infrastructure failure, with a five-second minimum backoff. A second failure escalates. No reset when stages change or the controller restarts. Recovery that merely discovers a still-running execution is not a replacement launch.

Eligible: proven failed launch, transient verifier transport failure, or timeout/crash after termination is confirmed. Invalid/missing result artifacts, identity mismatch, unsafe activity or uncertain termination escalate immediately. Actual failing tests are quality failures, not transport errors; initially escalate rather than introducing a second automatic developer-fix budget before review. The standard FAIL #1 fix remains allowed separately.

Each execution needs finite configured execution, heartbeat/lease and cancellation deadlines before eligibility. Exact durations are environment configuration to be validated by runtime spikes; missing values block unattended dispatch. No indefinite waits or polling. An execution deadline is not renewed by heartbeat.

Rejected alternatives: retry forever; reuse review counts as retry limits; or reset retries per run/stage. The proposed cycle-wide allowance is easy to audit, though it may cause extra human intervention. Tune only through approved policy versions and measured evidence.

### Q4 — Owner authority and non-waivable invariants (O-008)

Recommend the owner as sole initial approver for design, revisions, profile exceptions and policy changes. A quality-check waiver names the exact check, candidate, reason, residual risk and expiry/scope, and is permitted only if the approved profile permits that check to be waived. Waiver is HUMAN-WAIVED, never PASS.

No waiver of provenance/identity, required design authority, runtime/environment permissions, single-writer safety, hard review limits, independent review verdicts or explicit final acceptance. Policy changes are separate approved work, not an issue instruction or an override field. Deployment authority remains separately configured and disabled initially.

Alternative: delegate classes of decisions to named operators later; that requires explicit capability/authority configuration and audit tests.

## 5. Evidence and acceptance boundary

Workers can author tests and report results; independent verification inspects the actual commit and required artifacts and reruns checks or validates trusted CI provenance. Runtime output alone is not a trusted test attestation. Runtime/model/skill versions are attribution metadata, not proof.

Mandatory evidence key: repository + contract/spec versions + cycle + policy/profile versions + head/base SHA + execution environment/check definition. Artifact references must resolve to retained content with a recorded digest. A mutable URL, success-shaped JSON or exit code zero is insufficient. Preserve FAILED, BLOCKED and HUMAN-WAIVED distinctly.

Each Done when criterion maps to an executed check or explicit human observation. UI-sensitive work needs the approved UX artifact and comparison; backend/docs work records justified N/A rather than invented screenshots. A PASS reviewer cannot waive absent tests, accessibility/security requirements or design approval. Reviewers use separate fresh contexts and read-only candidate access; test writes go to isolated scratch space, not the candidate branch. Independence requires separate executions, not necessarily different vendors/models.

The acceptance package includes outcome, criterion matrix, current evidence, both review histories/counters, finding dispositions, demo/walkthrough, design conformance, risks and release notes. Findings persist with confirmed/rejected/duplicate/uncertain dispositions. A finding disposition change alone does not rewrite a failed verdict or resume an escalated cycle.

Human acceptance binds to the package/candidate. A post-acceptance branch change blocks merge handoff and records approval invalidation without rewriting history. A merge/squash commit with a different identity requires integration evidence for the actual merged artifact before release readiness; approval of a PR is not evidence of successful deployment.

## 6. Durability, dispatch and recovery

SQLite transactions must atomically persist guarded state updates, event/dedupe records, reservations/counters, lease generation and external-action intents. Use state-version compare-and-swap and unique constraints for event keys, accepted results and active ownership. Transaction rollback leaves neither a consumed counter nor a half-transition.

Starting an external process is not atomic with SQLite. Persist an intent with a stable dispatch key before launching; attach the returned run/process identity afterward. On restart, reconcile unresolved intents before launching anything else. Adapter/launcher must prove lookup/deduplication by that dispatch identity, or the ambiguous launch is quarantined for human containment—not blindly repeated. Exactly-once external launch is not claimed merely because the database is transactional.

Lease generation fences controller/result acceptance, **not filesystem writes by a rogue/stale process**. Lease expiry alone does not grant a new writer. Confirm the prior process and descendants have stopped and write access is contained before handing over the branch/worktree. If the selected runtime cannot establish that, quarantine the workspace/branch and block reassignment. A new worktree alone is not proof that the old process cannot write the repository.

Restart reconciliation checks intents, processes, lease generations, branch heads/bases, artifacts, accepted verdicts and pending external sync. Duplicate webhooks wake reconciliation; they do not grant ownership. Persist a logical action key for GitHub publication and discover an existing PR before retrying an ambiguous publish. Notifications and PR sync failures cannot reset quality counters or allow duplicate development.

Operator controls: pause prevents new dispatch; shutdown/cancel attempts bounded termination; uncertain containment quarantines affected work. Resumption rechecks eligibility and evidence. Worker-reported policy changes, secrets requests and forbidden destinations are rejected outside the worker prompt. Precise OS confinement and launcher mechanisms remain implementation/spike obligations, not solved by this design prose.

## 7. Separate release handoff

Delivery ACCEPTED permits an authorised merge action, not a deploy action. Record actual merge identity and create a separate release record only after merge is verified. Proposed release states follow the source: `MERGED` → `RELEASE_READY` → `STAGING_VALIDATED` (when configured) → `AWAITING_RELEASE` → `DEPLOYED` → `POST_DEPLOY_VERIFIED`, with `FAILED`/`ROLLED_BACK` alternatives.

Each release record binds environment, immutable artifact/version, operator, approvals, configuration/migration notes, smoke checks and rollback/forward-recovery procedure. Missing required staging evidence blocks; a permitted skip needs explicit policy rationale. Production execution stays disabled in this initial design. Documentation-only changes record “no deployable artifact” and applicable N/A, not a fictional DEPLOYED status.

Release failures create incident/escalation evidence and new tracked fix work; they neither consume nor replenish the delivery review budget. Product outcome observation is separate from technical deployment success and may return work to discovery.

## 8. Review and approval gate

This draft is author-produced, not independently reviewed. [Scenarios](delivery-lifecycle-v0.1-scenarios.md) are test specifications/tabletop expectations, not executed controller tests. Independent review must try to break the transitions and authority rules, then adversarial review follows standard PASS. Commit-bound reviews require a frozen Git candidate; this directory currently has no Git repository.

Owner decisions requested after review: approve or amend Q1–Q4 and adversarial-on-every-change applicability (P-004), then approve an exact specification version. No coding ticket depending on these semantics becomes READY before that approval. Duration defaults, OS containment and real adapter behaviour require later evidence and must block unattended dispatch until resolved.
