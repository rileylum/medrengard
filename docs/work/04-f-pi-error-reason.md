# 04-f — pi run errors record pi's own reason

Route: Fast. One parser branch in an existing adapter, with an obvious shape.

Goal: when pi ends a run with an error turn, the run fails with pi's `errorMessage`, not "no claim block in reply".

Done when:
- A pi stream whose last `turn_end` has `stopReason: "error"` and an `errorMessage` fails with a reason that starts `pi:` and quotes the message's first line. Verified by a fixture case in `tests/fixtures/fake-cli.ts` copied from the live stream below and a test in `tests/cli-adapter.test.ts`.
- An error turn with no `errorMessage` fails with `pi: run ended with stopReason error`. Verified by test.
- A normal pi reply still yields its claim. The existing pi adapter tests pass unchanged.

Constraints: zero dependencies. No paid calls. Change only the pi `parse` in `src/runtime/cli-adapter.ts`.
Non-goals: retrying, or refreshing pi's login. claude's error paths, which 04-d already covers.
Verification: `npm test`, run by the owner.

Evidence (2026-10-19, owner-run `pi -p --mode json "reply with pong"`): the last `turn_end` was `{"role":"assistant","content":[],"stopReason":"error","errorMessage":"OAuth refresh failed for openai: OpenAI OAuth token request failed (400): {\n  \"error\": \"invalid_grant\"\n}", …}`, then `agent_end`, exit 0. The factory recorded `run failed: no claim block in reply`.

Related, not in scope: the pi config is an overlay (A-038), so a token pi refreshes inside the sandbox is dropped when the run ends. If OpenAI rotates refresh tokens, a sandboxed run could spend the stored refresh token and lose its replacement, which would explain the `invalid_grant`. Not verified. The comment on `pi.config` already names the fix (bind `agent/auth.json` writable). Raise it with the owner before any pi live run that depends on it.

## Log
- 2026-10-19 — drafted after the 09-c live run (A-064). Not READY until the owner says go.
