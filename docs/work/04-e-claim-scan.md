# 04-e — Claim block by linear scan; scope names and reasons are always valid

Route: Fast. Fix ticket for 04-d's adversarial FAIL on `5347806` (A-025). Internal, reversible, one obvious design per finding.

Goal: no reply text can hold the controller's event loop in the claim parser, and the four 04-d adversarial minors are closed.

Done when:
- Finding the claim block is linear in the reply length: a reply that opens a ```` ```json ```` fence and is followed by 100 000 blank lines with no closing fence parses (as `no claim block in reply`) in under 200 ms, and the same with a closing fence yields the block; verified by test through `start()` with the echo-prompt fixture, for both adapters.
- A fence with no newline after the language tag (```` ```json{...}``` ````) and one closed on the same line as the JSON are accepted; verified by test. A JSON string containing ```` ``` ```` is out of scope (note in the log).
- A `runId` that is not a valid systemd unit-name fragment (anything outside `[A-Za-z0-9:_.-]`, or longer than 200 characters) is `failed` with a reason before anything is spawned under cgroup isolation; verified by test with `'r 1'` and `'é'`.
- `cancel()` after the child has exited under a scope does not call `process.kill`; verified by reading, because the exit-time `cgroup.kill` settles the run within one event-loop turn and no test can hold that window open. A smoke test with a spy on `process.kill` guards that the call is harmless.
- A reason cut at 1 KB is well-formed (`isWellFormed()`), verified by test with astral characters across the boundary.
- The construction probe has a 5 s timeout and reports it in the error; verified by reading (no test can hang a user manager).

Constraints: zero dependencies. `controller.ts`, `adapter.ts`, `lifecycle.ts`, `store.ts` untouched. The claim format (last fenced `json` block, or a whole-reply object) is unchanged.
Non-goals: a JSON string containing a fence; a pre-aborted signal (the controller never passes one); the process-group-mode post-exit truncation note (the scope closes it, and process-group mode is the documented opt-out).
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-16 — owner: “option 1 go” (A-025). Branch `feat/04-e-claim-scan` stacked on 04-d at `f7c9083`.
- 2026-10-16 — tests first (five in `tests/cli-adapter.test.ts`, one in `tests/runtime.test.ts`; the 100 000-line case hangs on 04-d's regex, the rest are red), then: `lastFencedJson` is two `indexOf` calls walking back from the end, so an unclosed trailing fence falls through to an earlier closed one; `start()` refuses a run ID outside `[A-Za-z0-9:_.-]{1,200}` under cgroup isolation before spawning; `cancel()` after exit under a scope writes `cgroup.kill` only; `failed()` applies `toWellFormed()` after the cut; the construction probe has `timeout: 5000` and names it. Mutation-checked: the unit-name check, `toWellFormed` (after widening the test to two ASCII lengths; the first version landed the cut on a pair boundary and did not fail), and the earlier-fence fallback (after adding the closed-then-unclosed case) each fail a test when removed; the post-exit cancel branch under a scope cannot be held open by a test and is verified by reading (done-when amended, smoke test kept). Out of scope, noted: a JSON string containing a fence ends the block early. Implementer-run: `npm test` 111 tests, 92 pass, 14 skipped, 5 todo, 0 fail. Awaiting owner-run tests, then standard review 1.
