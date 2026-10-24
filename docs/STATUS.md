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

## Forward scope — 2026-10-24

The owner requested a next-agent handoff and a durable scope/milestones document
after discussing what completion means. [The roadmap](roadmap.md) defines three
finish lines: core v1, local factory v1 and the broader factory vision. The
current implementation is a core candidate. Further line reduction is not the
next objective; one real delivery path is.

Documentation branch: `docs/factory-roadmap`, based on `refactor/core` at
`7785418`, worktree `/var/tmp/software_factory/refactor/roadmap`. Root
`HANDOFF.md` is local and untracked; copies in the launch and refactor worktrees
point here. Main and the integration branch remain unchanged; nothing pushed.

At the owner's request, removed 49 redundant local branches after checking
their commits were contained in preserved history, plus the 11 clean temporary
refactor round worktrees. The remaining branches are `main`, `refactor/core`
and `docs/factory-roadmap`. Older worktrees were preserved; the agent-kit and
core-docs worktrees now remain detached at their previous commits.

Next action: read the roadmap, then prepare the M1 observer-fix follow-up ticket
with a public-API regression and review plan. The fix is still outstanding; the
documentation request did not itself execute or approve all future milestones.
The completed refactor's stop rule and final-review freeze remain its historical
record; subsequent implementation belongs to new work.

After M1, build M2's first real provider-to-PR path. Settle the recovery promise
and provider access boundary when designing the relevant implementation; do not
silently inherit removed capabilities or invent owner approvals.

This session changed documentation only. Local Markdown links and diff
whitespace were checked; application tests were not rerun. The last implementation
gate remains 54/54 passing, with the separate adversarial FAIL above.
