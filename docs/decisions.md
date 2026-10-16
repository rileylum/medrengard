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
| D-016 | DECIDED (A-016) | [Core lifecycle v1](specs/core-lifecycle-v1.md) is the implementation baseline. One recovery rule: anything unclassified escalates; owner chooses child cycle or cancel. Edge-case semantics are added only when a test or a real incident requires them |
| D-017 | DECIDED (A-016) | Design documents are not put through adversarial review on their own. The 2+1 rule applies to code with executable tests |
| D-018 | DECIDED (A-017) | Plan steps are broken into Fast or Design tickets and delivered per [workflow.md](workflow.md) |

## Open

| ID | Question | Needed by |
| --- | --- | --- |
| O-001 | Pi and Claude Code: structured output, cancellation, isolation. `-p` and JSON modes exist on both CLIs; nothing else checked | Runtime spike |
| O-005 | Default quality checks per repository type; who may waive | First real repository |
| O-006 | Foreground process or daemon; GitHub remote; merge mechanism | Integration |
| O-007 | Backpressure: max outstanding PRs, cost and time limits | Before unattended runs |
| O-009 | Staging and deployment ownership | Release tracking |

## Approval history

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
