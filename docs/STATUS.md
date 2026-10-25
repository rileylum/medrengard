# Current status

## Current next action — ticket 13, 2026-10-25

The first-journey docs are merged (`379484d`). The owner chose the first run and
its shape: the rifle half of bolts_n_blades slice 4, phase 1 ending at an
owner-approved plan, a headless Claude Code planner on a subscription token,
the owner's factory as a separate repository, and an install script for the
product ([A-146](decisions.md#a-146--2026-10-25--first-run-example-phase-split-subscription-token-factory-layout-and-installer)).
Scope and acceptance: [ticket 13](work/13-phase-1-plan.md).

The owner accepted the phase-1 token/network risk; destination-specific
network access and the install script are following tickets.

Next: implement ticket 13 on `feat/13-phase-1-plan`, as the owner asked (“Commit
and then handoff so the next session will start with the implementation”).
Work step by step with the owner in the loop at each turn. Branch from main if
the owner has merged `docs/phase-1-plan-ticket`, otherwise from that branch.
The live run needs separate approval per `live-runs.md`. This session was
documentation only; Markdown links and `git diff --check` checked, no tests
rerun.

## First user journey, 2026-10-24

The owner merged the refactor, roadmap and reviewed observer fix into main at
`ce7c8a0` (`Merge branch 'feat/12-observer-isolation'`). The pending-merge notes
below describe earlier sessions. The core is still a candidate, not core v1.

The owner agreed to **idea → approved plan/spec → implement → check and
review/fix → owner acceptance for publication → PR**, with human feedback and
approval during both planning and result revision. The canonical journey,
scope and acceptance evidence are in [the roadmap](roadmap.md#first-user-journey--agreed-2026-10-24);
the quoted agreement is [A-145](decisions.md#a-145--2026-10-24--first-user-journey-with-human-approval-and-feedback),
with the session log in [M2 journey definition](work/m2-first-journey.md).

Next session: define the owner's starting input and plan/spec approval
experience for a concrete small repository change. Map that journey to the
existing primitives and integrations, identify concrete gaps, and prepare the
first bounded implementation ticket. Provider choice, network/credential
boundary, recovery promise and operator interface remain unresolved. The
agreed approach is to try building a workflow and add primitive support only
when a worthwhile need appears.

This session is documentation only on `docs/first-user-journey`, worktree
`/var/tmp/software_factory/first-journey`, based on main `ce7c8a0`. No product
code, paid run or external publication was requested or performed. Markdown
links and `git diff --check` are checked; application tests are not rerun.
The last independent implementation gate remains 57/57 passing plus 12
additional observer probes. The owner merges this documentation branch.

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
review, as required by the prompt. The finding remained unfixed at the end of
that run; the subsequent authorized fix is recorded below.

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

That session changed documentation only. Local Markdown links and diff
whitespace were checked; application tests were not rerun. The last implementation
gate at that point was 54/54 passing, with the separate adversarial FAIL above.

## Observer follow-up — 2026-10-24

The owner authorized closing the defect in
[ticket 12](work/12-observer-isolation.md), on `feat/12-observer-isolation`,
worktree `/tmp/medrengard-m1-observer`, based on `docs/factory-roadmap` at
`e4e6c0b`. Returned thenable handling now stays inside the observation guard,
including deferred callbacks and nested thenables. Public-API regressions
verify refusal, absence of observer-created work, notification order and
continued owner control. The original refactor review remains unchanged.

Validation: three new regressions failed before the fix and passed afterward;
the full real-bubblewrap gate passed **57/57**, zero failures/skips/todos
(18.1 s). A subsequently requested fresh independent review of `bbd92de`
returned **PASS**, no actionable findings. It independently passed the full
57/57 gate (18.33 s), confirmed all three regressions fail on the parent for
the intended reason, replayed the original reproduction before and after the
fix, and passed 12 additional public-API probes. The detailed review and scope
are in the ticket log. The resolved finding was removed from `work/parked.md`.
This closes the reported defect, not core v1.

The owner also agreed to the roadmap's development loop: define a user journey
or agentic workflow, try to build it, and decide whether missing primitive
support is worth adding. No provider or recovery policy was selected by that
reply. Current recovery still escalates interrupted runs without result adoption
or a continuation command; provider access and real publication remain unbuilt.

Owner acceptance on 2026-10-24: “Accept”, following the independent PASS report
and request for acceptance of the overall refactor. The quoted reply and scope
are recorded in ticket 12. Acceptance covers the refactor, roadmap and reviewed
fix at `cb0e92c`; it does not declare core v1 or settle recovery/provider policy.

Next action: owner merge of `feat/12-observer-isolation`, which includes the
refactor, roadmap, reviewed fix and acceptance record. Main remains unchanged;
only review and acceptance documentation changed after the reviewed
implementation commit. `git diff --check` passed for the acceptance update;
application tests were not rerun for documentation only. Then define M2's first real
provider-to-PR journey and its acceptance evidence. Resolve the recovery promise
and provider network/credential boundary as part of that implementation design.
No paid run, push or merge is part of this follow-up.
