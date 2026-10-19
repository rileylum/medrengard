# 09-b — Generic driver

Route: Design. Recovery (row 11) and every later stage depend on how a workflow is driven.

Goal: `run.ts` drives any workflow by step kind, and resumes a cycle from its stored stage.

Design note: a step registry maps a step kind and role to an implementation. Today's `develop`, `fix`, `verify` and `review` become the default steps. A step receives its inputs from the workflow, for example the last verdict's findings for the fix step, not by reading the store itself. The job file may name a workflow module; the default is `defaultWorkflow`. Alternatives: one function per workflow (no reuse of steps), or steps that read the store directly (hidden coupling, which structured findings would have to undo).

Done when:
- Every test in `tests/run.test.ts` and `tests/main.test.ts` passes unchanged under the default workflow. Verified by test.
- A second workflow, `DEV → CHECK → REVIEW (role reviewer, budget 1) → OWNER (human)`, runs from open to `OWNER` with fake adapters and no role aliases (A-059: the engine can't start on a review stage, and `review` needs `verify`). Verified by test.
- A cycle records the workflow's name and content hash when it opens, and the store refuses to load a cycle whose hash doesn't match its workflow. A cycle with no recorded hash loads under the default workflow. Verified by test (moved from 09-c, A-059).
- `resume(store, cycleId, ...)` on a cycle left at `VERIFYING` runs the checks and continues, with no developer run. Verified by test.
- The loop's step cap is derived from the workflow's budgets, not a constant. Verified by a test where a workflow with larger budgets runs past today's cap of 10.
- A job naming a workflow that fails `checkWorkflow` is refused before any run, with the reason. Verified by test.
- Parked 08-f minor: one timeout test per controller git call site in `developer.ts` and `verify.ts`, each with a deadline other than 2000. Verified by test.

Constraints: zero dependencies. No paid calls: tests use `tests/fake-adapter.ts` and `tests/stub-cli.ts`. Stacked on 09-a.
Non-goals: finding orphaned runs and relaunching (row 11); extension steps (row 10); prompt changes (09-c).
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-19 — drafted on `feat/docs-core-principles` (A-056). Owner, asked to read the three tickets and say go: “merge, I'm happy. We'll then start work on a fresh context”. Read as go for 09-a to 09-c; READY.
- 2026-10-19 — approach decided (A-059): [design/2026-10-19-generic-driver.md](../design/2026-10-19-generic-driver.md). Owner: “take all”. Second-workflow line changed; cycle-record line moved in from 09-c. Waiting for the owner to approve the note.
- 2026-10-19 — the owner ran `/plan-work` on the design note, read as approval of it (no quoted reply). Interface answers (step table private to `run.ts`; workflow from `store.workflow`; `fix` keeps reading its findings; `workflowHash` in `store.ts`; test seams): “take all”. Plan: `plans/2026-10-19-generic-driver.md`, uncommitted.
- 2026-10-19 — implemented. `4a6cd50`: parked 08-f minor, three timeout tests at 3000 ms that also bound the elapsed time (the reason text repeats whatever deadline it is given, so text alone would not catch a call site hard-wired to 2000). `752a832`: generic driver (`run`, `resume`, private step table by stage kind, adapters by role, step cap from budgets), the open marker records the workflow's name and hash and `load` refuses a mismatch, `checkWorkflow` refuses a role that produces both a commit and a verdict. `61b550c`: the job file's `workflow` module, `runtime` keyed by role, exit 0 and `accept` at any human stage. Outside the plan: `cliAdapter` gains a `writes` option, because the sandbox gave write access only to role `developer` (`src/runtime/cli-adapter.ts:74`); `main.ts` sets it per role. One existing test edited: the stub store in `tests/controller.test.ts:148` gains `workflow`, assertions unchanged. `npm test` on `61b550c`, implementer-run, not independent: 264 tests, 240 pass, 19 skipped, 5 todo, 0 fail. Mutation checks: 13 of 13 mutants caught (4 for 08-f, 6 for the driver and store, 3 for `main.ts`). Next: standard review 1.
- 2026-10-19 — reviews waived by the owner (A-060): “Okay lets waive the review again”. Next: 09-c on `feat/09-c-prompt-versions`, stacked on this branch.
