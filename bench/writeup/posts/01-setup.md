# Testing published agent skills on a long-horizon benchmark, part 1: the setup

People publish skills for coding agents, packaged instructions such as "review your work with two
fresh reviewers" or "check with evidence before you claim you're done", and other people install
them by the hundred thousand. We wanted to know what they change. Does the code come out better?
Does the agent get more right? And what does it cost?

This series reports what we found by running two popular skills against a plain baseline on
SlopCodeBench, a benchmark where an agent keeps extending its own code as the specification
changes. This first post covers how the measurements were made, so the later posts can stick to
results:

1. **The setup** (this post)
2. Review and verify: what changed, and what it cost
3. Reading the diffs: is the reviewed code actually better?
4. Why lower erosion doesn't raise the solve rate
5. Where the failures come from: misreading the spec

Everything here is one model (Claude Opus 5.5 at medium effort) in one harness (Claude Code
2.1.318, and 2.1.319 for one late study), with three runs per configuration. The numbers are
narrow, and we say so throughout.

## The benchmark

[SlopCodeBench](https://github.com/SprocketLab/slop-code-bench) (arXiv 2603.24755) has 36
problems. Each problem is a sequence of **checkpoints**: the agent builds a program to the first
checkpoint's specification, then each later checkpoint extends it. Every checkpoint after the first
starts from the agent's own previous code. A problem has three to eight checkpoints.

That's the point of the benchmark. Most coding benchmarks grade one change to someone else's code.
Here the agent lives with its own decisions. If it took a shortcut at checkpoint 2, the shortcut is
still there at checkpoint 5.

Each checkpoint is graded by SlopCodeBench's own grader in a container, with tests in groups:
**Core** (the checkpoint's main behaviour), Functionality and Error, plus **Regression**, which
reruns each earlier checkpoint's tests. On top of the tests, SlopCodeBench's `scb-check` scores
code quality. We report its two headline measures:

- **Erosion**: the share of the code's complexity that sits in functions with cyclomatic complexity
  above 10, weighted by size (each function counts as its complexity × √lines). Zero means no
  function is that tangled; one means all the complexity is in such functions.
- **Verbosity**: the share of lines that are clones, match its "slop" patterns, or are trivial
  wrappers.

Lower is better for both. From the tests we derive:

- **Solved**: the share of a problem's checkpoints where every Core test passes.
- **Core**: the mean share of Core tests passing per checkpoint.

## The harness: Medrengard

We ran the agent through [Medrengard](../../../docs/core.md), a framework we're building for running
agent workflows on one person's machine. A workflow is a graph of **steps**; a **commission** takes
one request through a workflow; each start of a step's program is an **attempt**, and every
attempt goes into a log.

For this benchmark, each checkpoint is one commission, and the baseline workflow is about as small
as one gets:

```text
seed ──► implement ──► publish
         (one agent step: Claude Code, attempted once)
```

`seed` checks out the starting point: the previous checkpoint's commit with the problem's assets put
back, as SlopCodeBench's own harness does. `implement` runs the agent. `publish` stores the commit
it claims. The whole configuration is a few dozen lines of TypeScript:

```ts
implement: {
  kind: "agent",
  claims: ["commit"],
  agent: {
    harness: { run: ["node", ".../adapters/claude-code.ts",
      "--permission-mode", "bypassPermissions", "--effort", "medium", "--max-budget-usd", "10"] },
    model: "claude-opus-5-5",
    prompt,
  },
  workspace: "subject",
  inputs: { request: "request" },
  on: { done: "publish" },
  budget: 1,
  access,
},
```

The baseline's prompt is one line: *"Do what the request says, in your workspace. When you are done,
commit all your work and claim the commit."* The request is the checkpoint's task, rendered word
for word as SlopCodeBench's own `just-solve` prompt renders it.

What Medrengard adds here:

- **The agent never sees the tests.** It runs in a bubblewrap sandbox with its workspace, the
  request and scratch space, and no access to the grader. Grading happens afterwards, outside the
  sandbox.
- **Claims are checked.** The agent claims a commit, and Medrengard verifies that the commit exists,
  that it's the workspace's HEAD and that it isn't the starting commit handed back.
- **Every step is recorded.** Every attempt's transcript, cost and commit is in the log, and each
  checkpoint's commits are kept in a git repository. That record is what lets later posts show the
  code before and after a review.

## Is our setup fair to the benchmark?

A harness can make a benchmark easier or harder without anyone noticing, so we checked ours two
ways.

**Against SlopCodeBench's own harness.** We ran their harness once per problem on six problems,
with the same model, effort and Claude Code version. Paired by problem, theirs minus ours: solved
−0.001 [−0.048, 0.043], erosion +0.054 [0.002, 0.128]. The solve rates are the same; their erosion
is slightly higher. One run of theirs per problem is a sanity check, not a measurement of their
harness.

**Against a published run.** HumanLayer ran Opus 5.5 at medium effort once over all 196
checkpoints: Core 74.0%, every test passing 14.3%. Over the 164 checkpoints we ran once, we got Core
71.3% and 12.2%. The problem sets differ, and their harness version isn't stated, but the figures
are close enough that we aren't making the benchmark easier.

## Choosing the problems

Running everything on all 36 problems, several times, for every configuration would cost too much,
so we chose a subset, and fixed the rules for choosing before looking at any results.

1. **A seeded draw.** Before any study, a draw seeded at `20261105` picked, per difficulty label,
   two problems to iterate on and two to **hold out** for a final study. The held-out six have not
   been run.
2. **A survey.** The first six turned out easy for this model: both "Hard" problems were solved at
   every checkpoint in every run. So we ran the baseline once on the 24 problems left over and
   placed all 30 on a grid: thirds by solve rate, each third split at its median erosion. A rule
   written before the survey ran filled each of the six cells to two problems by the same seed.
3. **One flaw, one fix.** The rule broke ties by name. Eleven problems tied at "solved 1.00" for
   ten places in the top third, so the name order pushed fully solved problems into the middle
   third, and the draw picked one of them. Fixing the rule would have redrawn everything, so we kept
   it and replaced only that problem, by a seeded draw from the eligible ones. This is recorded in [`METHODS.md`](../../published/METHODS.md).

That gave twelve **iteration problems**, each run five times under the baseline. The review and
verify study used eleven of them. It left out test_translator, which cost $15 a run against $1.40
to $5.30 for the others; part 4 comes back to it.

For studies from now on we cut the set again, to the **screen set**: one problem per grid cell,
the cheapest in each (layered_config_synthesizer, file_merger, datagate, eve_jump_planner,
textdrop, file_query_tool). It costs about $27 per configuration and repeat instead of $52, and
intervals come out about 1.35 times wider. It was chosen by cost, not by where any effect showed.

## Comparing configurations

The unit is a **problem run**: one configuration on one problem, through every checkpoint. For
each comparison:

- **Paired by problem.** Problems differ far more from each other than configurations do: the
  baseline's solve rate runs from 0 on layered_config_synthesizer to 1 on meshctl. So we compare
  each configuration with the baseline on the same problem, then average the differences.
- **A fresh control.** The baseline runs again in the same study, beside the configurations. A
  pilot showed a day's drift on one problem larger than we expected; it turned out to be mostly
  run-to-run noise, but a control run alongside makes that question moot.
- **n = 3.** Three runs per configuration per problem, fixed in advance from the baseline's spread.
  At n = 3 over eleven problems, the smallest difference we could reliably detect is about 0.05 in
  solve rate and 0.05 in erosion.
- **Bootstrap intervals.** 95% intervals come from resampling problems, then runs within each
  problem, seeded so the same data always give the same interval.

Cost is Claude Code's own estimate at API prices. The runs used a subscription, so read dollars as
relative effort, not money spent.

## What we can and can't claim

- **One model, one harness.** Opus 5.5 at medium effort in Claude Code. A different model might
  respond to the same skill differently.
- **Three runs.** Enough to see an effect of 0.19 in erosion clearly, not to separate small
  effects.
- **SlopCodeBench's horizon.** Problems end after at most eight checkpoints. Part 4's main finding
  ("the agent doesn't break what it built") holds within that horizon and says nothing beyond it.
- **Same-model reviewers.** Every reviewer in these skills is the same model as the implementer,
  reading the same spec.

Every figure in this series comes from a script in the
[`writeup/`](..) directory, run over the recorded results. The scores, manifests and the median
run's code per problem are [published](../../published/).

Next: what the two skills changed.
