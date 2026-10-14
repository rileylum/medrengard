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
| Candidate | Repository identity, work branch, target branch, exact head SHA and pinned target-branch tip SHA (`base`); base is NOT the Git merge-base. Record merge-base separately for diff calculation. Evidence refers to this tuple, not moving branch names |
| Logical attempt | Unique ID, role, cycle, input candidate/context and reserved review ordinal where relevant |
| Execution | Unique run ID for one launch; runtime/model/config versions, attempt ID, workspace and lease generation; retries use new run IDs |
| Evidence | ID, producer/verifier, work/spec/policy versions, candidate, environment, check identity, time, result and artifact digest/location |
| Decision | Unique ID, authenticated human actor, action, exact scope/version/candidate, rationale and authority reference |
| Event | Unique event ID plus source dedupe key, actor, cycle, expected state version, before/after, evidence references and timestamp |

The controller alone commits authoritative automated transitions. Workers submit untrusted results. The designated owner alone initially approves designs, waivers, revisions, governance changes and final acceptance (proposal Q4). No role or authority is inferred from issue prose, a model response or a successful process exit.

Work readiness is distinct from cycle stage: `NEEDS_REFINEMENT`, `NEEDS_DESIGN_APPROVAL`, `READY`. Becoming work-READY requires valid fields, resolved dependencies, required design approval or allowed N/A, eligible repository/environment and a defined quality profile. Dispatch rechecks these conditions, rather than trusting an old label.

A cycle is created by an explicit owner work/cycle authorisation (initial work or Q1 revision), before readiness promotion, in `PREPARING`, control `ACTIVE`, counters `(0,0)`. It pins immutable contract/spec/policy/profile versions, authority references and review limits, even when a referenced design still awaits approval. The controller promotes it to `QUEUED` only once work readiness is READY. Changes to those pinned versions require a new authorised cycle; never edit them in place. READY in the source roadmap denotes work readiness, not a second cycle stage.

## 3. Delivery states and transition rules

Delivery states: `PREPARING`, `QUEUED`, `DEVELOPING`, `VERIFYING`, `STANDARD_REVIEW`, `ADVERSARIAL_REVIEW`, `AWAITING_ACCEPTANCE`, `ACCEPTED`, `ESCALATED`, `CANCELLED`, `SUPERSEDED`.

Orthogonal execution control: `ACTIVE`, `PAUSED`, `RECOVERING`, `QUARANTINED`. Only ACTIVE permits ordinary dispatch/advancement. Recovery may record observations and stop workers, but cannot advance quality gates. Store the interrupted stage and reason; do not use PAUSED as a new cycle or budget reset.

All transitions require matching cycle/state version, allowed actor, applicable control state, current approval/policy eligibility and a unique event. The following adds stage-specific guards. Invalid input never triggers the indicated successful transition. Escalation defaults to control PAUSED once containment is proven; uncertain containment requires QUARANTINED. Controller failure/staleness handling may interrupt any nonterminal control state; ordinary quality advancement requires ACTIVE.

| From / trigger | Required guard/evidence | To / effect |
| --- | --- | --- |
| No cycle / owner authorises work | Explicit work/version, scope, limits and authority; unique authorisation ID | PREPARING/ACTIVE `(0,0)`; create pinned cycle exactly once |
| PREPARING / controller readiness evaluation | Work readiness READY; valid pinned versions and required approvals | QUEUED; record readiness evidence |
| QUEUED / scheduler claim | Dependencies satisfied; approved context; eligible slot/runtime; exclusive branch/workspace ownership; durable launch intent; capture target tip B1 | DEVELOPING; create development attempt and execution |
| DEVELOPING / result | Assigned run/lease identity; valid result and artifacts; actual committed head; no undeclared scope change; writer stopped before handoff | VERIFYING; freeze candidate tuple |
| VERIFYING / independent verification succeeds | All pre-review checks (§5) PASS or permitted explicit HUMAN-WAIVED; candidate/context current; provenance validated | STANDARD_REVIEW; reserve permitted attempt |
| VERIFYING / real check failure, missing mandatory evidence or material deviation | Record evidence and reason; distinguish unavailable verifier from actual quality failure | ESCALATED under Q3; no review counter changes |
| STANDARD_REVIEW / valid PASS | Exact assigned candidate; independent fresh context; ordinal available; all pre-review evidence and required standard-review output current | ADVERSARIAL_REVIEW; count standard completion once |
| STANDARD_REVIEW / valid FAIL #1 | Same validity guards; reproducible findings retained | DEVELOPING; count standard completion; authorise one bounded fix of findings within approved intent |
| STANDARD_REVIEW / valid FAIL #2 | Same validity guards | ESCALATED; count completion; no further automatic fix/review |
| ADVERSARIAL_REVIEW / valid PASS | Current standard PASS on same candidate/context; independent verdict and pre-review/review-stage evidence current; acceptance-stage human observations may still be pending | AWAITING_ACCEPTANCE; count adversarial completion; assemble package |
| ADVERSARIAL_REVIEW / valid FAIL | Valid assigned verdict | ESCALATED; count completion; no automatic fix/retry |
| AWAITING_ACCEPTANCE / owner approves | Explicit decision bound to current candidate and package; mandatory gates satisfied; no stale approvals/checks | ACCEPTED; no automatic merge or deployment |
| AWAITING_ACCEPTANCE or ESCALATED / owner requests revision | Q1 authorisation; old workers contained; immutable scope/version and new cycle ID; pending design approval cannot be bypassed | Old cycle SUPERSEDED atomically with new PREPARING/ACTIVE cycle `(0,0)`; new work must independently meet readiness |
| Any nonterminal stage / owner cancels | Stop/quiesce workers; reconcile results; retain artifacts and findings | CANCELLED/PAUSED only after containment; otherwise ESCALATED/QUARANTINED with pending cancel intent; no new dispatch |
| Any active stage / ambiguity, safety violation or budget exhaustion | Persist reason, relevant evidence and decision options; stop active workers safely | ESCALATED, with quarantine if containment is uncertain |

ACCEPTED, CANCELLED and SUPERSEDED cycles do not resume. An accepted cycle may be the immutable parent of a new cycle through the separate merge-handoff rules (§7); its recorded acceptance is not erased. Human resolution never synthesises a missing review PASS.

### Operational resolution and control transitions

All rows require version-guarded events and recorded actor/evidence. Control states never reset counters, pinned context, execution deadlines or Q3 replacement use. `resume_stage` records the stage interrupted by an escalation. Clearing control does not itself clear ESCALATED or permit a terminal cycle to dispatch.

| From / actor and trigger | Guard and evidence | Result |
| --- | --- | --- |
| ACTIVE / owner pauses | Authenticated pause decision; stop new dispatch, continue observing existing executions | PAUSED; stage unchanged, results retained until resume/revalidation |
| ACTIVE or PAUSED / controller observes operational interruption | Persist process observations, interrupted control and stage | RECOVERING; no dispatch except resolution below |
| ACTIVE, PAUSED or RECOVERING / controller detects uncertain containment or unsafe activity | Record process/access evidence and reason; request bounded termination | QUARANTINED; delivery ESCALATED unless already terminal; cancel intent retained |
| RECOVERING / controller resolves known live execution or safe replacement | Verified identity/ownership/context; interrupted control was ACTIVE; delivery not ESCALATED/terminal; for replacement, confirmed termination, Q3 allowance and backoff | ACTIVE; observe existing run or launch one replacement of same attempt; consume replacement allowance before launch |
| RECOVERING / controller resolves interruption of paused cycle | Same containment/context evidence, interrupted control PAUSED | PAUSED; no launch; later owner resume required |
| RECOVERING / controller exhausts recovery allowance or proves invalid result | Failure evidence; containment proven (otherwise quarantine) | Delivery ESCALATED, control PAUSED; no replacement |
| PAUSED / owner resumes control | Exact cycle decision; containment/ownership and context revalidated; no unresolved safety issue | ACTIVE, same delivery stage; ESCALATED remains non-dispatchable |
| QUARANTINED / owner acknowledges containment | Recorded process-tree termination and revoked/contained write-access evidence from trusted operator/launcher; unsupported assurance is insufficient | PAUSED; never direct ACTIVE; pending cancellation completes as CANCELLED; otherwise existing ESCALATED/terminal stage retained |
| ESCALATED / owner resolves a non-execution operational blocker | Same pinned context/candidate; missing authority/config/evidence supplied and independently verified; no failed quality verdict bypass; no replacement execution needed | Restore recorded resume_stage, PAUSED; owner must separately resume control |
| ESCALATED / owner requests a replacement execution | Even when runtime is now fixed, no same-cycle manual extra execution allowance | Remain ESCALATED; explicit Q1 child cycle or cancellation required |
| ESCALATED or AWAITING_ACCEPTANCE / owner rejects or returns to design | Record disposition, reason and design work reference where relevant; contain all workers | CANCELLED/PAUSED; if containment uncertain, retain cancel intent in QUARANTINED until proven |
| Any nonterminal stage / owner cancels or shuts down with cancellation | Confirmed termination/write containment; retain evidence and decision | CANCELLED/PAUSED; if not proven, QUARANTINED with pending cancellation, not a completed cancellation |

An exhausted/failed quality gate cannot be resolved by operational resume. Owner-authorised retries outside Q3 require a new explicitly budgeted cycle; there is no same-cycle manual retry loop. Observing an existing run, attaching an already-produced artifact or supplying a valid permitted waiver is not a replacement execution.

### Reservation lifecycle

A review attempt reservation is `RESERVED`, then either `CONSUMED` by one valid completed verdict (including stale PASS/FAIL), or `CLOSED_UNUSED` when the cycle is cancelled/superseded and the run is proven unable to produce a further verdict. RESERVED survives pause, recovery, escalation and a Q3 replacement run. No release back to the same cycle's available budget is permitted. CLOSED_UNUSED is retained history, not a reusable ordinal. Duplicate results are no-ops; conflicting results escalate the nonterminal cycle and preserve the first accepted result (terminal cycles retain an anomaly and block any merge handoff).

Completed plus outstanding review reservations cannot exceed the limit. Only one review attempt is active per cycle at a time. A safely replaced run is fenced/closed before accepting the replacement's verdict; delayed output from that replaced run is diagnostic only. Completed verdict/counter/transition are one transaction. A valid assigned verdict arriving after escalation due to staleness still consumes its reservation but cannot resume the cycle. Cancellation/supersession finalisation waits for reconciliation of completed verdicts; later output from closed runs is retained diagnostically, never used to reopen budgets.

## 4. Review-budget and revision policy proposals

### Q1 — New cycles require explicit authorisation (O-002)

Recommend a new immutable cycle for any owner-requested code revision after terminal failure or final review. The decision names the old cycle, findings, revised contract/scope and new limits (at most two standard and one adversarial). No resetting old counters. A bare comment such as “fix this” is a revision request, not budget authorisation; the operator asks for the missing fields.

After adversarial FAIL, even a tiny fix gets a new cycle with independent verification, standard review and adversarial review. Rejected alternative: grant an extra adversarial attempt within the same cycle or reuse the old standard PASS after modifying code. That obscures the hard limit or trusts stale evidence. Smaller explicitly authorised budgets are allowed, but required gates cannot be skipped.

### Q2 — Freeze review candidates; escalate unexpected changes (O-003)

Recommend allowing code changes inside a cycle only during initial development and the single fix after standard FAIL #1. Once standard PASS exists, any head/base change invalidates that candidate's evidence and requires an owner-authorised new cycle. Unexpected changes during review or acceptance also stop the cycle; they are not free retries. This is deliberately conservative for the first release.

The target-branch tip B1 is captured at the first development claim, not at work intake. A moving target branch is detected before each dispatch, result/verdict acceptance, package presentation, human acceptance and merge handoff. After capture, any target-tip drift in DEVELOPING (including the fix), VERIFYING, either review or AWAITING_ACCEPTANCE escalates, preserving counters. No automatic rebase is permitted, including during the post-FAIL fix. The authorised developer may change the work-branch head only in its assigned DEVELOPING stage; external/unattributed head changes always escalate. PREPARING/QUEUED have no captured candidate, so target movement there only changes the tip captured at claim. After ACCEPTED, drift invalidates the separate merge handoff (§7).

Never silently replace the stored base. Old evidence stays in history marked stale. New commits are not assumed harmless, even if labelled docs-only. Stale valid FAIL #1 increments the counter but escalates; it does NOT grant the ordinary fix transition. Staleness handling takes precedence over normal PASS/FAIL stage routing.

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

### Context validity

Cycles pin contract/spec/policy/profile versions; they do not follow the newest version automatically. Publishing a new version alone leaves explicitly still-authorised pinned versions eligible. An owner adoption/replacement decision for this work, revocation of a pinned approval/version, or withdrawal of runtime/environment eligibility invalidates the active cycle's context: mark affected evidence stale and ESCALATE (or invalidate the merge handoff if ACCEPTED), preserve counters, contain active workers. Required checks cannot be changed in place. Any resulting scope/version change requires a child cycle. Authorisation validity is rechecked at every gate; this is what “current eligibility” means, not latest-version substitution.

Waiver expiry/revocation before acceptance similarly escalates, without relabelling it PASS. The owner may resolve that operational blocker only by independently verified existing check evidence or a newly valid profile-permitted waiver on the SAME candidate/context; otherwise create a new cycle. Expiry after acceptance blocks merge until revalidated under §7. A stale valid in-flight verdict consumes its reservation but cannot advance.

### Evidence phases

The work/profile assigns every criterion/check to a phase before readiness; no mandatory check may silently shift to a later phase.

- **Pre-review:** executable build/tests, applicable security/a11y/performance/visual checks, approved design references, implementation design comparison and runnable demo/walkthrough instructions. Required evidence must pass or be explicitly permitted-waived before standard dispatch and remain current thereafter.
- **Review-stage:** required standard/adversarial verdicts and structured findings, produced by their respective independent reviewers. These cannot be demanded as inputs to their own stage. Each stage requires all earlier-phase evidence.
- **Acceptance-stage:** owner or named authorised human's hands-on observations/UAT and explicit disposition. Before review, the contract must name the procedure, candidate fixture and observer role; the actual human observation may be pending until AWAITING_ACCEPTANCE. No automated test obligation can be replaced by calling it UAT.

In AWAITING_ACCEPTANCE, the controller may attach authenticated human observations and assemble the package without changing code/context. Missing acceptance-stage observations keep the cycle in AWAITING_ACCEPTANCE with an incomplete package and no approval. A failed mandatory human observation escalates; missing/invalid earlier-phase evidence discovered here also escalates. Passing observations leave the stage unchanged until explicit owner approval. Record each attachment/outcome in the ledger. An agent may format or attach evidence, but cannot impersonate the human observer or infer acceptance.

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

Delivery ACCEPTED creates a separate merge-handoff record in `PENDING`; it is not permission to merge automatically. Initial merge authority is proposed as owner-only/manual and must be approved before SF-002E is READY (O-006). The record binds the accepted cycle, H1, target tip B1, approval and integration-check definition. Handoff transitions:

| From / actor | Guard / evidence | To / effect |
| --- | --- | --- |
| PENDING / controller detects drift, revoked authority, expired waiver or result conflict | Head differs from H1, target differs from B1, or context validity lost; record observation | INVALIDATED; no merge; accepted delivery history unchanged |
| PENDING / owner authorises and performs manual merge | Revalidated H1/B1 and pinned authority/evidence; protected or atomic expected-target update; record actor/action and actual merge identity M1 | MERGED; create release record from M1 |
| PENDING / operator cannot prove atomic target check or merge provenance | Record missing proof; do not rely on a prior non-atomic tip check | INVALIDATED; no authorised merge; any externally observed merge is quarantined from release eligibility pending human reconciliation |
| INVALIDATED / owner authorises revision | Explicit Q1 child-cycle decision linked to accepted parent; old handoff never reactivated | Create PREPARING child `(0,0)`; parent stays ACCEPTED, invalidated approval retained as history |

Base drift always invalidates BEFORE merge; integration tests are not a substitute for reviewed B1. A merge/squash M1 generated solely from the authorised H1 and unchanged B1 is a legitimate new identity, not a revision: preserve lineage, verify the actual integration artifact and required checks before RELEASE_READY. If an external manual merge used changed inputs, record the fact but block release readiness; do not call it a valid handoff. Runtime/API atomic merge enforcement is later work and blocks merge automation, not this design-only review.

Record actual merge identity and create a separate eligible release record only after the authorised merge is verified. Proposed release states follow the source: `MERGED` → `RELEASE_READY` → `STAGING_VALIDATED` (when configured) → `AWAITING_RELEASE` → `DEPLOYED` → `POST_DEPLOY_VERIFIED`, with `FAILED`/`ROLLED_BACK` alternatives.

Each release record binds environment, immutable artifact/version, operator, approvals, configuration/migration notes, smoke checks and rollback/forward-recovery procedure. Missing required staging evidence blocks; a permitted skip needs explicit policy rationale. Production execution stays disabled in this initial design. Documentation-only changes record “no deployable artifact” and applicable N/A, not a fictional DEPLOYED status.

Release failures create incident/escalation evidence and new tracked fix work; they neither consume nor replenish the delivery review budget. Product outcome observation is separate from technical deployment success and may return work to discovery.

## 8. Review and approval gate

This draft remains unapproved. Standard review 1 of `f9569aa35f68d3e789152febab3489a47f34b1cb` returned FAIL; this revision addresses S1-F1–F7 and awaits standard review 2. [Scenarios](delivery-lifecycle-v0.1-scenarios.md) are test specifications/tabletop expectations, not executed controller tests. Adversarial review follows standard PASS. Git was initialised on 2026-10-15 after the first draft; each review refers to a frozen commit, not a moving branch.

Owner decisions requested after review: approve or amend Q1–Q4, adversarial-on-every-change applicability (P-004), and initial owner-only/manual merge authority (O-006), then approve an exact specification version. No coding ticket depending on these semantics becomes READY before that approval. Duration defaults, OS containment and real adapter behaviour require later evidence and must block unattended dispatch until resolved.
