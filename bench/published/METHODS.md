# Methods

How the published results were made, for anyone reading them or a post built on them. Facts and
decisions only; each decision was the owner's, made before the runs it governs unless it says
otherwise. Figures are in each study's `report.md` and in `iteration-12.md`.

## What was measured

[SlopCodeBench](https://github.com/SprocketLab/slop-code-bench) (arXiv 2603.24755): problems of
several checkpoints, where an agent extends its own code as the specification changes. Each
checkpoint is graded by SlopCodeBench's own `eval-snapshot` in its Docker image, outside the
agent's sandbox, so no step sees the tests.

- **solved**: the share of a problem's checkpoints whose Core tests all pass. A checkpoint never
  reached, after an abandon, counts as unsolved.
- **Core**: the mean Core pass fraction per checkpoint.
- **reliable**: the share of runs solving every checkpoint of a problem.
- **erosion**, **verbosity**: SlopCodeBench's own quality measures (`scb-check`), means over
  graded checkpoints.
- **$**: Claude Code's own cost estimate at API prices, summed over a run's agent attempts. The
  runs used a Claude subscription, so no money was spent per run: read $ as relative effort.
- **seconds**: wall time of the agent attempts. The machine was doing other work throughout, and
  runs overlapped by the study's concurrency (2 to 6), so times are rough.

Spread: a problem run (one configuration on one problem, every checkpoint) is the unit. Per
problem, the mean and min–max over runs. Per configuration, the mean over problems with a
bootstrap 95% interval, resampling problems and then runs within them, seeded so the same lines
give the same summary. Comparisons are paired by problem.

## The setup

- Model `claude-opus-5-5`, effort medium, in Claude Code 2.1.318, through Medrengard's Claude Code
  adapter with `--permission-mode bypassPermissions` and a $10 stop per attempt (never reached).
- Node 24.13.0; SlopCodeBench runner at `af5a9cb`, problems at `9cd9ca3`, Python 3.12.14 (each
  study's `manifest.json`).
- **The baseline configuration**: one agent step per checkpoint, attempted once. Its prompt:
  "Do what the request says, in your workspace. When you are done, commit all your work and claim
  the commit." The request is the checkpoint's task exactly as SlopCodeBench's `just-solve`
  prompt renders it. Each checkpoint starts from the previous checkpoint's commit with the
  problem's assets put back, as SlopCodeBench's harness does, and with `.venv` made again from
  `requirements.txt`, as its resume commands do.
- The agent runs in a bubblewrap sandbox with no access to the grader or tests, and sees its
  workspace at `/workspace`.

## Problems

SlopCodeBench's 36 problems were split before any study ran (decision S4), by a seeded draw
(Python's `random.Random(20261105)`, per difficulty label, sorted names, a sample of four: the
first two to iterate on, the next two held out):

- **iteration** (first six): datagate, textdrop (Easy); file_query_tool, mvvault (Medium);
  meshctl, eve_industry (Hard). 38 checkpoints.
- **held out**: xjq, code_search, dynamic_config_service_api, trajectory_api, recli,
  metric_transform_lang. Run only by a study marked final; none has been.
- **unused**: the other 24.

The first six turned out easy for this model by its labels (both Hard problems solved at every
checkpoint in every run), so the set was widened by difficulty for this model rather than by
label (decision W1). The **survey** ran the baseline once on the 24 unused problems; a rule fixed
before it ran (`driver/select.ts`, decision W2) placed all 30 by one run each, ranked by solved
(ties by Core, then name) into thirds, each third split at its median erosion, kept the current
six and filled each of the six cells to two by seed 20261105. The **added** six get five fresh
runs: the survey run only places them, so a lucky or unlucky single run does not carry over.

**A flaw in the rule, and one replacement.** Eleven problems solved 1.00 for an easy third of ten
places, so the name tiebreak put circuit_eval and env_manager into the middle third; env_manager
(solved 1.00) was drawn there. Fixing the tie rule changed the whole draw, so the owner chose to
keep the rule as fixed and replace only env_manager, by a seeded draw from the fair middle-high
candidates (eve_jump_planner, mocked_http, sheeteval): `generator(20261105)`'s first value
0.102041 gave eve_jump_planner (decision S10). The added six: layered_config_synthesizer,
test_translator, eve_market_tools, file_merger, eve_jump_planner, execution_server. The 18
surveyed and not chosen were seen, not tuned on.

## Studies

| study | what | runs |
|---|---|---|
| `baseline` | the baseline ×5 and their harness ×1 on the first six | 36 |
| `survey` | the baseline ×1 on the 24 unused | 24 |
| `survey-rerun` | the baseline ×1 on the two the survey's `/tmp` stopped | 2 |
| `baseline-added` | the baseline ×5 on the added six | 30 |

`iteration-12.md` is the baseline over all twelve iteration problems, made by
`study.ts report studies/baseline.ts studies/baseline-added.ts`.

### Two configuration hashes, read as one baseline

A configuration's hash covers its whole workflow definition. Between the studies one thing
changed: where the agent's temporary files live.

- `97ec32116034…` (`baseline`, `survey`): `/tmp` a 256 MiB area held in memory.
- `2b3921ca80cd…` (`baseline-added`, `survey-rerun`): `/tmp` and the agent's home on disk, in the
  attempt's work area, under a 16 GiB disk limit.

Two survey runs filled the 256 MiB `/tmp` (below); no run of the `baseline` study came near it.
The agent, model, prompt, request and grading are the same, so the twelve problems are read as
one baseline. A reader who disagrees can read each study's report alone.

### Calibration

SlopCodeBench's own harness ran once per problem on the first six (`slopcodebench` in the
`baseline` study), with the same model, effort and Claude Code version, the `just-solve` prompt
and the `any-case` pass policy so it continues past failing tests as ours does. One run is a
sanity check, not a measure of their harness: it rules out a gross mismatch in our setup. Their
solved fell inside our five runs' range on every problem; paired by problem, theirs minus ours
was solved −0.001 [−0.048, 0.043], erosion +0.054 [0.002, 0.128], $ +0.459 [0.222, 0.789]
per problem. Their harness's output is not published, beyond its scores and the example code.

As a check on the whole benchmark: HumanLayer's write-up (2026-10-15) ran Opus 5.5 medium once on
all 196 checkpoints: Core 74.0%, strict (every test) 14.3%. Ours over the 164 checkpoints we ran
once (the survey with its reruns, and the first six's first run): Core 71.3%, strict 12.2%. Their
harness and Claude Code version are not stated, and the sets differ; the figures agree closely
enough that our setup is not making the benchmark easier or harder.

### Stopped runs

- Survey, mocked_http checkpoint 7: the agent downloaded micromamba into `/tmp` to install
  RabbitMQ, Java and Kafka to test its mocks against real servers, and filled the 256 MiB `/tmp`.
- Survey, dynamic_buffer checkpoint 4: test data and compiled C++ and Rust outputs filled it.

Both were limits of the setup, not the agent's failures (decision T1): abandoned in the survey,
`/tmp` moved to disk, and both run again from the start in `survey-rerun`, which places them.
There, mocked_http completed; dynamic_buffer's builds passed even 16 GiB and it was abandoned as
the agent's failure (decision R1), counted unsolved from checkpoint 4. Each abandoned line in
`runs/` carries the escalation and the owner's reason.

No other run in any study escalated.

### Running order

Studies ran in stages, the owner checking time and cost between them, at a concurrency of 2 to
6 (each run's in `invocations.jsonl`). The `baseline` study's runs started repeat-first; in the
Hard stage the driver was paused by hand to start only some runs, which changes order, not what
ran. The `baseline` study has two manifests: its first stage ran on bench commit `b0f1198`, and the
manifest was set aside (`manifest-b0f1198.json`) when the driver gained per-run concurrency; the
configuration hash, pins, versions and Medrengard commit are equal in both.

Estimated cost by Claude Code: `baseline` $127 (ours $103, theirs $23), `survey` $107,
`survey-rerun` about $20, `baseline-added` $137.

## What is published

- `<study>/`: each study's manifests (repositories named, not located), invocations, every run's
  result lines and the summary; the survey's `selection.md`.
- Example code, in a separate repository: per problem and configuration, the run nearest the
  median (solved, then erosion, then the first repeat), as its own history, one commit per
  checkpoint, tagged `<study>/<problem>/<configuration>/checkpoint-<n>`. Their harness's examples
  are one commit per checkpoint of the snapshot it kept. The first commit of ours holds the
  problem's assets, if it has any, which are SlopCodeBench's (Apache-2.0).
- Not published: transcripts, their harness's full output, every other run's code.

Made with `node driver/study.ts publish studies/baseline.ts studies/baseline-added.ts
studies/survey.ts studies/survey-rerun.ts`.
