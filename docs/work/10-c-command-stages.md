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
