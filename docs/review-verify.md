# Review and verify: the plan

Which published review and verify skills to test against the baseline, and how. Decided with the owner
on 2026-11-06; nothing here has run yet.

## What the baseline leaves to catch

From `published/iteration-12.md` (the baseline, 12 problems, 5 runs each):

- Spec misreadings repeated in every run: datagate checkpoints 2 and 4 (the rowid "source-file row" read as
  the data row); mvvault checkpoint 4 failed in 3 of 5 runs.
- Identical failures in every repeat: eve_market_tools, file_merger; layered_config_synthesizer solved 0.
- Erosion high on every problem: 0.711 mean.

Every reviewer below runs on the same model as the implementer, so a reviewer quoting the same spec may share
a misreading. Erosion is the likelier place for an effect, solved the less likely.

## How many runs (decision N1)

n=3 for each configuration under test, compared with the published n=5 baseline, paired by problem. No
fresh control at this stage: the baseline ran on 2026-11-05/06, and Claude Code is still 2.1.318 as in its
manifests. A change of model on the server side would not show.

Smallest difference a study can detect against the n=5 baseline (80% power, two-sided 5%, run-to-run noise
only, so a lower bound; the bootstrap also resamples problems):

| metric | at n=3 |
|---|---|
| solved | 0.046 |
| Core | 0.041 |
| erosion | 0.039 |
| verbosity | 0.052 |
| $ per problem | 0.40 |

## What is tested

Published, widely used skills, not the owner's own. Each configuration runs alone against the baseline;
combinations are separate tests later.

| # | configuration | source | what it tests |
|---|---|---|---|
| 1 | `code-review` | [mattpocock/skills](https://github.com/mattpocock/skills) (315k stars, MIT) | review after the work: two parallel reviewers with fresh contexts, Spec (quoting the spec) and Standards (repo standards and a Fowler smell baseline); report only |
| 2 | `verification-before-completion` | [obra/superpowers](https://github.com/obra/superpowers) (313k, MIT) | the implementer checks its own work with evidence before claiming it; no reviewer |
| 3 | `tdd` | mattpocock/skills | what TDD alone adds |
| 4 | `requesting-code-review` | obra/superpowers | one reviewer from a template, Critical/Important/Minor, the implementer fixes Critical and Important |
| 5 | `interrogate` | [cursor/plugins pstack](https://github.com/cursor/plugins/tree/main/pstack) (poteto) | adversarial review: adversaries try to break the change, a finding survives only if a rerun proves it; written for Cursor and mixed models, run here on Opus only |
| 6 | `doubt-driven-development` | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (113k, MIT) | adversarial review during the work: a fresh-context reviewer biased to disprove each non-trivial decision |

Rough cost at n=3 (12 problems × 3 runs), from the baseline's $4 per problem run: 1 $180–250, 2 about $150,
3 $180–250, 4 $180–250, 5 $250–400, 6 $200–300; $1.1–1.6k for all six. Each is checked on one Easy problem
before its study, and each paid run needs the owner's approval.

Later:

- `requesting-code-review` as Medrengard steps: a review step claiming a verdict, a fix step on fail.
  Tests whether the workflow adds anything over the skill. A verdict is a judgement, so Core finding 5
  (a step claiming a document moves the subject) does not arise.
- [kunchenguid/no-mistakes](https://github.com/kunchenguid/no-mistakes) (9k): a review, test, docs and lint
  pipeline with auto-fix. A Go program in front of a git remote that fetches the base branch from the forge;
  needs a fake remote and its push, PR and CI stages skipped.
- Adversarial Review (arXiv 2608.18167): reviewer plus a critic of the review. No published skill; we would
  write it.
- Pairings, such as `tdd` with `code-review` (Pocock's `implement`).

Looked at and not run:

- anthropics/claude-plugins-official `code-review`: bound to GitHub PRs, and excludes style so cannot move
  erosion. Its validation of each finding could be a later variant of 4.
- affaan-m/ECC `verification-loop`: a JavaScript build, lint and test script; these problems are Python with
  no visible tests.
- Osmani `code-review-and-quality`: one five-axis reviewer, close to 4 and to 1's Standards axis.
- pstack `tdd`, `principle-prove-it-works`: duplicate 3 and 2. `reflect`, `correct`, `unslop`,
  `show-me-your-work`: mine transcripts, need a history of corrections, edit prose, or log decisions.
- kunchenguid/kun: pulls documents that change daily over the network, so a run cannot be pinned.

## Design of the first tests

Open, one decision at a time with the owner; see the benchmark log for each decision as it is made.
