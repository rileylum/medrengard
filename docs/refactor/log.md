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

Round 00 candidate `0716546`: adds 629 lines, removes zero. Counts: src
5,792 lines; tests 12,640 lines; public entry exports 13 (three values, ten
types). `npm test`: 671 tests, 647 pass, zero fail, 19 live skips, five todos;
`npm run test:learn`: six pass. All 19 new e2e/contract cases pass, including
the eleven MVP cases. Independent foundation review pending before merge.

Foundation review 1: FAIL on `0716546`, three reproduced findings. Snapshot
UTF-8 decoding changed invalid path bytes and could certify the wrong tree;
workflow edges could retry a failed gate on the same subject automatically;
the process runtime omitted approved-spec and review artifacts. Worker repair
requested before integration. Reproductions are under `/tmp/r00-review-*.mts`.

Foundation repair `8c97663`: full gate 676 tests, 652 pass, zero fail,
19 skips, five todos; guide six pass; 24 new e2e/contract cases pass.
Foundation review 2: FAIL, one reproduced storage invariant. A subsequent
developer run could orphan and prune the previous accepted commit from its
writable clone, leaving an artifact SHA with no retained objects. Reproduction:
`/tmp/r00-review-retention.mts`. Worker must preserve accepted commits outside
candidate-writable storage before round 00 integrates. The capped simplification
rounds in the prompt begin after the foundation proof.

Foundation retention repair `d2e0b14`: validated commit packs are retained in
controller-owned repositories outside candidate-write mounts; later snapshots
read retained objects. Regression prunes the old candidate object, refuses
candidate writes to retained storage, and checks the retained SHA after the
candidate gitdir is removed. Full gate: 677 tests, 653 pass, zero fail,
19 skips, five todos. E2E: 25 pass. Guide: six pass. Review 3 pending.

Foundation review 3: FAIL, one transport defect. A valid 150,000-byte
specification fit the artifact limit but exceeded the operating system's
single-argument limit in the process runtime (`spawn E2BIG`). Request data
is being moved to stdin, with byte-count/hash verification. The reviewer
reported no other concrete blocking findings in the full five-file diff.

Round 00 final candidate `19a6898`: reviewer 3 repair recheck PASS. Independent
large-spec reproduction reaches DONE with complete content. Full gate: 678
tests, 654 pass, zero fail, 19 live skips, five todos; e2e 26 pass; guide six
pass. Net change: 794 lines added, zero removed. Src: 5,821 lines; tests:
12,776 lines; public exports: 13. Verdict: PASS; ready for integration.

Integrated round 00 as `5585512` with `--no-ff`; the pre-merge gate passed.

## Round 01 — remove cut frontends (in progress)

Remove `learn/`, `proto/`, and supporting scripts/docs. Neither is imported
by the core; both are explicitly cut by core.md. Worker branch `refactor/r01`.

Round 01 `5460def`: +5 / −6,501 lines across 78 files. Src: 5,821
lines; tests: 12,776 lines; public exports: 13. Gate: 678 tests, 654 pass,
zero fail, 19 skips, five todos. Fresh review PASS, no findings: explicitly
cut frontends and supporting material removed; core/test implementation
unchanged. Verdict: simpler, PASS.
