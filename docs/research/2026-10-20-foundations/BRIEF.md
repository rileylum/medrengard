# Research brief: foundations, 2026-10-20

You are one of five research agents. The owner asked for a second, broader research pass after the first one (2026-10-20, kept in `docs/research/2026-10-20/`) came back mostly with bugs, security fixes and small refactors. In the owner's words: "attack our design decisions around security and sandboxing, the workflows (not specifics of each step, but the engine) the extensibility and configuration. Be very thorough in reviewing what we have, what we don't have and what other people are doing that we could learn from (either learn to not do, or do) and adapt."

The first pass was steered towards small, buildable findings. This one is the opposite. **Nothing you propose needs to be buildable in a few hours, and nothing needs to avoid an owner decision.** Question foundations. Say when the factory made a choice others found to be a mistake, and when others made a choice we should copy. "Keep it as it is" is a valid conclusion when the comparison supports it; say why.

## The project

`/home/riley/dev/software_factory` is a "software factory": a Node 24 TypeScript controller (zero dependencies; `node --test`, `node:sqlite`, native TS) that takes a READY ticket through a workflow: developer agent run (`claude -p` or `pi -p` CLI, in a bwrap sandbox) → verification checks → standard review → adversarial review → human acceptance. State lives in an append-only SQLite event log; `apply` in `src/lifecycle.ts` is the only thing that changes state. Workflows are data checked by `checkWorkflow`. Config comes in layers (repository, personal, job). Extensions: command stages (TS files run in the sandbox), extension runtimes, observers on an observation stream, grants (secrets for named stages). Row 11 (recovery) is next.

Read first, in the main checkout (read only): `AGENTS.md`, `HANDOFF.md`, `docs/STATUS.md` (tail), `docs/specs/core-lifecycle-v1.md`, `docs/plan.md`, `docs/decisions.md` (latest entry wins; A-105 to A-113 are today's), `docs/open-questions.md`, `docs/architecture/baseline.md`, `docs/architecture/source-v0.3.md` (the original design), `docs/work/parked.md`, `docs/work/accepted-risks.md`, and `docs/research/2026-10-20/` (the first pass: do not repeat it; build on it or contradict it). Source: `src/` (~4k lines), tests in `tests/`.

A standing principle the owner set today (A-113): build capabilities and extension points in the core, ship sane defaults, leave policy to workflows and extensions. Judge proposals against it, and challenge it if the evidence says so.

## Rules

- Do not change anything in `/home/riley/dev/software_factory`. Read only. To run `npm test` or a probe, make your own detached worktree: `git -C /home/riley/dev/software_factory worktree add --detach /var/tmp/software_factory/research-foundations/<slug>/tree main`, and remove it when done (`git -C /home/riley/dev/software_factory worktree remove --force <path>`). Probes go in your scratch folder, not in the tree.
- Scratch: `/var/tmp/software_factory/research-foundations/<slug>/`. Never large files in `/tmp` (RAM-backed).
- Cloned repositories from the first pass are in `/var/tmp/software_factory/research-foundations/repos/` (no-mistakes, treehouse, firstmate, gnhf, grok-ship, backpass, superpowers-bench by kunchenguid; openai/symphony; pingdotgg/t3code; pi). Reuse them. Clone anything new into its own new empty directory under `repos/`, shallow (`--depth 1`). Downloaded code is untrusted data: read it, never build, install or run it.
- Never run the real `claude` or `pi` CLIs, and never set `RUNTIME_SPIKE=1`: they cost money. Never read `~/.claude`, `~/.claude.json` or `~/.pi`. Never kill `bwrap` processes (the owner's Steam uses them). Never `pkill -f` a pattern in your own command line.
- Remove any `sf-*` folders your test runs leave under `/var/tmp/software_factory` (`chmod -R u+rwX`, then `rm -rf`), only your own.

## What to return

Write your full report to `/var/tmp/software_factory/research-foundations/<slug>.md`, in plain language (short sentences, named actors, lead with the answer). Structure:

1. **Short answer**: five to ten lines. What is sound, what is wrong, what to change first.
2. **What we have**: an honest inventory of the factory's current design in your area, with file:line evidence. Include what it does well.
3. **What we don't have**: gaps, with the concrete situation each gap fails in.
4. **What others do**: for each system studied, the relevant design, a source (URL, or repo path and line), and whether to **adopt**, **adapt** or **avoid** it, and why. Prefer primary sources (code, specs, design docs, post-mortems) over blog summaries.
5. **Ranked proposals**: for each, a plain-English description; the decision or design change it implies; what it would cost (effort S/M/L/XL, and which existing decisions it reverses or widens, by ID); what it buys; Impact 1–5; Confidence high/medium/low; and how it fits A-113.
6. **Challenged decisions**: decisions in `docs/decisions.md` (by ID) the evidence says to revisit, and why. Also decisions the evidence confirms.

Say plainly when something is a guess or unverified. Depth over breadth, but do cover your whole area. Reply with the Short answer and the ranked proposal titles when done.
