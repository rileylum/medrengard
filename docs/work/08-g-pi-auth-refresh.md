# 08-g — pi keeps its refreshed login after a sandboxed run

Route: Fast, after a short investigation. A-038 already chose the fix (a writable `auth.json`, if pi stops logging in). This ticket first confirms the cause.

Goal: a sandboxed pi run that refreshes pi's OpenAI login leaves the new tokens in `~/.pi/agent/auth.json`, so the next run does not fail with `invalid_grant`.

Investigation (before any code; results go in `docs/work/08-g-findings.md`):
- Does pi write the new tokens to `agent/auth.json` after a refresh? Answer from pi's published source, with the file and function cited. The session must not read `~/.pi`, where pi is installed here; read the upstream package or repository instead.
- Does OpenAI's token response give pi a new refresh token that replaces the old one? Answer from the same source.
- Does a write to a file under the `.pi` overlay vanish after the run? Show it with an offline test against `wrap` in `src/sandbox.ts`, using a temporary directory in place of `~/.pi`.
- If all three are yes, the cause is confirmed: go on to the fix. If any is no, stop, record the finding and ask the owner.

Done when:
- With the cause confirmed, `pi.config` in `src/runtime/cli-adapter.ts` binds `agent/auth.json` writable on top of the `.pi` overlay. Every other path under `.pi` stays in the overlay. Verified by a test: a write to `auth.json` inside the sandbox survives the run, and a write to another file under the overlay does not.
- If `auth.json` does not exist, the run still starts, and the sandbox does not create the file. Verified by test.
- The claude config stays read-only. The existing sandbox and adapter tests pass unchanged.
- One live pi run after the owner's next forced re-login shows that the refresh survives. The owner runs it, because it costs money and needs an expired token.

Constraints: zero dependencies. No paid calls in `npm test`. The session does not read `~/.pi`; the owner runs any check that needs it.
Risk to state in the findings: a developer run has unrestricted bash in the sandbox, so with this change it can overwrite or delete the owner's pi login. That is damage outside its remit (A-037). The owner decides whether to accept it, or whether only reviewer runs get the writable bind.
Non-goals: pi's error reason (04-f); refreshing or retrying the login from the factory; claude's credentials.
Verification: `npm test`, run by the owner; the live run above, run by the owner.

Evidence (2026-10-19, 09-c live run): every pi test that needed a reply failed with `OAuth refresh failed for openai … invalid_grant` until the owner logged pi in again; then 40 of 40 pi tests passed. See 04-f.

## Log
- 2026-10-19 — drafted on `feat/09-d-spec-rewrite` at the owner's request. Not READY until the owner says go.
- 2026-10-19 — READY (A-067), on `feat/08-g-pi-auth-refresh`, stacked on 04-f. Investigation done: [08-g-findings.md](08-g-findings.md). All three answers are yes for pi 0.73.1, the latest on npm. The installed build's error wording differs, so the owner should check `pi --version`. Findings for the fix: `wrap` mounts binds before overlays, so it needs a bind mounted after them; binding reviewers only does not fix the loss. No code yet. Next: the owner chooses an option from the findings.
- 2026-10-19 — owner ran `pi --version`: 1.1.0. Checked again against tag `v1.1.0` of `earendil-works/pi`, where pi now lives: same answers, and pi's own comment confirms OpenAI rotates refresh tokens; `auth.json` is written in place, so a file bind works. Findings updated. Next: the owner chooses an option.
- 2026-10-19 — owner chose option 1 (A-068): “Yes option 1 is good”. The risk is in [accepted-risks.md](accepted-risks.md). Implemented as `9fb570c`: `Policy.writeOver` in `src/sandbox.ts`, bound read-write after the overlays; `CliSpec.config.write`, home-relative and skipped when missing; pi's config writes `.pi/agent/auth.json`. Tests: a bwrap test (auth.json keeps its write; settings.json and the lock are dropped), a sandboxed-adapter test (reviewer role; a missing write path is not created on the host), and the spec test updated for pi's new config line. All three failed before the change. `npm test` on `9fb570c`, implementer-run, not independent: 272 tests, 248 pass, 19 skipped, 5 todo, 0 fail. Mutation: dropping the bind, mounting it before the overlays, and dropping the missing-path filter each fail at least one test. Not done: the owner's live check after the next refresh. Next: the owner runs `npm test` on `9fb570c`, runs or waives the reviews, and watches the next pi refresh.
- 2026-10-19 — reviews and the owner-run `npm test` waived by the owner (A-069): “waive”. Merged into main with the row 9 stack, locally with `--no-ff` (no remote).
