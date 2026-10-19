# 10-c — Command stages

Route: Design. A user's custom step is a command stage (A-074, D-024), and 10-e's grants attach to it.

Goal: a workflow's command stage may run its own commands in the sandbox, with its context in a file named by `SF_REQUEST`, an `outputDir` of its own, network off unless it asks, and a recorded SHA-256 of each file it runs from beside the workflow.

Design note: [2026-10-20-command-stages.md](../design/2026-10-20-command-stages.md). `StageDef` command gains `run` and `network`; `verify` runs `run` or, without it, `job.checks`; each command stage writes its evidence, request, diff and `output/` under `evidence/<head>/<stage>/`; the reviewer sees every command stage's evidence for the head. Alternatives: bare argv lists; detecting file arguments; flat evidence with only `output/<stage>/` per stage.

Done when:
- The default workflow is byte-identical: its hash equals a literal computed on main. Verified by test.
- A command stage with `run` runs those commands and not `job.checks`; one without `run` runs `job.checks`. Verified by test.
- Inside the sandbox, `SF_REQUEST` names a file with the cycle ID, work ID, stage, head, base, ticket, `diffFile` and `outputDir`, and `diffFile` holds the base-to-head diff. Verified by test.
- A command can write `outputDir` and the checkout, and nothing else: not its own evidence, not another stage's. Verified by test.
- Network is off unless the stage sets `network: true`. Verified by one test each way.
- A file argument runs the bytes that were hashed, and the `verification` event records their SHA-256; a repository workflow's file is read at the base SHA. Verified by test.
- Two command stages on one head keep each other's evidence, and the reviewer prompt lists both. Verified by test.
- `checkWorkflow` refuses a malformed `run`, `network` or file argument. Verified by test.
- `commandKit` passes on a fixture command and fails on fixtures that break each contract; `readRequest` reads the request. Verified by test.

Constraints: zero dependencies. No paid calls. The default workflow stays byte-identical. Stores written before 10-c still replay.
Non-goals: grants (10-e); passing data between steps, including showing `output/` to a reviewer (A-074); network filtering by domain; named outcomes (Q8, parked).
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-20 — drafted on `feat/10-c-command-stages` (A-074). Not READY until the owner says go; no code before the design note is approved.
- 2026-10-20 — owner: “Approved all recommendations” (A-081). READY; design note approved with Q1 to Q4 as recommended.
- 2026-10-20 — built on `feat/10-c-command-stages`, tests first, code head `b97105f`. Implementer's `npm test` (not independent): 351 tests, 327 pass, 0 fail, 24 skipped or todo (unchanged). `lazy-review` run; its two shrinks applied, `commandKit`'s `deadlineMs` kept. Each done-when line has a test; mutants checked for the per-stage reviewer list, the bwrap `SF_REQUEST`, the `output/` bind, `network` both ways, running the copy of a file argument, the `files` shape check, the untrimmed repository file and the `main.ts` wiring. Decisions the note left to the build, for the reviewers:
  - `SF_REQUEST` reaches the command through `Policy.env`: bwrap sets it after `--clearenv`; verify also adds it to the spawn environment, which is what `none` runs in.
  - `checkWorkflow` also refuses a command stage whose name is not a file stem, because the name is now a directory under `evidence/<head>/`. Not in the note.
  - `run` refuses a file argument with no `workflowDir` before the developer starts, so a paid run is not wasted. `verify` refuses it too, and refuses a file missing from `workflowDir`, before writing anything.
  - A repository workflow's file arguments are read with `git cat-file blob`, not the `git` helper, which trims and would change the hashed bytes.
  - `commandKit` has five cases. A fixture breaks four of them. The request case has no breaking fixture: the controller writes the request, not the command; `readRequest` has its own test.
  - The default reviewer prompt now names checks `VERIFYING/<name>`; the golden prompts in `tests/fixtures/prompts/` are updated (A-081 Q4). The default workflow's hash is unchanged and pinned.
  - Known limit: a cycle opened before 10-c and resumed in a review stage finds no evidence under `evidence/<head>/<stage>/` and escalates. No command calls `resume` yet (row 11).
