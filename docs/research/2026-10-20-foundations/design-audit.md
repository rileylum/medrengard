# Design audit: the factory's decisions as a whole (slug: design-audit)

Research date 2026-10-20. Read only; nothing in `/home/riley/dev/software_factory` was changed, no worktree was made, and no test was run. Citations are at main `42f174e`. "Guess" or "unverified" marks anything not checked against a primary source.

## 1. Short answer

- **Sound, keep as hard rules:** the controller alone decides state (D-001), evidence binds to a SHA (spec principle 2), fresh-context reviewers, the sandbox, and "humans merge" as the default. Every system studied that is trusted with real repositories converges on these. The factory does them better than most.
- **Wrong, and visible in the factory's own record:** the factory's *product* does not offer the moves its owner actually uses. About two in three adversarial reviews of the factory's own tickets failed (about 20 of 30). The owner never once cancelled. Every time, the answer was "fix the findings on the branch, then merge", often without another review. The product's default workflow can only escalate, then cancel or restart from base.
- **Wrong, for reasons that no longer hold:** three defaults were set before the sandbox existed and still cripple runs. The claude developer cannot run tests (`src/runtime/cli-adapter.ts:311`). No reviewer can run anything (`:334`, A-030). A red check goes straight to the owner (A-108 item 2). Every comparable system lets the developer run checks and gives a red check a bounded fix round.
- **Over-built:** a general workflow engine, extension host, grants, four configuration layers and a 6,000-line guide, all built before crash recovery and before any second user. The record that governs the process is also heavy: 99 approval entries in six days, and more lines of docs than of source.
- **Under-built:** recovery (a crash still strands a cycle), cost caps and cost records, a model dimension, a daemon or reconciler, a remote or CI for the factory's own repository, and dogfooding. The factory does not build itself.
- **The record contradicts itself in at least nine places** without saying so (section 6.1). Two of them are "core rules no workflow can switch off" that later decisions switch off: A-109 refunds budget and A-108 retries a quality gate.
- **Change first:** (1) record the owner's real escalation moves as product features: an owner-authorised fix inside the cycle; (2) flip the three pre-sandbox defaults; (3) decide O-006 (daemon or not) before drafting row 11; (4) one "current rules" page that removes the contradictions; (5) then run the factory's own tickets through the factory.

## 2. What we have

An honest inventory of the design as a whole, as the record states it.

**Goals and invariants.** `docs/architecture/baseline.md:7-20` lists ten invariants. The owner later turned two of them into default policy (D-023, A-054): the 2+1 review budget and human acceptance. `docs/specs/core-lifecycle-v1.md:9-18` now splits the rules into three core rules (controller decides; SHA binding with "budget already spent stays spent"; unclassified escalates with "no automatic retry of a quality gate") and two default-policy rules (2+1; humans accept).

**The product, by layer.**
- Core: an append-only SQLite event log; `apply` as the only state change; a workflow checked by `checkWorkflow`; one driver with a preflight; prompt contract and role-text hashes on every outcome; a once-a-second cancel watch (spec lines 20-116).
- Extension surface (row 10): runtimes by registry, command stages with `run`, `network` and `{ file }` arguments, grants, a pulled observation stream, and four configuration layers (D-024, A-074 to A-090).
- Sandbox: bubblewrap with per-stage policies and systemd user scopes. `pasta` is coming (A-106).
- Runtimes: `claude -p` and `pi -p` only (D-007).
- Not built: recovery (row 11), tracker and code host sync (row 12), pools, acceptance evidence, structured findings and the improvement loop (row 13), the Design Studio (O-012), and release tracking (O-009).

**The process (how the factory is built).** `docs/workflow.md`: Fast or Design tickets, tests first, an owner-run `npm test` (line 47), two standard reviews and one adversarial review through `claude -p` (lines 48-53), and owner merge. Approvals are quoted replies in `docs/decisions.md`. Findings go to `docs/work/parked.md` or `docs/work/accepted-risks.md`. `AGENTS.md:14-23` holds the rules.

**What it does well.**
- The trust model is the strictest surveyed. The first pass reached the same conclusion (`docs/research/2026-10-20/harnesses.md:10`).
- Provenance is ahead of most systems: workflow hash, contract hash, role-text hash and module hash on every outcome.
- The process has caught real, serious bugs: a catastrophic regex backtrack (04-d), a symlink escape into the developer's worktree (06-a), a `.git` pointer swap that hid rewritten files (07-b), and a grant file readable by agents (10-e). The adversarial reviewer reproduced each one with a probe.
- The owner records decisions with quotes, and every waiver is written down. That honesty is what makes this audit possible.

**Size, for scale.** `src/` is 4,019 lines; `tests/` about 7,800; `docs/` about 6,400 lines of Markdown; `learn/` and `proto/` about 6,200. 359 commits touch `docs/` and 143 touch `src/`. There are 550 commits in six days, 15 to 20 October.

## 3. What we don't have

Each gap, with the situation it fails in.

1. **The owner's real escalation moves in the product.** Live run 1: a reviewer failed a correct change and the developer disputed it. The only moves were cancel, or a child cycle from base with a new paid developer run (`HANDOFF.md:103`). In the factory's own process, the owner's move after an adversarial FAIL was almost always "fix these findings and merge" (A-080, A-082, A-085, A-086, A-090, A-077, and nine fix tickets A-021 to A-041). The product cannot express that move. A-109(B), an overrule, covers only half of it: it rejects a finding, but it cannot accept a finding with a targeted fix.
2. **A developer that can run its own checks (claude).** Live run 2: the developer could not commit, because of the git allow list (`docs/plan.md`, Role prompts row). Every developer learns that its tests fail only after VERIFYING, and the default then escalates to the owner. Ralph, Aider, Claude Code's own best practices and Copilot's validation tools all put the check inside the developer's loop.
3. **A reviewer that can show, not argue.** The adversarial role text says "report what you can show" (`src/lifecycle.ts:83`). Its tools are Read, Glob and Grep (`src/runtime/cli-adapter.ts:334`). The reviewers of the factory's *own* tickets got `Bash(npm test)` and `node:*` (`HANDOFF.md:83`), and nearly every major in `parked.md` comes with a probe script. So the product's adversary is weaker than the one the owner has seen work.
4. **Recovery.** A crash or Ctrl-C strands a cycle; `resume` exists and nothing calls it (`docs/specs/core-lifecycle-v1.md:120`). The source's first measurable outcome includes "a safe, recoverable failure path" (`source-v0.3.md:651`; `baseline.md:9`). That outcome is not yet met, although ten plan rows are done.
5. **Something long-lived.** No daemon, scheduler, reconciler or observer host (O-006 open). Row 12's "merging on GitHub records accept", A-113's dispatch gate and stall-watchdog observer, and row 11's reconcile-on-restart each need a process that outlives one `main.ts` run.
6. **Cost and model.** No turn or dollar cap is passed, and no cost is recorded (A-111 "soon"). The default deadline is 120 s (`HANDOFF.md:171`). The job's `model` key is ignored (A-113), so the "model" dimension of D-002 does not exist.
7. **A remote, CI or backup for the factory's own repository.** "The repository has no remote" (`HANDOFF.md:166`). 550 commits and every decision exist on one disk.
8. **Dogfooding.** `docs/workflow.md:3` says the process is "the core lifecycle run by hand until the controller can run it". Live run 3 reached AWAITING_ACCEPTANCE (A-087). The controller can now run it, and still does not. no-mistakes's `VISION.md:82` says "Every change to this repository must pass through its own gate; dogfooding is the first calibration loop". Pi is built with Pi (Ronacher, "Building Pi With Pi", https://lucumr.pocoo.org/2026/5/24/pi-oss/).
9. **A current-rules view.** "Latest entry wins" across 691 lines, while the D-table stops at D-024. A-105 to A-113 change rules but have no D-row. A reader must replay the whole log, as `apply` replays events, to know the rules. Section 6.1 shows what that costs.
10. **The measurement the process promised.** `docs/workflow.md:68-70`: "After a few tickets, look at where the time went and automate that step next." About 50 tickets on, no such analysis is recorded in `STATUS.md` or the decisions log. The data exists in the ticket logs.

## 4. What others do

Previous pass (`harnesses.md:137-183`) has the per-system table; it is not repeated here. This section compares *overall shape and goals* and judges who is right.

| System | Their decision | Ours | Verdict |
|---|---|---|---|
| **StrongDM software factory** (https://factory.strongdm.ai/, Willison's write-up https://simonwillison.net/2026/feb/7/software-factory/) | "Code must not be reviewed by humans." Validation by end-to-end *scenarios stored outside the codebase* ("a test stored in the codebase can be lazily rewritten to match the code"), scored as probabilistic "satisfaction"; digital twins of SaaS dependencies; spend "at least $1,000 on tokens per human engineer per day". | Human acceptance; reviewers with veto; tests visible to the developer (A-107). | **Adapt** the holdout idea (owner-held scenarios as the gate that counts), **avoid** no-human-review: the owner's stated risk appetite (A-054 quote) rejects it. StrongDM is right that the validation set must live outside the candidate; we are right to keep the human at merge. |
| **Attractor** (spec: https://github.com/strongdm/attractor, `attractor-spec.md` §§2.6, 3.4-3.7, 4.6, 5.3, 6, 8) | A DOT graph; `goal_gate=true` nodes must succeed before exit, else jump to `retry_target`; `max_retries` per node; checkpoint after every node; a CSS-like **model stylesheet** maps nodes to model/provider/effort; human gates go through an `Interviewer` interface with AutoApprove, Console, Queue and Recording implementations. Shipped as a spec only, no code. | Workflow as data with budgets; no retries; no checkpoint beyond the event log; no model mapping; human stages answered only by `main.ts accept`. | **Adopt** the model stylesheet idea (role → runtime → model, overridable per stage); it is the cheapest way to make D-002's model dimension real. **Adopt** the Interviewer shape for human stages: it is A-113's "policy in extensions" done right (auto-approve is one implementation, not a flag). **Avoid** unbounded node retries. |
| **OpenAI Symphony** (`repos/openai_symphony/repo/SPEC.md:20-70, 790-830`) | A daemon that polls the tracker; repository-owned `WORKFLOW.md` (YAML plus prompt); **non-goal: "General-purpose workflow engine"** (line 63); retries with exponential backoff; stall timeout; trust posture "implementation-defined"; restart recovery "without requiring a persistent database". | General workflow engine; event-sourced store; no retries; no daemon. | Split. **Avoid** Symphony's prompt-only gating. **Adopt** its daemon-plus-reconcile shape for O-006. Symphony's non-goal is a fair warning against our row 9 and 10 scope (section 6.3). |
| **no-mistakes** (Kun Chen; `repos/kunchenguid_no-mistakes/repo/VISION.md`) | Line 11: "the core pipeline's shape and order stay fixed, and a repository may add checks on top but never remove, reorder, or dilute the core". Line 31: "Every judgment has exactly one owner ... never stacked". Line 16: cost must be opt-in. Line 37 onwards: "the pipeline runs forward", with a per-step fix budget. Line 44: deterministic guards "bandage poor agent judgment". Line 82: dogfood. | A-113: everything is configurable policy; standard and adversarial review stacked on the same question; hard deterministic guards everywhere. | **Adopt** the "a repository may only strengthen" rule for the *repository* layer, and dogfooding. **Adapt** "one owner per judgment": make the adversarial pass a different question (executable falsification) rather than a second opinion on the same question. **Avoid** line 44: for a local tool with paid, sandboxed runs, deterministic guards are the factory's main value. |
| **GitHub Copilot coding agent** (https://docs.github.com/en/copilot/concepts/agents/coding-agent/risks-and-mitigations) | The agent cannot approve or merge its own PR, and neither can the person who asked; validation tools (CodeQL, secret scanning, tests) run inside the agent's loop. | Same human merge; checks run after the developer, not inside. | **Adopt** checks inside the developer loop. **Keep** our human merge; it matches Copilot's. |
| **Devin, Jules, Factory droids, Cursor background agents** (docs as cited in `harnesses.md`; Jules plan approval unverified) | Cloud VM per task; Jules asks the human to approve a plan before coding; Factory's `droid exec` has autonomy levels (read-only by default, more by flag); Cursor attaches video and screenshots to the PR; Devin tests the app after CI. | Local only; no plan step; grants as the capability tier; acceptance evidence parked (A-051). | **Adapt** autonomy levels: our grants and per-stage `network` already are a capability tier, so name the tiers. **Avoid** cloud for now (A-035). A plan-approval step belongs to the Design Studio (O-012), not the cycle. |
| **CodeRabbit, Graphite's reviewer, Cursor Bugbot** (product docs; behaviour from public docs, not re-verified today) | AI review is *advisory*: comments, severities, autofix offers; a human decides. Noise is the main complaint users raise. | LLM verdict has veto power and spends budget. | **Adapt**: keep the veto only for findings backed by an executable repro or a broken done-when line (A-109's "blocking"), and make the rest advisory. SWR-Bench precision of 16.65% (`deep-research.md:31`) supports this. |
| **OpenHands / All Hands** (`harnesses.md`) | Docker runtime, event stream, resolver opens a draft PR, stuck detector. | bwrap, event log, local branch, no stall detector. | Confirms our shape; **adopt** a stuck detector as an observer (A-113 already plans it). |
| **Sweep** | Reported to have pivoted from an issue-to-PR bot to an IDE assistant (**unverified**). | Issue-to-PR. | If true, a warning that unattended issue-to-PR is hard to make worth its review cost. That supports the backpressure focus of O-007. |
| **Gas Town** (Yegge, https://github.com/steveyegge/gastown) | Many agents, a Witness for stuck agents, a Refinery merge queue with gates; throughput first. | One cycle at a time; assurance first. | Different goal. **Adopt** the Witness as an observer extension; do not chase throughput before backpressure (O-007). |
| **Ralph loops** (Huntley, https://ghuntley.com/ralph/) | "Backpressure" from type checkers and tests inside every loop; fresh context per iteration; "one thing per loop"; greenfield only; "engineers are still needed". | Fresh context: yes. Backpressure inside the developer loop: no (claude). | **Adopt** in-loop backpressure. That is gap 2. |
| **Hashimoto, "My AI Adoption Journey"** (https://mitchellh.com/writing/my-ai-adoption-journey) | "Harness engineering": every time an agent does a Bad Thing, change AGENTS.md or add a tool so it "never makes that mistake again"; one background agent at a time; triage agents report only. | The improvement loop (source §11) is unbuilt; harness fixes go through owner tickets; prompts are one line. | **Adopt** the cheap version now: a per-repository instruction file the factory reads from the base (A-100 already allows it), plus a log of escalation causes. The full meta-reviewer can wait. |
| **Ronacher, "Building Pi With Pi"** | Dogfood; agents "defend locally against every bad state ... the correct fix is not to handle the bad state, but to make the bad state impossible". | 08-a to 08-f handled hostile states one at a time: FIFOs in a gitlink, PATH_MAX chains, non-UTF-8 names, a 3 GB string. | **Adopt** as a review heuristic: when an adversarial finding is the third of its class, the fix is structural (for example, the controller never runs its own git over a tree a candidate wrote) and not another guard. |
| **Willison, five levels** (https://simonwillison.net/2026/Jan/28/the-five-levels/) | A scale from autocomplete to a "dark factory". | The factory sits about level 4: agents write, a human reviews outcomes. | A useful naming device for the owner's goal; no change. |

**Who is right, overall.** The factory is right where it differs on *authority*: controller state, SHA binding, the sandbox, human merge. Others are right where they differ on *loops and leverage*. The developer runs checks in its loop. A red check gets a bounded fix. Reviewers are advisory unless they can show a failure. The gate that counts is a holdout the developer cannot edit. Cost is recorded and capped. A long-lived process reconciles. The tool builds itself.

## 5. Ranked proposals

### P1. Make the owner's real escalation moves product features (Impact 5, Confidence high, Effort M)

- **What:** the owner can act on an ESCALATED cycle with three commands, each recorded with a quoted reason and source. (a) *Overrule*: A-109(B) as planned. (b) *Targeted fix*: pick findings, then one fix run against them, then verify, and the workflow continues from a named stage (by default the stage after the failed review), with no new reviewer budget unless the owner grants it. Source §07 proposed exactly this: "may the owner approve one targeted fix and a fresh adversarial attempt? Proposed: only via an explicit override with an audit trail" (`source-v0.3.md:390`). (c) *Accept with risk*: accept the head as is, with the findings recorded as accepted risks.
- **Decision implied:** O-011 gets an answer from data the factory already has: its own about 20 adversarial FAILs and the owner's moves on them.
- **Reverses or widens:** widens A-072 and D-016 (two more owner moves beyond child cycle and cancel); supersedes the "budget never resets" wording of spec principle 2 (see 6.1).
- **Buys:** removes the costliest path in live run 1, a new paid developer run from base for a one-line disagreement.
- **A-113 fit:** these are capabilities on human stages. Whether a workflow offers them is policy.

### P2. Flip the three defaults set before the sandbox (Impact 5, Confidence high, Effort M)

- **What:**
  1. The claude developer runs the job's declared checks by default (A-112 item 11 makes it opt-in).
  2. Reviewers, at least the adversarial one, may run commands inside their bwrap sandbox, with no network and the checkout read-only (reverses A-030).
  3. An adversarial FAIL counts only with a repro script the controller runs at the SHA (A-112 item 10). Otherwise it is advisory.
- **Why now:** A-030 (2026-10-16) removed `Bash(npm test)` from reviewers when they ran *unsandboxed*. 08-d put reviewers in bwrap a day later. The claude developer's four git subcommands date from 05-a, before 08-c. pi's developer already has an unscoped shell in the same sandbox (`cli-adapter.ts:321`). That shows the sandbox, not the allow list, is what bounds the run. It also means the same role gets different powers by runtime, against D-002.
- **Reverses:** A-030; A-112 item 11's "off by default".
- **Buys:** the developer gets backpressure inside its loop; the adversary can show, not argue; false FAILs drop (`deep-research.md:31`: running the reviewer's own fix against tests cut false rejection from 54.8% to 16.3%).
- **A-113 fit:** the default changes; the tool lists stay workflow data.

### P3. A red check gets one fix round in the default workflow (Impact 4, Confidence medium-high, Effort S after A-108's primitive)

- **What:** `VERIFYING: FAIL → DEVELOPING` (fix run with the failed checks), budget 1, then ESCALATED.
- **Reverses:** A-108 item 2 ("the default workflow keeps `VERIFYING: FAIL → ESCALATED`"), and the source's VERIFY → ESCALATED edge (`source-v0.3.md:358`).
- **Evidence:** every surveyed loop does this (Aider 3, Goose `max_retries`, no-mistakes per-step fix budget, Attractor `retry_target`, Superpowers up to 5; `harnesses.md:45-62`). The owner deferred it to "tune from run logs". Under P2, a red check is rarer, so one round costs little.
- **Confidence:** medium-high rather than high, because the owner has a stated preference to wait for logs.

### P4. Decide O-006 (daemon or foreground) before drafting row 11 (Impact 4, Confidence medium, Effort S to decide, M to build)

- **What:** decide whether the factory has one long-lived process that reconciles and hosts observers, or stays a command per run.
- **Why:** row 11's tickets (driver entry point, `layout`, replay, `recover`; A-112) assume a command run on restart. Row 12's sync, A-113's dispatch gate and watchdog, and row 13's pools each need something periodic. Symphony, no-mistakes, T3 Code and firstmate all run a daemon or supervisor that reconciles on start (`harnesses.md` table).
- **Decision implied:** O-006's "Needed by" moves from "Integration" to "before row 11".
- **A-113 fit:** the daemon is a capability; what it schedules is policy.

### P5. One "current rules" page; repair the contradictions (Impact 3, Confidence high, Effort S)

- **What:** a page (or the spec's Principles section) that states every rule now in force, each with its decision ID. Then:
  - update `baseline.md:15,18`, spec principles 2 and 3, and plan row 11 to match D-023, A-105, A-108 and A-109;
  - close O-001 (answered by row 3, A-019) and O-014 (answered by the first research pass, `docs/research/2026-10-20/README.md`);
  - mark the "pending review" lines in `parked.md` as done;
  - bring the spec up to row 10: grants, command `run`, `network` and the observation stream are not in it (spec line 3 says "rows 1 to 9", line 25 still says a command stage "runs the job's declared checks").
- **Also:** move merge and waiver records (about half the A-entries) into ticket logs and merge-commit messages, so `decisions.md` holds decisions.
- **Reverses:** nothing. It changes how A-049 and "latest entry wins" are used.
- **Buys:** the next session reads 1 page, not 691 lines; contradictions become visible at write time.

### P6. Replace ad hoc waivers with a written review tier for the process (Impact 3, Confidence high, Effort S)

- **Why:** since row 9 the 2+1 rule has been waived or cut short on almost every ticket:
  - waived: 09-a to 09-d, 04-f, 08-g, 06-d, 07-e, learn-refresh (A-058, A-060, A-063, A-069, A-071, A-073, A-092);
  - fixes merged unreviewed: 10-b, 10-c, 10-e, 10-d, 10-f (A-077, A-080, A-082, A-086, A-090);
  - in-session reviews with no adversarial: the ten sweep branches (A-095 to A-104).

  The owner-run `npm test` (`workflow.md:47`) has not run since row 8.
- **What:** write down the tiers the owner already uses. Seams that hold trust (store, controller, sandbox, grants, git over candidate trees) get 2+1 through `claude -p`, with probes. Refactors, docs and the guide get one in-session review. The independent test run becomes a `pre-merge-commit` git hook in the owner's checkout. It runs `npm test` in a clean worktree at the merge SHA and needs no owner effort, since the owner merges locally with `--no-ff`.
- **Severity:** reviewers mark a missing test for correct code as "minor", not "major" (10-b, 10-c and 10-e majors were test gaps).
- **Reverses:** narrows `AGENTS.md:15` and `workflow.md:47-53` to the tiers; source §07's "policy-driven exemptions" (`source-v0.3.md:389`) already proposed this for the product.

### P7. A counterweight to A-113: a second real user before an extension point (Impact 3, Confidence medium, Effort S)

- **What:** add to A-113: "build the extension point when a workflow or extension the owner actually runs needs it; until then, the default is plain code." This mirrors "zero dependencies until a test needs one".
- **What else:** freeze or cut `learn/`. Its stand-ins copy `src/` by hand and drift (A-112 item 7; `HANDOFF.md:88-90`); A-050 already says it can be cut.
- **Evidence:** Symphony's non-goal "general-purpose workflow engine". The preflight refuses workflow shapes that `checkWorkflow` accepts (spec line 97), so the engine is more general than anything that runs. A-078's accepted risk exists only because of an extension point (repository workflows as code).
- **Widens:** A-113, A-054.

### P8. Make the model dimension real, and reach other vendors through one protocol (Impact 3, Confidence medium, Effort M)

- **What:** a role → runtime → model map with per-stage override (Attractor's model stylesheet), recorded on every run. Then an Agent Client Protocol (ACP) runtime adapter, which no-mistakes, gnhf and T3 Code use to reach many agents through one adapter (`harnesses.md` table).
- **Why:** D-002 and the baseline say "runtime, model and role are independent". Today model does not exist and runtime is two hand-written CLI specs. Codex and Copilot (`source-v0.3.md:43, 290-294`) are absent.
- **Confidence:** medium; ACP's coverage of claude and pi in headless mode is unverified here.

### P9. Holdout acceptance checks as the gate that counts, by default for done-when lines the owner marks (Impact 3, Confidence medium, Effort M)

- **What:** an owner-held check kept outside the candidate, plus a protected-path check, as the *default* gate for done-when lines the owner marks.
- **Evidence:** StrongDM ("lazily rewritten to match the code"); ImpossibleBench ("hiding tests ... reduces cheating success rate to near zero", `deep-research.md:49`).
- **Reverses:** narrows A-107's "visible by default" to "visible unless the ticket marks a done-when line as held". The owner chose visible tests from current preference and has not yet seen run logs. This is a softer ask.

### P10. A remote for the factory repository (Impact 3, Confidence high, Effort S)

- **What:** a private remote, push only; no CI deploys anything.
- **Why:** a disk failure today loses the code, 113 decisions and every ticket log. A-052 already plans GitHub as the code host.

### P11. Dogfood (Impact 5, Confidence medium, Effort L, after P1, P2 and row 11)

- **What:** run the factory's own Fast tickets through `main.ts` with the default workflow. Keep `claude -p` 2+1 by hand only for trust-holding seams (P6).
- **Buys:**
  - real escalation data for O-011, cost data for O-007 and prompt data for O-013;
  - VERIFYING as the independent test run;
  - the end of `workflow.md:3`'s "until the controller can run it".
- **Cost:** row 11 must land first, or a crash strands a ticket.

## 6. Challenged decisions

### 6.1 Contradictions the record does not flag

1. **Spec principle 2 vs A-109(B).** `core-lifecycle-v1.md:12` lists "Budget already spent stays spent" among "Core rules, which no workflow can switch off". `workflow.md:53` says "Spent budget does not reset". A-109(B) (`decisions.md:84`): an owner overrule "refunds the budget the FAIL spent". The source allows an owner-authorised reset (`source-v0.3.md:483`), so A-109 is defensible. The spec's core rule must change to "only an owner command, recorded, resets budget". Today it says the opposite.
2. **Spec principle 3 vs A-108.** `core-lifecycle-v1.md:13`: "There is no automatic retry of a quality gate" as a core rule. A-108 builds the primitive so that "a commit stage re-entered from a command stage's FAIL" runs a fix. That is an automatic retry of the check gate in any workflow that uses it. Either principle 3 becomes default policy, or A-108 is limited. P3 needs principle 3 moved.
3. **`baseline.md:15` and `:18` vs D-023.** The baseline still lists "Two standard reviews and one adversarial review per cycle" and "Humans accept PRs ... No automatic merge" as *invariants*. D-023 (A-054) made both default policy, and A-074 Q6a lets an observer run `accept` ("would allow me to auto approve things that were only comments"). The baseline was never updated.
4. **A-054's engine guarantee "the controller itself never merges or deploys" vs grants plus observers.** Live run 3 ran a MERGE grant stage that the controller spawned with the token (A-087). A-074 Q6a lets an observer accept. Once the "grant after human stage" gap (`HANDOFF.md:71`) is closed, observer-accept followed by a merge grant stage is an automatic merge, with the controller doing every step but the `git push`. The guarantee needs restating as "a merge happens only through a grant the owner gave in personal or job config", which is what is actually enforced.
5. **Plan row 11 vs A-105.** `docs/plan.md:17` says the controller resolves stranded cycles "per source §06". §06 says "Infrastructure retry: idempotent retries with backoff" and "create a fresh run with durable context, and limit restart churn" (`source-v0.3.md:341-342`). A-105 withdrew relaunch for row 11 but left the row pointing at §06.
6. **D-002 vs the runtime specs.** "Runtime, model and role are independent". The developer role is a scoped allow list under claude (`cli-adapter.ts:311-314`) and an unscoped shell under pi (`:321`), and model is not selectable (A-113). The 05-a ticket recorded this as a limit, never as a D-002 conflict.
7. **Source §08 and `workflow.md:49` vs A-030.** The source's adversarial reviewer "execute[s] relevant tests" (`source-v0.3.md:408`). The process's own adversarial reviewer is told to "run the tests, feed bad inputs". The product's has Read, Glob and Grep only. A-030's reason (an unsandboxed reviewer) ended with 08-d.
8. **D-016 vs the adversarial-driven hardening.** D-016: "Edge-case semantics are added only when a test or a real incident requires them". The adversarial probes count as "a test", so every probe-backed edge case qualified: a 3 GB string (04-c), PATH_MAX chains (08-b, 08-c), FIFOs in a gitlink (08-e), non-UTF-8 names (08-d). A-023 ("accept it here and move on"), A-037 and A-042 show the owner pushing back, case by case. D-016 needs the A-037 threat order written into it: no incident and no damage by mistake → park, do not fix.
9. **A-016 vs A-054 and A-055.** A-016: "I'd much rather go back to our simpler base and let it run implementation rather than just theorizing". Three days later, rows 9 and 10 built a general engine and extension host before recovery. A-055 reversed A-052's "recovery first" and said so; the conflict with A-016's spirit is not said. This is the owner's call to make, but it should be made knowingly (section 6.3).

Smaller drift:
- O-001 is still open though row 3 answered it (A-019).
- O-014 is gated "before O-011 and O-013" though the first pass was that survey.
- O-016 is "answered" yet still listed.
- `parked.md` lines 28-42 still say "pending review" for merged 08-d work.
- The spec says it describes rows 1 to 9 (line 3) while `AGENTS.md:7` calls it "the spec".

### 6.2 Decisions whose reason no longer holds

| Decision | Reason then | Why it no longer holds | Action |
|---|---|---|---|
| A-030 (reviewers read-only, `Bash(npm test)` withdrawn) | Reviewers ran unsandboxed | 08-d put reviewers in bwrap | Reverse (P2) |
| 05-a / A-026 claude developer allow list | No sandbox around the clone | 08-c sandboxed the developer; pi runs unscoped in the same sandbox; live run 2 failed on the list | Flip default (P2; challenges A-112 item 11's "off by default") |
| A-108 item 2 (default red check escalates) | "Tune from run logs" | No developer could run checks, so the first signal was VERIFYING; with P2 the loop is cheap | Reverse (P3) |
| workflow.md step 3 (owner runs `npm test`) | The implementer's claim does not count | Owner has not run it since row 8; the rule stands only as recorded waivers | Replace with a pre-merge hook (P6) |
| `workflow.md:3` "run by hand until the controller can run it" | The controller could not run it | Live run 3 reached AWAITING_ACCEPTANCE | Dogfood once row 11 lands (P11) |
| A-043 (lift scratch-only with network and credential gaps open) | Owner accepted both gaps | Grants (10-e) now put tokens into networked stages; A-106 closes loopback but not egress; the domain proxy line in `parked.md` has no ticket | Security agent's area; flag that A-043's premise widened |
| A-072 (a dispute stops the cycle; overrule later) | Keep 07-e small | Live run 1 hit exactly this case | Build P1 before more live runs |

### 6.3 Over-building the evidence supports revisiting

- **A-054, A-055 and A-113 as a trio.** Each is reasonable alone. Together they built and now mandate extension points ahead of users:
  - registries, four configuration layers, grants, the observation stream, command-stage `run`, and JSON workflows and protocol versions to come;
  - meanwhile a crash still strands a cycle.

  Symphony refuses a general workflow engine (`SPEC.md:63`). no-mistakes fixes its core pipeline and lets repositories only add (`VISION.md:11`). Evidence for A-113: the owner wants to publish a strong core (A-054), and Pi and Attractor show that handler-style extension works. **Verdict:** keep A-113, and add P7's "second real user" rule and no-mistakes's "a repository may only strengthen" rule for the repository layer.
- **The decision log as a merge ledger.** 99 approval entries in six days; most entries after A-094 record a merge. Comparable projects keep ADRs for decisions and put approvals in the PR or merge commit (no-mistakes's `AGENTS.md` names owners per invariant instead of a log). P5.
- **`learn/` and `proto/`** (A-046 to A-050, A-091 to A-094): about 6,200 lines, outside the ticket process, with hand-copied logic that every `src/` change must follow. `baseline.md:30` lists "custom dashboard" as a non-goal, and source §05 says herdr is optional "without making it the factory dependency" (`source-v0.3.md:295`). A-047 says "the end goal will be having this run in herdr". The owner should decide whether herdr is a goal or an option; the two documents disagree.

### 6.4 Accepted risks whose reopen event has come or is close

| Row | Reopen when | Status |
|---|---|---|
| A-078 (a repository workflow runs unsandboxed in the controller) | "A workflow can be loaded as data" | A-111 schedules JSON workflows "soon" and requires repository workflows to be data. The reopen event is planned; close the row with that ticket, and do not leave the TypeScript path open beside it. |
| A-068 (every pi run can overwrite `auth.json`) | "A run damages the file" | A-068 itself lists "two pi runs refreshing at once" as not covered. Row 13 pools make concurrent refresh routine. Treat pools as the reopen event now. |
| A-099 (verify ignores git attributes) | "A repository the factory runs relies on `eol`, `ident` or LFS" | A-043 lets the factory run on any repository. The first real repository with LFS or `text=auto` CRLF content reopens it. Add a preflight warning when `.gitattributes` names a filter or `eol`, so the reopen event is detected, not discovered. |
| Parked 08-a note: domain filtering needs a proxy | "A later ticket after 08-c" | Grants (10-e) give tokens to networked stages; A-106's pasta does not filter egress. The event the note waited for has passed. |

### 6.5 Open questions that block more than they say

- **O-006 (daemon):** marked "Integration". It actually blocks row 11's design, row 12's sync, A-113's dispatch gate and watchdog, and observers that act unattended. Decide first (P4).
- **O-011 (budget exhaustion):** marked "before unattended runs". It blocks A-109(B), the dispute path that live run 1 hit, and any child-cycle work. Its "would settle it" asks for "a record of real escalations". The factory's own ticket logs already are that record: about 20 adversarial FAILs, and the owner's move on each (P1).
- **O-013 (prompts):** marked "before the first real repository's tickets". A-043 already allows real repositories, and `checkWorkflow` refuses role text longer than one line (`src/lifecycle.ts:289`). Every run today uses one-sentence prompts. It blocks run quality now.
- **O-007 (backpressure, cost):** it blocks unattended runs. A-111's run records give it data, but no cap is passed today.
- **O-014:** done in substance; close it, because its row still gates O-011 and O-013 on paper.

### 6.6 The vision rules, one by one

| Rule | For keeping it hard | Against | Verdict |
|---|---|---|---|
| **Controller decides state; agents return claims** (D-001) | Every serious system has one authoritative orchestrator (Symphony §2.1 "single authoritative orchestrator state"; Attractor's engine picks edges; no-mistakes: "agent confidence is not evidence"). The factory's adversarial history shows claims lie in practice. | Symphony lets the agent write tracker transitions itself; no-mistakes prefers instructions to guards (`VISION.md:44`). Both target trusted settings. | **Keep, hard.** Confirmed. |
| **Evidence binds to a SHA** | Confirmed everywhere (no-mistakes drops `live_validation` once the head moves; Copilot signs commits). | A-107's "run on base" and O-012's Design Studio produce evidence not about the candidate. A-105 already hashes the job. | **Keep, widen:** evidence binds to the SHA *and* the hashes of what judged it (workflow, checks, ticket, prompt), which the factory mostly records already. |
| **Fixed 2+1 review budget** | Caught real security bugs in the factory's own core. | SWR-Bench precision 16.65%; about two in three of the factory's own adversarial reviews failed, and the owner overrode every one; nobody else runs a dedicated adversarial pass (`harnesses.md:126`); no-mistakes: "never stacked"; the owner has waived it on most tickets since row 9. | **Already default policy (D-023); stop calling it an invariant** (baseline, AGENTS). Keep 2+1 for trust-holding seams; tier everything else (P6). In the product, require a repro for an adversarial FAIL to count (P2). |
| **Vendor-neutral** (D-002) | No vendor type in the core is real and cheap to keep. Two runtimes and the extension runtime path work. | Only two CLIs. Model is not a dimension. Roles differ by runtime. Linux, bwrap, systemd user scopes and soon pasta tie it to one OS family. | **Keep as a goal, not a claim.** Make model real and add ACP (P8). Say "Linux only" in the README until a second sandbox backend exists. |
| **Local execution** (P-005, A-035) | Owner constraint (resources, no cloud); privacy; matches no-mistakes ("a local tool for the person whose credentials ... are on the line"). | Cloud systems (Copilot, Devin, Cursor, Jules) get isolation and parallelism for free; pools on one resource-constrained machine will be tight. | **Keep.** Revisit only at pools (row 13), with measured memory per cycle (the sweep measured 562 MB of disk per cycle). |
| **Zero dependencies until a test needs one** (P-002) | The controller runs unsandboxed with the owner's credentials; supply-chain risk is real; Node 24 built-ins carry far. | The rule is already npm-only: bwrap, systemd-run, git and now passt (A-106) are system dependencies. Upcoming work hand-rolls schema validation three times: structured findings (A-109), JSON workflows (A-111), protocol versions. | **Keep, and say it is about npm runtime dependencies of the controller.** Write one small hand-made schema checker before A-109 and A-111, rather than three. |

## Unverified or guessed

- Sweep's pivot.
- Jules plan approval.
- CodeRabbit and Graphite behaviour beyond public docs.
- ACP's headless coverage of claude and pi.

The adversarial tallies (about 20 FAIL and 10 PASS) come from ticket logs and decision entries. The count may be off by one or two where a log line is ambiguous (08-f).
