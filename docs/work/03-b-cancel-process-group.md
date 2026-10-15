# 03-b — Cancel resolves on exit and kills the process group

Route: Fast. Fix ticket for 03-a's adversarial FAIL on `85e32e9`. Internal, no UX, reversible.

Goal: `spawnRuntime` returns within the grace bound and reports honestly no matter what the child's descendants do.

Done when:
- Cancelling a child whose grandchild inherited stdout resolves within the grace period plus one second, with `status: 'cancelled'`; verified by a test with a `node` grandchild that idles for four seconds.
- The grandchild does not outlive the cancel: a grandchild that would write a file after the parent dies does not write it; verified by the same test.
- `cancel()` after the child has exited but before its pipes close still resolves within one second; verified by test.
- A child that died by its own signal before `cancel()` is reported `exited`, not `cancelled`; verified by test.
- A `cwd` that does not exist is reported as `failed` with a message naming the directory, distinguishable from a missing binary; verified by test.
- Live cancel tests assert `status`, not the exit code; the findings document says `status` is the signal.
- The bad-model and no-auth live tests print the parsed fields the findings cite (`is_error`, `subtype`, `terminal_reason`, `api_error_status`, `result`), and the findings cite only what a test prints. CLI versions come from a `--version` diagnostic or are dropped.
- `docs/work/03-a-findings.md` states that the claude deny reply text varies between runs, and that cancel stops the process group.

Constraints: zero dependencies; `node:child_process` only. No adapter interface, no retries. Live tests stay behind `RUNTIME_SPIKE=1`.

Non-goals: the standard-review minors about a cap on every live spawn (the deny cap stays; 04-a decides deadlines) and pinning denial to `--tools ""`. Non-UTF-8 handling.

Verification: `npm test`, then `RUNTIME_SPIKE=1 npm test`, both run by the owner on the reviewed SHA.

## Log
- 2026-10-15 — owner: "Go ahead with option 1, 3b". Branch `feat/03-b-cancel-process-group` stacked on 03-a at `38cace2`.
- 2026-10-15 — tests first (four new in tests/runtime.test.ts, two fixtures), spawn.ts spawns detached and signals the group, drops pipes after a cancelled exit, pre-checks cwd. Live tests assert `status`, print parsed error fields and `--version`. Findings updated. Implementer-run: `npm test` 50 tests, 35 pass, 10 skipped, 5 todo, 0 fail; live spike file 10 pass (claude deny case hit the 60 s cap, nothing created: second occurrence). Awaiting owner-run tests, then standard review 1.
