# 08-e — Every reviewer call site tested; a comparison git cannot finish is dirt

Route: Fast. Fix ticket for 08-d's adversarial FAIL on `64514a0` (A-040). It adds a test and makes one internal change. Stacked on 08-d.

Goal: a test fails if any reviewer `main.ts` builds (standard or adversarial, claude or pi) runs outside the job's sandbox; a checkout that git cannot compare is recorded as `tree` dirt with git's error, and is still cleaned.

Done when:
- 08-d adversarial major: `tests/run.test.ts` runs `main.ts` with stub CLIs. The reviewer under test is standard or adversarial, claude or pi, and tries to write outside its cwd. Under bwrap the write is refused; under `none` it lands. The test fails for each of these mutations: the adversarial call site without the sandbox, `cliAdapter(piReviewer)` without it, `cliAdapter(claudeReviewer)` without it. Verified by mutation.
- 08-d adversarial minor (malformed gitlink): a check that leaves `vendor/.git/HEAD` junk at a gitlink records `tree: FAIL` with git's error. `verify` does not throw, and the gitlink is emptied. Verified by test in `tests/verify.test.ts`.
- The non-UTF-8 untracked name minor is in parked.md against the next ticket that touches `verify.ts`.

Constraints: zero dependencies. Untouched: `sandbox.ts`, `cli-adapter.ts`, `developer.ts`, `main.ts`.
Non-goals: non-UTF-8 names (parked); a reviewer reading its own CLI's credentials (known since 08-c).
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-16 — owner: “Option 1 go” (A-040). Branch `feat/08-e-reviewer-sandbox-tests` off `feat/08-d-reviewer-sandbox` at `9622a75`.
