# Core refactor log

## Run — 2026-10-24

Authorization: owner instructed “Follow docs/refactor/prompt.md”. That prompt
supersedes the ordinary ticket workflow for this run and authorizes worker
worktrees, fresh reviews, and local integration merges. Main and existing
worktrees are left untouched; nothing is pushed.

Starting commit: `5ed0e56` on `main`. Integration: `refactor/core` at
`/var/tmp/software_factory/refactor/core`.

Counts include all files under each directory, with lines counted by newline
records (including fixtures). Before: src 25 files / 5,436 lines; tests 75
files / 12,367 lines; learn 64 files / 5,487 lines; proto 7 files / 833 lines.
There was no public entry point, hence zero entry-point exports. Later counts
use the same convention; exported names include types and values.

## Round 00 — MVP proof (in progress)

Worker: `refactor/r00`, isolated worktree. Establish all eleven cases in
`tests/e2e/` using only the public entry point and owner-defined workflows.
Legacy code assumes commit-first cycles, so document-first workflows require
a primitives controller; sandbox and process-containment code is reused.

Baseline: `systemd-run --user --scope --quiet npm test` passed: 652 tests,
628 pass, zero fail, 19 pre-existing live skips, five pre-existing todo cases
(69.5 seconds). Output: `/tmp/refactor-baseline-scope.log`. The restricted
shell attempt could not run all sandbox/systemd tests; no gate was weakened
to accommodate it.
