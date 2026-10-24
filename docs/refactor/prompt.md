# Core refactor: brief for the orchestrating agent

You are the orchestrator. You run unattended until the stop rule below. The
owner reads the log and the final report; there is no one to ask mid-run.

## Read first

`AGENTS.md`, then `docs/core.md`. `core.md` wins over every other document.
`docs/architecture/source-v0.3.md` is the end goal; read §§05–08 and
Appendix B before round 0.

## Setup

- Integration branch `refactor/core` off `main`, checked out in
  `/var/tmp/software_factory/refactor/core`.
- Each round's worker gets its own worktree and branch off the current
  `refactor/core`: `/var/tmp/software_factory/refactor/rNN`, branch
  `refactor/rNN`.
- Never touch `main`, never push, never delete a worktree you did not create.

## Round 0: the proof

A worker subagent writes `tests/e2e/`. It imports only the public entry point
(create `src/index.ts` if needed) and defines the MVP workflow there as user
code, with stub agents. One test per case:

1. Idea to spec: a design agent stage turns an idea into a spec document
   (no commit yet); a human stage approves it by its hash; the approved spec
   starts the develop workflow.
2. Develop: a developer agent commits in an isolated worktree; a command
   stage runs the checks in the sandbox at that SHA.
3. Standard review FAIL, fix, second review PASS; a second FAIL escalates.
4. Adversarial FAIL escalates at once, with no second attempt.
5. Owner review and iterate: request changes, fix, review again, accept. An
   accept naming a stale SHA is refused.
6. PR: an extension stage opens a PR through a fake code host, carrying the
   review package.
7. An invalid agent result, or a zero exit with no artifact, cannot advance;
   it escalates.
8. A crash mid-run, then a restart: replay rebuilds state; no run is
   duplicated and no budget is spent twice.
9. An observer extension sees every event in order and cannot change state.
10. The stub runtime receives each agent's role text, skills and MCP servers
    as defined; swapping the runtime changes nothing else in the workflow.
11. The workflow check refuses an invalid workflow before anything runs.

Round 0 may add a thin layer over today's code to make these pass; later
rounds replace it. Merge round 0 only when the suite and `npm test` are green.

## Rounds 1 and later

1. **Pick.** You, or a scout subagent, choose the one change that most makes
   the code smaller, simpler or easier to build on while keeping `core.md`
   true. In rough order of preference: delete something cut; move policy out
   of the core into the default workflow; collapse a seam with one adapter;
   merge modules that change together; rename to the ubiquitous language.
   Adding code is allowed only for a primitive `core.md` names.
2. **Change.** A worker subagent makes it in its worktree, deleting the tests
   and docs that served deleted code. The e2e suite may change only to follow
   an API change, never to weaken a case.
3. **Gate.** `npm test` passes, including `tests/e2e/`.
4. **Review.** A fresh reviewer subagent gets only the diff, `core.md` and the
   test output, never the worker's reasoning. It returns PASS or FAIL with
   `file:line` findings. On FAIL, the worker gets one fix; a second FAIL
   abandons the round (log it, remove the branch, pick something else).
5. **Merge.** On PASS, merge `refactor/rNN` into `refactor/core` with
   `--no-ff`.
6. **Log.** Append to `docs/refactor/log.md`: the round, what changed and
   why, lines added and removed, `src/` and `tests/` line counts, the number
   of public exports, the verdict.

## Stop rule

Stop when two rounds in a row produce no change that the reviewer passes as
simpler, or after 30 rounds. Stop early, and log why, if keeping `core.md`
true would need an invariant broken or the owner's decision: that is the
"cannot classify" rule applied to this work.

## Finish

1. Rewrite `README.md` to describe what is left. Delete docs that describe
   deleted code. Leave `docs/decisions.md`, `docs/research/` and
   `docs/architecture/` unchanged.
2. Run one adversarial reviewer subagent against `refactor/core`: told to
   break `core.md`'s invariants and the e2e cases. Fix nothing after it; log
   its findings.
3. Write the final report at the end of `docs/refactor/log.md`: what the
   codebase is now, the before and after counts, the adversarial findings,
   and the questions for the owner.
