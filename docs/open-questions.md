# Open questions

What the owner has not decided yet. When a question is decided, record the quoted answer in [decisions.md](decisions.md) and remove its row here; if it creates work, the work goes on the [plan](plan.md). Review findings tied to a ticket go in [work/parked.md](work/parked.md), not here.

O-001 to O-010 moved here from `decisions.md` on 2026-10-18; the IDs are unchanged. Questions with a section below carry the research behind them: why it matters, what is true today, and what would settle it.

| ID | Question | Needed by |
| --- | --- | --- |
| O-005 | Default quality checks per repository type; who may waive; how each "done when" line gets verification the developer cannot edit ([below](#o-005-independent-verification-of-done-when)) | First real repository |
| O-006 | Foreground process or daemon. (Remote and merge mechanism decided in A-052: the owner merges on the code host, and the next sync records it.) A-122: no daemon now; the owner's long-term goal is a daemon, for example one on a VM serving another computer. Revisit when a tracker needs webhooks pushed to a listening socket, a UI must update faster than a poll, or pools make the one-second watch too costly | First of: webhooks, a live UI, pools, a remote host |
| O-007 | Backpressure: max outstanding PRs, cost and time limits | Before unattended runs |
| O-009 | Staging and deployment ownership | Release tracking |
| O-010 | How an owner's answer to an agent in its herdr tab becomes evidence the reviewers can see ([work/herdr-findings.md](work/herdr-findings.md)) | The herdr frontend |
| O-011 | What a cycle that runs out of review budget should lead to: what a child cycle inherits, and when the owner rewrites the ticket instead ([below](#o-011-what-to-do-when-a-cycle-runs-out-of-review-budget)) | Before unattended runs |
| O-012 | Whether and when the Design Studio gets a plan row, and which part comes first ([below](#o-012-the-design-studio)) | After plan row 11 (recovery) |
| O-013 | The initial prompt for each role, the skills each role gets, and how a run records which versions it used ([below](#o-013-role-prompts-and-skills)) | Before the first real repository's tickets |
| O-015 | Acceptance evidence (A-051): which tickets need it, which artifact type comes first, and when it gets a plan row ([below](#o-015-acceptance-evidence)) | When the stage gets a plan row |
| O-017 | Which stages a grant stage requires. The default (11-d2): an owner move may not jump (enter a stage other than the one the cycle escalated from) past a stage whose last outcome is a FAIL (review verdicts, command stages' checks, the owner's `request_changes`) on the way to a grant stage, unless an owner accept came after the FAIL; paths the workflow declares from a FAIL run. A workflow key could relax it: a stage marked advisory (for example `blocking: false`), or a grant stage naming the stages it needs (for example `requires: ["SECURITY_REVIEW"]`). Until then a project that differs accepts each FAIL with risk. Build the key when a workflow the owner runs needs it (A-124) | The first workflow with an advisory review, or a grant stage that needs only some reviews |

## O-005 Independent verification of "done when"

Raised 2026-10-18, guide walkthrough.

**Why it matters.** The controller judges a check by its exit code alone, on the exact candidate SHA. That is deterministic, but the checks usually run the candidate's own tests, which the developer wrote. PASS shows the code agrees with its own tests, not that it does what the ticket asked.

**Today.** Checks are argv lists in the job file (`Check` in `src/verify.ts`); the owner declares them, so the developer cannot remove them. Reviewers read the diff and the evidence and are the only judge of test quality. Untested: a check that runs owner-held tests from outside the candidate, readable through the job's `sandbox.read`.

**Would settle it.** The design asks that each "done when" line name an independent verification method (source §04, "Definition of Ready is risk-aware") and that quality profiles set required checks per risk tier (source §09, "Quality profiles and independent gates"; defaults OPEN in §15). Decide whether owner-held acceptance tests become standard, prove the `sandbox.read` route with a test, and decide who writes those tests.

**Partly settled (A-107).** Tests stay visible in the default workflow; hiding them is a workflow choice for later, made from run logs. The route is a `{ file }` argument from a `workflowDir` outside the repository, not `sandbox.read`. Still open: who writes acceptance tests, and the "run on base" primitive.

## O-011 What to do when a cycle runs out of review budget

Raised 2026-10-18, guide walkthrough.

**Why it matters.** The budget is the factory's brake: two standard reviews and one adversarial review per cycle, then stop. Most agent pipelines set a budget like this. Few say what a good next move is once it is spent, and the factory's answer decides how much owner time an escalation costs.

**Today.** A second standard FAIL or any adversarial FAIL moves the cycle to ESCALATED (`src/lifecycle.ts`, `case 'verdict'`). The owner has two moves in `src/main.ts`: `cancel`, or run the job again with `parentCycleId` to open a child cycle with a fresh budget. The child starts from a new clone at `job.base` with the ticket alone; the parent's findings and branch are not carried over (`src/developer.ts`). Source §15 lists "Post-human revisions" as OPEN: when a fresh cycle and budget may be authorised, and who authorises a budget reset.

**Would settle it.** A survey of how other agent pipelines and human code review handle repeated rejection; a record of real escalations from this factory (cause, owner's move, outcome); then an owner decision on what a child cycle inherits and when the owner should rewrite the ticket instead.

## O-012 The Design Studio

Raised 2026-10-18, guide walkthrough.

**Why it matters.** The factory starts at a READY ticket. The design puts a Design Studio before it: intake, exploration, prototypes, an approved spec, and its split into tickets (source §03). Ticket quality limits everything downstream, O-005 included.

**Today.** Not built and on no plan row; row 13 covers source §§6, 11 and 13. Tickets are written by hand under [workflow.md](workflow.md).

**Would settle it.** An owner decision on whether and when the Design Studio gets a plan row, and which part to build first.

## O-013 Role prompts and skills

Raised 2026-10-18, guide walkthrough.

**Why it matters.** Every developer and reviewer run starts from the role prompt. What a reviewer looks for, and how hard the adversary tries, comes from that text and from whatever skills the runtime has. The budget and the checks only bound the runs; the prompts decide their quality.

**Today.** Each prompt is a template string written by the implementer session to fit its ticket: `prompt()` in `src/developer.ts` (ticket 05-a) and `buildPrompt()` in `src/review.ts` (ticket 06-b). Most of the text is the contract the controller parses: the rules, the fenced json claim or verdict, the SHAs, and delimiters hardened by adversarial reviews. The judgement each role is asked for is about one sentence. No run is given skills, and the prompt carries no version, so a finding cannot be traced to the wording that produced it. Source §05 ("Portable skills and repository instructions") plans a versioned SKILL.md library: reusable skills for implementation, normal review, adversarial review and evidence collection, kept apart from project conventions. Source §08 asks that skill and policy versions be stored with each run.

**Would settle it.** Two answers, each from a survey of published practice and a trial on this factory's own tickets:
1. The initial prompt for each role: developer, fix run, standard reviewer, adversarial reviewer.
2. The supplementary skills each role gets, and how a run records which prompt and skill versions it used.

Inputs from the 2026-10-20 research (A-110; `docs/research/2026-10-20/harnesses.md` finding 5): no-mistakes's reviewer lines ("construct at least one concrete input or state and trace it"; "report a finding only when you can construct a concrete sequence that occurs during the change's intended usage"; one finding per broken invariant; a simplification pass; "prior findings and fix summaries are claims, not evidence"). Also to decide: whether a re-review after a fix sees the earlier findings, labelled as claims, and answers ADDRESSED or NOT ADDRESSED for each, with the adversarial reviewer kept cold (the session's recommendation).

Constraint from A-100: any instructions, prompts or skills a repository supplies are read from the base, never the candidate, as AGENTS.md is for reviewers since sweep-reviewer-instructions. Otherwise a candidate rewrites the rules it is judged by.

## O-014 Survey: skills libraries, harnesses and other factories

Raised 2026-10-18, guide walkthrough. **Answered** (A-125) by the two research passes, `docs/research/2026-10-20/` (`harnesses.md`) and `docs/research/2026-10-20-foundations/`. Kept for the reasoning.

**Why it matters.** The factory's flow was designed from first principles in the source document and built ticket by ticket. Nobody has compared it with what others have built for the same job. O-011, O-005 and O-013 each ask one part of this question; the survey asks it for the whole.

**Today.** The source says the owner's current workflow uses "Superpowers-inspired skills" coordinated through herdr (source §01). No survey of other work is recorded.

**Would settle it.** A written survey of three groups:
1. Popular, well-regarded skills libraries: which skills they provide, and what those skills say.
2. Agent harnesses: how they structure roles, prompts, verification, review and failure.
3. Other software factories, meaning systems that take a ticket to a reviewed change: their stages, gates, budgets and what they do on failure.

For each group, two outputs: what to borrow for O-013 (prompts and skills), and whether our flow (develop, verify, standard review, adversarial review, owner acceptance) is the right one or could be improved. Findings that would change the flow go to the owner as proposals.

## O-015 Acceptance evidence

Raised 2026-10-19; design agreed in A-051, building it parked.

**Why it matters.** The checks and reviewers judge the code. Nothing yet shows the owner that the change does what the ticket asked: a video of a UI change, a screenshot, a recorded command or test run. This is also part of O-005's answer: the verification agent works from the ticket alone, apart from the developer.

**Today.** Not built. A cycle goes from ADVERSARIAL_REVIEW PASS straight to AWAITING_ACCEPTANCE (`src/lifecycle.ts`), and the owner sees the `main.ts` output and the branch.

**Would settle it.**
1. Whether every ticket needs acceptance evidence, or the ticket names it (source §04's `verification: [unit-tests, browser-demo]`; a backend-only fix need not produce screenshots).
2. Which artifact type comes first: browser video and screenshots, or a recorded command or test run. Browsers in bwrap need a probe first.
3. When it gets a plan row, and whether GitHub sync comes before it so the artifacts have a PR page to go on.

## O-016 Workflow definition and extension host

Raised 2026-10-19; principles agreed in A-054. **Answered:** items 1 and 2 in A-056, items 3 to 6 in A-074 (D-024). Kept for the reasoning; the decisions win where they differ.

**Why it matters.** A-054 makes the stages, steps, budgets, human acceptance and merging user-definable, with today's lifecycle as the default workflow. The core keeps its promises only if the engine can check a user's workflow against them before it runs.

**Today.** The workflow is hard-coded. `src/lifecycle.ts` fixes the `Stage` list, the transitions and `STANDARD_LIMIT`; `src/run.ts` fixes the order develop, verify, review, review. Seams are TypeScript interfaces chosen by name in `src/main.ts` (`'claude' | 'pi'`, `'bwrap' | 'none'`). No extension can be loaded, and no observer can read the event stream.

**Would settle it.**
1. The workflow format: a TypeScript module that exports the definition, or data the engine reads. How the step kinds (agent run, controller command, human decision, extension step) and transitions keyed on outcomes are written.
2. How the engine checks the guarantees at load time, for example a finite budget on every agent loop, and a verdict step that must name a SHA. SC-01 to SC-19 must pass unchanged against the default workflow.
3. The extension protocol: JSON over stdin and stdout, run in the sandbox; the TypeScript helper; a contract test kit per seam; how a run records extension versions.
4. Grants for outward effects. A merge or deploy extension needs code-host credentials, which A-052 keeps with the controller. Decide how a workflow grants a capability to an extension, and how a merge is bound to the accepted SHA.
5. The observation stream: how observers get events (read the event log, or a push from the controller), and how a reaction comes back as a claim or command.
6. Configuration layers: factory defaults, personal, repository, job.
Items 1 and 2 answered in A-056. Plan order decided in A-055: the engine (row 9) and the extension host (row 10) before recovery (row 11).
