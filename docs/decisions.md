# Decision register

DECIDED = source direction or a recorded owner reply. PROPOSED = recommendation. OPEN = unresolved. Latest entry wins. An owner approval is a quoted reply with a date; never invent one.

## From the source (v0.3)

| ID | Direction | Source |
| --- | --- | --- |
| D-001 | Deterministic controller; agents supply reasoning and results, not transition authority | §§1–2, 6 |
| D-002 | Vendor-neutral core; runtime, model and role are independent; personal and corporate domains separate | §§1, 5, 15 |
| D-003 | Two standard reviews and one adversarial review per cycle; stop on terminal failure; adversarial FAIL escalates immediately | §7, 15 |
| D-004 | Explicit human final acceptance and approval of design and governance changes | §§2–3, 10–12 |
| D-005 | Full risk-tailored SDLC; no automatic production deployment initially | §§1, 13, 15 |
| D-006 | Pools: three developers, two or three reviewers, one adversarial run at a time | §§1, 6 |

## Owner decisions

| ID | Status | Decision |
| --- | --- | --- |
| P-001 | DECIDED (A-001) | Markdown contracts and manual stage advancement until the controller replaces them |
| P-002 | DECIDED (A-001, A-016) | TypeScript core, SQLite state. Node 24 built-ins only; no dependencies until a test needs one |
| P-005 | DECIDED (A-001) | Run locally; corporate execution separately authorised |
| D-007 | DECIDED (A-001) | First runtimes: Pi and Claude Code |
| D-016 | DECIDED (A-016) | [Core lifecycle v1](specs/core-lifecycle-v1.md) is the implementation baseline. One recovery rule: anything unclassified escalates; owner chooses child cycle or cancel. Widened by A-114: an escalated cycle waits for the owner, who may also retry, overrule, fix, accept with risk or route. Edge-case semantics are added only when a test or a real incident requires them. Read with A-037 and A-042 (A-125): an edge case found only by an adversarial probe, with no incident and no damage by mistake, is parked or accepted, not fixed |
| D-017 | DECIDED (A-016) | Design documents are not put through adversarial review on their own. The 2+1 rule applies to code with executable tests |
| D-018 | DECIDED (A-017) | Plan steps are broken into Fast or Design tickets and delivered per [workflow.md](workflow.md) |
| D-019 | DECIDED (A-035) | Candidate code runs inside a sandbox chosen by backend name. Bubblewrap first; Docker, VMs and cloud later behind the same interface. No VM or cloud backend for now; the tool stays agnostic |
| D-020 | DECIDED (A-042) | Malicious code stays in scope, but the defences need not be airtight. Each adversarial finding is weighed by risk, and the recommendation can be a merge with the risk accepted. An accepted risk is recorded in [work/accepted-risks.md](work/accepted-risks.md) |
| D-021 | DECIDED (A-043) | The factory may run on any repository, not only scratch ones. Runs keep full network access and can read their own CLI's credentials |
| D-022 | DECIDED (A-052) | Task tracking and source control are separate seams, `Tracker` and `CodeHost`, each chosen by adapter name in the job file. GitHub first; Linear, GitLab and others behind the same interfaces. Providers report; the controller decides |
| D-023 | DECIDED (A-054) | Strong core, swappable modules with good defaults, user extensions. The core is the event log, the engine, the controller, run supervision, SHA binding, an observation stream and an extension host. Stages, steps, budgets, human acceptance and merging are a user-definable workflow; today's lifecycle is the default. Extensions run as separate processes speaking JSON over stdin and stdout, TypeScript first. Supersedes D-004 and spec principle 5 as fixed rules: both become default policy |
| D-024 | DECIDED (A-074) | Extensions take two shapes. A custom step is a command stage that names its own commands; there is no separate extension step kind. An observer is any process that reads the event stream and acts through the owner's commands. The JSON-over-stdin-and-stdout protocol is kept for runtime adapters. Grants are asked for by a workflow and given only by the owner's personal or job configuration. Configuration comes in four layers; the repository layer is read at the base SHA and cannot give grants or turn the sandbox off |

## Open

Open questions, O-001 onwards, are in [open-questions.md](open-questions.md).

## Approval history

### A-144 — 2026-10-22 — Messaging primitives: a published artifact between cycles and a live channel per run, open to observers

Owner, asking whether several agents can work at once and talk to each other while each stays sandboxed: “I have found it valuable to have streams work on dependent or linked work be able to communicate between each other to validate design etc. so it is a paradigm or a workflow that should be possible.” After the research (`docs/research/2026-10-22-agent-messaging/`), offered its ranking: (1) the upstream cycle publishes an interface file bound to its SHA and a downstream cycle checks against it, with no live channel; (2) a live channel, one controller-owned socket per run bound into its sandbox, with the controller recording each message as an event; (3) one VM per run on the home server. Owner: “Okay thats great, and pasta is already planned to be setup. My recommendation is to build the primitives to allows both option 1 and 2 - and there is no requirement for this to just be used for cross agent communication, then an observer extension could send messages through the same channels.”

Effect: messaging is a core capability under A-113, with the policy left to workflows and extensions. The primitives, to be ticketed:

1. A message is an event the controller records before delivery. The controller sets the sender and the sender's head; the body is a file with a hash, never argv.
2. Every sender is known by the channel the message came in on: a run by its own socket, an observer through the observation stream (its `note`, A-074, becomes a message), the owner through a command.
3. Each adapter may deliver a message mid-run (claude hooks, pi `steer`, a fixed herdr doorbell); a runtime with no way in gets its messages at its next run.
4. A stage's SHA-bound output can be named as an input to a linked work item's cycle (extends A-117's declared inputs across cycles).
5. Routing (who may message whom), visibility (which stages see messages) and caps are extension points; the observer is the first user of routing (A-124). The defaults are not decided (O-018).

It builds on A-106 (pasta) and the egress proxy row, not before them. The VM option (3) is not adopted; D-019 stands. What is still open is O-018. Docs only; no test run.

### A-143 — 2026-10-21 — 11-d: the adversarial findings tested on the branch; a hand-run accept without a command ID accepted as a risk

Asked, after 11-d's adversarial FAIL on `2be3768`: (1) the "major", no test sends the observer kit's cancel ID, so a kit that gave an accept and a cancel for one line one ID passed every test (a missing test for correct code, a minor under `docs/workflow.md`); (2) the minor, no test tells that `cancelWork` passes no `after`; (3) the note that an `accept` with no `--command-id` is not deduplicated, so on a workflow OWNER → MERGE → FINAL whose MERGE keeps the head a retyped `accept <sha>` would also accept FINAL. The session recommended adding both tests on the branch, each red on its mutant, without a further review (as A-137), and accepting (3) as designed, with a line in `docs/work/accepted-risks.md`. Owner: “Go as you recommend”.

Effect: (1) and (2) are tested on `feat/11-d-owner-events-bound`; the review budget is spent, so the tests have the implementer's mutants only. (3) is in `docs/work/accepted-risks.md`.

### A-142 — 2026-10-21 — 11-d: standard 3's test findings fixed on the branch; on to the adversarial review

Asked, after 11-d's standard 3 FAIL on `7ab24ab` (the two-delivery test asserts on timing and fails on correct behaviour; no test reaches `request-changes`'s duplicate path): fix both tests on the branch and go to the adversarial review, or a fourth standard review, or a new ticket naming 11-d. The session recommended the first; no product code changes. Owner: “fix both and go to the adversarial.”

Effect: both tests are fixed on `feat/11-d-owner-events-bound` without a further standard review; the adversarial review reads that head.

### A-141 — 2026-10-21 — 11-d: standard 2's FAIL fixed on the branch, then a third standard review, then the adversarial

Asked, after 11-d's standard 2 FAIL on `47c3e7b` (two overlapping deliveries of one command ID both drive the cycle; no test drives the loop after `request-changes`), with the standard budget spent: fix on the branch tests-first and go to the adversarial review; or a third standard review first; or a new ticket naming 11-d. The session recommended the first: the store reports whether an append wrote, and `decideAndDrive` drives only when it did. Owner: “go with your recommendation, and go through an additonal standard review.”

Effect: both findings are fixed on `feat/11-d-owner-events-bound`, tests first. A third standard review, beyond A-125's budget for this ticket only, reads the fix; then the adversarial review.

### A-140 — 2026-10-21 — 11-d: two existing test pins change; no command ID is minted

Asked, during 11-d's build: the ticket says existing tests pass unchanged, but two pins follow from A-123 item 1 and A-139: (1) the `request_changes` sample in `tests/lifecycle.test.ts` "outcomeRunId names the run of every outcome event" gains a `head`, since one without a head is now unclassifiable; (2) `tests/observe.test.ts` "observe runs a real accept…" expects the kit's `commandId` on the recorded accept. The session also reported that `main.ts` mints no command ID when none is given, a change from the design note: a fresh random ID deduplicates nothing, and it would change more pins. Owner: “Both are fine”.

Effect: both pins change with this decision. The design note's minting line is withdrawn.

### A-139 — 2026-10-21 — 11-d's design approved with the session's recommendations; 11-d and 11-d2 READY at Trust tier

Asked, with `docs/design/2026-10-21-owner-moves.md`, `docs/work/11-d-owner-events-bound.md` and `docs/work/11-d2-owner-moves.md`, nine questions. The session recommended: (1) two tickets, 11-d then 11-d2 stacked on it; (2) no `ENGINE_VERSION` bump, with a fixture replay test as evidence; (3) the command ID kept in the existing `run_id` unique index under an object-shaped key; (4) `cancel` without the stale-load check; (5) a `request-changes` command in 11-d; (6) 11-d2 builds `retry`, `overrule` and `route`, with accept-with-risk as `route` to the human stage, `fix` with chosen findings goes with A-108's ticket, and the child-from-candidate option is probed, not built; (7) no cap on overrules now; (8) the reviewer-run window parked against 11-e; (9) today's `SETTLED` renamed `STOPPED`, and `SETTLED` becomes ACCEPTED and CANCELLED. Owner: “Go with your recommendations”.

Effect: 11-d is READY at Trust tier on `feat/11-d-owner-events-bound`; 11-d2 is READY at Trust tier and starts after 11-d's reviews, stacked on its branch. The design note stands as drafted.

### A-138 — 2026-10-21 — The parked 10-b `decisionConfig` row moves to 11-f

Asked: the 10-b row in `docs/work/parked.md` names "the next ticket that touches `decisionConfig` in `src/main.ts`". 11-c changed only that function's comment and left the row. Should it stay pinned that way, or move to 11-f? Owner: “Start on 11-d. 10-b can go to 11-f”.

Effect: the row's "Pick up in" is 11-f. 11-d is being drafted (STATUS 83).

### A-137 — 2026-10-21 — 11-c: the adversarial minors tested on the branch; the race test's wording; a diverged-cycle note for 11-f; an unbounded test to Housekeeping

Asked, after 11-c's three reviews (standard 1 FAIL on `e64464d`, fixed; standard 2 PASS on `b126117`; adversarial PASS on `3bf36ce`): (1) the adversarial minors, two missing tests for correct code (two workflows with one name and different hashes, which `drivable` must tell apart; `addStages`'s re-check under the lock when several processes upgrade one store); (2) the done-when line that names a barrier file, where the test holds the write lock; (3) that one diverged cycle, a settled ancestor included, makes `accept`, `cancel` and `open` refuse for the whole work; (4) the 02-a test that waits with no bound for its writer child. The session recommended: (1) add both tests on the branch, each red on its mutant, without a further review; (2) the wording "a held write lock or a barrier file"; (3) a note in `docs/work/parked.md` against 11-f, so `recover` can resolve a diverged cycle without loading its siblings; (4) a line on the Housekeeping row. Owner: “Go with your recommendations”.

Effect: (1) is done on `feat/11-c-replay-recorded`; the review budget is spent (A-125), so the tests have the implementer's mutants only. (2) The ticket's done-when line reads so. (3) is in `docs/work/parked.md`. (4) is on the Housekeeping row in `docs/plan.md`.

### A-136 — 2026-10-21 — 11-c's design approved with the session's recommendations; READY at Trust tier

Asked, with `docs/work/11-c-replay-recorded.md` and `docs/design/2026-10-21-replay-recorded.md`, seven questions: (1) one ticket or two; (2) how stores written before 11-c load; (3) whether `decisionConfig` becomes a fallback; (4) whether a cycle under another workflow may be driven; (5) what the engine version does; (6) whether two `tests/store.test.ts` pins that hold A-059's refusal may change; (7) the append lock and the parked overlapping-accept race. The session recommended: (1) one ticket; (2) the stage column added with nulls, null rows not compared, no backfill, an open row with no `engine` read as before 11-c; (3) `decisionConfig` unchanged, since `accept` drives on with the whole config at the old base, which narrows A-112 item 6 to moving only the workflow match into the store; (4) refused by `drivable`, with 11-f to decide; (5) recorded only and named in the divergence error; (6) both pins rewritten to "loads under the recorded workflow, and `drivable` refuses, naming both", with a new test keeping the refusal when nothing matches; (7) `append` loads, applies and inserts under one write lock, and the race stays parked against 11-d. Owner: “Go with your recommendations”.

Effect: 11-c is READY at Trust tier, as the design note says. The two pins in (6) change with this decision.

### A-135 — 2026-10-21 — 11-b2: the adversarial minors fixed on the branch; pins accepted; moved repository to Housekeeping

Asked, after 11-b2's three reviews passed (standard 1 on `01ba4a5`, standard 2 on `4a902ef`, adversarial on `32c4c71`): (1) the mirror set-up race between cycles starting at once, and (2) the mirror's object format for a SHA-256 repository: fix on the branch, tests first, without a further review; (3) whether the three changed pins in `tests/developer.test.ts`, which leave out `mirrors/`, count as "unchanged"; (4) a line on the Housekeeping row for a repository moved or re-pointed between `develop` and `fix`. The session recommended fixing both on the branch (the mirror made in a temporary sibling and renamed into place; the fetch skipped when the base is there, and a failed fetch accepted when another process fetched it; the mirror made in the repository's object format), accepting the pins, and the Housekeeping line. Owner: “Fix both, go with your recommendations”.

Effect: (1) and (2) are fixed on `feat/11-b2-shared-clones`; the review budget is spent (A-125), so the fixes have the implementer's tests and mutants only. (3) The pins count as unchanged. (4) The Housekeeping row in `docs/plan.md` names it.

### A-134 — 2026-10-21 — 11-b2: the mirror bind travels on the run request

Asked, after 11-b2's probes passed: the design note's bind through `CliSpec.bind` cannot work, because `main.ts` builds every adapter before `develop` knows the mirror, and `cliAdapter` refuses a `sandbox.read` path that does not exist yet (a repository's first cycle). (1) An optional `read?: string[]` on `RunRequest`, absolute paths the controller asks the run's sandbox to bind read-only; `develop` and `fix` set it to the mirror's objects; every runtime goes through `cliAdapter`, so all are covered; extension runtimes receive the field in the request JSON (additive, D-024). (2) `main.ts` makes the mirror before building adapters and puts it in the developer's `sandbox.read`. The session recommended (1). Owner: “Option 1.”

Effect: `docs/design/2026-10-21-shared-clones.md` is updated: the bind is `RunRequest.read`; the mirror fetch runs after `open` beside the clone, so a failed fetch cancels the cycle as a failed clone does (the existing test for that case keeps its meaning).

### A-133 — 2026-10-21 — 11-b split from 11-b2; one mirror per repository; 11-b READY at Light tier

Asked, with the drafts `docs/work/11-b-layout.md`, `docs/work/11-b2-shared-clones.md` and `docs/design/2026-10-21-shared-clones.md`: (1) split the `layout` refactor (Light tier) from the shared clones (Trust tier, stacked on it); (2) one mirror per repository, so a cycle can read the base history of every earlier cycle on the same repository, or one per base SHA; (3) run the design note's probes before 11-b2's code, including one paid developer run each for claude and pi. The session recommended the split and one mirror per repository. Owner: “Split is good, one mirror per repo, probes are good. Go”.

Effect: 11-b is READY at Light tier (one review, A-125). 11-b2 keeps one mirror per repository and its probes, paid runs included, are approved; its design note stands as drafted, and its code waits for the probe results.

### A-132 — 2026-10-21 — 11-a2: the adversarial minor fixed on the branch; the race parked against 11-d

Asked, after 11-a2's three reviews passed (standard 1 on `28de902`, standard 2 and adversarial on `80c321d`): (1) the adversarial minor, where `preflight` passes, the `accept` is recorded, and `verify` then refuses the grant stage before anything runs (an empty grant file, a missing `{ file }` argument, no PASS verdict for the head): fix on the branch, or a fix ticket; (2) the race between two overlapping `accept` commands: park it against 11-d. The session recommended fixing (1) on the branch, tests first, by moving `verify`'s file and empty-grant checks into `preflight` and running `headGate` on the predicted cycle, and parking (2) with the fix all three reviewers named. Owner: “Fix the minor and park the race”.

Effect: (1) is fixed on `feat/11-a2-owner-drives`. The review budget is spent (A-125); the fix has the implementer's tests and mutants only. (2) is in `docs/work/parked.md` against 11-d: the store refuses an append when the cycle's stage, or its last sequence number, is not the one the writer loaded, checked in the same write; `commandId` alone does not close it.

### A-131 — 2026-10-21 — 11-a2's design approved; READY at Trust tier

Asked: approve the design note for 11-a2 (`docs/design/2026-10-21-owner-drives.md`): `decideAndDrive` in `src/run.ts` works out with `apply` the stage an owner's event leads to; only when the loop runs that stage does it build adapters and run `preflight`, before the event is recorded; the default workflow's `accept` loads no runtime. Rejected: a separate `resume` command, recording before `preflight`, and `preflight` inside `acceptCycle`. Tier Trust (2+1 through `claude -p`). Owner: “go approved”.

Effect: 11-a2 is READY at Trust tier.

### A-130 — 2026-10-21 — 11-a's review minor accepted: cancel prints after every cancel is recorded

Asked, from 11-a's Light review (PASS on `df2af87`, one minor): `cancel` now prints its lines after every cancel is recorded, not after each one, so a store write that fails part way through a cancel of several cycles prints nothing for the cycles already cancelled; the store keeps each cancel, and the error still prints. The session recommended accepting it, because restoring the order would add a print callback to `cancelWork` for that one failure. Owner: “accept”.

Effect: no code change. Logged in `docs/work/accepted-risks.md`; it reopens if a cancel's output is ever used to tell which cycles were cancelled.

### A-129 — 2026-10-21 — 11-a is READY at Light tier; `accept` drives on, in a ticket after 11-a; row 11's gaps placed

Asked: is ticket 11-a (`docs/work/11-a-driver-entry.md`, a pure refactor) go, at Light tier; and the session's recommendations on two questions. (1) Should `accept` drive on into the next stage? The session recommended yes, as a Trust-tier ticket right after 11-a that sets one rule for every owner command: record the event, then drive the cycle until it stops; 11-d's owner moves reuse it. With the default workflow, `accept` still stops at ACCEPTED. (2) Should plan row 11 record where the gaps left out of 11-a go? The session recommended yes, in 11-a's docs change: the `resume` command with 11-f, because today's `resume` reruns a stage whose run started, which A-105 item 1 forbids; reviewer `run_started` with 11-e; the `head_changed` and `base_changed` producer stays on the Owner tools row. Owner: “Go on 11-a, and take your recommendations”.

Effect: 11-a is READY at Light tier (one review, A-125). The new ticket is 11-a2, drafted after 11-a and not READY until the owner says go. Decides A-112 item 2's open point: `accept` drives on.

### A-128 — 2026-10-21 — The factory is named Medrengard; a private remote

Owner, after A-125's private remote: “Okay, I have gh installed so create the private repo. This is probably a good time to name the factory though - medrengard”.

Effect: the session created the private GitHub repository `rileylum/medrengard` and added it as `origin`. Before creating it, the session scanned every commit on main for key and token patterns and found none. The owner pushes main. `README.md`'s title and `package.json`'s name say Medrengard. Not yet renamed: the personal config path `~/.config/software_factory/`, the default `runsDir` `/var/tmp/software_factory/runs`, the guide's titles, and the local checkout's folder. Renaming the paths moves the owner's config and runs, so it is a ticket of its own, with the old paths read as a fallback.

The first real merge through `scripts/pre-merge-commit` (A-125) failed one test on a good merge: git sets `GIT_INDEX_FILE` for the hook, and it leaked into the tests' own git calls. The hook now unsets git's local environment variables before `npm test`. The session ran the fixed hook with `GIT_INDEX_FILE` set: 450 tests, 426 pass, 0 fail.

### A-127 — 2026-10-21 — Smaller items: ticket provenance, per-repository sections, secret references, workflow tooling; codex and ACP parked

Owner, on foundations theme T14 (`docs/research/2026-10-20-foundations/security.md` P9; `extend-config.md` proposals 9, 10; `engine.md` P7; `runtime-process.md` proposal 8), with the session's placement: “a to e as recommende”.

Effect (`docs/plan.md`):
1. Row 12: ticket provenance (listed authors only by default, hidden characters stripped, tracker text labelled untrusted; the allow list in the dispatch extension point) and secret references for grants. Widens A-083 Q1.
2. With Repository trust: personal per-repository sections and profiles, the home of A-119's per-repository friction. Widens A-074's layers.
3. After JSON workflows: checker warnings, a Mermaid view, and a kit that reports a workflow's worst-case paid runs.
4. Parked until the owner wants a third vendor: codex as a built-in runtime, and ACP as an extension runtime (after A-116's progress lines). Widens D-007 then.

This closes the foundations walkthrough: themes T1 to T14 are decided in A-114 to A-127.

### A-126 — 2026-10-21 — Workspaces: shared clones against a base-only mirror; overlay checkouts with pools

Owner, on foundations theme T13 (`docs/research/2026-10-20-foundations/runtime-process.md` proposal 5), with the session's timing (the mirror beside row 11's `layout` ticket; the overlay with pools): “Yes adopt both”.

Effect (`docs/plan.md`):
1. Beside row 11's `layout` ticket: each cycle's clone is `git clone --shared` against a bare mirror the controller owns. The mirror holds only what a developer may see, matching A-121 (d). Widens A-038: no hardlinks stays; a full copy per cycle goes. Shrinks A-111's housekeeping.
2. With pools (row 13): an overlay checkout per base SHA, after a probe with the real CLIs. Lower layers are immutable.

### A-125 — 2026-10-21 — Process and record: contradictions fixed, review tiers, a pre-merge test hook, a threat model, a private remote, dogfooding

Owner, on foundations theme T12 (`docs/research/2026-10-20-foundations/design-audit.md` P5, P6, P10, P11, section 6.1; `security.md` P12), with the session's recommendations (fix the contradictions now; spec up to row 10 as a docs ticket that becomes the current-rules page; merge records stay in this file; review tiers and a pre-merge hook; a private remote the owner creates; a threat model page; dogfooding after row 11): “Yes, but make sure when we rewrite anything we come back to the core goals - strong core, sane defaults but control and customizability to the user, extensibility and observability (plus anything else I'm missing).”

Effect:
1. Core goals, in `docs/architecture/baseline.md`, which every rewrite comes back to: a strong core; sane defaults, with control and customisation left to the owner; extensibility; observability. The session proposed five more (vendor neutral, D-002; local first, A-001; the controller decides, D-001; safe by default, D-019 and D-023; durable and recoverable, row 11 and A-122). Owner: “Yes please”. All nine are in `baseline.md`.
2. Contradictions fixed in this branch: the spec's core rules 2 and 3 note what A-114 and A-108 change when built; `baseline.md` marks 2+1 reviews and no automatic merge as default policy (D-023); plan row 11 follows A-105 and A-122, not source §06's retry; D-016 reads with A-037 and A-042 (a probe-only edge case with no incident and no damage by mistake is parked or accepted); A-054's "the controller itself never merges" reads as "a merge happens only through a grant the owner gave". O-001 (answered by row 3, A-019) and O-014 (answered by both research passes) are closed; `parked.md`'s "pending review" lines for 08-d say merged. A-118 already reversed A-030 and gave both runtimes the same developer powers (D-002); A-120 makes the model selectable.
3. Review tiers in `docs/workflow.md` and `AGENTS.md`: Trust (store, controller and engine, sandbox, grants, git over candidate trees) keeps 2+1 through `claude -p`; Light (refactors, docs, the guide) gets one review. A missing test for correct code is a minor finding.
4. Independent verification is `scripts/pre-merge-commit`, a git hook the owner installs once; it runs `npm test` on an export of the merge result's index. The session ran it on this branch: 450 tests, 426 pass, 0 fail, about 30 s.
5. `docs/security/threat-model.md`: one page of concerns, the trifecta rule, assets, actors and boundaries.
6. A private remote for this repository, push only, no CI: the owner creates it.
7. Plan rows: "Spec up to date" (docs ticket) and 11a "Dogfooding", after row 11.
8. Merge and waiver records stay in this file.

### A-124 — 2026-10-21 — Extension points on demand; a decision shape for dispatch; observer verbs; manifest and lock later

Owner, on foundations theme T11 (`docs/research/2026-10-20-foundations/extend-config.md` proposals 6, 7, 8; `design-audit.md` P7): “As recommended”.

Effect:
1. A-113 gains a counterweight, also in `AGENTS.md`: build an extension point when a workflow or extension the owner runs needs it; until then, plain code. The same rule as "zero dependencies until a test needs one". A-117's step-type registry already follows it.
2. Dispatch (row 12) uses a decision shape: a pure, sandboxed JSON function whose answer is recorded as an event. The default stays a number in config. Widens D-024 from two shapes to three.
3. With `stop-run` in the Run records row: observers may also send `note`, and the store keeps a cursor per observer. An `sf observe` supervisor waits with O-006.
4. An extension manifest and lock file, pinned by content hash, is a plan row built before the first workflow or extension is shared outside this repository.
5. `learn/` is unchanged from A-112.

### A-123 — 2026-10-21 — Engine correctness: owner events bound to a SHA and deduplicated; replay divergence detected; linear replay; checker gaps

Owner, on foundations theme T10 (`docs/research/2026-10-20-foundations/engine.md` P2, P6, P9, G14; each defect reproduced by a probe), with the session's placement: “Adopt as suggested”.

Effect (`docs/plan.md`):
1. With row 11's fourth ticket (A-114): `request_changes` carries `head`; every event from outside a run carries a `commandId` the store deduplicates. Extends spec principle 2 to the owner's verdicts; widens A-074 Q6a and 10-d's observer contract. Before row 12 in any case.
2. With row 11's third ticket: a stage checksum per row, an engine version on the open row, and a light replay check for recorded workflows, so a tightened `checkWorkflow` never makes an old cycle unloadable. Partly reverses 10-d's rejection of alternative 3 (the column is a checksum; `apply` stays the one source); refines A-112 item 6.
3. With the progress rows (A-116): history appended without copying, so replay stays linear.
4. With JSON workflows (A-120): `checkWorkflow` refuses a PASS edge to `ESCALATED`, an unreachable stage, and a grant stage not after a PASS verdict.

### A-122 — 2026-10-21 — No daemon now; runs outlive the controller, and recovery adopts finished runs

Owner, on foundations theme T9 (`docs/research/2026-10-20-foundations/runtime-process.md` proposals 4 and 7; `design-audit.md` P4), asked: no daemon now, with three triggers recorded on O-006; and runs that outlive the controller in row 11, finished runs adopted by default: “Yep this all sounds good, a daemon is probably the long term goal (especially one that could run on a VM and then serve to another computer for example)”.

Effect:
1. O-006 stays open with the long-term goal and the triggers in `docs/open-questions.md`. The factory stays one-shot commands over SQLite; `recover` and later `dispatch` are commands the owner or a systemd user timer runs. A later daemon calls the same commands.
2. Row 11's fifth ticket, before `recover`: runs outlive the controller. Output and exit code go to files kept by a supervisor that is not the controller. `recover` watches or stops a running run, receives a finished one under its original run ID, and escalates one that left nothing. Widens A-105: a run that finished while the controller was down is received, not escalated; this is not a relaunch. A "never adopt" setting keeps A-105 exactly. Unverified: whether a systemd transient unit keeps its exit status after it ends.

### A-121 — 2026-10-21 — Sandbox hardening without friction; subordinate UID parked

Owner, on foundations theme T8 (`docs/research/2026-10-20-foundations/security.md` P5, P6, P7, P10, P11; `runtime-process.md` pi MCP note), asked to adopt items a to f and park g: “Yes”.

Effect (`docs/plan.md`, Sandbox hardening row, with or before A-106): resource limits and a disk floor; a `stop` command; the clone's `.git/hooks` and `.git/config` reset after each run, with a warning on the printed path; the developer's clone holds only the base's history; `--disable-userns` after a probe, seccomp later; `--no-mcp` for the pi reviewer. Running agents under a subordinate UID is parked as a backend option, off by default. Confirms D-019 (bwrap first).

### A-120 — 2026-10-21 — Strict configuration: one schema, provenance, canonical workflow hash, runtime entries as data

Owner, on foundations theme T7 (`docs/research/2026-10-20-foundations/extend-config.md` proposals 1, 2, 4 and 5; probe: typos such as `sandbox.reed`, `grnats` and `model` accepted silently), with the session's order: “Adopt”.

Effect (`docs/plan.md`):
1. With JSON workflows: one declared schema for every file the owner writes; unknown keys refused at every depth with "did you mean", naming file, pointer and layer; a generated JSON Schema; values checked at load. A canonical workflow hash and a format version in the same ticket. Widens A-078 Q3 (merge rule per key) and A-056.
2. With `doctor`, before `recover`: provenance per value, a `config --show-origin` command, and a hash of the effective config on the open row that `resume` checks. Widens A-105 item 2.
3. With the Role prompts row: runtime entries carry model, effort and arguments; the repository layer may pick a runtime per role but not define one. Widens A-074 Q7 and A-113 item 3.

### A-119 — 2026-10-21 — Repository trust: capabilities without friction by default; friction opt-in per repository

Owner, on foundations theme T6 (`docs/research/2026-10-20-foundations/security.md` P3, P4; `extend-config.md` proposal 3), asked first: “Okay, some of these just sound like making it harder to use and not trusting the user. Is that the correct reading?” The session agreed for three of the five (trust by hash on the owner's own repositories, a default protected-paths FAIL, a human gate before grants) and revised them. Owner: “Yes let's take the revised version, allowing friction to be optionally added on a per repo basis.”

Effect (`docs/plan.md`: JSON workflows, Repository trust, row 12):
1. Repository workflows load as JSON data only; first of A-111's soon items. Closes A-078 when built.
2. An owner floor: a personal `require` block (checks that always run, a human stage, a minimum review budget), empty by default. A repository workflow below it is refused; a repository's checks add to the floor's, never remove them.
3. Trust by content hash, by default only for repositories whose base the owner does not control. The owner's own repositories keep A-095's check and no extra step.
4. A `protected-paths` check ships as an optional stage, not in the default workflow; after A-109 it may raise a needs-owner finding instead of a FAIL.
5. Grant stages run with `checkout: false` by default. An owner `accept` before a grant is released is an option, off by default.
6. Each piece of friction (2, trust by hash, protected paths, the grant gate) can be turned on per repository in the owner's personal config.
7. A-113, qualified: policy lives in workflows, but a floor the owner sets binds every workflow a repository supplies. Security keys (sandbox, egress lists, grants, the floor) are set only in the owner's layers. Widens D-024's rule for `sandbox` and `grants`. Reopens A-078 Q1 and Q2; widens A-095; A-074's repository layer may set checks, workflow and runtimes only above the owner's floor.

### A-118 — 2026-10-21 — Defaults set before the sandbox: developer runs the checks; the adversarial reviewer may run commands

Owner, on foundations theme T5 (`docs/research/2026-10-20-foundations/design-audit.md` P2, P3), with the session's recommendations (1: the developer runs the checks by default, after A-106; 2: reviewers may run commands in a sandbox with no network and a read-only checkout, on by default for the adversarial reviewer; 3: keep A-108 item 2 and tune from run logs): “Yes, though we've already captured point 2 I think. These are all good suggestions”.

Effect (`docs/plan.md`):
1. The "developer runs the checks" option is on by default once A-106 lands. Reverses A-112 item 11's "off by default". The claude developer can already run code through `.git/hooks` and `git commit`, and pi's developer has a shell, so the sandbox bounds the run; both runtimes get the same powers (D-002).
2. Point 2 is close to A-112 item 10 (the controller runs a reviewer's script at the SHA), which is already on the Acceptance evidence row. The new part, added to that row: a reviewer may also run commands itself, with no network and a read-only checkout, on by default for the adversarial reviewer. Reverses A-030, which dated from reviewers running unsandboxed. The security review's "reviewers with no network tools" still holds, because the reviewer gets no network.
3. Unchanged: the default workflow keeps `VERIFYING: FAIL → ESCALATED` (A-108 item 2); a fix round on a red check is tuned from run logs (A-116).

### A-117 — 2026-10-21 — Named outcomes and declared step inputs and outputs, before A-108 and A-109; step-type registry on demand

Owner, on foundations theme T4 (`docs/research/2026-10-20-foundations/engine.md` P3, P4): “Yes to both recommendations, keeping in mind  our principles around the core, extensibility etc this seems to be on the right track”.

Effect (`docs/plan.md`, Structured findings row):
1. Named outcomes and declared inputs and outputs are the design A-108 and A-109 are built on. A stage declares its outcomes (default `PASS`/`FAIL`, so today's workflows are unchanged) and its inputs by name and source; a step type declares its outputs. Outputs are SHA-bound files with a hash in the outcome event, never interpolated into prompts or argv. `checkWorkflow` checks the dataflow, which replaces `driverLimits` (A-096). Answers A-074 Q8; widens A-056 and A-057. A-109 A's routes become workflow edges, not core rules.
2. Step-type registry: a design note now (the engine keeps three effects: candidate change, evidence about a head, wait for a decision; step types register and never set stage or budget). It is built when the second new step kind needs it, likely acceptance evidence. Revisits D-024 then.

### A-116 — 2026-10-21 — Stream, keep and parse run output; progress lines; claims through the CLI's schema

Owner, on foundations theme T3 (`docs/research/2026-10-20-foundations/runtime-process.md` proposals 1, 2, 3 and 6), with the session's order (1 and 6 as the Run records ticket; 2 after `protocol: 1`; 3 with structured findings): “Yes accept”.

Effect (`docs/plan.md`):
1. Run records: claude runs with `--output-format stream-json --verbose`, pi's JSONL is read line by line, and every run's output is written to `runsDir/runs/<runId>/` as it arrives. The parser records model, tool list, usage, cost and stop reason. Reverses 04-d's "no streaming" (A-024). Cancel stops claude with SIGINT first, so a stopped run keeps its cost.
2. After `protocol: 1`: adapters report progress; the controller keeps rate-limited `run_progress` rows outside the event log; extension runtimes may print progress lines before their outcome. Widens D-024 and A-074. This gives A-113's watchdog its heartbeat.
3. With structured findings: claims through each CLI's schema option, the fenced block as fallback, `apply` still validating.
4. No SDK: both vendor SDKs spawn the same CLI over stdio, so the CLI adapters stay (D-002, P-002 confirmed).

### A-115 — 2026-10-21 — Egress proxy joins the parked domain-filtering line; own credential later; threat model restated

Owner, on foundations theme T2 (`docs/research/2026-10-20-foundations/security.md` P1, P2 and "Challenged decisions"): “Okay we already have domain filtering on the plan right? So p1 should go with that.” “P2 is worth looking at in the future, it sounds like it has the potential to degrade the experience, so I would want to be careful.” “Can restate 037”.

Effect:
1. Egress proxy (P1): the controller runs a proxy per run, and the sandbox has no network of its own. The proxy allows hosts from a list set only in the owner's personal or job layer, resolves names itself, refuses loopback, link-local, private, Docker-bridge and host addresses, and logs each connection. It joins the parked 08-a domain-filtering line, which A-106 kept parked, and gets a row in `docs/plan.md`.
2. Factory credential (P2): looked at later, not scheduled. The factory would run on its own revocable credential instead of the owner's CLI logins, injected by the proxy or passed through the environment. The owner's condition: it must not degrade the experience of using the CLIs.
3. Threat model, restating A-037: an agent that has read third-party content (dependencies, documentation, issue text) may act as if hostile, though nobody wrote malicious code. Defences need not be airtight (D-020 stays), but no run should hold private data, untrusted input and an open network together. The owner's first concern from A-037 stands: an agent going outside its remit, or a mistake that causes damage.

Owner, asked whether to build the pasta ticket (A-106) as planned with the Docker-bridge and LAN gap recorded as an accepted risk until the proxy lands, or skip to the proxy; and whether T1's in-place moves go in row 11 after the three refactors and before `recover`: “Yes to both recommendations”.

Effect: the A-106 ticket stays as planned; its record notes that host services on Docker-bridge addresses (172.17.0.1, 172.18.0.1 probed) and LAN hosts (192.168.1.1 probed) stay reachable until the egress proxy, and `docs/work/accepted-risks.md` lists it. T1 (A-114) is row 11's fourth ticket, before `recover`, with A-109 B folded in.

### A-114 — 2026-10-21 — An escalated cycle waits for the owner; it is no longer a dead end

Owner, on foundations research theme T1 (`docs/research/2026-10-20-foundations/TRIAGE.md`; `engine.md` P1, `design-audit.md` P1): “Yes this is a good change, an escalation shouldn't always be an abandon and we need to have flexibility in how we treat it.”

Effect:
1. ESCALATED becomes a stage that waits for the owner. The owner answers with an `owner_decision` event carrying the action, a quoted reason, its source and the head SHA. Moves: `retry` the stage that escalated (spent budget stays spent); `overrule` a FAIL (A-109 B: refund one unit of that stage's budget, rerun the stage); `fix` chosen findings, verify, then continue at a named stage; `accept with risk` (the findings go to accepted risks); `route` to a stage the checker allows; `cancel`. A child cycle stays for "start over", with an option to start from the parent's candidate instead of the base.
2. Widens D-016 and A-072: anything unclassified still escalates, and the owner has the moves above as well as child cycle and cancel. ESCALATED leaves `SETTLED`; the one-open-cycle rule treats it as open and waiting.
3. Spec core rules 2 and 3 change with the ticket that builds this: spent budget stays spent unless the owner overrules, and the owner's choices are the moves above.
4. A-113: the core holds the moves; whether a workflow offers one is policy. An observer may send `retry` with its own source, which gives opt-in automatic relaunch without changing A-105's default.

### A-113 — 2026-10-20 — Principle: capabilities and extension points in the core; defaults are sane, not enforced

Owner, on the last unranked research items (a gate on cycles waiting for the owner, a stall watchdog, a stronger model for the last fix round, GitHub sync notes): “Okay these all look good, but I want to make sure we're focused on making them possible in the core and with extensions not necessarily just enforcing them.” And: “the check for what and when a ticket becomes available should be extensible”; “The watcdog itself is probably an extension built on our observability right?”; “The stronger model is probably just a different workflow, so again lets just make sure we support it in the workflow engine but we don't necessarily need to do that for our default.” Then, on the session's write-up: “Yes please”.

Effect, a standing principle for every ticket: build the capability or extension point in the core, ship a sane default, and leave policy to workflows and extensions. A ticket that adds policy says which extension point holds it. Applied now (`docs/plan.md`):
1. Dispatch (row 12): an extension point decides which ticket may start next and when; the default refuses a new cycle while K cycles wait on the owner.
2. Watchdog: an observer extension. The core adds what it lacks: progress or heartbeats from a run in flight, and a request that stops one run without settling the cycle (Run records row).
3. A stronger model: a workflow choice. A second commit stage under its own role is likely possible today and gets a proving test; a runtime entry may name a model or arguments (Role prompts row).
4. GitHub sync notes: confirmations of A-095, A-100, no automatic merge, and grants (row 12).

Owner, asked whether to add the principle to `AGENTS.md` as well: “Yes add it to agents.md as well.” It is a line under "Rules".

### A-112 — 2026-10-20 — Two live-run gaps placed; row 11 starts with one driver entry point

The owner asked which research findings were left out of the walkthrough (A-105 to A-111) and why. The session listed them (`docs/research/2026-10-20/`); this and the next entries record the owner's decisions on them.

1. The two live-run gaps already in `docs/plan.md` (reviewers see each check's command; each run's raw runtime output is kept). The session recommended raw output go with A-111's run-records ticket, since tuning from logs needs the why as well as the cost, and the check command stay with the prompts row, so the contract hash changes once. Owner: “okay make sure we've logged your findings against the plan so we don't miss these.”
2. One driver entry point (`architecture.md` finding 2): `drive` exported from `src/run.ts`; `acceptCycle` and `cancelWork` in a new `src/decide.ts`, without printing; `main()` only under `import.meta.main`. A pure refactor; whether `accept` then drives on (the grant-after-human gap) is decided in row 11 or 12. Owner: “Yes lets make it row 11s first ticket”.
3. A `layout` module for cycle paths (`architecture.md` finding 5): `src/layout.ts` names the default runs folder, the clone, branch, verify checkout and evidence paths once; every module and `recover` use it. A pure refactor. Owner: “Makes sense to me, make it the second ticket.”
4. Extension runtime extras (`extensibility.md` findings 7 and 8): (a) `runtimes.<name>.network`, an option a runtime may set; (b) `src/kits/` bound read-only at a fixed path (`/sf/kits`) in every command and runtime sandbox, with a `serve()` helper, versioned with `protocol: 1`. One ticket, after `protocol: 1` (A-111). Owner: “3a yes keep defaulting to true, but its worth having the option exposed. 3b yep great idea. Placement is fine.”
5. Pool model (`architecture.md` finding 9; `harnesses.md` finding 8): one process per cycle, or one process for many cycles, which needs async `accept`, `receive` and `land`, since the controller's sync git blocks the event loop up to a stage deadline. The session leaned to one process per cycle. Owner: “Okay lets log our findings, but don't record a direction. Let that work do its own research, compare and consider your findings and we'll come up with a solution then.” No direction is recorded; row 13 researches the choice afresh, with these findings as input.
6. Replay each cycle under its recorded workflow (`architecture.md` finding 7): `store.load` replays a cycle under its open row's definition when that passes `checkWorkflow` and hashes to the recorded workflow, else under the given workflow if it matches, else throws; `store.unsettled()` lists open cycles across work IDs; `decisionConfig` becomes a fallback for stores written before 10-d. This widens A-059 Q2 from "refuse a cycle whose hash does not match" to "refuse only when nothing matches". A row 11 ticket after the layout module and before `recover`. Owner: “Yep looks good.”
7. The guide's stand-ins copy `src/` logic and have drifted (`architecture.md` finding 8). The session recommended extracting each pure part (`replayRow`, `fixInput`, `openRefusal`) as tickets touch those modules. Owner: “A dedicated ticket I think, the learning is experimental and probably not something that will ship”. So one dedicated, low-priority ticket does the extraction; core tickets do not carry it.
8. `land` keeps fetched objects in the owner's repository when it refuses a claim (`security.md` notes), so a large commit stays until gc prunes it. The session recommended a size cap before the fetch, measured by sandboxed git in the developer's clone (`rev-list --objects --disk-usage base..branch`), default 100 MB, set in the job file; not a quarantine repository, and never `gc --prune=now`. Owner: “Yep agree with your recommendation”. A small, low-priority ticket beside A-111's clone cleanup.
9. Small doc drift (`sweep.md` finding 9), fixed by the session on this branch: the README's "Start here" list numbered two items 3; the spec's head-change and base-change rows now say no step records those events yet.
10. An adversarial FAIL backed by a failing test (`deep-research.md`, unranked): the reviewer attaches a script; the controller runs it at the SHA; a script that fails confirms the FAIL, one that passes downgrades the finding. Owner: “Yeah this is a great idea, I've often wondered if the reviews are just flagging things that don't really matter. So lets record it as an idea against those primitives”. Recorded as a use case for the primitives of A-107 (run on base), A-109 (structured findings) and the plan's Acceptance evidence row (an agent step writes a script, a command step runs it); not a ticket of its own, and the default workflow is not changed.
11. The claude developer cannot run tests (`deep-research.md`, unranked): its Bash allows only `git add`, `commit`, `status` and `rev-parse`, a list from 05-a, before the sandbox (08-c); pi's developer has an unrestricted shell inside the sandbox. The session recommended letting the claude developer run exactly the job's declared check commands, after A-106. Owner: “Okay yes this makes sense right, doing it this way allows a workflow to be setup as it is today BUT also allows you to give the developer access to running the tests.” So it is an option a workflow or job turns on, off by default, which keeps today's claude developer; it does not change pi, whose shell is unscoped. A small ticket after A-106 (`pasta`).

### A-111 — 2026-10-20 — The smaller research items: three soon, the rest tracked; "Ken Chun" is Kun Chen

Asked, from the overnight research (TRIAGE owner items 8 to 18): ticket soon (1) run records: `run_failed.cause`, cost, tokens, model and CLI version per run, and `claude`'s turn and budget caps; (2) JSON workflows, with a repository workflow required to be data (closes A-078); (3) `protocol: 1` on the extension contracts. Track for later: a `doctor` command, a `status` command with clearer job-file errors, clone cleanup, faster tests, and a warning at `accept` when the base moved (`head_changed`/`base_changed` have no producer, A-103). Owner: “Yes agree with the split, these all seem very useful so I'd definitely want them all done at some point.”

Also, the owner on the person the brief named "Ken Chun": “Kun Chen is the correct person” (GitHub `kunchenguid`, author of no-mistakes, which the research used).

Effect: each item is a row in `docs/plan.md`'s later work. The three "soon" items are drafted as tickets first; each needs the owner's go before it is READY.

### A-110 — 2026-10-20 — Reviewer wording kept as input to O-013; no prompt change now

Asked, from the overnight research (`docs/research/2026-10-20/harnesses.md` finding 5, TRIAGE owner item 6): borrow no-mistakes's reviewer wording, and should a re-review after a fix see the earlier findings, labelled as claims. Owner: “yes I agree generally so we can log these findings to be reviewed when we get to the currently planned prompt etc. stage”.

Effect: the default prompts do not change now. O-013 lists the research's wording and the prior-findings question as inputs, to be decided when the prompts and skills row starts.

### A-109 — 2026-10-20 — Structured findings, and the owner may overrule a finding inside the cycle

Asked, from the overnight research (`docs/research/2026-10-20/deep-research.md` proposals 7 and 8, `harnesses.md` finding 4, TRIAGE owner item 5): (A) findings carry `file:line`, `requirement`, `severity` (blocking or minor), `scenario` (input, expected, actual) and `action` (fix, or needs the owner; missing means the owner); only a blocking finding can FAIL; minor findings go to the owner, not the fix run; a needs-the-owner finding escalates. (B) an owner command marks a finding false with a quoted reason, refunds the budget the FAIL spent, reruns the same review stage, and shows the ruling to the next reviewer. The session recommended both: A as a Design-route ticket landing before or with A-108's primitive, B after A, with those defaults. Owner: “Yes to both”.

Effect: two tickets to draft, A first. A changes the verdict contract and the fix-run input (O-011, O-013 touch it). B is the ticket A-072 named. Each still needs the owner's go before it is READY.

Owner, adding: “we should look for other opportunities to provide structure to input/output across the core AND potentially have the ability to set this up in the workflow definitions and other extensions.” So A's design also surveys the core's other free-text inputs and outputs for the same treatment, and asks whether a workflow definition or an extension (runtime, kit) may declare the shape of what a step takes and returns. Recorded on the plan's "Structured findings" row.

### A-108 — 2026-10-20 — A commit stage can act on a red check; the default workflow still escalates

Asked, from the overnight research (`docs/research/2026-10-20/harnesses.md` findings 2 and 3, TRIAGE owner item 4): build the engine primitive that lets a commit stage take a failed verification as its findings, and whether the default workflow should loop on a red check. Owner: “Yes build the primitive, in fact I would want to theoretically allow a workflow step that is meant to act as a reviewer to have the authority to make these small edits themselves, especially when its a docs, comment or some other trivial fix. My feeling is that we could already achieve that though. Lets leave the default workflow as is.”

Effect:
1. A ticket (Design route, to be drafted) lets a commit stage re-entered from a command stage's FAIL run as a fix with the failed checks (name, command, output tail) as its findings. Preflight's refusal of that shape (`driverLimits`) is then deleted.
2. The default workflow keeps `VERIFYING: FAIL → ESCALATED`. The owner tunes it later from run logs.
3. The owner wants a reviewer-like step that may make small edits itself (docs, comments, trivial fixes). The session found this is not possible today: a role produces either a commit or a verdict, never both; a commit stage entered by a PASS is refused by preflight because `fix` needs a FAIL's findings; and a commit stage has no "nothing to change" outcome. The same ticket's design should consider generalising a commit stage's input (a review's findings, a check's failures, or none) and a "no change" outcome, so such an editing step can be written as a workflow. Any commit it makes is a new SHA, so verify runs again; whether its edits are reviewed again is the workflow's choice.

Owner, after the session explained why an editing reviewer is not possible today and that it is the same primitive: “Okay yes, I agree that we should work on that primitive with those use cases in mind.” The ticket's design covers all three inputs (a review's findings, failed checks, none) and the "no change" outcome.

### A-107 — 2026-10-20 — Owner-held tests (O-005): visible by default; the core keeps the primitives for a hidden holdout

Asked, from the overnight research (`docs/research/2026-10-20/deep-research.md` proposal 4, `harnesses.md` finding 7, TRIAGE owner item 3): who writes acceptance tests, may the developer see them, and must they fail on base. The owner: “Okay at this stage, the workflow that I envisage doesn't hide tests. Though I think we should build the primitives to allow this”. The session found two of three primitives exist (a `{ file }` argument from a `workflowDir` outside the repository is copied into the stage's evidence and bound only for that check; a protected-path check is an ordinary check reading `diff.patch`), and that "must fail on base" needs the core (verify runs checks only on the candidate, and evidence binds to the candidate SHA). Owner: “Yes thats good, at some point I will start tuning the workflow and especially with the recording of logs and seeing where our failures are then we'll know if the develop stage is consistently writing bad tests or changing them etc.”

Effect:
1. The default workflow uses visible tests. Whether to hide them is a workflow choice, made later from run logs: whether developers write weak tests or edit them.
2. Later, small: a sandbox test pinning that the developer cannot read `workflowDir` or any stage's evidence copies; an example protected-path check.
3. Later, Design route: a "run on base" option for command stages, with the evidence rule extended to name the SHA each result is for.
4. Known leak, accepted: a hidden test's failure output reaches reviewers, whose findings reach the fix prompt.

### A-106 — 2026-10-20 — Networked sandboxes get their own network namespace through pasta

Asked, from the overnight research (`docs/research/2026-10-20/security.md` finding 3, TRIAGE owner item 2): a networked sandbox (`--share-net`) reaches every service on the host's 127.0.0.1 and its abstract Unix sockets (CUPS, PostgreSQL and Steam ports confirmed). Fix with `pasta` (Arch `passt`, a new system dependency) with host loopback unmapped, with a controller-run proxy, or leave it. The session recommended `pasta` now and the proxy later, for domain filtering (the parked 08-a note). Owner: “pasta now”.

Effect: a ticket, to be drafted, replaces `--share-net` with `--unshare-net` plus `pasta` with host loopback unmapped, for every networked sandbox (agent runs and network command stages, grant stages included). Test first: a `node:net` server on 127.0.0.1 in the test process is unreachable from a `network: true` sandbox. `passt` is a new system dependency; the owner installs it (`sudo pacman -S passt`, in `extra`). The proxy stays parked with 08-a. The ticket still needs the owner's go before it is READY.

### A-105 — 2026-10-20 — Row 11 (recovery): always escalate a crashed run; resume refuses a changed job

Asked, from the overnight research (`docs/research/2026-10-20/`, TRIAGE owner item 1): after an agent run whose controller died, relaunch it once or always escalate; and should a resume refuse when the job file changed since the cycle opened. The session recommended always escalate for now, and yes to the refusal. Owner: “Yes to both recommendations”.

Effect, for row 11's tickets (none built yet):
1. A run whose controller died without an outcome is recorded as `run_failed` and escalates, as D-016's plain rule says. No relaunch. The spec's "may relaunch a failed run once per cycle" proposal and the plan's "relaunch budget per cycle" are withdrawn for row 11; they may return once `run_failed` records a cause (research item `run_failed.cause`), with a cap and only for a crash, as every surveyed system that relaunches does.
2. The open row records a hash of the job's ticket and checks; `resume` refuses a cycle whose job no longer matches.
3. The rest of row 11 follows the research's restart rules (`harnesses.md` finding 1, `deep-research.md` proposal 1): every run, reviewers included, records `run_started`; recovery leaves a cycle parked at a human stage or ESCALATED, reruns a command stage, and for an agent stage with a started run and no outcome pins the clone's branch tip under a recovery ref, then records `run_failed`; a lock is taken before recovery. These are design inputs; each ticket still needs the owner's go.

### A-104 — 2026-10-20 — sweep-lifecycle-constants: merged after the owner's walkthrough

Owner, after the walkthrough: “Yep this is a good change, merge”.

Effect: `feat/sweep-lifecycle-constants` merges into main locally with `--no-ff`. `SETTLED`, `outcomeRunId` and `EVENT_TYPES` are defined once in `src/lifecycle.ts`; the store, the controller (including the cancel watch from A-098) and the guide's shim use them. A new event type needs three edits, not four. One fresh in-session review covers the branch (PASS; dedup byte-identical); the `claude -p` reviews and the adversarial review did not run. Merging main into the branch conflicted in the spec's head, base and duplicate rows; both sides combined. The owner did not run `npm test`; the session's run on the branch with main merged in (450 tests, 426 pass, 0 fail; `test:learn` 6 of 6, the same as the overnight trial merge of all ten) is not independent. This is the last of the ten overnight branches.

### A-103 — 2026-10-20 — sweep-stage-guards: merged after the owner's walkthrough

Owner, after the walkthrough: “merge, good tests”.

Effect: `feat/sweep-stage-guards` merges into main locally with `--no-ff`. Tests only: each event type sent to each stage kind that does not take it escalates "outside" and spends no budget, and the three ignore branches are pinned. The ticket's question, that `head_changed` and `base_changed` have no producer (warn at `accept`, or escalate when the base moves), is not decided; it stays open. One fresh in-session review covers the branch (PASS, 19 of 19 mutants caught); the `claude -p` reviews and the adversarial review did not run. The owner did not run `npm test`; the session's run on the branch with main merged in (449 tests, 425 pass, 0 fail; `test:learn` 6 of 6) is not independent.

### A-102 — 2026-10-20 — sweep-lazy-runtimes: merged after the owner's walkthrough

Owner, after the walkthrough: “Looks good to me, merge”.

Effect: `feat/sweep-lazy-runtimes` merges into main locally with `--no-ff`. An extension runtime's module is read and hashed when its adapter is built (A-075), so an entry no role selects blocks nothing, and `accept`, `cancel` and `events` never read one; a read error names `runtimes.<name>`. One fresh in-session review covers the branch (PASS); the `claude -p` reviews and the adversarial review did not run. Merging main into the branch conflicted in the spec's Driver bullets; both sides kept. The owner did not run `npm test`; the session's run on the branch with main merged in (446 tests, 422 pass, 0 fail; `test:learn` 6 of 6) is not independent.

### A-101 — 2026-10-20 — sweep-terminal-escapes: merged; the prototypes stay as they are

Owner, after the walkthrough: “Looks good, we can leave the prototypes as is”. The owner runs the merge command.

Effect: `feat/sweep-terminal-escapes` merges into main locally with `--no-ff`. `main.ts` passes every stored or agent string it prints through `printable`; the event log keeps the raw text. `proto/board.ts` and `proto/run.ts` stay unescaped, by the owner's choice. One fresh in-session review covers the branch (PASS); the `claude -p` reviews and the adversarial review did not run. The owner did not run `npm test`; the session's run on the branch with main merged in (443 tests, 419 pass, 0 fail; `test:learn` 6 of 6) is not independent.

### A-100 — 2026-10-20 — sweep-reviewer-instructions: merged; reverses 06-b's "read from the candidate commit"

Owner, after asking whether the planned role prompts and skills work (O-013) would overwrite this, and hearing that it changes the core's side (where instructions are read from, and a delimiter line), not the role's judgement text: “Okay merge”.

Effect: `feat/sweep-reviewer-instructions` merges into main locally with `--no-ff`. Reviewers get each repository instruction file from the base; when the candidate changes one, the section header says so and points to CHANGED PATHS and the DIFF. This reverses 06-b's "read from the candidate commit", which gave no reason. The review contract hash changes. O-013 gains the constraint that repository-supplied instructions, prompts and skills are read from the base. The parked `CLAUDE.md` discovery by the claude reviewer (06-c note) is now the main way around this rule. One fresh in-session review covers the branch (PASS); the `claude -p` reviews and the adversarial review did not run. Merging main into the branch conflicted in the spec's verify and review bullets; both sides kept. The owner did not run `npm test`; the session's run on the branch with main merged in (441 tests, 417 pass, 0 fail; `test:learn` 6 of 6) is not independent.

### A-099 — 2026-10-20 — sweep-git-hardening: merged; the stored-bytes trade-off logged

Owner, after the walkthrough: “Okay this is good, but I'd want the tradeoff logged - probably as a limitation in the README if not elsewhere as well. It might be something we need to revisit”.

Effect: `feat/sweep-git-hardening` merges into main locally with `--no-ff`. Verify's checkout reads no attributes and holds the commit's stored bytes; the trade-off (no `eol`, `ident` or LFS conversions; the `core.autocrlf` caveat) is logged in the README's "Known limitations" and as a row in `docs/work/accepted-risks.md`, with the event that reopens it. One fresh in-session review covers the branch (PASS, findings fixed); the `claude -p` reviews and the adversarial review did not run. The owner did not run `npm test`; the session's run on the branch with main merged in is not independent (result in the ticket log).

### A-098 — 2026-10-20 — sweep-cancel-aborts: merged after the owner's walkthrough

Owner, after the walkthrough: “Looks good, merge”.

Effect: `feat/sweep-cancel-aborts` merges into main locally with `--no-ff`. A run in flight reloads its cycle once a second and aborts when the cycle has settled, recorded as `run_failed` with reason `cancelled`. `RunOptions.signal` is left to row 11. Reviews: two fresh in-session standard reviews (FAIL on guide text, then PASS); the `claude -p` reviews and the adversarial review did not run. Merging main into the branch conflicted only in `tests/run.test.ts` (two appended blocks; both kept). The owner did not run `npm test`; the session's run on the branch with main merged in (435 tests, 411 pass, 0 fail; `test:learn` 6 of 6) is not independent.

### A-097 — 2026-10-20 — sweep-open-race: merged after the owner's walkthrough

Owner, after the walkthrough: “Makes sense to me, lets merge as well”.

Effect: `feat/sweep-open-race` merges into main locally with `--no-ff`. `EventStore.open` checks and inserts inside one `BEGIN IMMEDIATE` transaction, so two processes cannot open two cycles for one work item. One fresh in-session review covers the branch (PASS, two nits); the `claude -p` reviews and the adversarial review did not run. The owner did not run `npm test`; the session's run on the branch with main merged in (432 tests, 408 pass, 0 fail; `test:learn` 6 of 6) is not independent.

### A-096 — 2026-10-20 — sweep-preflight: merged after the owner's walkthrough

Owner, after the walkthrough: “Okay yes this is a good catch and a great implementation idea - 'pre-flight' checks are good and I think we could expand this to other uses in the future.” Then, asked for an explicit word: “Approved”.

Effect: `feat/sweep-preflight` merges into main locally with `--no-ff`. The workflow shapes today's driver cannot run stay in `driverLimits` in the driver, not in `checkWorkflow` (the ticket's alternative 1). Owner's note for later, not a ticket: preflight could grow to other uses; the ticket's non-goals name two candidates (a missing `{ file }` argument, a job with no checks) and a known gap (a grant stage reached with no review PASS). Reviews: two fresh in-session standard reviews (FAIL, then PASS; findings fixed; the last round read by the session, not reviewed again); the `claude -p` reviews and the adversarial review did not run. The owner did not run `npm test`; the session's run on the branch with main merged in (431 tests, 407 pass, 0 fail; `test:learn` 6 of 6) is not independent.

### A-095 — 2026-10-20 — sweep-head-workflow: merged after the owner's walkthrough

Owner, after the plain-English walkthrough and a worked example of the attack: “Okay, makes sense. Merge and onto the next one”.

Effect: `feat/sweep-head-workflow` merges into main locally with `--no-ff`. A repository workflow is imported only when a local branch or tag outside `sf/*` contains the base. "Merged" keeps the built meaning (any such branch or tag); the owner did not ask for the narrower "default branch only". Before the merge the session folded the two `if (fromRepo)` lines in `loadConfig` into one block (no behaviour change). One fresh in-session review covers the branch (PASS, its finding fixed); the `claude -p` reviews and the adversarial review did not run. The owner did not run `npm test`; the session's run on the final tip (423 tests, 399 pass, 0 fail) is not independent. A-078's accepted-risks row is updated to match.

### A-094 — 2026-10-20 — learn-refresh: merged after the owner's walkthrough

Owner, after the report that all five batches were done: “Okay all good, merge”.

Effect: `feat/learn-refresh` merges into main locally with `--no-ff`. No review covers it (A-092); the owner's walkthrough is the check. The owner did not run `npm test`; the implementer's run on `31fddb2` (419 tests, 395 pass, 0 fail) is not independent. Next: row 11 (recovery).

### A-093 — 2026-10-20 — learn-refresh is READY; build all five batches without stopping

Owner, after reading the learn-refresh ticket: “Okay, go ahead and do this work by yourself this is an experimental feature not really important to the core. So you don't need my input as you go through the process. Report back to me when you've completed the 5 batches.”

Effect: [work/learn-refresh.md](work/learn-refresh.md) is READY. The implementer builds batches 0 to 4 without a walkthrough between them, and reports when all five are done. The owner's walkthrough happens after that. It replaces the walkthrough after each batch in A-092.

### A-092 — 2026-10-20 — The guide gets a ticket; the owner walks through it instead of reviews

Owner, asked whether the guide goes through the ticket workflow and whether reviews apply: “Yes ticket, I don't think we necessraily need a review - I can just do a manual walk through. Lets walk through the decisions needed for the design doc. One small critique of the original was that it did feel quite repetitive across the pages”.

Then, on the seven design questions (what felt repetitive, the room list, the naming clash, demos for the new code, the simulator's scope, the order of work, what is out of scope): “1. Yeah its both, but also that we have the step through the workflow format in lots of them, that might be the best way but its a bit samey so either swapping up the method for how we showcase the features or making sure they are hyper focused when its not the generic whole picture page would help. 2. Yep keep the number small, as much as practical 3. Go with your recommendation 4. sure 5. Yep I think thats probably fine 6. Sure 7. Yep”.

Effect: the work is the Design ticket [work/learn-refresh.md](work/learn-refresh.md). It replaces A-050's "outside the ticket workflow" for this work. It has no standard or adversarial reviews; the owner walks through each batch in a browser. The design note follows the answers: only the simulator steps through a cycle, each room shows one feature in its own way, each rule is said once, and the guide keeps few rooms. The process room is renamed so that "workflow" names the engine. The ticket is not READY until the owner has read it and said go.

### A-091 — 2026-10-20 — Next: fix and expand the guide

Owner, after 10-d merged and row 10 was complete, asked what comes next: “Okay, the next thing I'd like to do is fix the learn page - both by actually fixing but expanding it to the new architecture and features”.

Effect: the next work is `learn/`, ahead of row 11. Make `npm run test:learn` pass again, and add what the guide does not yet cover. That is everything since 09-a: the workflow engine, prompt versions, registries, configuration layers, command stages, grants and the observation stream. Branch `feat/learn-refresh` is made from main at `d48c8d9`. A-050 keeps `learn/` outside the ticket workflow. Whether this work gets a ticket and reviews is not yet decided.

### A-090 — 2026-10-20 — 10-d: fix the review findings, then merge

Owner, after standard 1 and the adversarial review both passed on `05b550a` with three minors and two notes, offered a fix of all five tests first, the busy timeout on `openings()`, and a merge without another review: “fix and merge”.

Effect: the reader waits for the events table, not only the file; `source` is one single-line rule, checked by `SHAPE` and the CLI; the kit sends its unknown row after each case's events too; the reader skips an open row that is not an object; `openings()` sets a busy timeout. Tests first. Then `feat/10-d-observation-stream` merges into main with `--no-ff`, unreviewed after the fixes.

### A-089 — 2026-10-20 — 10-d: run the reviews

Owner, after 10-d was built at `05b550a` and asked to run `npm test` or waive it, and to run or waive the reviews: “run the reviews”.

Effect: standard 1 starts on `05b550a`. The owner gave no answer on running `npm test`; no owner-run result is recorded, and the reviewers' own runs are the independent ones.

### A-088 — 2026-10-20 — 10-d READY; observation stream design approved

Owner, after reading the 10-d ticket and [design/2026-10-20-observation-stream.md](design/2026-10-20-observation-stream.md) with its six questions: “take all”.

Effect: 10-d is READY, and the design note is approved with Q1 to Q6 as recommended. Q1: a line's `seq` is the row's store-wide position (`pos`), not its per-cycle number. Q2: rows written before 10-d get a position in `(cycle_id, seq)` order and a null `at`. Q3: the open row records the workflow's definition, so a runs directory replays without a job file; pre-10-d custom-workflow cycles print null stages unless the job file is given. Q4: `accept` and `cancel` take `--source <name>`, defaulting to `owner`. Q5: `observerKit` takes scripted cycles and expected actions, plus two fixed cases (an unknown event, a refused command). Q6: `proto/board.ts` stays as it is.

### A-087 — 2026-10-20 — Live run findings recorded in the plan; merge

Owner, after live runs 1 and 2 escalated (a reviewer misread a silent check's `exit 0`; a developer could not commit, likely through a denied `$(cat …)`), on recording the gaps: “lets capture this in the plan - we already have two sections that are relevant, skills and montioring and self improvement”. After run 3 reached AWAITING_ACCEPTANCE with the MERGE grant stage passing: “accpepted and merged, merge live-run-fidnings into main”.

Effect: `docs/plan.md`'s rows for role prompts and skills and for the improvement loop name the three gaps: the developer contract does not list the allowed git commands; the reviewer prompt does not show a check's command; a run keeps none of the runtime's raw output. `docs/live-run-findings` merges into main with `--no-ff`. Live run 3's cycle is accepted, and its head merged into the scratch repository by the owner.

### A-086 — 2026-10-20 — 10-e: fix the adversarial findings, then merge

Owner, after 10-e's adversarial FAIL on `79220e4` (one major: a grant file beside the claude or pi binary is readable by the agents' sandboxes; three minors: no test of the head gate's PASS-for-this-head rule, `head.stdout` redacted after JSON quoting, overlapping values partly left in clear) and the recommendation to fix all four tests first, trim `\r\n` from a grant value, add the child-argv and cwd-config warnings to the design note, then merge without another review, as for 10-b and 10-c (A-080, A-082): “fix and merge”.

Effect: the fixes go on `feat/10-e-grants`, tests first, unreviewed. Then `git merge --no-ff` into main. On record: standard 1 FAIL on `231163d` (fixed at `818de56`), standard 2 FAIL on `818de56` (fixed at `79220e4`, A-085), adversarial FAIL on `79220e4`.

### A-085 — 2026-10-20 — 10-e: fix the standard 2 findings, then the adversarial review

Owner, after 10-e's standard 2 FAIL on `818de56` (one major: no test pins that `verify` keeps a grant's value out of bwrap's argv; three minors: overlapping values defeat redaction, a grant file under a system or runtime root is not refused, `tree.stdout` is not redacted) and the recommendation to fix all four tests first, also refuse `grants` on an agent stage and two grants with one variable in a stage, record the Q5 point against A-078's accepted risk, then run the adversarial review: “go as recommended”.

Effect: the fixes go on `feat/10-e-grants`, tests first, with no further standard review (the budget is spent). The A-078 row in `work/accepted-risks.md` notes that a repository workflow, run at import, could read a grant file, which Q5's refusal does not prevent. Then the adversarial review runs on the fixed head.

### A-084 — 2026-10-20 — 10-e: owner-run tests waived; run the reviews

Owner, asked to run `npm test` on `231163d` or waive it, and to run or waive the reviews: “run the reviews, don't worry about the tests (though we should do a live run soon)”.

Effect: 10-e carries no owner-run `npm test`; the implementer's run on `231163d` (374 tests, 350 pass, 0 fail) is labelled not independent in the review material. Standard review 1 runs on `231163d`, then the rest of the budget as `docs/workflow.md` sets it. A live run of the factory is wanted soon; not yet scheduled.

### A-083 — 2026-10-20 — 10-e READY; grants design approved

Owner, after reading the 10-e ticket and [design/2026-10-20-grants.md](design/2026-10-20-grants.md) with its five questions: “take all”.

Effect: 10-e is READY, and the design note is approved with Q1 to Q5 as recommended. Q1: a grant is `{ variable, file }` in the personal or job layer; the value comes from the file only and reaches the stage as that variable, through the spawn environment, never bwrap's argv. Q2: a workflow with a grant stage is refused under `sandbox.backend: none`. Q3: a grant stage runs only when each stage's last verdict, verification and `accept` is for the current head and at least one PASS verdict is for it; otherwise the cycle escalates before anything runs. Q4: a grant stage needs `run` and `network: true`, its FAIL can only escalate, and a missing or wrong `output/head` is a reserved `head` check that FAILs. Q5: a repository workflow may not ask for grants. These refine A-074's grants bullet; "an environment variable or a file" is read as where the value comes from.

### A-082 — 2026-10-20 — 10-c: fix the adversarial findings and the standard 2 minors, then merge without another review

Owner, after 10-c's adversarial FAIL on `69f402e` and the recommendation to fix on the branch and merge without another review, as for 10-b (A-080): “fix and merge without”, then, asked what “without” meant: “merge with out another review”.

Effect: four fixes on `feat/10-c-command-stages`, tests first, ending at `3e317b3`, with no further review. The adversarial major was a missing test: a repository file argument read at the base, not `HEAD`. The adversarial minor: `diff.patch` ignores the owner's external diff, textconv and colour. The standard 2 minors: a repository file argument must be a regular file in Git; the kit's writes case checks every file in the stage folder. Then `git merge --no-ff` into main. On record: standard 1 FAIL on `b97105f` (fixed at `69f402e`), standard 2 PASS on `69f402e`, adversarial FAIL on `69f402e`. The rule that a command stage's name must be a file stem was raised by both standard reviewers; the owner has not confirmed it, and it ships as built.

### A-081 — 2026-10-20 — 10-c READY; command stages design approved

Owner, after reading the 10-c ticket and [design/2026-10-20-command-stages.md](design/2026-10-20-command-stages.md) with its four questions: “Approved all recommendations”.

Effect: 10-c is READY, and the design note is approved with Q1 to Q4 as recommended. Q1: `run` entries are `{ name, command }`, not bare argv. Q2: a command stage's evidence, request, diff and file copies go in `evidence/<head>/<stage>/`, and `outputDir` is its `output/` subdirectory; the default workflow's evidence moves to `evidence/<head>/VERIFYING/`. Q3: a file argument is written `{ file: 'x.ts' }`, copied, hashed and bound read-only; a repository workflow's file is read at the base SHA. Q4: the reviewer sees every command stage's evidence for the head, not `output/`. These refine A-074's wording for `run` and `outputDir`.

### A-080 — 2026-10-20 — 10-b: fix the adversarial findings, then merge

Owner, after 10-b's adversarial FAIL on `38d38a6` (one major: no test that the repository layer's presence is checked at the base, not `HEAD`; three minors: a relative `XDG_CONFIG_HOME` or `HOME` resolves against the working directory, `accept` and `cancel` on a pre-10-b store fail closed when the tip adds a repository workflow, the job file's `runsDir` rule untested) and the recommendation to fix the major and the two cheap minors on the branch, park the pre-10-b store minor, then merge: “fix then merge”.

Effect: the major, the relative-path minor and the `runsDir` minor are fixed on `feat/10-b-config-layers`, tests first, with no further review (the budget is spent). The pre-10-b store minor goes to parked.md. The branch is then merged into main with `git merge --no-ff`, with standard 1, standard 2 and adversarial FAIL on record and their fixes unreviewed.

### A-079 — 2026-10-19 — 10-b: standard 2 findings fixed without another standard review, then adversarial

Owner, after 10-b's standard 2 FAIL on `2884bae` (one major, three minors) and the recommendation to fix all four on the branch and then run the adversarial review: “Next session we'll fix and run the adversarial before progressing”.

Effect: the four findings are fixed on `feat/10-b-config-layers`, tests first, with no third standard review (the budget is spent). The adversarial review then runs on the fixed SHA. Merge waits for the owner.

### A-078 — 2026-10-19 — 10-b READY; configuration layers design approved

Owner, after reading the 10-b ticket and [design/2026-10-19-config-layers.md](design/2026-10-19-config-layers.md) with its four questions: “take all recommendations and go”.

Effect: 10-b is READY and follows that note. Q1: the repository layer has an allow list (`checks`, `workflow`, `runtime`); every other key is refused there. Q2: a repository workflow is allowed, though it runs unsandboxed in the controller; the risk goes to [work/accepted-risks.md](work/accepted-risks.md). Q3: arrays replace the earlier layer's value whole. Q4: the store's open row records the resolved base SHA, and `accept` and `cancel` read the layers at it.

### A-077 — 2026-10-19 — 10-f: review minors fixed unreviewed, then merged

Owner, after 10-f's standard and adversarial PASS on `4775ac3` with two kit minors and a `claim: undefined` note, and the recommendation to fix all three on the branch without another review: “yes fix and merge”. Earlier, on the reviews: “review please, if you've already run the tests then I don't need to rerun”.

Effect: `6f86f0a` fixes the three, tests first: `runtimeKit` treats a null-prototype object as plain data, a test pins that it drops a nested undefined claim field, and it checks the union on the round-tripped outcome, so `claim: undefined` fails. No review covers `6f86f0a`. The owner did not run `npm test`; the implementer's run on `6f86f0a` (302 tests, 278 pass, 0 fail) is the record. The `adversarial_reviewer` kit case (standard 1 note) is not added: the ticket names only `standard_reviewer`. `feat/10-f-registries-fixes` merges into main locally with `--no-ff`.

### A-076 — 2026-10-19 — 10-a merged; its adversarial minors become 10-f

Owner, after 10-a's adversarial PASS on `bb40612` with four minors and the recommendation of a fix ticket before 10-b: “okay, file the fix ticket and merge”.

Effect: [10-f](work/10-f-registries-fixes.md) is drafted for the four minors and the `SHAPE` note; it is not READY until the owner says go. `feat/10-a-registries` merges into main locally with `--no-ff`. The owner did not run `npm test` on `bb40612`; the implementer's run (295 tests, 271 pass, 0 fail) and the two reviewers' matching runs are the record. 10-a carries standard 1 PASS on `22ae421` and adversarial PASS on `bb40612`.

### A-075 — 2026-10-19 — 10-a READY; registries design approved

Owner, after reading the 10-a ticket: “go”. Then, given [design/2026-10-19-registries.md](design/2026-10-19-registries.md) (a runtime registry in `src/runtime/registry.ts`; an extension runs as `node <module>` through `cliAdapter` with `CliSpec` gaining `input`, `bind` and `moduleHash`; `runtime` and `moduleHash` on every outcome event; a `BACKENDS` table in `src/sandbox.ts`; `runtimeKit` in `src/kits/runtime.ts`, imported by path): “approve”.

Effect: 10-a is READY and follows that note. A job-file runtime may not reuse a built-in name. The module is hashed once, when its adapter is built.

### A-074 — 2026-10-19 — Row 10 design answers (O-016 items 3 to 6)

Owner, after reading the handoff: “lets handle row 10”, the planned order (A-055). Offered seven answers for O-016 items 3 to 6, then worked examples of extension steps and of extensions that would not fit. Owner, concerned that extensions were being forced into one shape: “why not have an extension that simply listens in to the current state of a ticket and reports that out [...] OR what about some sort of discord notification bot that pings a user when we hit an escalation.” Shown that both are observers, not steps, and asked about the use of an extension step beside a workflow: “I'm a bit confused as to the utility of steps as extensions - when you could simply just write a different workflow.” Offered folding the extension step into the command stage, since a command stage already runs an argv in the sandbox at the candidate SHA: “Yes I think thats a much better place for these custom steps that run commands”. Offered the revised answers: “Okay I agree with your recommendations for 1, 2, 3, 4, 5, 7 and 8.” Offered the widened observation stream (Q6) and observers that run `accept` (Q6a): “Yes I like both, 6a would allow me to auto approve things that were only comments for example”.

Effect (D-024):
- **Custom steps (Q1 to Q3).** No `extension` stage kind. A command stage may name its own commands (`run: [[argv], …]`); with none it runs `job.checks`, so the default workflow is unchanged. The controller writes the step's context (cycle ID, work ID, stage, head, base, ticket, `diffFile`, `outputDir`) to a file and passes its path in `SF_REQUEST`; a TypeScript helper reads it. Each stage gets a writable `outputDir`, `evidence/<head>/<stage>/`. Network is off unless the stage sets `network: true`. Exit 0 is PASS, anything else FAIL. A run records the SHA-256 of each command argument that is a file next to the workflow. Contract test kits for command stages, observers and runtime adapters.
- **Runtime adapters (Q1, Q7).** The out-of-process protocol stays for runtimes only: one process per run, one JSON `RunRequest` on stdin, one JSON `RunOutcome` on stdout.
- **Grants (Q4, Q5).** A workflow asks for a grant on a command stage (`grants: ['github']`); only the personal or job layer gives it, mapping the name to an environment variable or a file. The secret reaches that stage's sandbox alone, with network; a test pins that no developer, check or reviewer sandbox sees it. A grant-holding stage runs only when every verdict and verification is for the current head. It writes the head it acted on to `outputDir/head`; a missing or different head escalates. The controller cannot stop a stage holding a token from misusing it; the rule makes a wrong merge visible and escalated.
- **Observation stream (Q6, Q6a).** Pull: `node src/main.ts events <job.json | runsDir> [--follow]` prints JSON lines `{ seq, at, cycleId, workId, event, from, stage, escalation }`. The store records a time on each row, outside the `Event`, so replay is unchanged. Observers act only through the owner's commands, and each command records its source. An observer may run `accept`; the source shows who accepted. The controller does not start observers. Reviewer runs record no start, so a stalled reviewer is not yet visible; row 11 adds that.
- **Configuration and registries (Q7).** Four layers, later winning key by key: factory defaults (code), personal (`~/.config/software_factory/config.json`), repository (`.factory/config.json`, read at the base SHA, never the candidate), job file. The repository layer may set checks, the workflow and runtimes per role; it may not give grants or set `sandbox.backend: none`. Runtimes and sandbox backends are chosen by name from a registry; built in are `claude`, `pi`, `bwrap` and `none`. The personal layer may add a runtime that is an extension module.
- **Named outcomes (Q8).** Parked. The change only adds names, so `PASS`/`FAIL` workflows keep working when it comes.
- Plan row 10's "done when" is reworded: a user's extension runs as a command stage, not as an extension step. Tickets: 10-a registries, 10-b configuration layers, 10-c command stages, 10-d observation stream, 10-e grants. Each becomes READY when the owner has read it and said go. O-016 is answered (items 1 and 2 in A-056).

### A-073 — 2026-10-19 — 07-e test and reviews waived; merge

Owner, asked to run `npm test` on `8362c1e`, run or waive the reviews, and decide the merge: “waive test and review. Merge”.

Effect: 07-e carries no reviews and no owner-run `npm test`; the implementer's run on `8362c1e` (283 tests, 259 pass, 0 fail) stands as the record. `feat/07-e-fix-without-tree-change` merges into main locally with `--no-ff`.

### A-072 — 2026-10-19 — 07-e design approved

Owner, after the 07-e design note and its three questions (approve cases 1 to 5 and the interface; should a dispute stop the cycle, with overruling as a separate ticket; is 2 KiB the right cut for the reason): “All looks good to me.”

Effect: [the 07-e design](design/2026-10-19-fix-without-tree-change.md) is approved as written. A same-tree fix that adds commits on top of the previous candidate is accepted; a `dispute` claim escalates with the developer's reason, cut to one line and 2 KiB; a dispute stops the cycle. Overruling a finding within the same cycle is not part of 07-e; it would be its own ticket, not yet drafted.

### A-071 — 2026-10-19 — 06-d test and reviews waived; merge; start 07-e

Owner, asked to run `npm test` on `e7eb056`, run or waive the reviews, and decide the merge: “waive test and reviews. Merge then lets start on 07-e”.

Effect: 06-d carries no reviews and no owner-run `npm test`; the implementer's run on `e7eb056` (276 tests, 252 pass, 0 fail) stands as the record. `feat/06-d-reviewer-commit-messages` merges into main locally with `--no-ff`. 07-e starts with its design note; no code until the owner approves the note.

### A-070 — 2026-10-19 — 06-d READY

Owner, after the handoff named 06-d then 07-e as next and neither READY: “go on 06-d”.

Effect: [06-d](work/06-d-reviewer-commit-messages.md) is READY and is implemented on `feat/06-d-reviewer-commit-messages`, off main at `7a3ca4e`. 07-e is still not READY.

### A-069 — 2026-10-19 — 04-f and 08-g reviews waived; merge row 9, 04-f and 08-g

Owner, asked to run or waive the reviews for 04-f and 08-g and whether to open a PR: “waive. Lets merge actually then we'll look at 06-d and 07-e in a new session (so we'll need to update the handoff after the merge)”.

Effect: 04-f and 08-g carry no reviews and no owner-run `npm test`; the implementer's run on `9fb570c` (272 tests, 248 pass, 0 fail) stands as the record. The repository has no remote, so the stack (09-a, 09-b, 09-c, 09-d, 04-f, 08-g) merges into main locally with `--no-ff`, as earlier merges did. Plan row 9 is done. 06-d and 07-e come next, in a new session.

### A-068 — 2026-10-19 — 08-g: pi's auth.json writable for every pi run

Owner, after the 08-g findings (the `.pi` overlay drops pi's refreshed OpenAI login; binding reviewers only does not fix it), offered three options (1, bind `auth.json` writable for every pi run and accept that a run can overwrite or delete the login; 2, leave it and log in again when needed; 3, refresh in the controller): “Yes option 1 is good”.

Effect: 08-g binds `~/.pi/agent/auth.json` writable on top of the `.pi` overlay for every pi run, developer and reviewer. The owner accepts that risk; it is recorded in [work/accepted-risks.md](work/accepted-risks.md). Not covered: two pi runs refreshing at once (pools, row 13), and a run killed at its deadline in the middle of a refresh.

### A-067 — 2026-10-19 — 04-f and 08-g READY, stacked on 09-d

Owner, after 09-d was committed and offered the order 04-f, 08-g, 06-d, 07-e, and asked whether to open a PR for the row 9 stack: “Okay lets start tackling 04-f into 08-g now”.

Effect: 04-f and 08-g are READY. No PR is opened, so main still lacks row 9. As with 09-a to 09-c, `feat/04-f-pi-error-reason` is stacked on `feat/09-d-spec-rewrite`, and `feat/08-g-pi-auth-refresh` on 04-f. 08-g's fix waits on the owner's answer to the risk its ticket names (a developer run could overwrite the pi login).

### A-066 — 2026-10-19 — 09-d READY; 08-g drafted

Owner, after the 09-d draft and a request to file the pi login issue (“seems like we could easily investigate”): “go on 09-d”.

Effect: [09-d](work/09-d-spec-rewrite.md) is READY; the spec rewrite starts on `feat/09-d-spec-rewrite`, stacked on `feat/09-c-prompt-versions`. [08-g](work/08-g-pi-auth-refresh.md) is drafted and not READY: it first checks whether the `.pi` overlay drops pi's refreshed login, then binds `auth.json` writable (A-038).

### A-065 — 2026-10-19 — 09-c plan deleted

Owner, asked whether to delete or commit the untracked 09-c plan: “delete the plan file”.

Effect: `plans/2026-10-19-prompt-versions.md` is deleted uncommitted, as the 09-a and 09-b plans were (A-058, A-061). A-062, the 09-c ticket log and the handoff keep what it decided.

### A-064 — 2026-10-19 — Three tickets from the 09-c live run, after row 9

Owner, asked whether the three issues seen in the 09-c live run become tickets or are parked under O-013: “Yes all three should be tickets, we'll deal with them and any others after we finish this 09 work.”

Effect: drafted, not READY: [04-f](work/04-f-pi-error-reason.md) (a pi error turn records pi's own reason), [06-d](work/06-d-reviewer-commit-messages.md) (reviewers see the candidate's commit messages) and [07-e](work/07-e-fix-without-tree-change.md) (a fix whose findings need no tree change; Design route). Each is numbered by the plan step whose code it changes. They wait until row 9 is finished: 09-d first.

### A-063 — 2026-10-19 — 09-c reviews and owner-run tests waived

Owner, told that `npm test` on `c368009` was run by the implementer session and is not independent: “Okay I'm going to waive that and the review.”

Effect: 09-c carries no reviews and no owner-run `npm test`; the implementer's run on `c368009` (269 tests, 245 pass, 0 fail, 19 skipped, 5 todo) stands as the record. As with 09-a and 09-b (A-058, A-060), the stacked branch carrying 09-a to 09-c merges on the owner's word with the waivers on record. 09-d, the spec rewrite, is next.

### A-062 — 2026-10-19 — 09-c prompt split shape

Owner, offered three plan answers (Q1 `roleText` on every agent stage plus an optional `fixRoleText` on commit stages, with today's four first lines on `defaultWorkflow`; Q2 `checkWorkflow` refuses an agent stage with no role text; Q3 role text must be one line) and three interface answers (Q1 a new pure `src/prompt.ts` with `developerPrompt` and `reviewPrompt` returning the text and both hashes; Q2 an optional `versions` on `ExecuteOptions` that `receive` spreads onto every `developer_result`, `verdict` and `run_failed`; Q3 tests at `develop`, `fix` and `review`, at `src/prompt.ts` and at `checkWorkflow`): “take all”, then “take all”.

Effect: 09-c follows `plans/2026-10-19-prompt-versions.md`. The contract hash is the hash of each kind's contract built from fixed placeholders, because the per-run nonce makes a hash of the sent text unique. Prompts with several paragraphs wait for O-013.

### A-061 — 2026-10-19 — 09-b plan deleted; no runs to keep

Owner, asked whether to keep the 09-b plan and whether any runs directory holds 09-b cycles worth keeping: “delete the plan. I don't need any runs”.

Effect: `plans/2026-10-19-generic-driver.md` is deleted unmerged, as the 09-a plan was (A-058). 09-c may change `defaultWorkflow` and so its hash; cycles opened by 09-b code under the default workflow will be refused, and that is accepted.

### A-060 — 2026-10-19 — 09-b reviews waived

Owner, after an overview of 09-b on `61b550c`: “Okay lets waive the review again and prepare the handoff for a fresh session for 09-c”.

Effect: 09-b carries no reviews, as 09-a (A-058). The stacked branch carrying 09-a and 09-b merges with 09-c on the owner's word, with both waivers on record. 09-c is next.

### A-059 — 2026-10-19 — 09-b driver approach

Owner, offered three registry approaches (one implementation per role; one per step kind with adapters by role, recommended; one function per workflow) and three questions (Q1 test the second workflow as `DEV → CHECK → REVIEW → OWNER`, because the engine can't start on a review stage and `review` needs `verify`; Q2 move 09-c's workflow record into 09-b, with the store refusing a cycle whose hash doesn't match; Q3 the job file names a workflow module, and `runtime` is keyed by role with `standard` and `adversarial` as aliases): “take all”.

Effect: 09-b follows [design/2026-10-19-generic-driver.md](design/2026-10-19-generic-driver.md), pending the owner's approval of the note. Its second-workflow done-when line becomes Q1's four-stage workflow. The cycle-record line moves from 09-c to 09-b.

### A-058 — 2026-10-19 — 09-a reviews waived; spec rewrite after 09-c

Owner, asked whether 09-a's two standard reviews and one adversarial review are waived, run now, or run with 09-b's as a stacked branch: “waive”. Earlier, offered an overview of 09-a instead of a review: “okay I'm happy with that lets start on 09-b in a fresh context”. Asked where the spec rewrite that A-054 calls for goes: “up to you, should it happen now or after? Should it include changes from 09-c?”. Asked whether to commit the untracked 09-a plan: “No we can cut that plan document”.

Effect: 09-a carries no reviews; it merges with 09-b and 09-c on the owner's word, with the waiver on record. The spec rewrite of [specs/core-lifecycle-v1.md](specs/core-lifecycle-v1.md) is a docs ticket, 09-d, after 09-c, so it describes the driver (09-b) and the workflow and prompt version records (09-c) once, not twice. `plans/2026-10-19-workflow-engine.md` is deleted uncommitted; the design note and the ticket log keep what it decided.

### A-057 — 2026-10-19 — 09-a engine shape

Owner, offered three approaches for the inside of `apply` (keep the switch on event type; a handler table by step kind; a compiled lookup table, with the first recommended) and three questions (Q1 replace `standard` and `adversarial` with `Cycle.budgets` and edit their read sites in callers, widening the ticket's constraint; Q2 `QUEUED` as a fourth engine stage, with the workflow naming its `start`; Q3 `apply(c, e, workflow = defaultWorkflow)` and an optional workflow on `EventStore`, recording nothing new on the open marker): “take all recommendations”. Then, given [design/2026-10-19-workflow-engine.md](design/2026-10-19-workflow-engine.md): “design is approved”. Then, offered three interface answers (the `EventStore` constructor runs `checkWorkflow` and `apply` trusts its caller; keep the three-argument `apply` and wrap each `reduce(apply, …)`; second workflows live in the tests only) and generic escalation reasons (`<STAGE> FAIL`, `<STAGE> FAIL at budget limit <n>`), which change two regexes in `tests/run.test.ts`: “take all”, then “Take all recommendations”.

Effect: 09-a follows that design. Its constraint now also allows mechanical edits of `c.standard` and `c.adversarial` read sites in `src/main.ts` and the caller tests, and the two escalation regexes at `tests/run.test.ts:122` and `:132`. Agent stages carry `produces: 'commit' | 'verdict'` as part of the `agent` kind, not a fourth kind.

### A-056 — 2026-10-19 — Row 9 design answers

Owner, offered four answers for the workflow engine (Q1 a TypeScript module that exports plain data, so the engine can check and hash it; Q2 today's event types kept with a `step` field, so existing stores replay; Q3 stage names defined by the workflow, with `ESCALATED`, `CANCELLED` and `ACCEPTED` fixed in the engine; Q4 the core owns a prompt's contract part and the workflow owns the role text) and three tickets (09-a engine and default workflow, 09-b generic driver, 09-c prompt split and version records): “accept all”.

Effect: tickets [09-a](work/09-a-workflow-engine.md), [09-b](work/09-b-generic-driver.md) and [09-c](work/09-c-prompt-versions.md) are drafted, stacked in that order. Each becomes READY when the owner has read it and said go. O-016 items 1 and 2 are answered; items 3 to 6 (extension protocol, grants, observation stream, configuration layers) remain for row 10.

### A-055 — 2026-10-19 — Build the workflow engine now, before recovery

Owner, after the core principles (A-054): “Okay I think this is the right path, and I'd want to implement this sooner rather than later so we don't build up too much debt as to what and how things run.” Then, offered the order (the engine before recovery; acceptance evidence as the first stage written in the workflow format): “Yes lets do this now. Part refactor part new features - we should also look forward in the plan so that we're considering the future features and work (like adding skills and initial prompts)”.

Effect: two new plan rows before recovery. Row 9 is the workflow engine, a refactor of `src/lifecycle.ts` and `src/run.ts`. Row 10 is the extension host and the observation stream, new features. Recovery moves to row 11, tracker and code host sync to row 12, and the unsplit rest to row 13; A-052's order between recovery and sync stands. [plan.md](plan.md) gains a table of what each later row and open question needs from rows 9 and 10, so the engine is designed with them in view. The design questions for row 9 are in [open-questions.md](open-questions.md), O-016.

### A-054 — 2026-10-19 — Strong core, user-definable workflow, extensions

Owner, opening an architectural discussion: “Basically I want to publish a strong core application, this is probably the state machine. Then the rest of the application is sort of plug and play, adapatable and configurable [...] The other thing that I would want is that the factory itself is modifiable outside the core, not just in configuration but we should look for opportunities to allow something like lua or ts code to be written by a user that is personal and works with our core.”

Offered: extensions sit on the agents' side of the trust line and return claims; three questions (does that rule fit; may users add stages; out-of-process JSON or in-process TypeScript). Reply: “1. Okay I think this is good, we can challenge it along the way though. 2. No I think users should be able to fully customise the stages and steps of the factory workflow. 3. Go with your recommendation with ts as the first-class option”.

Offered: three tiers (engine guarantees, default policy, user extensions), with "humans accept" as the open point. Reply: “I think humans accept should be configurable, otherwise the principles are all good - you even caught a good principle that we need "observability" such that extension can actually see whats going on, and react.”

Offered: keep "the factory never merges" as a guarantee. Reply: “I think the factory never merges should not be a guarantee, perhaps the controller never does - but why not a user extension? Our 'sane' default will be that it doesn't - but I can see a case for a bug that say something like sentry finds on your application, you might want that to auto merge and be deployed if its small right? Thats not my risk appetite but we shouldn't enforce that”.

Effect (D-023):
- The core: the event log (`src/store.ts`); an engine that applies events to a cycle under a workflow definition (today mixed with the default workflow in `src/lifecycle.ts`); the controller, the only writer (`src/controller.ts`); run supervision with deadlines, cancel and recovery; candidate and evidence binding to a Git SHA; an observation stream that observers read and react to through claims or commands; an extension host with the seam contracts, loader, contract test kits and version records.
- Engine guarantees, which no workflow can switch off: only the controller changes state, and every change is a recorded event; evidence and verdicts bind to a SHA, and a new commit makes old evidence invalid; anything the controller cannot classify escalates; every agent loop has a finite budget; extensions return claims and never write state; every run records the versions of the workflow, prompts and extensions it used; the controller itself never merges or deploys. (A-125: in practice, a merge happens only through a grant the owner gave in personal or job configuration; an observer `accept` followed by a merge grant stage is an owner-configured automatic merge.)
- Default policy, which a workflow may change: today's stages and order, two standard reviews and one adversarial review, controller-run checks, fresh-context reviewers, human acceptance, and no merge step.
- User extensions: stages and steps built from step kinds (agent run, controller command, human decision, extension step), roles, prompts, adapters, observers, and merge or deploy steps.
- Extensions run as separate processes over JSON on stdin and stdout, inside the sandbox; TypeScript is the first-class option.
- The spec's principle 5 and D-004 stay true of the default workflow only. The spec is rewritten when the engine is built.
- Open parts and the proposed plan order are in [open-questions.md](open-questions.md), O-016. Plan rows are not changed until the owner approves an order.

### A-053 — 2026-10-19 — Drop the parked 02-a schema cleanup

Owner, told that `WITHOUT ROWID` on the events table and `WHERE run_id IS NOT NULL` on its unique index change no behaviour (SQLite never treats two NULLs as equal in a unique index), and that removing them reaches only new databases because the table is made with `CREATE TABLE IF NOT EXISTS`, so existing ones would need a migration: “Okay yes lets drop the task”.

Effect: both clauses stay in `src/store.ts`. The schema cleanup half of the 02-a notes line in [work/parked.md](work/parked.md) is dropped and gates no ticket.

### A-052 — 2026-10-19 — Tracker and code host sync: two seams; recovery first

Owner, on GitHub sync: “This all looks good, and I do basically only use github - but like the rest of the factory this should be agnostic and work with other providers or something like linear (seperating source control from task tracking)”. Then, offered a design with two seams (a tracker for tickets in and status out, a code host for the branch and the owner's review, each with a `local` adapter for today's behaviour and a `github` one) and five questions (Q1 the issue named on the command line, the job file still giving the repository and checks; Q2 a merge on the host is accept when the merged head equals the candidate's SHA, otherwise the cycle escalates, and the factory never merges; Q3 a PR closed without merge is cancel, changes requested does nothing automatic; Q4 the PR description is the review package and the issue gets one status comment edited in place; Q5 GitHub sync right after recovery and before the acceptance evidence stage): “Yep they all look good to me - so lets record those”.

Effect: plan row 9 is recovery; row 10 is tracker and code host sync; the rest of the old row 9 moves to row 11, its order not yet decided. The sync design:
- `Tracker` reads a ticket by reference and returns a provider-qualified work ID (`github:owner/repo#42`, `linear:ENG-123`), and reports status. `CodeHost` publishes the candidate branch with the review package, and reads the owner's disposition. The job file names each adapter. The first ticket builds `local` and `github` for both; Linear and GitLab come later.
- The providers report what happened; the controller decides. A merged review is `accept` only when its head is the candidate's SHA; otherwise the cycle escalates. A review closed unmerged is `cancel`. Changes requested is left to the owner, who opens a child cycle (source §15, post-human revisions).
- Sync is its own pass, `sync(store, tracker, host)`, that reconciles the store against the providers; `run.ts` does not call it. A failed report never changes a cycle and is retried by the next sync.
- Provider credentials stay with the controller. No developer, check or reviewer sandbox can read them, and a test pins that.
- Runs start one issue at a time from the command line; finding READY issues by label is scheduler work for the pools row.

### A-051 — 2026-10-19 — Acceptance evidence stage: design agreed, built later

Owner, after proposing a stage at the end of the cycle in which a verification agent produces an artifact (a video, an image or a test run) proving the work meets its done-when lines, for the PR, and after four points in reply (the agent writes the demo script and the controller runs it at the SHA in the sandbox; a failed demo: escalate, count as a standard FAIL, or rerun the agent once when its script is broken and escalate when the behaviour is wrong; the demo is not reviewed by an agent, so the PR says so and maps each done-when line to its item; the cost: a new stage before AWAITING_ACCEPTANCE, browsers in bwrap, the name "acceptance evidence", and GitHub sync to show it): “1. soumds good. 2. c 3. agree 4. Well, should it sit between adversarial review and awaiting acceptance? Have we built the 'review desk' part of the factory maybe it should sit there? I suppose that does sit between those two stage. I think we should maybe park this second half to later development”.

Effect: verification has two halves. The first is today's VERIFYING stage and stays as built: the controller checks the SHA and base and runs the declared checks, and the reviewers read the results. The second, acceptance evidence, is parked for later development, with this design: a verification agent in a fresh context writes a demo script from the ticket and the candidate; the controller runs it at the head SHA in the sandbox and keeps the output under `evidence/<head>/`; a broken script reruns the agent once, a demo showing wrong behaviour escalates; the PR shows the script and its output, marked as not reviewed by an agent, with each done-when line mapped to its evidence. It sits after ADVERSARIAL_REVIEW and before AWAITING_ACCEPTANCE; the Review Desk (source §10, not built) presents it. What is still open is in [open-questions.md](open-questions.md), O-015.

### A-050 — 2026-10-18 — Merge the guide to main as experimental; its tests leave npm test

Owner, after walking through the guide (`learn/`, built as a prototype without a ticket) and asked whether it merges to main as experimental like `proto/` (A-048), and whether its tests stay in the default `npm test`: “1. yes merge as experimental 2. No they should go out, I don't know the best way to keep them but avoid having it mess with regular tests - worst case we can cut them”.

Effect: `learn/` merges to main as an experimental guide, outside the ticket workflow: no ticket, no reviews. Its tests move to `learn/learn.test.ts` and run with `npm run test:learn`; `npm test` no longer runs them, so a change to `src/` can break the guide without failing the factory's tests. `src/` must not import from `learn/`. If keeping the guide in step costs too much, its tests, or the guide, can be cut. The owner runs the merge.

### A-049 — 2026-10-18 — Open questions move to their own file

Owner, during the guide walkthrough, after asking for somewhere to flag questions for later research and finding it odd to keep them in a file titled decisions: “yes that makes sense, lets split the file and reference it from decisions as well just in case something is expecting them to still be there.”

Effect: [open-questions.md](open-questions.md) holds every open question, O-001 to O-014, with the research behind the new ones (O-005 widened; O-011 review budget exhaustion; O-012 the Design Studio; O-013 role prompts and skills; O-014 a survey of skills libraries, harnesses and other factories). The `## Open` section here points to it. A decided question is recorded here with the owner's quoted reply and its row leaves that file. `AGENTS.md` lists the file under "Read first".

### A-048 — 2026-10-18 — Merge the herdr TUI prototype to main as experimental

Owner, after the prototype's stage runs were sandboxed (A-047) and asked whether `proto/` should merge to main as experimental, replacing A-046's "no merge": “Okay commit and then merge (you'll need to hand me the command to execute”.

Effect: `proto/` merges to main as an experimental interface while the factory is developed. It stays outside the ticket workflow: no ticket, no tests first, no reviews. `src/` must not import from `proto/`, so deleting the directory removes it. The owner runs the merge. This replaces A-046's "no merge to main"; the rest of A-046 stands.

### A-047 — 2026-10-18 — Sandbox the prototype's stage runs; the factory's goal is to run in herdr

Owner, told that interactive claude in the unchanged bwrap policy works but herdr cannot detect it, and offered two routes to a merge (make the sandbox work first, or merge with stages unsandboxed behind a job-file opt-in): “Okay yes lets make the sandbox work first, and make sure that we record these findings as the end goal will be having this run in herdr.”

Effect: `proto/herdr-adapter.ts` runs every stage in the job's sandbox, with three changes to cliAdapter's policy for interactive runs ([work/herdr-findings.md](work/herdr-findings.md)). A job whose sandbox is `none` still runs claude unconfined. The findings file records what a herdr frontend needs, and O-010 holds the evidence question. Whether `proto/` merges to main is still open; A-046's "no merge" stands until the owner decides.

### A-046 — 2026-10-18 — Throwaway herdr TUI prototype

Owner, asking for "the quickest demo prototype we can - this will likely be thrown out" of a TUI that works inside herdr, and then answering five questions (exempt the prototype from the ticket workflow; branch name `feat/proto-herdr-tui`; stages as interactive claude sessions in herdr tabs rather than headless `claude -p`; claude only; no diff-comment key): “1. Yes 2. Sounds good 3. Yes 4. Yes claude only 5. Yes we can leave it out.” Then: “Okay now go away and build it by yourself with no input from me, its a prototype and so it only really maters once the final thing is done at which point I will review and we can collaborate on it.”

Effect: `proto/` holds the prototype on `feat/proto-herdr-tui`, outside the ticket workflow: no ticket, no tests first, no reviews, and no merge to main. For prototype runs only, herdr is in use, which overrides workflow.md's "herdr is not part of this setup". Interactive stage runs are not sandboxed; the demo points them at a scratch repository. `src/` is unchanged.

### A-045 — 2026-10-17 — Fix the 07-d adversarial minors before merge

Owner, after 07-d's standard PASS and adversarial PASS on `b5d4635` (two minors: arguments after the job file are ignored, so `node src/main.ts job.json cancel` runs the job; after `cancel` clears an ESCALATED parent, a job file still naming `parentCycleId` is refused with no hint), offered a fix before merge, parking, or a merge with the risks accepted: “Fix”.

Effect: both minors are fixed on `feat/07-d-accept-cancel`, test first. The run command refuses extra arguments with the usage line. A job whose `parentCycleId` names a cycle that is not ESCALATED is refused before any run, with a message saying to remove the field. The fix commit takes standard review 2, the ticket's last standard attempt; the adversarial budget is spent.

### A-044 — 2026-10-17 — Ticket 07-d: owner accept and cancel commands

Owner, told that nothing in plan row 9 is needed to run the factory on hobby projects one issue at a time, and that the main friction is the missing accept and cancel commands (a finished or stranded cycle blocks its work ID): “Yep, let's add the accept and cancel commands now.”

Effect: ticket 07-d-accept-cancel, Fast route, on `feat/07-d-accept-cancel` stacked on `feat/09-scoping`. It is numbered under step 7 because `main.ts` is that step's command and the lifecycle already holds both events; row 9 is not split by it. The row 9 split proposed in the handoff is still waiting for the owner's answer.

### A-043 — 2026-10-17 — Lift the scratch-repositories-only limit

Owner, after step 8 put developer, check and reviewer runs in bubblewrap, offered three answers on the working limit that the A-029 merge introduced (factory runs on scratch repositories only): lift it for repositories without secrets (recommended), keep it, or lift it fully. Told the two open gaps: every run has full network access, and a run can read its own CLI's config directory, credentials included, so a hostile or confused agent could send out the repository and the login. Reply: “lift it fully.”

Effect: the factory may run on any repository, including one that holds secrets. The two gaps stay open and are accepted for now. The network line in [work/parked.md](work/parked.md) is no longer tied to the first repository holding secrets; it waits for a later ticket. The parked lines that cite the limit are marked lifted.

### A-042 — 2026-10-17 — Weigh adversarial findings by risk; record accepted risks

Owner, asked whether to record the rule offered after the 08-e adversarial FAIL (park findings that need deliberately hostile code and do no damage by default): “No rule, we definitely want to consider malicious code - but I don't think we need to make something airtight and waste development time. So you should weigh up the risk when these recommendations come through and potentially merge accepting them. We should probably capture them somewhere in that case though”.

Effect: no default parking rule. Malicious code stays in scope, ranked after damage and leaving the remit (A-037). When an adversarial review fails, the implementer session weighs each finding's risk and recommends one of three outcomes: a fix ticket, parking against a named ticket, or a merge with the risk accepted. The owner still decides. A risk the owner accepts goes to [work/accepted-risks.md](work/accepted-risks.md), with the reason and the event that would reopen it. Unlike a parked line, an accepted risk does not gate any ticket.

### A-041 — 2026-10-16 — Fix ticket for the 08-e adversarial FAIL

Owner, after the 08-e adversarial FAIL on `eeffa15` (one major: a FIFO a check leaves in a gitlink's nested `.git` blocks the controller's git forever and nothing is recorded; one minor: the `update-index` arm of `treeDiff`'s catch has no test of its own), offered a fix ticket 08-f that gives the controller's git calls a timeout tied to the stage deadline, with tests for the FIFO case and the untested arm, or a merge with the hang parked: “Option 1 go”. The owner did not answer the offered rule to park hostile-check findings by default, so no such rule is recorded.

Effect: ticket 08-f-controller-git-timeout, Fast route, stacked on 08-e with fresh review budget. Every controller git call over a tree a run or a check wrote gets the stage deadline as its timeout and is killed with SIGKILL past it, and the failure is recorded with its reason. The ticket also covers the same hang on the developer side (the fetch from the clone in `land`, and `fix`'s git in the clone), which the implementer session reproduced while scoping, and the parked non-UTF-8 minor, which A-040 assigned to the next ticket that touches `verify.ts`.

### A-040 — 2026-10-16 — Fix ticket for the 08-d adversarial FAIL

Owner, after the 08-d adversarial FAIL on `64514a0` (one major: main.ts passing the sandbox to the adversarial and pi reviewers is untested; two minors: a malformed nested repository at a gitlink makes `treeDiff` throw before cleanup, a non-UTF-8 untracked name stops the removal), offered a fix ticket stacked on 08-d covering the major and the gitlink minor with the UTF-8 minor parked, or a merge with the findings parked: “Option 1 go”.

Effect: ticket 08-e-reviewer-sandbox-tests, Fast route, stacked on 08-d with fresh review budget. It tests the sandbox at every reviewer call site in main.ts and records a comparison that git cannot complete as `tree` dirt, then cleans the checkout. The UTF-8 minor goes to parked.md against the next ticket that touches `verify.ts`.

### A-039 — 2026-10-16 — Merge 08-c with the adversarial minor parked

Owner, after the 08-c standard PASS and adversarial PASS on `cfdcc16` (one adversarial minor: the per-run `/tmp` cleanup in `cliAdapter` throws on a directory chain past PATH_MAX; the adversarial reviewer could not write probes), asked to merge as it stands or run a second adversarial review first, and whether to park the minor against 08-d: “Merge and park it. But I'm away from the computer so I can't merge right now”.

Effect: `feat/08-c-developer-sandbox` is accepted for merge as it stands, with no second adversarial review; the owner merges it on return. The minor is parked against 08-d, which is not READY to merge until its done-when list covers it. 08-d starts now on `feat/08-d-reviewer-sandbox`, stacked on 08-c.

### A-038 — 2026-10-16 — 08-c and 08-d: developer and reviewer runs in the sandbox

Owner, after the runtime probe ([08-c-findings.md](work/08-c-findings.md)) and five questions (the developer's clone at `<runsDir>/<cycleId>` made with `--no-hardlinks`, its branch fetched into the repository with a sandboxed `upload-pack` and `fetch.fsckObjects`, the head checks run in the repository after the fetch; claude's configuration bound read-only and pi's as a temporary overlay, with a writable `auth.json` only if pi stops logging in; two stacked tickets, 08-c the developer with `--restricted` for claude and `--no-approve` for pi, 08-d the reviewers with the checkout read-only and `--no-context-files` for pi; 08-d also fixes the controller side of the two 08-b majors and takes the two parked verify minors; network on with `/run/systemd/resolve` bound for runtimes, `/tmp` a per-run directory on disk removed after the run): “Take all, go”.

Effect: 08-c-developer-sandbox is READY on the Design route with these answers; 08-d-reviewer-sandbox is drafted, stacked on 08-c, and becomes READY after 08-c's standard PASS. 08-c covers the parked 05-a pi bash and 05-b claude settings lines and the 08-a note on the controller's git reading the developer's git config; 08-d covers the 06-c pi context-files line, the two 08-b majors and the two 08-b minors.

### A-037 — 2026-10-16 — Merge 08-a and 08-b with the 08-b adversarial findings parked

Owner, after the 08-b adversarial FAIL on `dc6c461` (two majors: a committed gitlink directory and a dangling symlink survive the untracked removal and reach the unsandboxed reviewer; two minors: a tracked path starting with whitespace is deleted after a clean tree check, and a deep chain plus a locked directory makes the removal throw) and the question how likely they are: “Option 2, for the most part I'm not terribly concerned about malicious code - obviously that is a worry. My primary concern is agents going outside their remit to achieve a goal which they can't otherwise do, or making a mistake - causing damage to the repo or outside (i.e. deleting data from the whole of the tmp dir instead of their own space inside it)”.

Effect: `feat/08-b-tree-permissions` (08-a and 08-b) is merged by the owner with 08-a standard PASS, 08-a adversarial FAIL fixed by 08-b, 08-b standard PASS and 08-b adversarial FAIL on record. The two majors are parked against 08-c (developer and reviewer runs in the sandbox), which closes them: inside the sandbox the owner's home is not bound. The two minors are parked against the next ticket that touches `verify.ts`. Threat model for 08-c and later, in the owner's words: the first concern is an agent going outside its remit or making a mistake that damages the repository or anything outside its own space; deliberately malicious code is a secondary concern.

### A-036 — 2026-10-16 — Fix ticket for the 08-a adversarial FAIL

Owner, after the 08-a adversarial FAIL on `798eb1c` (one major: a check that removes the owner's permissions on a directory hides a rewritten tracked file from the tree comparison, because git warns on stderr, skips the path and exits 0; two minors: a check that removes permissions on the checkout itself makes the comparison throw, and untracked leftovers such as a planted `.git` directory or a symlink to the owner's files reach the unsandboxed reviewer): “Option 1 go”.

Effect: ticket 08-b-tree-permissions, Fast route, stacked on 08-a with fresh review budget. The controller restores owner access to the checkout before comparing, records any warning from the comparison as `tree` evidence, runs its git from the repository, and removes untracked entries before review. The developer and reviewer sandbox ticket becomes 08-c.

### A-035 — 2026-10-16 — Sandbox before plan row 8; five design answers

Owner, choosing between the sandbox ticket and plan row 8: “Sandbox, ideally I think this implementation deserves some research. My system is currently resource constrained so I don't want VMs as the solution, I also want to keep things local so cloud solutions are out as well. Though I don't want either of those solutions to be out of the picture eventually, this tool should ideally be agnostic.” Then, after the research summary ([08-a-findings.md](work/08-a-findings.md)) and five questions (a sandbox interface that wraps a command from a policy of read paths, write paths and network, the backend named in the job file, `none` explicit and scratch-only; the developer in its own clone, the controller fetching its branch; checks on the candidate's files with no git folder, the controller comparing them to the commit; no network for checks, full network for developers and reviewers, domain filtering parked; reads start empty and bind only what is needed): “Take all”.

Effect: the sandbox becomes plan row 8; GitHub sync, pools, release tracking and the improvement loop move to row 9. Row 8 is two tickets. 08-a-sandboxed-checks (Design route; READY on these five answers, its ticket text written after the reply) adds `src/sandbox.ts` with the bubblewrap backend and runs verification checks inside it on a checkout with no `.git`; it covers the parked 06-a symlink, `core.hooksPath` and evidence-file lines and the 07-b gitdir-swap, `git replace` and `core.fileMode` lines. 08-b (drafted after 08-a) moves developer and reviewer runs into the sandbox, the developer into its own clone; what claude and pi need inside comes from an owner-run probe, because listing their configuration directories was refused to this session as credential exploration.

### A-034 — 2026-10-16 — Fix ticket for the 07-b adversarial FAIL

Owner, after the 07-b adversarial FAIL on `f3b4e12` (one major: a check running git inside the verify checkout hides a rewritten tracked file from the `tree` check and review's guard through `skip-worktree`, `assume-unchanged` or a `.git` pointer swap; two minors: the newline flatten misses `\r` and the Unicode line separators, the `tree` status has a 1 MiB buffer): “Option 1 go”.

Effect: ticket 07-c-tree-check, Fast route, stacked on 07-b with fresh review budget. It records index flags as `tree` evidence before the status, widens the buffer, fixes the flatten in the prompt and in `main.ts`, and moves the step cap after the stop. The `.git` pointer swap, `git replace` and `core.fileMode` go to parked.md against the sandbox ticket: no git command run from inside a swapped checkout can see it.

### A-033 — 2026-10-16 — 07-a same-tree refusal on a fix run

Owner, after standard review 2 on `6261150` noted that `refuse` on a fix run also rejects a commit whose tree equals the failed candidate's (an empty commit on top of it), beyond A-032's "the head must differ from the previous head": “go with your recommendation”.

Effect: the rule stays. A fix run must produce a new SHA with a new tree; the reviewers still judge `base..head`, and descent from the previous head is still not required.

### A-032 — 2026-10-16 — Step 7 tickets: fix run and end-to-end loop

Owner, after reading the 07-a and 07-b design notes and five questions (two stacked tickets; `fix` beside `develop` reading findings from the store; a stage that throws escalates with `reject_dispatch`; `verify` records a dirty tracked tree as `tree: FAIL`; `run` returns the Cycle, branch and worktree with a thin `src/main.ts` over a job file, the "PR" being the local branch): “Take all recommendations”.

Effect: 07-a-fix-run and 07-b-end-to-end-loop are READY on the Design route with the recommended answers, 07-b stacked on 07-a. The 06-c parked minor is picked up by 07-b.

### A-031 — 2026-10-16 — Fix ticket for the 06-b adversarial FAIL

Owner, after the 06-b adversarial FAIL on `f7ed0be` (one major: a diff over 1 MiB strands the cycle on `execFileSync`'s default `maxBuffer`; six minors: `.gitattributes -diff` hides content, the cut drops the middle with no file list, the head filter untested, a check can rewrite the tracked tree the reviewer reads, pi lacks `--no-approve`, forgeable section headers): “option 1 go”.

Effect: ticket 06-c-reviewer-prompt-bounds, Fast route, stacked on 06-b with fresh review budget. It fixes the major and the six minors and adds `--strict-mcp-config` to the claude reviewer. `CLAUDE.md` auto-discovery in the claude reviewer is recorded as a non-goal pending a flag probe.

### A-030 — 2026-10-16 — 06-b reviewer runs: signature, tools, evidence source

Owner, after the 06-b question round (`review(store, adapter, cycleId, job, opts)` recomputing the checkout and evidence paths from `runsDir`; read-only reviewer tools, no bash; per-check results from the `verification` event with capped files attached; pick up the parked `MISSING`-under-cgroup minor): “go”.

Effect: 06-b is READY on the Design route with the recommended answers; A-028's `Bash(npm test)` for claude reviewers is withdrawn. `src/review.ts` builds the prompt and calls `execute`; `claudeReviewer` and `piReviewer` are read-only specs.

### A-029 — 2026-10-16 — Merge 06-a with the adversarial findings parked

Owner, after the 06-a adversarial FAIL on `4b20fb5` (one major: a symlink committed in the candidate lets a check read the developer's worktree, so evidence for a SHA depends on files in no commit; two minors: an unknown binary is `FAIL` not `MISSING` under cgroup isolation, and `git worktree add` runs a committed `post-checkout` hook through `core.hooksPath`): “option 2 go”.

Effect: `feat/06-a-verification` is merged with standard PASS (5d1a34b) and adversarial FAIL (4b20fb5) on record. The major and both minors are tracked in [work/parked.md](work/parked.md). All three need a developer with unscoped shell or `git config`, which today is pi on a scratch repository; the ticket that gives pi a policy or puts a sandbox around the worktree is not READY until its done-when list covers them. The `MISSING` classification goes to the next ticket that touches `verify.ts`.

### A-028 — 2026-10-16 — Step 6 design: verification and reviewer runs

Owner, after the step 6 question round (two tickets 06-a verification and 06-b reviewer runs; checks declared on `Job`, not read from the candidate; checks run in a fresh detached checkout of the candidate SHA; evidence as files under the runs directory keyed by SHA, no store change; `review()` mirroring `develop` over `execute`, claude reviewers with `Read,Glob,Grep,Bash(npm test)` and pi with `read,grep,find,ls`; a check that cannot start is `MISSING`, everything else non-zero is `FAIL`; no `runtime` on reviewer runs; parked head-guard variants stay parked): “take all”.

Effect: 06-a is READY on the Design route with the recommended answers; 06-b is drafted and becomes READY after 06-a's standard PASS. `src/verify.ts` owns the checkout, the check runs, the evidence files and the `verification` event.

### A-027 — 2026-10-16 — Fix ticket for the 05-a adversarial FAIL

Owner, after the 05-a adversarial FAIL on `18421ff` (two majors: a throw after `open` strands a QUEUED cycle and blocks the work item; `git log --output` and `git diff --output` let a claude developer write outside the worktree under the allow list): “option 1 go”.

Effect: ticket 05-b-contain-developer-run, Fast route, stacked on 05-a with fresh review budget. It fixes both majors, the four minors (parentless cycle after ESCALATED, relative `runsDir`, non-string `accept` return, user settings joining the grant) and the two mechanical notes; the pre-existing-commit note goes to step 6 in parked.md.

### A-026 — 2026-10-16 — 05-a developer run design

Owner, after reading the 05-a design note and five questions (one `develop()` seam; `accept` option on `execute` for the commit check; worktree per cycle on `sf/<cycleId>`, kept; scoped `--allowedTools` for claude and pi's unscoped bash recorded as a limit; `runtime` on the `claim` event with `Adapter.name` restored): “take all recommendations”.

Effect: 05-a is READY on the Design route with the recommended answers. `src/developer.ts` opens the cycle, makes the worktree, assembles the prompt and calls `execute`; `receive` rejects a claim the caller's `accept` refuses as `run_failed`; `EventStore.open` enforces the 02-b parked guards; the `claim` event carries `runtime`.

### A-025 — 2026-10-16 — Fix ticket for the 04-d adversarial FAIL

Owner, after the 04-d adversarial FAIL on `5347806` (one major: the claim-block regex backtracks catastrophically on an unclosed fence followed by blank lines, holding the controller's event loop past the deadline): “option 1 go”.

Effect: ticket 04-e-claim-scan, Fast route, stacked on 04-d with fresh review budget, replaces the regex with a linear scan and takes the four minors (unit-name validation, no group signal after exit under a scope, well-formed reason cut, probe timeout). 04-d and 04-e merge together.

### A-024 — 2026-10-16 — 04-d real adapters design

Owner, after reading the 04-d design note and five questions (cgroup logic inside `spawnRuntime`; refuse at construction without a user systemd; fenced `json` claim block; drop `Adapter.name`; four live runs): “go with all recommendations”.

Effect: 04-d is READY on the Design route with the recommended answers. `spawnRuntime` grows `isolation` and `maxOutputBytes`; `src/runtime/cli-adapter.ts` builds the claude and pi adapters from a spec; the runtime ends its reply with a fenced `json` block holding the claim; `Adapter.name` is dropped until the step 5 loop records `runtime` on the Run.

### A-023 — 2026-10-16 — Merge 04-a/04-b/04-c with the 04-c adversarial finding parked

Owner, after the 04-c adversarial FAIL on `e97a045` (one major: an outcome within about 60 bytes of V8's string cap strands a cycle; needs about 3 GB of heap to produce): “Yep I agree I think, we should really just accept it here and move on to actually implementing what we're trying to guard against right?”

Effect: the stacked branch carrying 04-a, 04-b and 04-c is merged with standard PASS and adversarial FAIL on record. The size bound is parked against 04-d (real claude and pi adapters), where the bytes come in and a stdout limit bounds them; the self-resolving-thenable hang is recorded as a non-goal of the in-process seam. Step 4 of the plan is done: the adapter seam, the fake adapter and the controller's receive path drive the state machine for normal, malformed, timeout, cancel and duplicate outcomes.

### A-022 — 2026-10-16 — Fix ticket for the 04-b adversarial FAIL

Owner, after the 04-b adversarial FAIL on `8664c1b` (two majors: hostile in-process values from an adapter strand a cycle; one minor: the stage guard rejects a reviewer run whose cycle was cancelled while it ran): “option 1 go”.

Effect: ticket 04-c-total-receive, Fast route, stacked on 04-b with fresh review budget. The real claude and pi adapter ticket becomes 04-d; the two 03-b parked lines move with it.

### A-021 — 2026-10-16 — Fix ticket for the 04-a adversarial FAIL

Owner, after the 04-a adversarial FAIL on `3ba5434` (three majors in `receive` and `run_failed`): “Option 1, go”.

Effect: ticket 04-b-receive-hardening, Fast route, stacked on 04-a with fresh review budget, fixes the three majors and the related minors. The real claude and pi adapter ticket becomes 04-c; the two 03-b parked lines move with it.

### A-020 — 2026-10-16 — 04-a adapter interface design

Owner, after reading the 04-a design note and four questions (split real adapters and cgroup cancel into 04-b; controller owns the deadline; new `run_failed` event; `append` returns the Cycle): “go with your recommendations”.

Effect: 04-a is READY on the Design route with the recommended answers. The two 03-b parked lines (process-tree escape; `cancel()` guard and cwd minors) move to 04-b, the ticket that wraps `spawnRuntime` into real claude and pi adapters. The adapter seam is `src/adapter.ts`; the controller in `src/controller.ts` is the only non-test caller of `EventStore.append`.

### A-019 — 2026-10-15 — Merge 03-a/03-b with the 03-b adversarial findings parked

Owner, after the 03-b adversarial FAIL on `d8a9d21`: “option 1”. Earlier, choosing the fix ticket after the 03-a adversarial FAIL on `85e32e9`: “Go ahead with option 1, 3b”.

Effect: the stacked branch carrying tickets 03-a and 03-b is merged with standard PASS and adversarial FAIL on record. The two majors (descendants that leave the process group survive cancel; a self-re-parenting child is misreported as exited) and the minors are tracked in [work/parked.md](work/parked.md) against 04-a, which is not READY until its done-when list covers them. The findings document is qualified accordingly.

### A-018 — 2026-10-15 — Merge 02-a/b/c with the 02-c adversarial finding parked

Owner, after the 02-c adversarial FAIL on `39d2c59`: “Yep lets do 1, and make sure we are tracking the finding for when it is relevant.”

Effect: the stacked branch carrying tickets 02-a, 02-b and 02-c is merged with standard PASS and adversarial FAIL on record. The finding (a caller applying the unserialised object can diverge from replay) and the other deferred findings are tracked in [work/parked.md](work/parked.md); the first ticket that calls `EventStore.append` from non-test code must cover it. Workflow addition: parked findings gate the ticket named against them.

### A-017 — 2026-10-15 — Working agreement

Owner: “Yes plase, that sounds good. And make some notes in agents.md or somewhere for this to be our agreed workflow going forward - taking items from the plan, breaking them down into that framework and potentially multiple pieces of work”.

Effect: [workflow.md](workflow.md) is the agreed process. Plan steps become Fast or Design tickets under `docs/work/`, one branch each, tests first, owner-run verification, one fresh-session standard review (two at most), one adversarial review, owner merge. First ticket: 02-a SQLite event store.

### A-016 — 2026-10-15 — Stop design iteration; implement the core

Owner, after reviewing twelve design cycles against the v0.3 plan: “I'd much rather go back to our simpler base and let it run implementation rather than just theorizing and agonizing over a plan and edge cases which don't/haven't occured”, then “Ignore my rules”, then asked to remove the accumulated design material.

Effect: cycle-13 withdrawn before review. v0.1 and v0.2 lifecycle specs, 120 scenarios, twelve review ledgers, the manual workflow and templates were removed from the tree. They remain in Git history before commit `1214ca2` for anyone who needs them. Directions D-008 to D-015 from those cycles (paused-failure handling, held results, child recovery of interrupted development, receipt ordering) are superseded by D-016's single rule.

### A-001 — 2026-10-15 — Bootstrap direction

Owner: “I'm happy with the approach, the tech stack and I think we should target Pi and Claude Code. It should run locally.”

Effect: TypeScript and SQLite, Pi and Claude Code first, local execution. Vendor neutrality remains a constraint.
