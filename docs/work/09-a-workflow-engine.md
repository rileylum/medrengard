# 09-a — Workflow engine and default workflow

Route: Design. It replaces the seam every later row builds on (A-054 to A-056).

Goal: `apply` reads a workflow definition instead of a fixed stage table, and today's lifecycle is the default workflow.

Design note (approved in A-056):
- A workflow is a TypeScript module that exports plain data: stage names, a step kind for each stage (`agent`, `command`, `human`), the role for agent stages, transitions keyed on outcomes (`PASS`, `FAIL`), and a budget for each budgeted stage. Alternative rejected: code with hooks, which cannot be checked or hashed before it runs.
- Stage names are strings that the workflow defines. `ESCALATED`, `CANCELLED` and `ACCEPTED` are the engine's own.
- Today's event types stay, each with an optional `step` field naming the stage it belongs to. An event with no `step` belongs to the current stage, so existing stores replay. Alternative rejected: generic events and a migration.
- Counters become one budget counter per budgeted stage, kept on the Cycle.

Done when:
- `defaultWorkflow` reproduces the v1 table. Every scenario in `tests/scenarios.ts` ends at its declared stage and counters under it; the scenario table is unchanged. Verified by test.
- `checkWorkflow` refuses a workflow, with a reason, when a transition names an unknown stage, when an agent loop has no finite budget, when a stage uses an engine stage name, or when a stage has no path to a settled stage. Verified by one test per refusal.
- A workflow with no human stage (the last review's PASS goes to `ACCEPTED`) passes the check and reaches `ACCEPTED` (A-054, human acceptance is policy). Verified by test.
- A verdict or verification for a SHA that is not the candidate escalates under any workflow, not only the default one. Verified by test against a second workflow.
- A store written by `main` before this ticket still loads, and every cycle replays to the same stage and counters. Verified by test.

Constraints: zero dependencies. `apply` stays pure. Only `lifecycle.ts`, `store.ts` and their tests change, plus mechanical edits where `src/main.ts` and the caller tests read `c.standard` and `c.adversarial`, and the two escalation regexes in `tests/run.test.ts` (A-057); the callers keep working through the default workflow.
Non-goals: driving a workflow (09-b); prompts (09-c); extension steps and observers (row 10); a workflow file the job names (09-b).
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-19 — drafted on `feat/docs-core-principles` (A-056). Owner, asked to read the three tickets and say go: “merge, I'm happy. We'll then start work on a fresh context”. Read as go for 09-a to 09-c; READY.
- 2026-10-19 — engine shape decided (A-057): [design/2026-10-19-workflow-engine.md](../design/2026-10-19-workflow-engine.md). Owner: “take all recommendations”, then “design is approved”. Constraint widened for the counter read sites.
- 2026-10-19 — implemented. `c6a133d`: fixture `tests/fixtures/v1-store.sqlite`, written by the code at `dfaf0c9` (plus a `.gitignore` exception, since `*.sqlite` is ignored). `4d45a54`: engine, `defaultWorkflow`, `checkWorkflow`, `Cycle.budgets`, `step` field, store workflow; `4bd3605`: lazy-review shrink. `npm test` on `4bd3605`, implementer-run, not independent: 246 tests, 222 pass, 19 skipped, 5 todo, 0 fail. Mutation checks: 11 of 11 mutants caught. Next: standard review 1.
- 2026-10-19 — reviews waived by the owner (A-058): “waive”. No standard or adversarial review runs on 09-a. The plan file was deleted uncommitted at the owner's request. Next: 09-b on `feat/09-b-generic-driver`, stacked on this branch.
