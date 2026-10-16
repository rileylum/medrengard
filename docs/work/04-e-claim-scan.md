# 04-e — Claim block by linear scan; scope names and reasons are always valid

Route: Fast. Fix ticket for 04-d's adversarial FAIL on `5347806` (A-025). Internal, reversible, one obvious design per finding.

Goal: no reply text can hold the controller's event loop in the claim parser, and the four 04-d adversarial minors are closed.

Done when:
- Finding the claim block is linear in the reply length: a reply that opens a ```` ```json ```` fence and is followed by 100 000 blank lines with no closing fence parses (as `no claim block in reply`) in under 200 ms, and the same with a closing fence yields the block; verified by test through `start()` with the echo-prompt fixture, for both adapters.
- A fence with no newline after the language tag (```` ```json{...}``` ````) and one closed on the same line as the JSON are accepted; verified by test. A JSON string containing ```` ``` ```` is out of scope (note in the log).
- A `runId` that is not a valid systemd unit-name fragment (anything outside `[A-Za-z0-9:_.-]`, or longer than 200 characters) is `failed` with a reason before anything is spawned under cgroup isolation; verified by test with `'r 1'` and `'é'`.
- `cancel()` after the child has exited under a scope writes `cgroup.kill` and does not call `process.kill`; verified by test with a spy on `process.kill`.
- A reason cut at 1 KB is well-formed (`isWellFormed()`), verified by test with astral characters across the boundary.
- The construction probe has a 5 s timeout and reports it in the error; verified by reading (no test can hang a user manager).

Constraints: zero dependencies. `controller.ts`, `adapter.ts`, `lifecycle.ts`, `store.ts` untouched. The claim format (last fenced `json` block, or a whole-reply object) is unchanged.
Non-goals: a JSON string containing a fence; a pre-aborted signal (the controller never passes one); the process-group-mode post-exit truncation note (the scope closes it, and process-group mode is the documented opt-out).
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-16 — owner: “option 1 go” (A-025). Branch `feat/04-e-claim-scan` stacked on 04-d at `f7c9083`.
