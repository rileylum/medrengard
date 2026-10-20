# 10-e — Grants

Route: Design. A grant hands the owner's credential to a command stage (A-074, D-024). Where the secret travels, and when the stage may run, are seams later merge and deploy steps build on.

Goal: a workflow's command stage may ask for a grant; only the personal or job layer gives it; its value reaches that stage's sandbox alone, and never bwrap's argv or the evidence; the stage runs only on a reviewed head and must report the head it acted on.

Design note: [2026-10-20-grants.md](../design/2026-10-20-grants.md). The layers map a grant name to `{ variable, file }`. `StageDef` command gains `grants`. `Policy` gains `secrets`, passed through the spawn environment with `--unsetenv` instead of `--clearenv`. A head gate runs before the stage, and a reserved `head` check runs after it. Stdout and stderr are redacted. The alternatives considered: `--setenv`, a secret file inside the sandbox, and a load-time graph check.

Done when:
- No secret value appears in any bwrap argv, and the grant stage's commands see it in their variable. Verified by test.
- In a workflow with a developer, a check stage, a reviewer and a grant stage, only the grant stage's environment holds the value. Verified by test.
- The personal and job layers give grants, and the job layer replaces one by name. The repository layer is still refused, and so is a repository workflow that asks for a grant. A missing file, a file inside the repository and a bad variable are each refused. Verified by test.
- `checkWorkflow` refuses a malformed `grants`, a grant stage without `run`, one without `network: true`, one whose `FAIL` is not `ESCALATED`, and a command named `head` in a grant stage. Verified by test.
- `run` refuses a grant the configuration does not give, and any grant under `none`, before the developer starts. Verified by test.
- A grant stage on a head without fresh verdicts and verifications, or without a PASS verdict, escalates with nothing run. Verified by test.
- A missing or different `output/head` records a FAIL `head` check and escalates. Verified by test.
- A printed token appears as `[grant <name>]` in the evidence and the reviewer prompt. Verified by test.
- The `verification` event records the grant names. Older stores replay, and the default workflow's hash is unchanged. Verified by test.
- `commandKit`'s head case passes on a fixture that writes the head and fails on one that does not. Verified by test.

Constraints: zero dependencies. No paid calls. The default workflow stays byte-identical. Stores written before 10-e still replay. No secret in a committed file, a log or an event.
Non-goals: a secret delivered as a file inside the sandbox; network filtering by domain; preventing a stage from misusing its token (A-074); a merge extension itself; named outcomes (Q8, parked).
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-20 — drafted on `feat/10-e-grants` (A-074). Not READY until the owner says go; no code before the design note is approved.
- 2026-10-20 — owner: “take all” (A-083). READY; design note approved with Q1 to Q5 as recommended.
