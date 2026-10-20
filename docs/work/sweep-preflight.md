# sweep-preflight — One preflight for run and resume

Route: Design. Item 3 has a real alternative: refuse the shapes in `checkWorkflow` (an engine rule) or in the driver (a limit of today's steps). The choice decides what "checkWorkflow passes" means.

Owner's instruction, 2026-10-20: "Once all this research comes back, triage it (merging similar things and organizing it, giving ratings for highest impact) - then create a worktree for each and spin up a sub agent to implement them. I want to come back tomorrow to a number of ready to merge branches, so we should only focus on the high quality and high impact ones. We will then work through them together, deciding if they should be merged or not, or if they need changes before going in - so you will need to explain each to me in plain english and defend the changes." This is the go to build the branch, not approval to merge.

Goal: `run` and `resume` share one `preflight` that refuses, before any cycle opens or any step runs, every setup a later step would refuse after a paid developer run.

Design note:
- Interface: `preflight(w, adapters, job, opts): Adapters` in `src/run.ts`, called by `run` before `develop` and by `resume` before `drive`. It runs the checks `run` made before (sandbox, `workflowDir`, grants, a role with no adapter) and adds three: the job's check names (`checkCommands`, split out of `verify`), each check program's presence in the sandbox (`missingProgram`, split out of `runCheck`), and the workflow shapes the driver cannot run (`driverLimits`). `verify` keeps its own name and program checks as a backstop.
- Shapes refused by `driverLimits`: (a) an edge into a commit stage where the last verdict may not be a FAIL for the candidate, because `fix` takes its findings from it: an edge from a commit stage, a review's PASS, or an edge from a command or human stage reachable from a commit or a review's PASS without another review in between. A command or human stage between a review's FAIL and the fix is allowed (it runs on `main` today); (b) a review stage that a commit stage reaches without a command stage between them, because `review` needs the verify checkout and evidence of the candidate.
- Alternative 1, chosen: a driver preflight. `checkWorkflow` keeps meaning "breaks a rule the engine guarantees under any driver". These shapes are sound for the engine: `apply` runs them correctly. Only today's `fix` and `review` cannot. Each shape is one rule with a comment naming the step it protects, so when `fix` learns to read check failures (TRIAGE owner item 4, harnesses finding 3) the owner deletes one line, and no stored workflow changes validity.
- Alternative 2, not chosen: add the rules to `checkWorkflow`. The store would refuse the workflow at load, which is earlier and visible in the guide's workflow editor. But it makes a driver limit an engine rule, and lifting it later changes which workflows the store accepts (D-023 territory). A store opened on such a workflow today would also stop loading, not only stop running.
- Alternative 3, not chosen: support the shapes. That is a flow change the owner has not decided (TRIAGE owner item 4).

Done when:
- `run` refuses a job check whose name is not a file stem, is `tree`, is declared twice, has a non-string argument or an empty command, before the developer starts, when a command stage uses `job.checks`. Verified by test.
- `run` refuses a check (job or stage `run`) whose program has no slash and is not found, or is found only outside the sandbox, before the developer starts. Verified by test.
- `run` refuses each of: a command stage's FAIL into a commit stage, a human stage's FAIL into a commit stage, a PASS (from a commit or a review stage) into a commit stage, a human FAIL after a check and before any review, and a review stage reached from a commit stage with no command stage between (one hop, or past a human stage). Each reason names the stages. `checkWorkflow` still passes them. A command or human stage between a review FAIL and the fix still runs end to end. Verified by test.
- `resume` refuses a missing grant, a missing `workflowDir` and a refused shape before any step. Verified by test.
- The test that made a stage throw with a bad check name now makes it throw another way and still pins `reject_dispatch`. Verified by test.
- The spec's Driver section lists the preflight with test names; `npm run test:learn` passes; guide text that became wrong is fixed.

Constraints: zero dependencies; no paid calls; `checkWorkflow` and the default workflow unchanged; `verify` keeps its checks as a backstop.
Non-goals: supporting a check-fix loop; checking a slash path (it names a file in the candidate, which does not exist yet); checking that a `{ file }` argument exists before develop; a job with no checks (still escalates after the developer run, as the spec says); a grant stage reachable from a commit stage with no review PASS between (the head gate in `verify` still refuses it, but only after the developer run).
Verification: `npm test` and `npm run test:learn`, run by the owner on the reviewed SHA.

## For the owner

**What was wrong.** Some mistakes in a job or workflow were found only after the developer run had been paid for. The cycle then escalated with an internal-sounding message. Four cases:
1. A bad check name in the job file, such as `../x`. `verify` refused it, after the developer run.
2. A check program that is not installed, or lives outside the sandbox (for example `npm` under `~/.nvm`). The check was recorded as MISSING, after the developer run.
3. A workflow the engine accepts but the driver cannot run. For example `VERIFYING: { budget: 2, FAIL: 'DEVELOPING' }`, the natural "tests failed, fix them" loop. `fix` threw "last verdict is not a FAIL for the candidate". A review with no check stage before it threw "no verify checkout".
4. `resume` skipped the `workflowDir` and grant checks that `run` makes.

**Reproduction.** On `main`, `/var/tmp/software_factory/research-2026-10-20/sweep/probes/verify-fail-loop.test.ts` and `no-verify.test.ts` each pay a (fixture) developer run, then escalate. In `tests/run.test.ts` the test "a stage that throws" showed case 1: a check named `../x` gave `claim, developer_result, reject_dispatch`.

**What the change does.** One function, `preflight` in `src/run.ts`, runs before the developer starts and before `resume` takes a step. It refuses all four cases with a message that names the stage, the check or the program. Nothing is opened, so there is nothing to cancel.

**Why a driver check and not a `checkWorkflow` rule.** Item 3 shapes are fine for the engine; only today's `fix` and `review` cannot run them. Keeping them out of `checkWorkflow` keeps that check meaning "breaks an engine guarantee", and lifting a limit later is one deleted line in `driverLimits`, with no change to what the store accepts. If you want shape (a) supported later (a bounded fix loop for red checks), `fix` must learn to read check failures as findings, and then the first rule in `driverLimits` goes.

**Risks and what it does not cover.**
- A job whose check program is missing now exits before the run, where before it ran and escalated. That is the point, but the guide's "A check is not installed" simulator preset now shows the refusal instead of a MISSING check; its text is updated.
- The program check uses the controller's PATH at preflight time, as `verify` does at check time. A program added to PATH between the two would pass `verify` too, so nothing is lost.
- A check run as a path (`./gradlew`) is not checked: it names a file in the candidate.
- A `{ file }` argument missing from `workflowDir` is still found only at `verify`. Same class, not in this item.
- A job with no checks still escalates after the developer run ("Missing evidence is never PASS"). Same class; refusing it is a spec change.

- A grant stage that a commit stage reaches with no review PASS between still fails only after the developer run, at `verify`'s head gate. No rule was added for it (standard review 2 asked to leave it as a known gap).
- `resume` now runs `driverLimits` too. A cycle opened earlier on a workflow that is now refused (for example `AWAITING_ACCEPTANCE: { FAIL: 'DEVELOPING' }`) can no longer be resumed; it can only be accepted or cancelled.
- A natural "request changes" edge (a human stage's FAIL back to the developer after the last review PASS) now makes the whole workflow refused at `run`. Before, such a workflow ran, and only escalated if the owner actually requested changes.

**Decision for you.** Whether these shape limits belong in the driver (built) or in `checkWorkflow` (alternative 2).

## Log
- 2026-10-20 — ticket written on `feat/sweep-preflight` (owner's go above).
- 2026-10-20 — tests first in commit "test(sweep-preflight): run and resume refuse before a paid run (red)". On the unchanged code, `node --test tests/run.test.ts`: 24 tests, 19 pass, 4 fail, each for the stated reason: "Missing expected rejection: a check FAIL back to the developer" (expected `/stage CHECK FAIL enters commit stage DEV/`); "Missing expected rejection" for `/check name "\.\.\/x" is not a file stem/`, for `/stage VERIFYING check lint: sf-no-such-program-7c1d not found/`, and for resume's `/stage MERGE asks for grant github, which no personal or job file gives/`. The rewritten "a stage that throws" test passes on both: its developer changes `job.checks` after preflight, so it now pins `verify`'s backstop and `reject_dispatch`.
- 2026-10-20 — built. `preflight` and `driverLimits` in `src/run.ts`; `checkCommands` and `missingProgram` split out of `verify` and `runCheck` in `src/verify.ts` (same messages). The guide: `learn/shims/sim-verify.js` exports both via `liveFunction` and uses them; the simulator's "A check is not installed" preset, the loop slide in `learn/sim.html`, the MISSING paragraph in `learn/verify.html` and the workflow editor's "accepted" line were wrong after the change and are updated. The guide was not checked in a browser. Mutants (`/tmp/sfp-mut.py`, one at a time, restored with `git checkout`): 7 tried, 7 caught after adding a "review PASS into a commit stage" case for the one that first survived (the `kind(name) === 'verdict'` condition). `lazy-review`: lean; one comment that cited a research report outside the repository was reworded.
- 2026-10-20 — implementer's run, not independent: `npm test` 423 tests, 399 pass, 0 fail, 19 skipped, 5 todo (baseline 419/395). `npm run test:learn` 6 tests, 6 pass.
- 2026-10-20 — standard 1 on `6d0b6c9`: FAIL, one major and two minors.
  - Major: rule (a) refused workflows that run on `main`: a command or human stage between a review's FAIL and the fix (`fix` needs only that the last verdict is a FAIL for the head). Fixed in `driverLimits` by marking the command and human stages that a commit or a review's PASS reaches before another review, and refusing an edge into a commit stage from a commit stage, from a review's PASS, or from a marked stage. Tests first, both red for the stated reason ("the driver cannot run workflow after-fail: stage BETWEEN PASS enters commit stage DEVELOPING"): a command stage between the FAIL and the fix reaches AWAITING_ACCEPTANCE through `run`; a human stage there stops `run`, and `resume` after `accept` reaches AWAITING_ACCEPTANCE. New refusal tests: the owner's FAIL after the adversarial PASS, and a human FAIL after a check before any review.
  - Minor: rule (b) was tested only one hop deep. Added DEV → OWNER (human) → REVIEW. The mutant without the recursive `walk(to)` is now caught.
  - Minor: an empty job check command passed preflight and was MISSING after the run. `checkCommands` now refuses it (`check a: command is empty`), test first (red: "Missing expected rejection"). `verify` shares the rule, so a job changed after preflight to an empty command now escalates by `reject_dispatch` rather than recording MISSING.
  - Mutants (`/tmp/sfp-mut.py`): 8 tried on the fix, 8 caught after adding the human-after-check case for the one that first survived (the recursion in `mark`).
- 2026-10-20 — implementer's run after the fix, not independent: `npm test` 426 tests, 402 pass, 0 fail, 19 skipped, 5 todo; `npm run test:learn` 6 pass.
- 2026-10-20 — standard 2 on `c9e1f54`: PASS, with three minors and two nits. The review budget is now spent; this last round is small and was not reviewed again.
  - Minor: a commit stage's FAIL edge, which `apply` never takes, counted as an edge (probe P1 refused here, runs on `main`). Minor: stages the start never reaches were checked (P2, P2b). Fixed: `driverLimits` follows only a commit stage's PASS, and checks only stages reachable from `start`. Test first, red with "the driver cannot run workflow case-0: stage NOTES PASS enters commit stage DEVELOPING"; it now runs all three to AWAITING_ACCEPTANCE. Two mutants (follow every commit edge; check every stage) are each caught. The reviewer's probe (`review-preflight-probes/probe.ts`) on this tree: P1, P2 and P2b each RAN to AWAITING_ACCEPTANCE.
  - Minor: a grant stage reachable from a commit stage with no review PASS between still throws only after the paid run. Not built, as asked; listed in Non-goals, "For the owner" and the spec's Driver section.
  - Nit: `learn/demos/ver-lab.js` now shows the "command is empty" refusal. Nit: "For the owner" now says what `resume` running `driverLimits` means for older cycles, and that a request-changes edge refuses the whole workflow.
- 2026-10-20 — implementer's run after the standard 2 round, not independent: `npm test` 427 tests, 403 pass, 0 fail, 19 skipped, 5 todo; `npm run test:learn` 6 pass.
- 2026-10-20 — owner: “Approved” (A-096); shape limits stay in the driver; preflight may grow to other uses later. Main merged into the branch (clean); session's run, not independent: `npm test` 431 tests, 407 pass, 0 fail; `test:learn` 6 pass. Merged into main with `--no-ff`.
