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
- 2026-10-20 — built on `feat/10-e-grants`, tests first, code head `231163d`. Implementer's `npm test` (not independent): 374 tests, 350 pass, 0 fail, 24 skipped or todo (unchanged). Each done-when line has a test. 19 mutants were checked and all were caught: the argv leak, redaction, both head-gate rules, the head-file symlink and match, the refusal under `none`, secrets delivery, recording the grant names, the check `run` does before develop, the repository workflow refusal, a file inside the repository, the reserved variables, merging per name, the `main.ts` wiring, the `network` and `run` rules, the `grants` shape check, and the kit's head case. Runner: `/var/tmp/software_factory/10-e/mutants.py`. `lazy-review` found one 2-line shrink (the head-check evidence block repeats the tree check's), not applied. Decisions the note left to the build, for the reviewers:
  - `spawnEnv(policy)` in `src/sandbox.ts` is the one place that builds the spawn environment. `wrapBwrap` unsets every name in it except the secrets, so the two cannot disagree. Without secrets, the argv is unchanged (`--clearenv`).
  - The end-to-end test runs under cgroup isolation, so `systemd-run --scope` is shown to pass the environment through.
  - A grant file that is empty when the stage runs is refused, because redacting an empty string would mark every character. A file missing at that point throws too; `drive` records either as `reject_dispatch`.
  - The head gate counts every verdict, verification and `accept` in the history, including a redelivered one recorded as ignored. A late duplicate of an old verdict therefore escalates. That is conservative, and was not tested.
  - `output/head` must be a regular file of at most 1 KiB. A symlink, a FIFO or a larger file fails the `head` check without being read. Owner access is restored before reading, in case the command locked the file. A passing head check leaves no `head.*` evidence, as the tree check does.
  - For a grant stage, the kit adds a REVIEW stage before it and appends a PASS verdict, so the head gate passes. The new head case skips for a stage with no grant, so every existing kit now reports one more skip.
- 2026-10-20 — owner: “run the reviews, don't worry about the tests (though we should do a live run soon)” (A-084). Owner-run `npm test` waived; standard 1 started on `231163d`.
- 2026-10-20 — standard 1 on `231163d`: FAIL, one major and three minors. The major: a grant stage that locks its own `outputDir` made `verify` throw on `lstat(output/head)` after the stage had run, so no verification was recorded. The minors:
  - `head.stdout` quoted `output/head` without redaction.
  - The check that a grant file is outside the repository did not use real paths.
  - The end-to-end test had no stage after the grant stage.

  All four are fixed at `818de56`, each test written first and seen red. The fixes:
  - `headFile` restores owner access on `outputDir` and reports a read it cannot make as a FAIL.
  - `head.stdout` is redacted.
  - Grant files are compared by real path.
  - A LATER command stage dumps its environment and tries to read the token file.

  Also taken from the reviewer's notes: a grant file under a `sandbox.read` root is refused, and the grant file is read before the stage folder is cleared. The reviewer also noted that an ignored, redelivered verdict could satisfy the gate. This cannot happen: the store drops a second `verdict`, `developer_result`, `run_failed` or `dispute` with the same run ID at insert (`DEDUP`, `src/store.ts`), so `apply` never records one.

  Reviewer notes for the owner: a grant stage after a human stage cannot run yet, because `accept` records and returns, and no command resumes the cycle (row 11). The reviewer's independent `npm test` matched: 374 tests, 350 pass, 0 fail. Implementer's `npm test` on `818de56`: 377 tests, 353 pass, 0 fail. Five more mutants were all caught (`10-e/mutants2.py`). Standard 2 started on `818de56`.
- 2026-10-20 — standard 2 on `818de56`: FAIL, one major and three minors. The standard budget is spent, so the owner decides. The major: no test shows that `verify` delivers the token through `policy.secrets`. A mutant that puts it in `policy.env` (bwrap `--setenv`, so world-readable argv) passes every test; done-when 1 is tested only at `wrap()`. The minors:
  - `redact` replaces values in grant order, so a value that contains another is only partly hidden.
  - The read-root refusal covers `sandbox.read` but not the system roots, or the runtime roots the adapters bind.
  - `tree.stdout` is not redacted.

  Standard 1's four findings are confirmed fixed. The reviewer's independent `npm test` matched: 377 tests, 353 pass, 0 fail. Notes for the owner:
  - A repository workflow runs unsandboxed at import (A-078 Q2), so it could read a grant file directly. Q5 stops it asking for a grant, not taking one.
  - `grants` on an agent stage is accepted and ignored.
  - Two grants with the same variable in one stage are not refused.
