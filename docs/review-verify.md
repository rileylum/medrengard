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

n=3 for each configuration under test, paired by problem. At first against the published n=5 baseline, with no
fresh control; changed by V6 below.

Smallest difference a study could detect against the n=5 baseline (80% power, two-sided 5%, run-to-run noise
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

- Pocock's `code-review` as Medrengard steps: implement, then a read-only review step running his two reviewers
  and claiming a verdict with the findings as its body, then on fail a fix step with a fresh context given the
  request and the verdict. The same review content as 1 in another structure, so the paired difference isolates
  what the workflow adds (isolation enforced by the sandbox, findings in the record, a bounded loop) against what
  it costs (the skill split up, a fix agent without the implementer's context). A verdict is a judgement, so Core
  finding 5 (a step claiming a document moves the subject) does not arise.
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

Decided with the owner, one at a time:

- **V1, skill files.** Copied verbatim from a pinned commit into `skills/<source>/<skill>/`, with the source's
  `LICENSE` and a `SOURCE` naming repository, commit and path. A reader sees the exact text that ran; the
  configuration's hash covers it; reproducing needs no network.
- **V2, tools.** Each configuration gets the tools its skill needs and no more: `Agent` (Claude Code's subagent
  tool) only where the skill starts subagents (1, 4, 5, 6). `Skill` comes with any skill. In 1 the tool and the
  skill arrive together; a baseline with `Agent` (about $150) separates them, only if 1 shows an effect.
- **V3, prompts.** The prompt names the skill, after its author's own use, and supplies what the skill would ask
  a person for; the skills are not edited.
  - 1: "Do what the request says, in your workspace. When you are done, commit your work, then use the
    code-review skill to review it since the commit you started from, with the request as its spec. Act on its
    findings, then commit all your work and claim the commit." The skill reviews committed work, so the agent
    commits first. "Act on its findings" is ours: the skill only reports, and Pocock's `implement` does not say
    to fix.
  - 2: "Do what the request says, in your workspace. Use the verification-before-completion skill before you
    claim your work is done. When you are done, commit all your work and claim the commit."
- **V4, pilot.** `studies/pilot-review.ts`: each once on datagate (Easy, $2.50 a baseline run, and the rowid
  misreading the baseline makes in 5 of 5 runs at checkpoint 2). It checks from transcripts and result lines
  that the skill is invoked, that 1's reviewers start as subagents and the agent commits again after them, that
  Claude Code's cost counts the subagents, and that nothing escalates. Its scores join no comparison; it may
  change only how a configuration is set up, put to the owner before any study runs. Then `studies/code-review.ts`
  and `studies/verification.ts`, n=3 on the twelve, reported with
  `study.ts report studies/baseline.ts studies/baseline-added.ts studies/<study>.ts`.

## After the pilots

`pilot-review` (datagate), `pilot-review-hard` (eve_market_tools, with the baseline) and `drift-check` (the
baseline on datagate), each n=1, about $31 in all, nothing escalated:

| | datagate solved / erosion / $ | eve_market_tools solved / erosion / $ |
|---|---|---|
| baseline, published n=5 | 0.657 / 0.639 (0.598–0.725) / 2.53 | 0.25 / 0.851 (0.803–0.952) / 3.31 |
| baseline, 2026-11-06 | 0.571 / 0.526 / 2.47 | 0.25 / 0.845 / 3.70 (Core 0.419, below every published run) |
| code-review | 0.714 / 0.395 / 6.89 | 0 / 0.609 / 7.94 |
| verification | 0.571 / 0.498 / 3.83 | 0.25 / 0.839 / 4.03 |

- Setup held: every checkpoint called its skill; code-review's two reviewers ran as subagents and the agent
  committed again after them; Claude Code's cost includes the subagents; their messages reach the transcript.
- datagate's rowid misreading survived: the Spec reviewer flagged rowid but was unsure of the numbering, and the
  agent kept the first data row as 1.
- **V6, a fresh control.** The baseline a day later fell below all five published runs on datagate's erosion, so
  the study runs the baseline again beside both configurations, at n=3; the published n=5 stays as the record.
- **V7, eleven problems.** test_translator left out: $15.30 a run against $1.40–5.30, 66 minutes, the noisiest on
  Core and cost; chosen by the baseline's cost, not the pilots. Detectable at n=3 per arm: solved 0.055, erosion
  0.047. The always-solved problems stay, where a regression shows. About $515, `studies/review-verify.ts`.
