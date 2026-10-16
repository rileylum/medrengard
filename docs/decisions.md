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
| D-019 | DECIDED (A-035) | Candidate code runs inside a sandbox chosen by backend name. Bubblewrap first; Docker, VMs and cloud later behind the same interface. No VM or cloud backend for now; the tool stays agnostic |

## Open

| ID | Question | Needed by |
| --- | --- | --- |
| O-001 | Pi and Claude Code: structured output, cancellation, isolation. `-p` and JSON modes exist on both CLIs; nothing else checked | Runtime spike |
| O-005 | Default quality checks per repository type; who may waive | First real repository |
| O-006 | Foreground process or daemon; GitHub remote; merge mechanism | Integration |
| O-007 | Backpressure: max outstanding PRs, cost and time limits | Before unattended runs |
| O-009 | Staging and deployment ownership | Release tracking |

## Approval history

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
