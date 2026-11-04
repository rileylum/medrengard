# medrengard-bench

Benchmarks to compare Medrengard workflows, starting with
[SlopCodeBench](https://github.com/SprocketLab/slop-code-bench): problems of several checkpoints,
where an agent extends its own code as the specification changes.

A **configuration** is the workflow under test: the steps that take a checkpoint's start to a
commit. A **study** runs configurations over problems, several times each, and summarises them
with their spread. Calibration against SlopCodeBench's own harness is a configuration of a study too.

## Files

- `workflow.ts`: one commission per checkpoint. `seed` checks out the start the driver made and
  claims it as a `start`, a kind of this factory's: unlike a commit it need not change anything, so
  a problem without assets starts from an empty repository (`bin/verify-start.ts` checks it is HEAD
  and keeps its bundle). Then the configuration's steps; Medrengard's commit verifier compares each
  claimed commit with the subject, so an agent cannot claim its start back as work. Every agent step
  working on the subject runs after `.venv` is made again from `requirements.txt`, as
  SlopCodeBench's resume commands do. `publish` pushes the last commit to
  `refs/results/<commission>`. The request is the checkpoint's task exactly as SlopCodeBench's
  `just-solve` prompt renders it.
- `configurations/`: one file per configuration, a function from the benchmark's environment (the
  access its agent steps run with, the prompt telling an agent to do what the request says) to its
  steps. A configuration names nothing of SlopCodeBench. `baseline.ts`: Claude Code through
  Medrengard's adapter, one step.
- `factory.ts`: every configuration, each its own workflow, on one log under `state/`. **Running
  it spends the owner's subscription: only with the owner's approval.**
- `dry/`: the same workflow with a stub that commits the problem's reference solution, at no cost,
  as two configurations: `stub`, one step, and `polished`, two agent steps.
- `study.ts`: what a study is, and the problem sets: `iteration`, which configurations are compared
  on, and `heldOut`, which only a study marked `final` runs. Drawn by seed before any study ran.
- `studies/`: the studies. `baseline.ts` is the first: the baseline five times on the iteration
  set, with calibration once. `dry-easy.ts` is free.
- `driver/study.ts`: runs a study, `--concurrency` problem runs at a time (2 by default), every
  configuration's and problem's first repeat before any second. Concurrency is how a study is run,
  not part of it: each run appends what it was asked for to `results/<study>/invocations.jsonl`. Before anything runs it writes
  `results/<study>/manifest.json`: the study, its repository's and Medrengard's commits, the
  runner's pins, Node's and Claude Code's versions, each configuration's hash. It refuses
  uncommitted changes, pins that do not match, held-out problems outside a final study, and a study
  changed since it started. An escalation stops it starting problem runs. Run again, it goes on
  where it stopped.
- `driver/bench.ts`: one problem run, one configuration on one problem's checkpoints. For each it
  builds the start (the previous result with the problem's assets put back, as SlopCodeBench's
  harness does), commissions it, and grades the commit with SlopCodeBench's own `eval-snapshot`,
  outside the factory, so no step sees the tests. One line per checkpoint goes to
  `<results>/<run>/<problem>.jsonl`: the configuration and repeat, the commit, the definition's
  hash, the agent attempts' time, their cost, turns and session time summed from Claude Code's
  result lines, whether it solved the checkpoint (all Core tests pass), SlopCodeBench's verbosity
  and erosion (its own `scb-check` call) and the grader's report.
- `driver/report.ts`: the summary. Per problem, each configuration's mean and range over complete
  runs; per configuration, means over problems with bootstrap 95% intervals (problems resampled,
  then repeats); each configuration against the study's first, paired by problem. A checkpoint never
  reached after an abandon counts as unsolved. Seeded, so the same results give the same summary.
- `bin/runner.py`: the driver's side of SlopCodeBench, run in its pinned environment by
  `bin/runner.sh`: problems, grading and pins. Tests replace it with a fake.
- `calibration/`: SlopCodeBench's own harness on the same model and the owner's subscription.
  `run.sh <problem> <effort> [<count>]` adds a model config and a provider to the runner checkout
  under `vendor/` and runs on a copy of the problem, in `$SCRATCH`, with the pass policy `any-case`
  so it goes past failing tests as ours does. `cell.ts` is one problem run of it in a study, its
  results written as ours under the configuration `slopcodebench`. Paid.
- `pins.json`: the runner's and problems' commits, and the Python they run on. `bin/fetch.sh`
  checks them out under `vendor/`.

It needs Medrengard at `2e1f372` or later: the commit verifier comparing a claim with any subject
that names a `sha` (for the start kind), the adapter turning off `cc-plugin-privacy`, and steps
seeing `/workspace`, `/input` and `/output`. `.medrengard` follows the checkout's working tree.

## Setup

```sh
ln -s ~/dev/medrengard .medrengard
ln -s ~/dev/medrengard/node_modules node_modules
bin/fetch.sh
```

Grading needs Docker, and the network for the grader's image and each snapshot's dependencies.

## Running a study

```sh
# Free: the stub through the real grader.
node driver/study.ts run studies/dry-easy.ts

# Paid, with the owner's approval: one stage of a study at a time.
node driver/study.ts run studies/baseline.ts --problems datagate,textdrop --concurrency 6

node driver/study.ts status studies/baseline.ts   # where each problem run stands
node driver/study.ts report studies/baseline.ts   # the summary, also results/baseline/report.md
```

A problem run stops for the owner when a checkpoint escalates, with exit 3, and the study starts no
new ones. Decide the escalation with Medrengard (`retry` or `abandon`), then run the study again: a
retry goes on, an abandon ends that problem run as the configuration's failure. A calibration run
that stops short, or one whose checkpoint their harness did not run, is recorded as `stopped`: to run
it again remove its `<problem>.jsonl` and its scratch directory under
`results/<study>/calibration/<run>/`; to accept it as a failure append a line with the status
`abandoned`. One that was interrupted leaves its scratch directory and no lines, for the owner.

A commission is `<study>-<configuration>-r<repeat>-<problem>-<n>`. `driver/bench.ts` can still run
one problem run alone, as `--factory`, `--configuration`, `--problem` and `--run`.

## Development

`npm test`: type check and the drivers' tests, which run the real workflow with the stub, a fake
runner and a fake SlopCodeBench harness, under the system temp directory.

SlopCodeBench is MIT-licensed; its problems repository's LICENSE file is Apache-2.0. Cite the
paper (arXiv 2603.24755) with any results.
