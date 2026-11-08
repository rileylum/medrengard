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
  Medrengard's adapter, one step. `claude-code.ts`: the baseline's step with a prompt, a skill and only the
  tools the skill needs, which the review and verify configurations are: `code-review.ts` (Matt Pocock's
  `code-review`, with `Agent` for its subagent reviewers) and `verification.ts` (obra/superpowers'
  `verification-before-completion`). The plan they belong to is `docs/review-verify.md`.
- `skills/`: published skills, copied verbatim at a pinned commit, per source with its `LICENSE` and a
  `SOURCE` naming the repository, commit and path. A configuration's hash covers their contents.
- `workflow.ts`'s `implementAccess` gives every agent step /tmp and its home as Medrengard scratch
  areas, on disk in the attempt's work area, bounded by a 16 GiB disk limit (`benchmarkLimits`).
- `factory.ts`: every configuration, each its own workflow, on one log under the data directory's
  `state/`. **Running
  it spends the owner's subscription: only with the owner's approval.**
- `dry/`: the same workflow with a stub that commits the problem's reference solution, at no cost,
  as two configurations: `stub`, one step, and `polished`, two agent steps.
- `study.ts`: what a study is, and the problem sets: `iteration`, which configurations are compared
  on, and `heldOut`, which only a study marked `final` runs, drawn by seed before any study ran;
  `unused`, the rest, which a survey study runs once to choose more to iterate on; `added`,
  the six chosen from it; `screen`, the six a configuration is screened on from 2026-11-08, one per
  cell of the survey's grid, the cheapest in each, at about half the cost of the eleven.
- `studies/`: the studies. `baseline.ts` is the first: the baseline five times on the iteration
  set, with calibration once. `survey.ts`: the baseline once on `unused`, with the selection that
  chooses the iteration set's next problems from it; `survey-rerun.ts` runs again the two whose
  survey run filled a 256 MiB /tmp held in memory, and places them. `baseline-added.ts`: the baseline five
  times on `added`, the six problems chosen from the survey to iterate on with `iteration`. `pilot-review.ts`:
  `code-review` and `verification` once on datagate, to check their setup, in no comparison;
  `pilot-review-hard.ts` the same and the baseline on eve_market_tools; `drift-check.ts` the baseline once more
  on datagate. `review-verify.ts`: the baseline, `code-review` and `verification` three times each on eleven of
  the twelve, without test_translator. `dry-easy.ts` is free.
- `driver/study.ts`: runs a study, `--concurrency` problem runs at a time (2 by default), every
  configuration's and problem's first repeat before any second. `--repeats n` runs only up to repeat
  n, so a study is paid for in stages: `--repeats 1`, then `--repeats 3` runs the second and third.
  Two optional caps stop it starting problem runs, the running ones finishing, so either can be
  passed by what they spend: `--budget <usd>`, what this run has spent, and `--weekly <percent>`,
  the subscription's weekly use, which counts the owner's other use too. The weekly use comes from
  the rate limit events in Claude Code's output, recorded on each checkpoint's line as `weekly`; a
  run's first problem runs start on the latest reading of any study, and one that gives no reading
  stops the run. Concurrency, repeats and caps are how a study is run, not part of it: each run
  appends what it was asked for to `results/<study>/invocations.jsonl`. A
  study runs from a worktree of its own, which holds the study, the driver and Medrengard, so one
  commit names them all. Before anything runs it writes `results/<study>/manifest.json`: the study,
  the worktree's commit, the runner's pins, Node's and Claude Code's versions, each configuration's
  hash. It refuses the main checkout, a study and a Medrengard in different checkouts, uncommitted
  changes, pins that do not match, held-out problems outside a final study, and a study changed
  since it started. Manifests before the monorepo name two repositories, the benchmark's and
  Medrengard's; their commits are in this repository's history. An escalation stops it starting problem runs. Run again, it goes on
  where it stopped.
- `driver/bench.ts`: one problem run, one configuration on one problem's checkpoints. For each it
  builds the start (the previous result with the problem's assets put back, as SlopCodeBench's
  harness does), commissions it, and grades the commit with SlopCodeBench's own `eval-snapshot`,
  outside the factory, so no step sees the tests. One line per checkpoint goes to
  `<results>/<run>/<problem>.jsonl`: the configuration and repeat, the commit, the definition's
  hash, the agent attempts' time, their cost, turns and session time summed from Claude Code's
  result lines, whether it solved the checkpoint (all Core tests pass), SlopCodeBench's verbosity
  and erosion (its own `scb-check` call) and the grader's report.
- `driver/select.ts`: the selection rule. Each problem is placed by one baseline run: ranked by
  solve rate (ties by Core pass fraction, then name) into thirds, each split at its median erosion.
  The current iteration problems stay; each of the six cells is filled to two from the surveyed
  ones, by the seed fixed in the survey study, which also picks the cells left short when the
  current ones overfill one. `study.ts select <survey>` prints the grid, also `selection.md`.
- `study.ts publish <study>…`: each study's scores into `published/<study>/`, to commit: its
  manifests with each repository named, not located; its invocations and selection; every run's
  lines, without the path to their harness's output, and an abandoned one's with why it escalated
  and the owner's feedback; and its summary. It refuses a file naming the owner's home or where
  the results are. Per problem and configuration it puts the median run's history (see
  `representative` in `report.ts`) into the examples repository (`--examples`, by default
  `../medrengard-bench-examples`) as the branch `<study>/<problem>/<configuration>`, each graded
  checkpoint tagged `<branch>/checkpoint-<n>`: ours the run's own commits, theirs a commit per
  checkpoint of the snapshot their harness kept, dated by it. Published again, names point where
  they did. Pushing either is the owner's.
- `driver/report.ts`: the summary. Per problem, each configuration's mean and range over complete
  runs; per configuration, means over problems with bootstrap 95% intervals (problems resampled,
  then repeats); each configuration against the study's first, paired by problem. A checkpoint never
  reached after an abandon counts as unsolved. Seeded, so the same results give the same summary.
- `bin/runner.py`: the driver's side of SlopCodeBench, run in its pinned environment by
  `bin/runner.sh`: problems, grading and pins. Tests replace it with a fake.
- `calibration/`: SlopCodeBench's own harness on the same model and the owner's subscription.
  `run.sh <problem> <effort> [<count>]` adds a model config and a provider to the runner checkout
  under the data directory's `vendor/` and runs on a copy of the problem, in `$SCRATCH`, with the pass policy `any-case`
  so it goes past failing tests as ours does. `cell.ts` is one problem run of it in a study, its
  results written as ours under the configuration `slopcodebench`. Paid.
- `pins.json`: the runner's and problems' commits, and the Python they run on. `bin/fetch.sh`
  checks them out under the data directory's `vendor/`.
- `data.ts`: the data directory, `~/.local/share/medrengard/bench` (or `$XDG_DATA_HOME`'s), or
  `MEDRENGARD_BENCH_DATA`. It holds `state/` (the log and the trajectories repository),
  `results/` and `vendor/`, outside every checkout, so a study's worktree and the main checkout see
  one record. Nothing else keeps a copy: back it up.

The benchmark imports Medrengard as `@medrengard/core`, the package beside it, and runs its Claude
Code adapter from `../core/adapters`.

## Setup

From the repository's root:

```sh
npm install
bench/bin/fetch.sh
```

Grading needs rootless Podman, and the network for the grader's image and each snapshot's dependencies:
SlopCodeBench's grader starts a container per checkpoint, and under Docker each one adds and removes a
network interface on the host, which other programs, such as Chrome, take for a network change. Under
rootless Podman those interfaces live in the owner's user namespace. `bin/podman-python3.12-uv.yaml` is
SlopCodeBench's environment with `binary: podman`, used for grading only; requests are rendered with the
original. The runtime's version is in each manifest's pins. Once:

```sh
sudo pacman -S podman passt                      # and a riley line in /etc/subuid and /etc/subgid
printf '[containers]\nuserns = "keep-id"\n' > ~/.config/containers/containers.conf
systemctl --user enable --now podman.socket
```

`keep-id` keeps files the grader writes into its bind mount owned by the owner. Studies before
`review-verify`'s second stage graded under Docker.

## Running a study

A study runs from a worktree of its own, at the commit it starts on, and stays there through its
stages; the main checkout goes on with other work. A change agreed between stages moves the
worktree to the new commit, with the manifest set aside as `manifest-<commit>.json`. Reports,
status and publishing run from any checkout.

```sh
git worktree add --detach ~/dev/medrengard-studies/<study>
cd ~/dev/medrengard-studies/<study> && npm install && cd bench

# Free: the stub through the real grader.
node driver/study.ts run studies/dry-easy.ts

# Paid, with the owner's approval: one stage of a study at a time, by problems or by repeats.
node driver/study.ts run studies/baseline.ts --problems datagate,textdrop --concurrency 6
node driver/study.ts run studies/baseline.ts --repeats 1 --budget 60 --weekly 70

node driver/study.ts status studies/baseline.ts   # where each problem run stands
node driver/study.ts report studies/baseline.ts   # the summary, also results/baseline/report.md
node driver/study.ts select studies/survey.ts     # once the survey is complete: the iteration set

# Several studies' runs together, printed only; a configuration on a problem in two is refused.
node driver/study.ts report studies/baseline.ts studies/baseline-added.ts

# Free, from a branch of the main checkout: scores into published/, the median runs into
# medrengard-bench-examples beside the repository.
node driver/study.ts publish studies/baseline.ts studies/baseline-added.ts studies/survey.ts studies/survey-rerun.ts
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
runner and a fake SlopCodeBench harness, under the system temp directory. The study driver's tests
run it from a worktree of a copy of the working tree, so they need nothing committed. The root's
linter and formatter skip the benchmark for now.

## Results and examples

[`published/`](published/) holds the studies' scores and reports, with
[`published/METHODS.md`](published/METHODS.md) on how they were made. Each problem's median run's
code, with its history across checkpoints, is in
[medrengard-bench-examples](https://github.com/rileylum/medrengard-bench-examples).

## Licence

MIT: see [`LICENSE`](LICENSE). SlopCodeBench is MIT-licensed and its problems Apache-2.0; neither
is held here (`bin/fetch.sh` checks them out into the data directory). Cite the paper (arXiv 2603.24755)
with any results.
