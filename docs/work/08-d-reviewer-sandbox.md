# 08-d — Reviewer runs in the sandbox; untracked leftovers

Route: Fast. It reuses 08-c's runtime policy with the cwd read-only (A-038). READY since 08-c's standard PASS (A-038).

Goal: a reviewer run (claude or pi) runs inside bubblewrap with the verify checkout read-only and nothing else of the owner's home but its CLI and configuration. Nothing a check leaves in the checkout reaches the reviewer.

Done when:
- A reviewer spec binds its cwd read-only. Under bwrap a fixture reviewer cannot write the checkout, `/var/tmp` outside its own `/tmp`, or the owner's home. `main.ts` passes the job's sandbox to both reviewer adapters. Verified by test.
- 06-c parked line: `piReviewer` runs `--no-context-files`. Verified by an args test.
- 08-b major (gitlink): a gitlink path in the checkout is emptied after the checks, and anything a check left in it is recorded as `tree: FAIL`. Verified with probe `08-b/probes/adv.mts gitlink` as a test.
- 08-b major (dangling symlink): `removeUntracked` unlinks anything `lstat` says is not a directory. Verified with `adv.mts dangling` as a test.
- 08-b minor (whitespace-led tracked path): the tracked list comes from an untrimmed listing. Verified with `adv.mts leadingws` as a test.
- 08-b minor (deep chain plus locked directory): one `try` around the restore and the removal records the failure instead of throwing. Verified with `adv.mts deeplocked` as a test.
- 08-c adversarial minor (A-039): a directory chain past PATH_MAX left in a run's `/tmp` does not make the adapter's cleanup throw; the run's outcome stands. Verified by test.
- Live: one claude and one pi reviewer under bwrap return a verdict (`RUNTIME_SPIKE=1`, two paid calls).

Constraints: zero dependencies; reuse 08-c's adapter policy.
Non-goals: network filtering by domain; claude's own `CLAUDE.md` discovery beyond what `--restricted` already does.
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-16 — drafted after the owner's “Take all, go” (A-038). Stacked on 08-c.
