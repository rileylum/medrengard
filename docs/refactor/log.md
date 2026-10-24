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

Integrated round 01 as `25684cb` with `--no-ff`; pre-merge gate passed.

## Round 02 — retire the legacy engine (in progress)

The public API depends only on its controller, generic process runtime,
sandbox and process supervisor. Delete the unused legacy engine/CLI/vendor
policy graph and its tests/docs. Ship the required default workflow beside
the core as owner TypeScript. Human-authorized revision handoffs need the
workflow checker to distinguish human waits from automatic handoff cycles;
fully automatic cycles must remain rejected. Worker branch `refactor/r02`.

Capability boundary: the old Claude/Pi-specific integrations are removed;
the replacement has a tested generic JSON process runtime, not provider
integrations. No paid agent runs are performed in this refactor.

Round 02 `7a5c69a`: +278 / −20,990 lines across 180 files. Src: 909
lines (five files); tests: 1,288 lines; default workflow: 21 lines; public
exports: 13. Gate: 77 tests, all pass, zero skipped/todo. Fresh review PASS,
no findings: owner-authorized budgets remain policy outside the core and
automatic handoff cycles remain refused. Protected history unchanged.
Verdict: simpler, PASS.

Integrated round 02 as `03e3a25` with `--no-ff`; pre-merge gate passed.

## Round 03 — remove unused supervision (in progress)

The public controller uses piped process-group execution inside bwrap, not
the legacy supervisor's optional scopes or durable output folders. Remove
those unused branches and their dedicated tests/docs. Before deletion, prove
at the active public boundary that sandboxed descendants cannot outlive
cancellation/deadline or a killed controller. Worker branch `refactor/r03`.

Round 03 `dfe71c1`: +142 / −516 lines across ten files. Src: 734
lines; tests: 1,086 lines; public exports: 13. Gate: 59/59 pass, no skips or
todos. Both new public containment cases pass normally and fail on a
deliberately broken confinement mutant at the surviving-marker assertion.
Fresh review PASS, no findings; piped execution semantics preserved while
unused supervision disappears. Verdict: simpler, PASS.

Integrated round 03 as `f16345a` with `--no-ff`; pre-merge gate passed.

## Round 04 — collapse the sandbox implementation (in progress)

The public controller uses bwrap with read/write mounts, a cleared environment,
a private temporary directory and no network. Remove unused backend dispatch
and policy branches while preserving those boundaries and the confinement
proof. Worker branch `refactor/r04`.

Round 04 `dd12744`: +34 / −214 lines across five files. Src: 636
lines; tests: 1,004 lines; public exports: 13. Gate: 53/53 pass, no skips or
todos. Fresh review PASS, no findings: bwrap flags, read-path validation,
mount ordering, cleared environment and network denial retained. E2E and
real-process confinement files unchanged. Verdict: simpler, PASS.

Integrated round 04 as `ebea36e` with `--no-ff`; pre-merge gate passed.

## Round 05 — assess remaining simplification (in progress)

A fresh worker inspects the reduced implementation for a substantive further
change, without speculative features or cosmetic churn. If none is justified,
the round will record no change rather than manufacturing a diff. Worker
branch `refactor/r05`.

Round 05: no code change (+0 / −0). Worker considered merging controller
with runtime, sandbox with supervisor, or entry point with implementation;
none removed meaningful implementation and each blurred a useful boundary.
Moving invariant checks to workflows or removing retained snapshots would
break core.md. Deleting the two unused environment-option lines alone was
not a substantive refactor. Gate: 53/53 pass, no skips/todos. Src: 636 lines;
tests: 1,004 lines; public exports: 13. Fresh reviewer: FAIL — empty diff,
no change to approve as simpler; no code defect findings. No merge. This is
the first consecutive round without an approved simplification.

## Round 06 — remove obsolete launch preflight (in progress)

An independent worker found an internal launch preflight and synthetic failed
run constructor that served the retired CLI's diagnostic policy. The active
controller always supplies bwrap and its own directory. Remove the duplicated
preflight and unused environment override, retaining actual launch-failure,
cancellation, output-limit and containment behavior. Worker `refactor/r06`.

Round 06 `b8b8d38`: +1 / −55 lines. Src: 611 lines; tests: 975 lines;
public exports: 13. Gate: 50/50 pass, no skips/todos. Fresh review PASS,
no findings: launch guard was unreachable at the public boundary, cwd
preflight specialized obsolete diagnostics, and the environment override
had no caller. Cancellation/output behavior unchanged. Verdict: simpler,
PASS; the consecutive no-change count resets to zero.

Integrated round 06 as `398905b` with `--no-ff`; pre-merge gate passed.

## Round 07 — consolidate sandbox setup validation (in progress)

Inspection found repeated backend checks and stage probes of only the
default sandbox, while the agent's actual declared read paths were never
validated by the controller. Consolidate configuration and availability
checks before dispatch; trust checked internal callers thereafter. Retain
all confinement behavior and prove invalid paths refuse before any work
record or runtime dispatch. Worker branch `refactor/r07`.

Round 07 `149f06c3`: +88 / −37 lines overall; source alone +10 / −20.
Src: 601 lines; tests: 1,036 lines; public exports: 13. Relative/missing
read-path tests failed before the change and passed afterward. Full gate:
56/56 pass, no skips/todos. Fresh review PASS, no findings; reviewer also
ran setup and confinement tests independently (13/13 pass). Verdict:
simpler validation boundary, PASS.

Integrated round 07 as `412dcfa` with `--no-ff`; pre-merge gate passed.

## Round 08 — assess sandbox execution collapse (in progress)

The fresh worker identified that the generic process supervisor now has one
production caller, always bwrap. Unlike a file-only merge, a sandbox-specific
execution module may remove unused generic lifecycle machinery. Prove normal
exit, output overflow, input delivery, cancellation and descendant cleanup
before deleting it. Worker branch `refactor/r08`.

Round 08 `caa43fd` (implementation `4ee5aac`): +187 / −415 lines across
17 files. Src: four files / 513 lines; tests: 893 lines; public exports: 13.
Gate: 54/54 pass, no skips/todos. Fresh review PASS, no findings. Additional
reviewer probes passed exact output caps, overflow during drain, early stdin
closure, inherited pipes, cancellation, pre-aborted signals, missing/self-
signalled commands and spawn failure. Four public containment cases prove
descendant cleanup on deadline, crash, normal exit and overflow. Verdict:
simpler, PASS.

Integrated round 08 as `88b0696` with `--no-ff`; pre-merge gate passed.

## Round 09 — assess remaining simplification (in progress)

A fresh worker inspects the four-file implementation independently. Current
policy already lives in the default workflow; proposed removals must preserve
artifact, budget, observation and confinement guarantees. Worker `refactor/r09`.

Round 09: no change (+0 / −0). Worker rejected moving invariant checks
into policy, deleting artifact retention/materialization, removing only the
backend discriminator, inlining mount helpers, folding the runtime adapter
into the controller, and adding replay bookkeeping to replace a focused
scan. No substantive simplification resulted. Gate: 54/54 pass, no skips or
todos. Src: 513 lines; tests: 893 lines; public exports: 13 (recounted from
the entry point). Fresh reviewer FAIL — empty diff, no change to approve
as simpler; not a code defect. No merge. First consecutive no-change round.

## Round 10 — independent simplification assessment

No change (+0 / −0). Worker independently rejected removing the real/fake
runtime seam, merging containment with controller state, deleting the sandbox
discriminator, adding failure bookkeeping to replay, moving invariants into
policy, deleting retention/materialization/old-log refusal, and cosmetic
helper/copy rearrangements. Gate: 54/54 pass, no skips/todos. Src: 513 lines;
tests: 893 lines; public exports: 13. Fresh reviewer FAIL — empty diff, no
change to approve as simpler; not a code defect. No merge.

## Stop and finish preparation

Stop rule met: rounds 09 and 10 consecutively produced no approved
simplification. Eleven numbered rounds were considered (00–10); eight were
integrated and three made no change. No invariant exception or invented owner
approval was used to continue.

README rewritten around the retained API, default workflow, execution model
and actual limits. STATUS replaced obsolete implementation history with the
current result; Git retains that history. Deleted-code docs were removed in
rounds 01–03. Decisions, research and architecture remain unchanged. The
final integration gate and required adversarial review follow; no code fixes
will be made after that review.

Final integration gate: 54/54 pass, zero failures/skips/todos, 17.8 seconds
(`/tmp/refactor-final-test.log`). `git diff --check` passed. Main is clean
at `5ed0e56`. Protected decisions/research/architecture are byte-for-byte
unchanged. The core document was restored verbatim during the final audit;
its only intervening change had been introductory references to deleted docs,
not normative rules. Final pre-review counts: src 513 lines (four files),
tests 893 lines (seven files), default workflow 21 lines, 13 public exports.

## Final adversarial review — FAIL

Reviewed head: `7bb2f3929e521f65979b403ca200a6114dde0d5b`. One fresh
reviewer was used. Its first turn was interrupted by a service content
filter; the same reviewer resumed with local synthetic correctness checks.
No implementation changes followed the review.

**P1 / high — observer return values escape the observation guard.**
`src/primitives.ts:198` invokes the callback within `observer.run(true, ...)`
but passes its return value to `Promise.resolve` outside that context. A
returned thenable's `then` getter can call `Controller.open` successfully.
A second observer then receives nested events out of order.

Reproduction (temporary synthetic data; working bwrap namespaces required):

```sh
node /var/tmp/software_factory/refactor-adversarial/observer.mts
```

Expected: the attempted observer mutation throws; only the original work
exists; the second observer sees positions `[1]`. Actual: both works exist
and the second observer sees `[2, 1]`. This violates the observation invariant
and MVP case 9 without direct database access, private fields or host-resource
access. The current passing suite does not cover this returned-thenable case.
The finding remains **unfixed and unaccepted**, as the prompt requires no
fixes after this review.

Review validation: existing confinement/process tests 24/24 pass; ten
additional synthetic validation/replay/concurrency checks pass, including
malformed/missing/oversized claims, stale subjects, concurrent advances and
recovery, no duplicate runs/spending, ordinary asynchronous observer guards,
workflow cycles and budgets. Additional snapshot checks pass for raw Git bytes
under CRLF attributes, dirty-file exclusion, symlinks, Unicode filenames,
executable modes and retained SHA identity. Reproductions:
`/var/tmp/software_factory/refactor-adversarial/correctness.mts` and
`/var/tmp/software_factory/refactor-adversarial/snapshot.mts`.

No other new defect was confirmed. Initial clone handling was inspected but
host Git configurations were not dynamically exercised. Arbitrary hostile
host modules are outside the trusted-owner-TypeScript boundary. No paid
providers, real code hosts or global configuration changes were used.

## Final report — 2026-10-24

**Result:** the refactor run reached its stop rule, but the final adversarial
review found an unresolved core-invariant defect. The branch is a reviewable
local result, not an invariant-clean merge candidate. The owner must decide
on the observer finding before relying on observer isolation or ordered
notification. No fixes were made after the final review.

The codebase now has one public entry point, a SQLite-backed controller for
workflows/stages/artifacts/budgets/replay/observation, a generic JSON process
runtime, and one bwrap execution module. Accepted commits are retained outside
candidate-writable storage; checks/reviewers use stored-byte snapshots. The
shipped default workflow keeps design approval, review counts, owner revision
and PR policy outside the core. The eleven MVP cases remain in public-entry-
point e2e tests, supplemented by runtime, retention, setup and containment
proofs. The observer finding shows the limit of that passing suite.

| Count | Before (`5ed0e56`) | After |
| --- | ---: | ---: |
| `src/` files / lines | 25 / 5,436 | 4 / 513 |
| `tests/` files / lines, including fixtures | 75 / 12,367 | 7 / 893 |
| `learn/` files / lines | 64 / 5,487 | 0 / 0 |
| `proto/` files / lines | 7 / 833 | 0 / 0 |
| Default workflow beside core | none | 1 file / 21 lines |
| Named exports from the public entry point | no entry point | 13 (3 values, 10 types) |

Line counts use newline records across all files, including fixtures, as in
the baseline. Source shrank 90.6%. The old modules contained 178 export
declarations without a single public entry point; that is a different metric
from the 13 explicitly exported names now.

Baseline gate: 652 tests, 628 pass, 19 live skips, five todos. Final integration
gate: **54/54 pass, zero failures/skips/todos**, 17.8 seconds. Removed tests
served deleted code; the eleven MVP cases were not weakened. Final adversarial
verdict: **FAIL**, one confirmed P1 finding above.

Rounds 00–10: eight integration merges (00, 01, 02, 03, 04, 06, 07, 08),
three no-change rounds (05, 09, 10). Every implementation merge used `--no-ff`
and passed its pre-merge gate. Two consecutive rounds without an approved
simplification (09 and 10) ended the run; no review-budget or invariant waiver
was invented. README and current documentation describe what remains.

The old CLI, Claude/Pi integrations, layered configuration, frontends and
unused supervisor are gone. This is a generic local primitives library, not
a provider-connected factory yet. Network/credential integration, code-host
implementation, old-log migration, interrupted-run adoption, owner-command
deduplication and resource quotas remain outside the implementation. Existing
and new limits are distinguished in `docs/work/accepted-risks.md` and
`docs/work/parked.md`; none of the new findings is an owner approval.

**Delivery:** `refactor/core` at `/var/tmp/software_factory/refactor/core`.
Main is clean and remains at `5ed0e56`; nothing was pushed. Worker worktrees
and local review reproductions remain available. The core contract, decisions,
research and architecture are unchanged from the baseline.

**Questions for the owner:**

1. Authorize a follow-up fix and regression for the returned-observer-thenable
   finding before merging? Recommended: fix it before treating this branch as
   satisfying the observation invariant.
2. Which provider runtime and network/credential boundary should be built on
   the new API first? The old provider integrations were deliberately cut.
3. Before real unattended work, which of historical-log migration, owner-
   command identity/deduplication and resource quotas is required next?
