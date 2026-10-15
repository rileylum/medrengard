# 03-a — Runtime spike

Route: Fast. A throwaway probe of two CLIs. Internal, no UX, reversible. Its findings feed the Design-route ticket 04-a (adapter interface); nothing here is an interface.

Goal: know, from a test, how `claude -p` and `pi -p` behave as a launched, observed and cancelled child process.

Done when:
- `src/runtime/spawn.ts` launches a runtime with a prompt and a working directory, and returns exit code, stdout, stderr and wall time; verified by a test that runs `node` as the runtime.
- Launching `claude -p --output-format json` with a fixed prompt yields parseable JSON with a result text and a session or run identifier; verified by test. Same for `pi -p --mode json`. These two tests skip, not fail, when the binary is absent or not authenticated, and say so.
- Cancelling a run mid-flight (SIGTERM, then SIGKILL after a grace period) returns within the grace period plus one second and reports `cancelled`, not an exit code of 0; verified by a test that cancels a `node` child that ignores SIGTERM.
- Tools can be denied: both runtimes run with all tools disabled, and a prompt that asks to create a file does not create it; verified by test, skipped when the binary is absent.
- `docs/work/03-a-findings.md` records, per runtime: the JSON shape, how a session is identified, the exit code on cancel, the exit code and output on a bad model or missing auth, and the flags used. Written from the test output, not the help text.

Constraints: zero dependencies; `node:child_process` and `node:test`. No adapter interface, no state machine calls, no retries. Tests that need a real runtime must finish inside 120 seconds each and run only when `RUNTIME_SPIKE=1` is set, so `npm test` stays fast and offline.

Non-goals: streaming output, resuming sessions, MCP, cost tracking, the adapter interface (04-a).

Verification: `npm test`, then `RUNTIME_SPIKE=1 npm test`, both run by the owner on the reviewed SHA.

## Log
- 2026-10-15 — ticket written; awaiting owner go.
