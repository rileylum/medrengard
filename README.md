# medrengard-bench

Benchmarks to compare Medrengard workflows, starting with
[SlopCodeBench](https://github.com/SprocketLab/slop-code-bench): problems of several checkpoints,
where an agent extends its own code as the specification changes.

- `workflow.ts`: one commission per checkpoint. `seed` checks out the start the driver made and
  claims it as a `start`, a kind of this factory's: unlike a commit it need not change anything, so a
  problem without assets starts from an empty repository (`bin/verify-start.ts` checks it is HEAD and
  keeps its bundle). Medrengard's commit verifier compares `implement`'s commit with it as with a
  commit subject, so an agent cannot claim its start back as work. Then
  `implement` is the configuration under test, run after `.venv` is made again from
  `requirements.txt`, as SlopCodeBench's resume commands do at each checkpoint after the first; `publish` pushes its commit to
  `refs/results/<commission>`. The request is the checkpoint's task exactly as SlopCodeBench's
  `just-solve` prompt renders it; the agent's prompt only says to do it and commit.
- `factory.ts`: the baseline, Claude Code through Medrengard's adapter. **Running it spends the
  owner's subscription: only with the owner's approval.**
- `dry/`: the same workflow with a stub that commits the problem's reference solution, at no cost.
- `driver/bench.ts`: takes one problem through its checkpoints. For each it builds the start (the
  previous result with the problem's assets put back, as SlopCodeBench's harness does), commissions
  it, and grades the commit with SlopCodeBench's own `eval-snapshot`, outside the factory, so no
  step sees the tests. One line per checkpoint goes to `results/<run>/<problem>.jsonl`: the commit,
  the attempt's time, its cost from Claude Code's result line, whether it solved the checkpoint (all
  Core tests pass) and the grader's report. The grader's quality analysis is kept beside it.
- `bin/runner.py`: the driver's side of SlopCodeBench, run in its pinned environment by
  `bin/runner.sh`; tests replace it with a fake.
- `pins.json`: the runner's and problems' commits, and the Python they run on. `bin/fetch.sh`
  checks them out under `vendor/`.

The start kind relies on Medrengard's commit verifier comparing a claim with any subject that
names a `sha`: `136cd4e` on Medrengard's `fix/commit-verifier-subject`, not yet merged.

## Setup

```sh
ln -s ~/dev/medrengard .medrengard
ln -s ~/dev/medrengard/node_modules node_modules
bin/fetch.sh
```

Grading needs Docker, and the network for the grader's image and each snapshot's dependencies.

## Running

```sh
# Free: the stub, on its own log under /var/tmp/medrengard/bench-dry.
node driver/bench.ts --factory dry/factory.ts --problem file_backup --run dry2

# Paid, with the owner's approval: the first checkpoint only.
node driver/bench.ts --factory factory.ts --problem file_backup --run base1 --checkpoints 1
```

A run id is used once: each checkpoint's commission is `<run>-<problem>-<n>`. A checkpoint that
escalates stops its problem and is left for the owner, ungraded.

## Development

`npm test`: type check and the driver's tests, which run the real workflow with the stub and a
fake runner, under the system temp directory.

SlopCodeBench is MIT-licensed; its problems repository's LICENSE file is Apache-2.0. Cite the
paper (arXiv 2603.24755) with any results.
