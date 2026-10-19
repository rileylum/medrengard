# Current status

## Where we are

Design iteration stopped (A-016). Implementing [core lifecycle v1](specs/core-lifecycle-v1.md).

Open questions and the research behind them: [open-questions.md](open-questions.md).

Plan step 1 done: `src/lifecycle.ts` is the pure state machine; `tests/lifecycle.test.ts` and `tests/scenarios.ts` hold SC-01 to SC-19.

Plan step 2 done (A-018): `src/store.ts` persists events in one `node:sqlite` table and replays them through `apply`.

Plan step 3 done (A-019): `src/runtime/spawn.ts` launches, observes and cancels a runtime as a child process; [03-a-findings.md](work/03-a-findings.md) records how `claude -p` and `pi -p` behave (JSON shapes, session ids, exit 143 on cancel, exit 1 with JSON or stderr on bad model and no auth, tool denial). Tickets 03-a and 03-b, merged as one stacked branch with an adversarial FAIL on record; the process-group escape and the other findings are parked for 04-a.

Step 4 completed by 04-d and 04-e (A-024, A-025): `src/runtime/cli-adapter.ts` builds the real `claude` and `pi` adapters from a spec over `spawnRuntime`; the runtime ends its reply with a fenced `json` block holding the claim, found by a linear scan; `spawnRuntime` runs the child in a systemd user scope (`sf-<runId>`) and kills the whole cgroup on cancel, deadline or exit, and caps each stream at 8 MiB (`overflow`); the 03-b minors are fixed; `Adapter.name` is dropped. Tickets 04-d and 04-e merged as one stacked branch; 04-d's adversarial FAIL (regex backtracking) is fixed by 04-e, which passed both reviews. Two 04-e minors are parked for the reconcile ticket.

Plan step 4 done (A-023): `src/adapter.ts` is the seam between the controller and a runtime; `src/controller.ts` starts a run with a deadline and records exactly one outcome per run through `EventStore.append`, which now returns the replayed Cycle; `run_failed` is a lifecycle event; `tests/fake-adapter.ts` drives normal, malformed, timeout, cancel and duplicate outcomes. Tickets 04-a, 04-b and 04-c, merged as one stacked branch with an adversarial FAIL on record (string-cap size bound, parked for 04-d).

Plan step 6 done (A-028 to A-031), 06-a merged, 06-b and 06-c merged together as `058b2ee`: `src/review.ts` builds the reviewer prompt from the store (per-check results from the `verification` event), the verify checkout (`--text` diff cut to 128 KiB a side after an uncut path list, instruction files from the commit) and the evidence files (16 KiB a side), with nonce delimiters, refuses a missing, stale or dirty checkout or missing evidence, and runs the reviewer through `execute`; `claudeReviewer` is `--restricted --strict-mcp-config` with Read, Glob, Grep; `piReviewer` is `--no-approve --tools read,grep,find,ls`; the shared `git` helper reads 64 MiB and keeps the error code. Both real reviewers return verdicts live. 06-a: `src/verify.ts` checks out the candidate detached at `<runsDir>/<cycleId>-verify`, runs `job.checks` there through `spawnRuntime` with a deadline, byte cap and scope, writes `<name>.stdout|stderr|exit` under `<runsDir>/evidence/<head>/`, and appends `verification`; `Job.checks` declares the commands; `src/git.ts` is the shared sync Git helper. Standard 1 PASS, adversarial FAIL (committed-symlink escape, pi only) parked for the pi-policy or sandbox ticket. 06-b (reviewer runs) is drafted.

Plan step 5 done (A-026, A-027), merged at `ade1195` as one stacked branch (05-a, 05-b): `src/developer.ts` opens a cycle, makes a worktree per cycle on `sf/<cycleId>`, prompts the developer and refuses a claim whose head is not the branch tip through the new `accept` option on `execute`; the `claim` event carries `runtime`; `EventStore.open` enforces one open cycle per work item and an ESCALATED parent; `claudeDeveloper(worktree)` and `piDeveloper` are the tools-on specs. Both real CLIs reached VERIFYING live.

Plan step 7 done (A-032 to A-034), 07-a merged, 07-b and 07-c merged together as `a848571`: `src/run.ts` drives one job through `develop`, `verify`, `review`, `review` with one `fix` after a standard FAIL and stops at AWAITING_ACCEPTANCE, ESCALATED or CANCELLED; a stage that throws escalates the cycle with `reject_dispatch` naming the stage. `fix` in `src/developer.ts` reruns the developer on the cycle's worktree with the last verdict's findings; its head must be new in SHA and tree, the branch tip, descended from the base and non-empty against it. `verify` records a dirty tracked tree or an index flag after the checks as `tree: FAIL` with evidence. `node src/main.ts <job.json>` runs a job with the real adapters by name and prints the stage, head, verdicts and the two Git lines to diff and merge; exit 0 only on AWAITING_ACCEPTANCE. Live: claude in all three roles took a scratch ticket to AWAITING_ACCEPTANCE in about 50 s. Parked: the `.git` pointer swap and other writes to the shared `.git` by a check (sandbox ticket); scratch repositories only until then (A-029).

Plan step 8 done (sandbox, A-035 to A-042). 08-a and 08-b merged by the owner as `f5e90bb`: every verification check runs inside bubblewrap on a checkout with no `.git`. `src/sandbox.ts` wraps a command from a policy (write roots, read roots, network) for backend `bwrap` or `none`; the job file names it, default `bwrap`. The controller writes and compares the checkout through the repository's git dir and a private index, restores owner access before comparing, counts git's warnings as dirt, and removes untracked entries before review. Closed: the parked 06-a symlink, `core.hooksPath` and evidence lines, the 07-b gitdir-swap, `git replace` and `core.fileMode` lines, and 08-a's adversarial major. Parked (A-037): a committed gitlink directory and a dangling symlink survive the untracked removal (against 08-c), and two verify minors. 08-c merged as `86dde47`: the developer runs in bwrap in its own clone, and its branch comes back through a sandboxed `upload-pack`. 08-d, 08-e and 08-f merged together as `f479736`: reviewers run in bwrap with the checkout read-only, every reviewer call site in `main.ts` is tested, and every controller git call over a tree a run or a check wrote is killed at the stage deadline and recorded. Developer, check and reviewer runs are all sandboxed now. The owner lifted the scratch-repositories-only limit (A-043): the factory may run on any repository. Runs keep full network access and can read their own CLI's credentials. Parked: two 08-f minors, against the next ticket that touches `git.ts`, `verify.ts` or `developer.ts`. Research: [08-a-findings.md](work/08-a-findings.md).

Ticket 07-d (A-044), on `feat/07-d-accept-cancel` stacked on `feat/09-scoping`: `node src/main.ts accept <job.json> <sha>` and `cancel <job.json>` record the owner's decision, so a work ID can run again. A refused command writes nothing. The store waits 5 s for another process's write lock and checks row 0 (two parked 02-a notes). Standard 1 PASS and adversarial PASS on `b5d4635`. The owner chose to fix the two adversarial minors (A-045): the run command refuses extra arguments, and a job naming a parent that is no longer ESCALATED is refused with a hint. Standard 2 PASS on `eaa5eb8`. Merged by the owner as `e61eb91`.

Experimental herdr TUI (A-046 to A-048), merged to main from `feat/proto-herdr-tui` and outside the ticket workflow: `proto/` is a herdr TUI. `proto/board.ts` lists jobs with stage, live agent and what needs the owner. `proto/run.ts` runs each stage as interactive claude in a herdr tab through `proto/herdr-adapter.ts`, inside the job's bwrap sandbox with three changes for interactive runs (A-047). See [proto/README.md](../proto/README.md). In live runs, two demo tickets reached AWAITING_ACCEPTANCE. A third, where the owner answered the developer in its tab, escalated: the reviewers cannot see what the owner says in a tab (O-010). The goal is a factory that runs in herdr (A-047); findings in [work/herdr-findings.md](work/herdr-findings.md).

Open questions moved to their own file (A-049), merged as `5959506`.

Experimental guide (A-050), outside the ticket workflow, merged to main as `596f620`: `learn/` is an interactive guide to the factory, modelled on the Cube Crawler learning guide. `npm run learn` serves it at http://127.0.0.1:8077/learn/. Twelve rooms with three detail levels, live code and docs read from the repository, and demos that run `src/` in the browser through an import map of stand-ins; the simulator runs the real `run`, `execute` and `apply` on a ticket the reader edits. `npm run test:learn` keeps it in step with `src/`, outside `npm test`. The owner walked through it on 2026-10-18; how to change it is in [learn/README.md](../learn/README.md).

## Checks run

2026-10-15: `npm test` and `RUNTIME_SPIKE=1 npm test` on `d8a9d21`, owner-run — 51 tests, 36 pass offline (10 live tests skipped with reason), 46 pass live, 5 todo, 0 fail.
2026-10-16: `npm test` on `3ba5434` (04-a), owner-run — 62 tests, 47 pass, 10 skipped, 5 todo, 0 fail. Standard review 1 PASS, adversarial FAIL (three majors in `receive`/`run_failed`; see the ticket log).

2026-10-16: `npm test` on `8664c1b` (04-b), owner-run — 68 tests, 53 pass, 10 skipped, 5 todo, 0 fail. Standard review 1 PASS; adversarial FAIL (two majors: hostile in-process values from an adapter, a throwing `toStringTag` getter on a rejection and a throwing `status` getter on an outcome, strand a cycle; see the ticket log).

2026-10-16: `npm test` on `003fdef` (04-c), owner-run — 71 tests, 56 pass, 10 skipped, 5 todo, 0 fail. Standard review 1 FAIL (BigInt and cycles pass `structuredClone` and throw in `append`); fixed with a JSON round trip.
2026-10-16: `npm test` on `e97a045` (04-c fix), owner-run — 71 tests, 56 pass, 10 skipped, 5 todo, 0 fail. Standard review 2 PASS. Adversarial FAIL: one major (an outcome within about 60 bytes of V8's string cap survives the guard and throws `RangeError` in `append`, stranding the cycle; reproduced, needs about 3 GB heap).

2026-10-16: `npm test` on `93ab46e` (04-d), owner-run — 102 tests, 83 pass, 14 skipped, 5 todo, 0 fail; `RUNTIME_SPIKE=1 npm test` 97 pass, 0 skipped, 0 fail. Standard 1 PASS; adversarial FAIL on `5347806` (claim-block regex backtracking holds the event loop past the deadline).
2026-10-16: `npm test` on `c72625d` and `e6789d6` (04-e), owner-run — 111 tests, 92 pass, 14 skipped, 5 todo, 0 fail. Standard 1 PASS, adversarial PASS.
2026-10-16: `npm test` on `c7adae7` (05-a), owner-run — 125 tests, 104 pass, 16 skipped, 5 todo, 0 fail; `RUNTIME_SPIKE=1 node --test tests/developer.test.ts` 9 pass, both live developer runs reach VERIFYING. Standard 1 PASS (2 minors, 3 notes, fixed in `18421ff`).
2026-10-16: `npm test` on `c8e7cf4` (05-b), owner-run — 129 tests, 108 pass, 16 skipped, 5 todo, 0 fail. Live claude run with the 05-b grant: implementer-run only, VERIFYING in 19.6 s. Standard 1 PASS, 4 notes. Adversarial PASS, 1 minor (project settings file inside the worktree joins the grant) and 5 notes, parked.
2026-10-16: `npm test` on `18421ff` (05-a), owner-run — 126 tests, 105 pass, 16 skipped, 5 todo, 0 fail. Adversarial FAIL: two majors (a throw after `open` strands a QUEUED cycle and blocks the work; `git log --output` and `git diff --output` write outside the worktree under the claude allow list); see the ticket log.

2026-10-16: `npm test` on `5d1a34b` (06-a), owner-run — 135 tests, 114 pass, 16 skipped, 5 todo, 0 fail. Standard review 1 launched.

2026-10-16: `npm test` on `4b20fb5` (06-a, standard 1 minors fixed), owner-run — 135 tests, 114 pass, 16 skipped, 5 todo, 0 fail. Standard 1 PASS on 5d1a34b; adversarial FAIL on 4b20fb5 (one major: a committed symlink lets a check read the developer's worktree; see the ticket log).

2026-10-16: `npm test` on `09402c8` (06-b), owner-run — 144 tests, 121 pass, 18 skipped, 5 todo, 0 fail. Standard review 1 PASS (6 minors, fixed in f7ed0be with `--restricted` for the claude reviewer).

2026-10-16: `npm test` on `f7ed0be` (06-b, minors fixed), owner-run — 145 tests, 122 pass, 18 skipped, 5 todo, 0 fail. Adversarial FAIL on f7ed0be (one major: a diff over 1 MiB strands the cycle on `execFileSync`'s default `maxBuffer`; see the ticket log).

2026-10-16: `npm test` on `d0fd999` (06-c), owner-run — 150 tests, 127 pass, 18 skipped, 5 todo, 0 fail. Standard review 1 PASS (3 minors, two fixed, the CRLF one probed and not reproduced).

2026-10-16: `npm test` on `03310a6` (06-c, minors fixed), owner-run — 150 tests, 127 pass, 18 skipped, 5 todo, 0 fail. Adversarial PASS on 03310a6 (1 minor parked).

2026-10-16: `npm test` on `c5322f6` (07-a), owner-run — 155 tests, 132 pass, 18 skipped, 5 todo, 0 fail. Standard review 1 FAIL (1 major, 1 minor; see the ticket log).
2026-10-16: `npm test` on `6261150` (07-a, standard 1 fixed), owner-run — 155 tests, 132 pass, 18 skipped, 5 todo, 0 fail. Standard review 2 PASS (4 notes; one test note closed in 76a84cd).
2026-10-16: `npm test` on `76a84cd` (07-a), owner-run — 155 tests, 132 pass, 18 skipped, 5 todo, 0 fail. Adversarial PASS (1 minor parked for 07-b).

2026-10-16: `npm test` on `f3b4e12` (07-b), owner-run — 165 tests, 141 pass, 19 skipped, 5 todo, 0 fail; live `main.ts` AWAITING_ACCEPTANCE in 49.7 s. Standard review 1 PASS (1 minor, documented). Adversarial FAIL (1 major: a check running git inside the verify checkout hides a rewritten tracked file from the `tree` check and review's guard; 2 minors; see the ticket log).

2026-10-16: `npm test` on `ef4ceea` (07-c), run by the implementer session at the owner's request (away from the computer) — 168 tests, 144 pass, 19 skipped, 5 todo, 0 fail. Standard review 1 PASS, adversarial PASS.

2026-10-16: `npm test` on `21733ae` (08-a), implementer-run, not independent — 187 tests, 163 pass, 19 skipped, 5 todo, 0 fail. One live claude call was made by the red run of the new `main.ts` test before the stubs were added (ticket log).
2026-10-16: `npm test` on `190a372` (08-a, code as `21733ae`), run by the implementer session at the owner's request — 187 tests, 163 pass, 19 skipped, 5 todo, 0 fail. Not independent.
2026-10-16: `npm test` on `798eb1c` (08-a, standard 1 minor fixed), implementer-run, not independent — 188 tests, 164 pass, 19 skipped, 5 todo, 0 fail. Standard review 1 PASS on `21733ae`.

2026-10-16: `npm test` on `4991a9e` (08-d), implementer-run, not independent — 215 tests, 191 pass, 19 skipped, 5 todo, 0 fail. `RUNTIME_SPIKE=1` live reviewers (claude, pi) in bwrap recorded verdicts; 2 paid calls.
2026-10-17: `npm test` on `bef6ff3` (08-f), implementer-run, not independent — 223 tests, 199 pass, 19 skipped, 5 todo, 0 fail. Standard 1 PASS on `f20e5f9` (minor fixed), adversarial PASS on `bef6ff3` (2 minors parked).
2026-10-16: `npm test` on `cfdcc16` (08-c), implementer-run, not independent — 208 tests, 184 pass, 19 skipped, 5 todo, 0 fail. `RUNTIME_SPIKE=1` live developer runs (claude, pi) in bwrap reached VERIFYING; 4 paid calls in all, including 2 diagnostics.
2026-10-17: `npm test` on `f479736` (main after the 08-c and 08-f merges), implementer-run, not independent — 223 tests, 199 pass, 19 skipped, 5 todo, 0 fail.
2026-10-17: `npm test` on `73463fc` (main after the 08-close merge), owner-run — all pass.

2026-10-17: `npm test` on `b5d4635` (07-d), implementer-run, not independent — 228 tests, 204 pass, 19 skipped, 5 todo, 0 fail. Standard 1 PASS, adversarial PASS (2 minors).
2026-10-17: `npm test` on `eaa5eb8` (07-d, A-045 fix), implementer-run and the standard 2 reviewer's run — 230 tests, 206 pass, 19 skipped, 5 todo, 0 fail. Standard 2 PASS.

2026-10-18: `npm test` on `feat/proto-herdr-tui` (src unchanged), implementer-run, not independent — 230 tests, 206 pass, 19 skipped, 5 todo, 0 fail. Prototype exercised live in a separate herdr session (sonnet, 3 jobs; paid calls: 3 developer runs, 1 fix run, 6 reviewer runs).
2026-10-18: `npm test` on `feat/proto-herdr-tui` (uncommitted: board line wrap, README, workflow.md), implementer-run, not independent — 230 tests, 206 pass, 19 skipped, 5 todo, 0 fail. Board's wrapped key and status lines checked by eye in an isolated herdr session at 53 columns. Sandbox spike: interactive claude in the unchanged developer bwrap policy runs, but herdr does not detect it (1 paid call, sonnet); details in `proto/README.md`.
2026-10-18: `npm test` on `feat/proto-herdr-tui` (uncommitted: sandboxed herdr adapter), implementer-run, not independent — 230 tests, 206 pass, 19 skipped, 5 todo, 0 fail. Live in an isolated herdr session: `demo-clamp` READY to ACCEPTED from the board with all three stages in bwrap and detected by herdr (sonnet; paid calls: 1 developer, 2 reviewers, plus 1 spike prompt).
2026-10-18: `npm test` on `feat/proto-learn` (stacked on `feat/research-list`), implementer-run, not independent — 230 tests, 206 pass, 19 skipped, 5 todo, 0 fail. `npm run test:learn` — 6 tests, 6 pass.
2026-10-19: `npm test` on `596f620` (main after the A-049 and A-050 merges), implementer-run, not independent — 230 tests, 206 pass, 19 skipped, 5 todo, 0 fail. `npm run test:learn` — 6 tests, 6 pass. No file in `src/` imports from `proto/` or `learn/`.
2026-10-19: `npm test` on `4bd3605` (09-a, `feat/09-a-workflow-engine`), implementer-run, not independent — 246 tests, 222 pass, 19 skipped, 5 todo, 0 fail. Mutation checks on `4d45a54`: each of 11 mutants (entry guard, step check, isEvent step, loop, settled path, engine name, start, stale-verdict count, default budget, store refusal, store replay workflow) fails at least one test.

2026-10-19: `npm test` on `61b550c` (09-b, `feat/09-b-generic-driver`), implementer-run, not independent — 264 tests, 240 pass, 19 skipped, 5 todo, 0 fail. Mutation checks: 13 of 13 mutants caught.
2026-10-19: `npm test` on `c368009` (09-c, `feat/09-c-prompt-versions`), implementer-run, not independent — 269 tests, 245 pass, 19 skipped, 5 todo, 0 fail. Mutation checks: 5 of 5 mutants caught. `npm run test:learn`: 3 of 6 fail (2 already failed on 09-b; 09-c adds stale references to `prompt`, `oneLine` and `buildPrompt`).
2026-10-19: `RUNTIME_SPIKE=1 npm test` on `6ab20d6` (09-c), owner-run: every claude live test passed, including a real developer run, a real standard review and the end-to-end `main.ts` job. Every pi test that needed a reply failed: pi's OpenAI OAuth refresh returned `invalid_grant`. After the owner logged pi in again, `RUNTIME_SPIKE=1 node --test --test-name-pattern='pi'`, owner-run: 40 tests, 40 pass, 0 fail, including a real pi developer run and a real pi standard review. Seen live, not yet ticketed: the pi adapter records an error `turn_end` as "no claim block in reply" instead of pi's `errorMessage`; in the live `main.ts` job, the standard reviewer FAILed for a commit message it cannot see, and the fix run made no new commit.

## Next action

1. Done: plan step 8 merged (`86dde47`, `f479736`, `73463fc`); the owner's `npm test` on `73463fc` passes.
2. Done: the owner lifted the scratch-repositories-only limit (A-043).
3. Done: 07-d merged as `e61eb91`, with `feat/09-scoping`. `npm test` on `441a568` (code as `eaa5eb8`) was run by the implementer session at the owner's request: 230 tests, 206 pass, 0 fail.
4. Done: `feat/research-list` (A-049) and `feat/proto-learn` (A-050) merged as `5959506` and `596f620`.
5. Owner: choose the next stage. Either a first real run on a hobby repository, one issue at a time (nothing in row 9 is needed for it), or row 9 tickets. Open questions that name the first real repository as their deadline: O-005 (independent verification of "done when") and O-013 (role prompts and skills); O-014 (survey) comes before O-013. Decide whether the first run waits for them.
6. Done: acceptance evidence designed and parked (A-051, O-015). Plan rows 9 (recovery) and 10 (tracker and code host sync) set (A-052).
7. Superseded by A-055: recovery is now row 11, after the workflow engine (row 9) and the extension host (row 10).
8. Later: the owner chose on 2026-10-19 to leave row 13, formerly 11 (pools, acceptance evidence, structured findings, improvement loop, release tracking) as it is, and to explore later how to split it and what each part does. The small metrics script that reads the event store waits for that too.
9. Done: the parked 02-a schema cleanup is dropped (A-053).
10. Done: the scratch files for 02-a to 07-d under `/var/tmp/software_factory/` were deleted at the owner's request (2026-10-19). The 08-a to 08-f files are kept.
11. Owner: use the experimental herdr TUI (`proto/README.md`, A-048) while testing the factory. Findings and open questions for the real herdr frontend: [work/herdr-findings.md](work/herdr-findings.md).
12. Done (on `feat/docs-core-principles`, not merged): the core principles are recorded as A-054 and D-023. The workflow becomes user-definable, with today's lifecycle as the default. Open parts are in O-016.
13. Done: the owner approved the order (A-055). Plan rows 9 (workflow engine) and 10 (extension host and observation stream) come before recovery; the plan lists what later work needs from them.
14. Done: the row 9 design answers are recorded (A-056). Tickets 09-a, 09-b and 09-c are drafted under `docs/work/`.
15. Done: the owner said go (“merge, I'm happy”) and asked for the docs branch to be merged. Tickets 09-a to 09-c are READY.
16. Done: 09-a implemented on `feat/09-a-workflow-engine` (A-057; design `docs/design/2026-10-19-workflow-engine.md`, plan `plans/2026-10-19-workflow-engine.md`), head `4bd3605`.
17. Done: 09-a reviews waived by the owner (A-058). The spec rewrite becomes ticket 09-d, after 09-c.
18. Done: 09-b implemented on `feat/09-b-generic-driver` (A-059; design `docs/design/2026-10-19-generic-driver.md`, plan `plans/2026-10-19-generic-driver.md`, uncommitted), code head `61b550c`.
19. Done: 09-b reviews waived by the owner (A-060).
20. Done: 09-c implemented on `feat/09-c-prompt-versions`, stacked on `feat/09-b-generic-driver` (A-061, A-062; plan `plans/2026-10-19-prompt-versions.md`, uncommitted), code head `c368009`.
21. Done: 09-c reviews and owner-run tests waived by the owner (A-063).
22. Done: three tickets drafted from the 09-c live run, to be taken after row 9 (A-064): 04-f, 06-d, 07-e.
23. Done: 09-d, the spec rewrite (A-058, A-066), committed as `5a1c93e` on `feat/09-d-spec-rewrite`. Row 9 is finished; the stack 09-a to 09-d is not merged.
24. Drafted at the owner's request: [work/08-g-pi-auth-refresh.md](work/08-g-pi-auth-refresh.md). It first checks whether the `.pi` overlay drops pi's refreshed OpenAI login, then binds `auth.json` writable (A-038). READY (A-067), stacked on 04-f.
25. Done: 04-f implemented on `feat/04-f-pi-error-reason` as `e36d85e`; `npm test` implementer-run, 246 pass, 0 fail. Owner: run `npm test` on `e36d85e`, and run or waive the reviews.
26. 08-g investigation done ([work/08-g-findings.md](work/08-g-findings.md)): the overlay loses pi's refreshed login. Owner: choose an option from the findings and run `pi --version`. No code yet.
