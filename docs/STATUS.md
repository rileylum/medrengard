# Current status

## Core refactor — 2026-10-24

The run followed [the refactor prompt](refactor/prompt.md) and stopped after
rounds 09 and 10 each produced no change that a fresh reviewer could approve
as simpler. Rounds 00, 01, 02, 03, 04, 06, 07 and 08 were integrated locally
with `--no-ff` and passing pre-merge gates. Round 05 also produced no change.

Integration branch: `refactor/core`, worktree
`/var/tmp/software_factory/refactor/core`. Main remains at `5ed0e56`; nothing
was pushed. The owner decides whether to merge the integration branch.

The implementation is four source files (513 lines), one public entry point
(13 named exports), and an owner-defined default workflow beside the core.
It covers idea/spec approval, isolated development, exact-SHA checks and
reviews, owner revision, PR extension, replay, observation and runtime
configuration through the public API. Accepted commits have controller-owned
storage; candidate execution is confined by bubblewrap.

The old CLI, Claude/Pi integrations, layered job configuration, learn/proto
frontends and unused supervision were removed. The retained real runtime is
a generic JSON process adapter. Provider networking and credentials, old-log
migration, process adoption, owner-command deduplication and resource quotas
remain outside the implementation. See [parked findings](work/parked.md).

## Validation and next action

Final integration gate: 54/54 tests pass, zero failures/skips/todos (17.8 s). Tests include the eleven
MVP cases, shared fake/process runtime contracts, exact artifact retention,
setup validation and descendant death after deadline, controller crash,
normal exit and overflow. No paid model runs were made.

README and obsolete-document cleanup are complete. The final integration
gate passed, but the final adversarial review returned **FAIL**: an observer's
returned thenable can escape the observation guard, create work and reorder
notifications (`src/primitives.ts:198`). No implementation fixes followed the
review, as required by the prompt. The finding is unfixed and not accepted.

Next action: the owner reviews [the final report](refactor/log.md#final-report--2026-10-24)
and decides on a follow-up fix before merging. The report includes the
reproduction, before/after counts, coverage limits and remaining questions.
