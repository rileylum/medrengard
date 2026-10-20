# Decision register

DECIDED = source direction or a recorded owner reply. PROPOSED = recommendation. OPEN = unresolved. Latest entry wins. An owner approval is a quoted reply with a date; never invent one.

## From the source (v0.3)

| ID | Direction | Source |
| --- | --- | --- |
| D-001 | Deterministic controller; agents supply reasoning and results, not transition authority | §§1–2, 6 |
| D-002 | Vendor-neutral core; runtime, model and role are independent; personal and corporate domains separate | §§1, 5, 15 |
| D-003 | Two standard reviews and one adversarial review per cycle; stop on terminal failure; adversarial FAIL escalates immediately | §7, 15 |
| D-004 | Explicit human final acceptance and approval of design and governance changes | §§2–3, 10–12 |
| D-005 | Full risk-tailored SDLC; no automatic production deployment initially | §§1, 13, 15 |
| D-006 | Pools: three developers, two or three reviewers, one adversarial run at a time | §§1, 6 |

## Owner decisions

| ID | Status | Decision |
| --- | --- | --- |
| P-001 | DECIDED (A-001) | Markdown contracts and manual stage advancement until the controller replaces them |
| P-002 | DECIDED (A-001, A-016) | TypeScript core, SQLite state. Node 24 built-ins only; no dependencies until a test needs one |
| P-005 | DECIDED (A-001) | Run locally; corporate execution separately authorised |
| D-007 | DECIDED (A-001) | First runtimes: Pi and Claude Code |
| D-016 | DECIDED (A-016) | [Core lifecycle v1](specs/core-lifecycle-v1.md) is the implementation baseline. One recovery rule: anything unclassified escalates; owner chooses child cycle or cancel. Edge-case semantics are added only when a test or a real incident requires them |
| D-017 | DECIDED (A-016) | Design documents are not put through adversarial review on their own. The 2+1 rule applies to code with executable tests |
| D-018 | DECIDED (A-017) | Plan steps are broken into Fast or Design tickets and delivered per [workflow.md](workflow.md) |
| D-019 | DECIDED (A-035) | Candidate code runs inside a sandbox chosen by backend name. Bubblewrap first; Docker, VMs and cloud later behind the same interface. No VM or cloud backend for now; the tool stays agnostic |
| D-020 | DECIDED (A-042) | Malicious code stays in scope, but the defences need not be airtight. Each adversarial finding is weighed by risk, and the recommendation can be a merge with the risk accepted. An accepted risk is recorded in [work/accepted-risks.md](work/accepted-risks.md) |
| D-021 | DECIDED (A-043) | The factory may run on any repository, not only scratch ones. Runs keep full network access and can read their own CLI's credentials |
| D-022 | DECIDED (A-052) | Task tracking and source control are separate seams, `Tracker` and `CodeHost`, each chosen by adapter name in the job file. GitHub first; Linear, GitLab and others behind the same interfaces. Providers report; the controller decides |
| D-023 | DECIDED (A-054) | Strong core, swappable modules with good defaults, user extensions. The core is the event log, the engine, the controller, run supervision, SHA binding, an observation stream and an extension host. Stages, steps, budgets, human acceptance and merging are a user-definable workflow; today's lifecycle is the default. Extensions run as separate processes speaking JSON over stdin and stdout, TypeScript first. Supersedes D-004 and spec principle 5 as fixed rules: both become default policy |
| D-024 | DECIDED (A-074) | Extensions take two shapes. A custom step is a command stage that names its own commands; there is no separate extension step kind. An observer is any process that reads the event stream and acts through the owner's commands. The JSON-over-stdin-and-stdout protocol is kept for runtime adapters. Grants are asked for by a workflow and given only by the owner's personal or job configuration. Configuration comes in four layers; the repository layer is read at the base SHA and cannot give grants or turn the sandbox off |

## Open

Open questions, O-001 onwards, are in [open-questions.md](open-questions.md).

## Approval history

### A-093 — 2026-10-20 — learn-refresh is READY; build all five batches without stopping

Owner, after reading the learn-refresh ticket: “Okay, go ahead and do this work by yourself this is an experimental feature not really important to the core. So you don't need my input as you go through the process. Report back to me when you've completed the 5 batches.”

Effect: [work/learn-refresh.md](work/learn-refresh.md) is READY. The implementer builds batches 0 to 4 without a walkthrough between them, and reports when all five are done. The owner's walkthrough happens after that. It replaces the walkthrough after each batch in A-092.

### A-092 — 2026-10-20 — The guide gets a ticket; the owner walks through it instead of reviews

Owner, asked whether the guide goes through the ticket workflow and whether reviews apply: “Yes ticket, I don't think we necessraily need a review - I can just do a manual walk through. Lets walk through the decisions needed for the design doc. One small critique of the original was that it did feel quite repetitive across the pages”.

Then, on the seven design questions (what felt repetitive, the room list, the naming clash, demos for the new code, the simulator's scope, the order of work, what is out of scope): “1. Yeah its both, but also that we have the step through the workflow format in lots of them, that might be the best way but its a bit samey so either swapping up the method for how we showcase the features or making sure they are hyper focused when its not the generic whole picture page would help. 2. Yep keep the number small, as much as practical 3. Go with your recommendation 4. sure 5. Yep I think thats probably fine 6. Sure 7. Yep”.

Effect: the work is the Design ticket [work/learn-refresh.md](work/learn-refresh.md). It replaces A-050's "outside the ticket workflow" for this work. It has no standard or adversarial reviews; the owner walks through each batch in a browser. The design note follows the answers: only the simulator steps through a cycle, each room shows one feature in its own way, each rule is said once, and the guide keeps few rooms. The process room is renamed so that "workflow" names the engine. The ticket is not READY until the owner has read it and said go.

### A-091 — 2026-10-20 — Next: fix and expand the guide

Owner, after 10-d merged and row 10 was complete, asked what comes next: “Okay, the next thing I'd like to do is fix the learn page - both by actually fixing but expanding it to the new architecture and features”.

Effect: the next work is `learn/`, ahead of row 11. Make `npm run test:learn` pass again, and add what the guide does not yet cover. That is everything since 09-a: the workflow engine, prompt versions, registries, configuration layers, command stages, grants and the observation stream. Branch `feat/learn-refresh` is made from main at `d48c8d9`. A-050 keeps `learn/` outside the ticket workflow. Whether this work gets a ticket and reviews is not yet decided.

### A-090 — 2026-10-20 — 10-d: fix the review findings, then merge

Owner, after standard 1 and the adversarial review both passed on `05b550a` with three minors and two notes, offered a fix of all five tests first, the busy timeout on `openings()`, and a merge without another review: “fix and merge”.

Effect: the reader waits for the events table, not only the file; `source` is one single-line rule, checked by `SHAPE` and the CLI; the kit sends its unknown row after each case's events too; the reader skips an open row that is not an object; `openings()` sets a busy timeout. Tests first. Then `feat/10-d-observation-stream` merges into main with `--no-ff`, unreviewed after the fixes.

### A-089 — 2026-10-20 — 10-d: run the reviews

Owner, after 10-d was built at `05b550a` and asked to run `npm test` or waive it, and to run or waive the reviews: “run the reviews”.

Effect: standard 1 starts on `05b550a`. The owner gave no answer on running `npm test`; no owner-run result is recorded, and the reviewers' own runs are the independent ones.

### A-088 — 2026-10-20 — 10-d READY; observation stream design approved

Owner, after reading the 10-d ticket and [design/2026-10-20-observation-stream.md](design/2026-10-20-observation-stream.md) with its six questions: “take all”.

Effect: 10-d is READY, and the design note is approved with Q1 to Q6 as recommended. Q1: a line's `seq` is the row's store-wide position (`pos`), not its per-cycle number. Q2: rows written before 10-d get a position in `(cycle_id, seq)` order and a null `at`. Q3: the open row records the workflow's definition, so a runs directory replays without a job file; pre-10-d custom-workflow cycles print null stages unless the job file is given. Q4: `accept` and `cancel` take `--source <name>`, defaulting to `owner`. Q5: `observerKit` takes scripted cycles and expected actions, plus two fixed cases (an unknown event, a refused command). Q6: `proto/board.ts` stays as it is.

### A-087 — 2026-10-20 — Live run findings recorded in the plan; merge

Owner, after live runs 1 and 2 escalated (a reviewer misread a silent check's `exit 0`; a developer could not commit, likely through a denied `$(cat …)`), on recording the gaps: “lets capture this in the plan - we already have two sections that are relevant, skills and montioring and self improvement”. After run 3 reached AWAITING_ACCEPTANCE with the MERGE grant stage passing: “accpepted and merged, merge live-run-fidnings into main”.

Effect: `docs/plan.md`'s rows for role prompts and skills and for the improvement loop name the three gaps: the developer contract does not list the allowed git commands; the reviewer prompt does not show a check's command; a run keeps none of the runtime's raw output. `docs/live-run-findings` merges into main with `--no-ff`. Live run 3's cycle is accepted, and its head merged into the scratch repository by the owner.

### A-086 — 2026-10-20 — 10-e: fix the adversarial findings, then merge

Owner, after 10-e's adversarial FAIL on `79220e4` (one major: a grant file beside the claude or pi binary is readable by the agents' sandboxes; three minors: no test of the head gate's PASS-for-this-head rule, `head.stdout` redacted after JSON quoting, overlapping values partly left in clear) and the recommendation to fix all four tests first, trim `\r\n` from a grant value, add the child-argv and cwd-config warnings to the design note, then merge without another review, as for 10-b and 10-c (A-080, A-082): “fix and merge”.

Effect: the fixes go on `feat/10-e-grants`, tests first, unreviewed. Then `git merge --no-ff` into main. On record: standard 1 FAIL on `231163d` (fixed at `818de56`), standard 2 FAIL on `818de56` (fixed at `79220e4`, A-085), adversarial FAIL on `79220e4`.

### A-085 — 2026-10-20 — 10-e: fix the standard 2 findings, then the adversarial review

Owner, after 10-e's standard 2 FAIL on `818de56` (one major: no test pins that `verify` keeps a grant's value out of bwrap's argv; three minors: overlapping values defeat redaction, a grant file under a system or runtime root is not refused, `tree.stdout` is not redacted) and the recommendation to fix all four tests first, also refuse `grants` on an agent stage and two grants with one variable in a stage, record the Q5 point against A-078's accepted risk, then run the adversarial review: “go as recommended”.

Effect: the fixes go on `feat/10-e-grants`, tests first, with no further standard review (the budget is spent). The A-078 row in `work/accepted-risks.md` notes that a repository workflow, run at import, could read a grant file, which Q5's refusal does not prevent. Then the adversarial review runs on the fixed head.

### A-084 — 2026-10-20 — 10-e: owner-run tests waived; run the reviews

Owner, asked to run `npm test` on `231163d` or waive it, and to run or waive the reviews: “run the reviews, don't worry about the tests (though we should do a live run soon)”.

Effect: 10-e carries no owner-run `npm test`; the implementer's run on `231163d` (374 tests, 350 pass, 0 fail) is labelled not independent in the review material. Standard review 1 runs on `231163d`, then the rest of the budget as `docs/workflow.md` sets it. A live run of the factory is wanted soon; not yet scheduled.

### A-083 — 2026-10-20 — 10-e READY; grants design approved

Owner, after reading the 10-e ticket and [design/2026-10-20-grants.md](design/2026-10-20-grants.md) with its five questions: “take all”.

Effect: 10-e is READY, and the design note is approved with Q1 to Q5 as recommended. Q1: a grant is `{ variable, file }` in the personal or job layer; the value comes from the file only and reaches the stage as that variable, through the spawn environment, never bwrap's argv. Q2: a workflow with a grant stage is refused under `sandbox.backend: none`. Q3: a grant stage runs only when each stage's last verdict, verification and `accept` is for the current head and at least one PASS verdict is for it; otherwise the cycle escalates before anything runs. Q4: a grant stage needs `run` and `network: true`, its FAIL can only escalate, and a missing or wrong `output/head` is a reserved `head` check that FAILs. Q5: a repository workflow may not ask for grants. These refine A-074's grants bullet; "an environment variable or a file" is read as where the value comes from.

### A-082 — 2026-10-20 — 10-c: fix the adversarial findings and the standard 2 minors, then merge without another review

Owner, after 10-c's adversarial FAIL on `69f402e` and the recommendation to fix on the branch and merge without another review, as for 10-b (A-080): “fix and merge without”, then, asked what “without” meant: “merge with out another review”.

Effect: four fixes on `feat/10-c-command-stages`, tests first, ending at `3e317b3`, with no further review. The adversarial major was a missing test: a repository file argument read at the base, not `HEAD`. The adversarial minor: `diff.patch` ignores the owner's external diff, textconv and colour. The standard 2 minors: a repository file argument must be a regular file in Git; the kit's writes case checks every file in the stage folder. Then `git merge --no-ff` into main. On record: standard 1 FAIL on `b97105f` (fixed at `69f402e`), standard 2 PASS on `69f402e`, adversarial FAIL on `69f402e`. The rule that a command stage's name must be a file stem was raised by both standard reviewers; the owner has not confirmed it, and it ships as built.

### A-081 — 2026-10-20 — 10-c READY; command stages design approved

Owner, after reading the 10-c ticket and [design/2026-10-20-command-stages.md](design/2026-10-20-command-stages.md) with its four questions: “Approved all recommendations”.

Effect: 10-c is READY, and the design note is approved with Q1 to Q4 as recommended. Q1: `run` entries are `{ name, command }`, not bare argv. Q2: a command stage's evidence, request, diff and file copies go in `evidence/<head>/<stage>/`, and `outputDir` is its `output/` subdirectory; the default workflow's evidence moves to `evidence/<head>/VERIFYING/`. Q3: a file argument is written `{ file: 'x.ts' }`, copied, hashed and bound read-only; a repository workflow's file is read at the base SHA. Q4: the reviewer sees every command stage's evidence for the head, not `output/`. These refine A-074's wording for `run` and `outputDir`.

### A-080 — 2026-10-20 — 10-b: fix the adversarial findings, then merge

Owner, after 10-b's adversarial FAIL on `38d38a6` (one major: no test that the repository layer's presence is checked at the base, not `HEAD`; three minors: a relative `XDG_CONFIG_HOME` or `HOME` resolves against the working directory, `accept` and `cancel` on a pre-10-b store fail closed when the tip adds a repository workflow, the job file's `runsDir` rule untested) and the recommendation to fix the major and the two cheap minors on the branch, park the pre-10-b store minor, then merge: “fix then merge”.

Effect: the major, the relative-path minor and the `runsDir` minor are fixed on `feat/10-b-config-layers`, tests first, with no further review (the budget is spent). The pre-10-b store minor goes to parked.md. The branch is then merged into main with `git merge --no-ff`, with standard 1, standard 2 and adversarial FAIL on record and their fixes unreviewed.

### A-079 — 2026-10-19 — 10-b: standard 2 findings fixed without another standard review, then adversarial

Owner, after 10-b's standard 2 FAIL on `2884bae` (one major, three minors) and the recommendation to fix all four on the branch and then run the adversarial review: “Next session we'll fix and run the adversarial before progressing”.

Effect: the four findings are fixed on `feat/10-b-config-layers`, tests first, with no third standard review (the budget is spent). The adversarial review then runs on the fixed SHA. Merge waits for the owner.

### A-078 — 2026-10-19 — 10-b READY; configuration layers design approved

Owner, after reading the 10-b ticket and [design/2026-10-19-config-layers.md](design/2026-10-19-config-layers.md) with its four questions: “take all recommendations and go”.

Effect: 10-b is READY and follows that note. Q1: the repository layer has an allow list (`checks`, `workflow`, `runtime`); every other key is refused there. Q2: a repository workflow is allowed, though it runs unsandboxed in the controller; the risk goes to [work/accepted-risks.md](work/accepted-risks.md). Q3: arrays replace the earlier layer's value whole. Q4: the store's open row records the resolved base SHA, and `accept` and `cancel` read the layers at it.

### A-077 — 2026-10-19 — 10-f: review minors fixed unreviewed, then merged

Owner, after 10-f's standard and adversarial PASS on `4775ac3` with two kit minors and a `claim: undefined` note, and the recommendation to fix all three on the branch without another review: “yes fix and merge”. Earlier, on the reviews: “review please, if you've already run the tests then I don't need to rerun”.

Effect: `6f86f0a` fixes the three, tests first: `runtimeKit` treats a null-prototype object as plain data, a test pins that it drops a nested undefined claim field, and it checks the union on the round-tripped outcome, so `claim: undefined` fails. No review covers `6f86f0a`. The owner did not run `npm test`; the implementer's run on `6f86f0a` (302 tests, 278 pass, 0 fail) is the record. The `adversarial_reviewer` kit case (standard 1 note) is not added: the ticket names only `standard_reviewer`. `feat/10-f-registries-fixes` merges into main locally with `--no-ff`.

### A-076 — 2026-10-19 — 10-a merged; its adversarial minors become 10-f

Owner, after 10-a's adversarial PASS on `bb40612` with four minors and the recommendation of a fix ticket before 10-b: “okay, file the fix ticket and merge”.

Effect: [10-f](work/10-f-registries-fixes.md) is drafted for the four minors and the `SHAPE` note; it is not READY until the owner says go. `feat/10-a-registries` merges into main locally with `--no-ff`. The owner did not run `npm test` on `bb40612`; the implementer's run (295 tests, 271 pass, 0 fail) and the two reviewers' matching runs are the record. 10-a carries standard 1 PASS on `22ae421` and adversarial PASS on `bb40612`.

### A-075 — 2026-10-19 — 10-a READY; registries design approved

Owner, after reading the 10-a ticket: “go”. Then, given [design/2026-10-19-registries.md](design/2026-10-19-registries.md) (a runtime registry in `src/runtime/registry.ts`; an extension runs as `node <module>` through `cliAdapter` with `CliSpec` gaining `input`, `bind` and `moduleHash`; `runtime` and `moduleHash` on every outcome event; a `BACKENDS` table in `src/sandbox.ts`; `runtimeKit` in `src/kits/runtime.ts`, imported by path): “approve”.

Effect: 10-a is READY and follows that note. A job-file runtime may not reuse a built-in name. The module is hashed once, when its adapter is built.

### A-074 — 2026-10-19 — Row 10 design answers (O-016 items 3 to 6)

Owner, after reading the handoff: “lets handle row 10”, the planned order (A-055). Offered seven answers for O-016 items 3 to 6, then worked examples of extension steps and of extensions that would not fit. Owner, concerned that extensions were being forced into one shape: “why not have an extension that simply listens in to the current state of a ticket and reports that out [...] OR what about some sort of discord notification bot that pings a user when we hit an escalation.” Shown that both are observers, not steps, and asked about the use of an extension step beside a workflow: “I'm a bit confused as to the utility of steps as extensions - when you could simply just write a different workflow.” Offered folding the extension step into the command stage, since a command stage already runs an argv in the sandbox at the candidate SHA: “Yes I think thats a much better place for these custom steps that run commands”. Offered the revised answers: “Okay I agree with your recommendations for 1, 2, 3, 4, 5, 7 and 8.” Offered the widened observation stream (Q6) and observers that run `accept` (Q6a): “Yes I like both, 6a would allow me to auto approve things that were only comments for example”.

Effect (D-024):
- **Custom steps (Q1 to Q3).** No `extension` stage kind. A command stage may name its own commands (`run: [[argv], …]`); with none it runs `job.checks`, so the default workflow is unchanged. The controller writes the step's context (cycle ID, work ID, stage, head, base, ticket, `diffFile`, `outputDir`) to a file and passes its path in `SF_REQUEST`; a TypeScript helper reads it. Each stage gets a writable `outputDir`, `evidence/<head>/<stage>/`. Network is off unless the stage sets `network: true`. Exit 0 is PASS, anything else FAIL. A run records the SHA-256 of each command argument that is a file next to the workflow. Contract test kits for command stages, observers and runtime adapters.
- **Runtime adapters (Q1, Q7).** The out-of-process protocol stays for runtimes only: one process per run, one JSON `RunRequest` on stdin, one JSON `RunOutcome` on stdout.
- **Grants (Q4, Q5).** A workflow asks for a grant on a command stage (`grants: ['github']`); only the personal or job layer gives it, mapping the name to an environment variable or a file. The secret reaches that stage's sandbox alone, with network; a test pins that no developer, check or reviewer sandbox sees it. A grant-holding stage runs only when every verdict and verification is for the current head. It writes the head it acted on to `outputDir/head`; a missing or different head escalates. The controller cannot stop a stage holding a token from misusing it; the rule makes a wrong merge visible and escalated.
- **Observation stream (Q6, Q6a).** Pull: `node src/main.ts events <job.json | runsDir> [--follow]` prints JSON lines `{ seq, at, cycleId, workId, event, from, stage, escalation }`. The store records a time on each row, outside the `Event`, so replay is unchanged. Observers act only through the owner's commands, and each command records its source. An observer may run `accept`; the source shows who accepted. The controller does not start observers. Reviewer runs record no start, so a stalled reviewer is not yet visible; row 11 adds that.
- **Configuration and registries (Q7).** Four layers, later winning key by key: factory defaults (code), personal (`~/.config/software_factory/config.json`), repository (`.factory/config.json`, read at the base SHA, never the candidate), job file. The repository layer may set checks, the workflow and runtimes per role; it may not give grants or set `sandbox.backend: none`. Runtimes and sandbox backends are chosen by name from a registry; built in are `claude`, `pi`, `bwrap` and `none`. The personal layer may add a runtime that is an extension module.
- **Named outcomes (Q8).** Parked. The change only adds names, so `PASS`/`FAIL` workflows keep working when it comes.
- Plan row 10's "done when" is reworded: a user's extension runs as a command stage, not as an extension step. Tickets: 10-a registries, 10-b configuration layers, 10-c command stages, 10-d observation stream, 10-e grants. Each becomes READY when the owner has read it and said go. O-016 is answered (items 1 and 2 in A-056).

### A-073 — 2026-10-19 — 07-e test and reviews waived; merge

Owner, asked to run `npm test` on `8362c1e`, run or waive the reviews, and decide the merge: “waive test and review. Merge”.

Effect: 07-e carries no reviews and no owner-run `npm test`; the implementer's run on `8362c1e` (283 tests, 259 pass, 0 fail) stands as the record. `feat/07-e-fix-without-tree-change` merges into main locally with `--no-ff`.

### A-072 — 2026-10-19 — 07-e design approved

Owner, after the 07-e design note and its three questions (approve cases 1 to 5 and the interface; should a dispute stop the cycle, with overruling as a separate ticket; is 2 KiB the right cut for the reason): “All looks good to me.”

Effect: [the 07-e design](design/2026-10-19-fix-without-tree-change.md) is approved as written. A same-tree fix that adds commits on top of the previous candidate is accepted; a `dispute` claim escalates with the developer's reason, cut to one line and 2 KiB; a dispute stops the cycle. Overruling a finding within the same cycle is not part of 07-e; it would be its own ticket, not yet drafted.

### A-071 — 2026-10-19 — 06-d test and reviews waived; merge; start 07-e

Owner, asked to run `npm test` on `e7eb056`, run or waive the reviews, and decide the merge: “waive test and reviews. Merge then lets start on 07-e”.

Effect: 06-d carries no reviews and no owner-run `npm test`; the implementer's run on `e7eb056` (276 tests, 252 pass, 0 fail) stands as the record. `feat/06-d-reviewer-commit-messages` merges into main locally with `--no-ff`. 07-e starts with its design note; no code until the owner approves the note.

### A-070 — 2026-10-19 — 06-d READY

Owner, after the handoff named 06-d then 07-e as next and neither READY: “go on 06-d”.

Effect: [06-d](work/06-d-reviewer-commit-messages.md) is READY and is implemented on `feat/06-d-reviewer-commit-messages`, off main at `7a3ca4e`. 07-e is still not READY.

### A-069 — 2026-10-19 — 04-f and 08-g reviews waived; merge row 9, 04-f and 08-g

Owner, asked to run or waive the reviews for 04-f and 08-g and whether to open a PR: “waive. Lets merge actually then we'll look at 06-d and 07-e in a new session (so we'll need to update the handoff after the merge)”.

Effect: 04-f and 08-g carry no reviews and no owner-run `npm test`; the implementer's run on `9fb570c` (272 tests, 248 pass, 0 fail) stands as the record. The repository has no remote, so the stack (09-a, 09-b, 09-c, 09-d, 04-f, 08-g) merges into main locally with `--no-ff`, as earlier merges did. Plan row 9 is done. 06-d and 07-e come next, in a new session.

### A-068 — 2026-10-19 — 08-g: pi's auth.json writable for every pi run

Owner, after the 08-g findings (the `.pi` overlay drops pi's refreshed OpenAI login; binding reviewers only does not fix it), offered three options (1, bind `auth.json` writable for every pi run and accept that a run can overwrite or delete the login; 2, leave it and log in again when needed; 3, refresh in the controller): “Yes option 1 is good”.

Effect: 08-g binds `~/.pi/agent/auth.json` writable on top of the `.pi` overlay for every pi run, developer and reviewer. The owner accepts that risk; it is recorded in [work/accepted-risks.md](work/accepted-risks.md). Not covered: two pi runs refreshing at once (pools, row 13), and a run killed at its deadline in the middle of a refresh.

### A-067 — 2026-10-19 — 04-f and 08-g READY, stacked on 09-d

Owner, after 09-d was committed and offered the order 04-f, 08-g, 06-d, 07-e, and asked whether to open a PR for the row 9 stack: “Okay lets start tackling 04-f into 08-g now”.

Effect: 04-f and 08-g are READY. No PR is opened, so main still lacks row 9. As with 09-a to 09-c, `feat/04-f-pi-error-reason` is stacked on `feat/09-d-spec-rewrite`, and `feat/08-g-pi-auth-refresh` on 04-f. 08-g's fix waits on the owner's answer to the risk its ticket names (a developer run could overwrite the pi login).

### A-066 — 2026-10-19 — 09-d READY; 08-g drafted

Owner, after the 09-d draft and a request to file the pi login issue (“seems like we could easily investigate”): “go on 09-d”.

Effect: [09-d](work/09-d-spec-rewrite.md) is READY; the spec rewrite starts on `feat/09-d-spec-rewrite`, stacked on `feat/09-c-prompt-versions`. [08-g](work/08-g-pi-auth-refresh.md) is drafted and not READY: it first checks whether the `.pi` overlay drops pi's refreshed login, then binds `auth.json` writable (A-038).

### A-065 — 2026-10-19 — 09-c plan deleted

Owner, asked whether to delete or commit the untracked 09-c plan: “delete the plan file”.

Effect: `plans/2026-10-19-prompt-versions.md` is deleted uncommitted, as the 09-a and 09-b plans were (A-058, A-061). A-062, the 09-c ticket log and the handoff keep what it decided.

### A-064 — 2026-10-19 — Three tickets from the 09-c live run, after row 9

Owner, asked whether the three issues seen in the 09-c live run become tickets or are parked under O-013: “Yes all three should be tickets, we'll deal with them and any others after we finish this 09 work.”

Effect: drafted, not READY: [04-f](work/04-f-pi-error-reason.md) (a pi error turn records pi's own reason), [06-d](work/06-d-reviewer-commit-messages.md) (reviewers see the candidate's commit messages) and [07-e](work/07-e-fix-without-tree-change.md) (a fix whose findings need no tree change; Design route). Each is numbered by the plan step whose code it changes. They wait until row 9 is finished: 09-d first.

### A-063 — 2026-10-19 — 09-c reviews and owner-run tests waived

Owner, told that `npm test` on `c368009` was run by the implementer session and is not independent: “Okay I'm going to waive that and the review.”

Effect: 09-c carries no reviews and no owner-run `npm test`; the implementer's run on `c368009` (269 tests, 245 pass, 0 fail, 19 skipped, 5 todo) stands as the record. As with 09-a and 09-b (A-058, A-060), the stacked branch carrying 09-a to 09-c merges on the owner's word with the waivers on record. 09-d, the spec rewrite, is next.

### A-062 — 2026-10-19 — 09-c prompt split shape

Owner, offered three plan answers (Q1 `roleText` on every agent stage plus an optional `fixRoleText` on commit stages, with today's four first lines on `defaultWorkflow`; Q2 `checkWorkflow` refuses an agent stage with no role text; Q3 role text must be one line) and three interface answers (Q1 a new pure `src/prompt.ts` with `developerPrompt` and `reviewPrompt` returning the text and both hashes; Q2 an optional `versions` on `ExecuteOptions` that `receive` spreads onto every `developer_result`, `verdict` and `run_failed`; Q3 tests at `develop`, `fix` and `review`, at `src/prompt.ts` and at `checkWorkflow`): “take all”, then “take all”.

Effect: 09-c follows `plans/2026-10-19-prompt-versions.md`. The contract hash is the hash of each kind's contract built from fixed placeholders, because the per-run nonce makes a hash of the sent text unique. Prompts with several paragraphs wait for O-013.

### A-061 — 2026-10-19 — 09-b plan deleted; no runs to keep

Owner, asked whether to keep the 09-b plan and whether any runs directory holds 09-b cycles worth keeping: “delete the plan. I don't need any runs”.

Effect: `plans/2026-10-19-generic-driver.md` is deleted unmerged, as the 09-a plan was (A-058). 09-c may change `defaultWorkflow` and so its hash; cycles opened by 09-b code under the default workflow will be refused, and that is accepted.

### A-060 — 2026-10-19 — 09-b reviews waived

Owner, after an overview of 09-b on `61b550c`: “Okay lets waive the review again and prepare the handoff for a fresh session for 09-c”.

Effect: 09-b carries no reviews, as 09-a (A-058). The stacked branch carrying 09-a and 09-b merges with 09-c on the owner's word, with both waivers on record. 09-c is next.

### A-059 — 2026-10-19 — 09-b driver approach

Owner, offered three registry approaches (one implementation per role; one per step kind with adapters by role, recommended; one function per workflow) and three questions (Q1 test the second workflow as `DEV → CHECK → REVIEW → OWNER`, because the engine can't start on a review stage and `review` needs `verify`; Q2 move 09-c's workflow record into 09-b, with the store refusing a cycle whose hash doesn't match; Q3 the job file names a workflow module, and `runtime` is keyed by role with `standard` and `adversarial` as aliases): “take all”.

Effect: 09-b follows [design/2026-10-19-generic-driver.md](design/2026-10-19-generic-driver.md), pending the owner's approval of the note. Its second-workflow done-when line becomes Q1's four-stage workflow. The cycle-record line moves from 09-c to 09-b.

### A-058 — 2026-10-19 — 09-a reviews waived; spec rewrite after 09-c

Owner, asked whether 09-a's two standard reviews and one adversarial review are waived, run now, or run with 09-b's as a stacked branch: “waive”. Earlier, offered an overview of 09-a instead of a review: “okay I'm happy with that lets start on 09-b in a fresh context”. Asked where the spec rewrite that A-054 calls for goes: “up to you, should it happen now or after? Should it include changes from 09-c?”. Asked whether to commit the untracked 09-a plan: “No we can cut that plan document”.

Effect: 09-a carries no reviews; it merges with 09-b and 09-c on the owner's word, with the waiver on record. The spec rewrite of [specs/core-lifecycle-v1.md](specs/core-lifecycle-v1.md) is a docs ticket, 09-d, after 09-c, so it describes the driver (09-b) and the workflow and prompt version records (09-c) once, not twice. `plans/2026-10-19-workflow-engine.md` is deleted uncommitted; the design note and the ticket log keep what it decided.

### A-057 — 2026-10-19 — 09-a engine shape

Owner, offered three approaches for the inside of `apply` (keep the switch on event type; a handler table by step kind; a compiled lookup table, with the first recommended) and three questions (Q1 replace `standard` and `adversarial` with `Cycle.budgets` and edit their read sites in callers, widening the ticket's constraint; Q2 `QUEUED` as a fourth engine stage, with the workflow naming its `start`; Q3 `apply(c, e, workflow = defaultWorkflow)` and an optional workflow on `EventStore`, recording nothing new on the open marker): “take all recommendations”. Then, given [design/2026-10-19-workflow-engine.md](design/2026-10-19-workflow-engine.md): “design is approved”. Then, offered three interface answers (the `EventStore` constructor runs `checkWorkflow` and `apply` trusts its caller; keep the three-argument `apply` and wrap each `reduce(apply, …)`; second workflows live in the tests only) and generic escalation reasons (`<STAGE> FAIL`, `<STAGE> FAIL at budget limit <n>`), which change two regexes in `tests/run.test.ts`: “take all”, then “Take all recommendations”.

Effect: 09-a follows that design. Its constraint now also allows mechanical edits of `c.standard` and `c.adversarial` read sites in `src/main.ts` and the caller tests, and the two escalation regexes at `tests/run.test.ts:122` and `:132`. Agent stages carry `produces: 'commit' | 'verdict'` as part of the `agent` kind, not a fourth kind.

### A-056 — 2026-10-19 — Row 9 design answers

Owner, offered four answers for the workflow engine (Q1 a TypeScript module that exports plain data, so the engine can check and hash it; Q2 today's event types kept with a `step` field, so existing stores replay; Q3 stage names defined by the workflow, with `ESCALATED`, `CANCELLED` and `ACCEPTED` fixed in the engine; Q4 the core owns a prompt's contract part and the workflow owns the role text) and three tickets (09-a engine and default workflow, 09-b generic driver, 09-c prompt split and version records): “accept all”.

Effect: tickets [09-a](work/09-a-workflow-engine.md), [09-b](work/09-b-generic-driver.md) and [09-c](work/09-c-prompt-versions.md) are drafted, stacked in that order. Each becomes READY when the owner has read it and said go. O-016 items 1 and 2 are answered; items 3 to 6 (extension protocol, grants, observation stream, configuration layers) remain for row 10.

### A-055 — 2026-10-19 — Build the workflow engine now, before recovery

Owner, after the core principles (A-054): “Okay I think this is the right path, and I'd want to implement this sooner rather than later so we don't build up too much debt as to what and how things run.” Then, offered the order (the engine before recovery; acceptance evidence as the first stage written in the workflow format): “Yes lets do this now. Part refactor part new features - we should also look forward in the plan so that we're considering the future features and work (like adding skills and initial prompts)”.

Effect: two new plan rows before recovery. Row 9 is the workflow engine, a refactor of `src/lifecycle.ts` and `src/run.ts`. Row 10 is the extension host and the observation stream, new features. Recovery moves to row 11, tracker and code host sync to row 12, and the unsplit rest to row 13; A-052's order between recovery and sync stands. [plan.md](plan.md) gains a table of what each later row and open question needs from rows 9 and 10, so the engine is designed with them in view. The design questions for row 9 are in [open-questions.md](open-questions.md), O-016.

### A-054 — 2026-10-19 — Strong core, user-definable workflow, extensions

Owner, opening an architectural discussion: “Basically I want to publish a strong core application, this is probably the state machine. Then the rest of the application is sort of plug and play, adapatable and configurable [...] The other thing that I would want is that the factory itself is modifiable outside the core, not just in configuration but we should look for opportunities to allow something like lua or ts code to be written by a user that is personal and works with our core.”

Offered: extensions sit on the agents' side of the trust line and return claims; three questions (does that rule fit; may users add stages; out-of-process JSON or in-process TypeScript). Reply: “1. Okay I think this is good, we can challenge it along the way though. 2. No I think users should be able to fully customise the stages and steps of the factory workflow. 3. Go with your recommendation with ts as the first-class option”.

Offered: three tiers (engine guarantees, default policy, user extensions), with "humans accept" as the open point. Reply: “I think humans accept should be configurable, otherwise the principles are all good - you even caught a good principle that we need "observability" such that extension can actually see whats going on, and react.”

Offered: keep "the factory never merges" as a guarantee. Reply: “I think the factory never merges should not be a guarantee, perhaps the controller never does - but why not a user extension? Our 'sane' default will be that it doesn't - but I can see a case for a bug that say something like sentry finds on your application, you might want that to auto merge and be deployed if its small right? Thats not my risk appetite but we shouldn't enforce that”.

Effect (D-023):
- The core: the event log (`src/store.ts`); an engine that applies events to a cycle under a workflow definition (today mixed with the default workflow in `src/lifecycle.ts`); the controller, the only writer (`src/controller.ts`); run supervision with deadlines, cancel and recovery; candidate and evidence binding to a Git SHA; an observation stream that observers read and react to through claims or commands; an extension host with the seam contracts, loader, contract test kits and version records.
- Engine guarantees, which no workflow can switch off: only the controller changes state, and every change is a recorded event; evidence and verdicts bind to a SHA, and a new commit makes old evidence invalid; anything the controller cannot classify escalates; every agent loop has a finite budget; extensions return claims and never write state; every run records the versions of the workflow, prompts and extensions it used; the controller itself never merges or deploys.
- Default policy, which a workflow may change: today's stages and order, two standard reviews and one adversarial review, controller-run checks, fresh-context reviewers, human acceptance, and no merge step.
- User extensions: stages and steps built from step kinds (agent run, controller command, human decision, extension step), roles, prompts, adapters, observers, and merge or deploy steps.
- Extensions run as separate processes over JSON on stdin and stdout, inside the sandbox; TypeScript is the first-class option.
- The spec's principle 5 and D-004 stay true of the default workflow only. The spec is rewritten when the engine is built.
- Open parts and the proposed plan order are in [open-questions.md](open-questions.md), O-016. Plan rows are not changed until the owner approves an order.

### A-053 — 2026-10-19 — Drop the parked 02-a schema cleanup

Owner, told that `WITHOUT ROWID` on the events table and `WHERE run_id IS NOT NULL` on its unique index change no behaviour (SQLite never treats two NULLs as equal in a unique index), and that removing them reaches only new databases because the table is made with `CREATE TABLE IF NOT EXISTS`, so existing ones would need a migration: “Okay yes lets drop the task”.

Effect: both clauses stay in `src/store.ts`. The schema cleanup half of the 02-a notes line in [work/parked.md](work/parked.md) is dropped and gates no ticket.

### A-052 — 2026-10-19 — Tracker and code host sync: two seams; recovery first

Owner, on GitHub sync: “This all looks good, and I do basically only use github - but like the rest of the factory this should be agnostic and work with other providers or something like linear (seperating source control from task tracking)”. Then, offered a design with two seams (a tracker for tickets in and status out, a code host for the branch and the owner's review, each with a `local` adapter for today's behaviour and a `github` one) and five questions (Q1 the issue named on the command line, the job file still giving the repository and checks; Q2 a merge on the host is accept when the merged head equals the candidate's SHA, otherwise the cycle escalates, and the factory never merges; Q3 a PR closed without merge is cancel, changes requested does nothing automatic; Q4 the PR description is the review package and the issue gets one status comment edited in place; Q5 GitHub sync right after recovery and before the acceptance evidence stage): “Yep they all look good to me - so lets record those”.

Effect: plan row 9 is recovery; row 10 is tracker and code host sync; the rest of the old row 9 moves to row 11, its order not yet decided. The sync design:
- `Tracker` reads a ticket by reference and returns a provider-qualified work ID (`github:owner/repo#42`, `linear:ENG-123`), and reports status. `CodeHost` publishes the candidate branch with the review package, and reads the owner's disposition. The job file names each adapter. The first ticket builds `local` and `github` for both; Linear and GitLab come later.
- The providers report what happened; the controller decides. A merged review is `accept` only when its head is the candidate's SHA; otherwise the cycle escalates. A review closed unmerged is `cancel`. Changes requested is left to the owner, who opens a child cycle (source §15, post-human revisions).
- Sync is its own pass, `sync(store, tracker, host)`, that reconciles the store against the providers; `run.ts` does not call it. A failed report never changes a cycle and is retried by the next sync.
- Provider credentials stay with the controller. No developer, check or reviewer sandbox can read them, and a test pins that.
- Runs start one issue at a time from the command line; finding READY issues by label is scheduler work for the pools row.

### A-051 — 2026-10-19 — Acceptance evidence stage: design agreed, built later

Owner, after proposing a stage at the end of the cycle in which a verification agent produces an artifact (a video, an image or a test run) proving the work meets its done-when lines, for the PR, and after four points in reply (the agent writes the demo script and the controller runs it at the SHA in the sandbox; a failed demo: escalate, count as a standard FAIL, or rerun the agent once when its script is broken and escalate when the behaviour is wrong; the demo is not reviewed by an agent, so the PR says so and maps each done-when line to its item; the cost: a new stage before AWAITING_ACCEPTANCE, browsers in bwrap, the name "acceptance evidence", and GitHub sync to show it): “1. soumds good. 2. c 3. agree 4. Well, should it sit between adversarial review and awaiting acceptance? Have we built the 'review desk' part of the factory maybe it should sit there? I suppose that does sit between those two stage. I think we should maybe park this second half to later development”.

Effect: verification has two halves. The first is today's VERIFYING stage and stays as built: the controller checks the SHA and base and runs the declared checks, and the reviewers read the results. The second, acceptance evidence, is parked for later development, with this design: a verification agent in a fresh context writes a demo script from the ticket and the candidate; the controller runs it at the head SHA in the sandbox and keeps the output under `evidence/<head>/`; a broken script reruns the agent once, a demo showing wrong behaviour escalates; the PR shows the script and its output, marked as not reviewed by an agent, with each done-when line mapped to its evidence. It sits after ADVERSARIAL_REVIEW and before AWAITING_ACCEPTANCE; the Review Desk (source §10, not built) presents it. What is still open is in [open-questions.md](open-questions.md), O-015.

### A-050 — 2026-10-18 — Merge the guide to main as experimental; its tests leave npm test

Owner, after walking through the guide (`learn/`, built as a prototype without a ticket) and asked whether it merges to main as experimental like `proto/` (A-048), and whether its tests stay in the default `npm test`: “1. yes merge as experimental 2. No they should go out, I don't know the best way to keep them but avoid having it mess with regular tests - worst case we can cut them”.

Effect: `learn/` merges to main as an experimental guide, outside the ticket workflow: no ticket, no reviews. Its tests move to `learn/learn.test.ts` and run with `npm run test:learn`; `npm test` no longer runs them, so a change to `src/` can break the guide without failing the factory's tests. `src/` must not import from `learn/`. If keeping the guide in step costs too much, its tests, or the guide, can be cut. The owner runs the merge.

### A-049 — 2026-10-18 — Open questions move to their own file

Owner, during the guide walkthrough, after asking for somewhere to flag questions for later research and finding it odd to keep them in a file titled decisions: “yes that makes sense, lets split the file and reference it from decisions as well just in case something is expecting them to still be there.”

Effect: [open-questions.md](open-questions.md) holds every open question, O-001 to O-014, with the research behind the new ones (O-005 widened; O-011 review budget exhaustion; O-012 the Design Studio; O-013 role prompts and skills; O-014 a survey of skills libraries, harnesses and other factories). The `## Open` section here points to it. A decided question is recorded here with the owner's quoted reply and its row leaves that file. `AGENTS.md` lists the file under "Read first".

### A-048 — 2026-10-18 — Merge the herdr TUI prototype to main as experimental

Owner, after the prototype's stage runs were sandboxed (A-047) and asked whether `proto/` should merge to main as experimental, replacing A-046's "no merge": “Okay commit and then merge (you'll need to hand me the command to execute”.

Effect: `proto/` merges to main as an experimental interface while the factory is developed. It stays outside the ticket workflow: no ticket, no tests first, no reviews. `src/` must not import from `proto/`, so deleting the directory removes it. The owner runs the merge. This replaces A-046's "no merge to main"; the rest of A-046 stands.

### A-047 — 2026-10-18 — Sandbox the prototype's stage runs; the factory's goal is to run in herdr

Owner, told that interactive claude in the unchanged bwrap policy works but herdr cannot detect it, and offered two routes to a merge (make the sandbox work first, or merge with stages unsandboxed behind a job-file opt-in): “Okay yes lets make the sandbox work first, and make sure that we record these findings as the end goal will be having this run in herdr.”

Effect: `proto/herdr-adapter.ts` runs every stage in the job's sandbox, with three changes to cliAdapter's policy for interactive runs ([work/herdr-findings.md](work/herdr-findings.md)). A job whose sandbox is `none` still runs claude unconfined. The findings file records what a herdr frontend needs, and O-010 holds the evidence question. Whether `proto/` merges to main is still open; A-046's "no merge" stands until the owner decides.

### A-046 — 2026-10-18 — Throwaway herdr TUI prototype

Owner, asking for "the quickest demo prototype we can - this will likely be thrown out" of a TUI that works inside herdr, and then answering five questions (exempt the prototype from the ticket workflow; branch name `feat/proto-herdr-tui`; stages as interactive claude sessions in herdr tabs rather than headless `claude -p`; claude only; no diff-comment key): “1. Yes 2. Sounds good 3. Yes 4. Yes claude only 5. Yes we can leave it out.” Then: “Okay now go away and build it by yourself with no input from me, its a prototype and so it only really maters once the final thing is done at which point I will review and we can collaborate on it.”

Effect: `proto/` holds the prototype on `feat/proto-herdr-tui`, outside the ticket workflow: no ticket, no tests first, no reviews, and no merge to main. For prototype runs only, herdr is in use, which overrides workflow.md's "herdr is not part of this setup". Interactive stage runs are not sandboxed; the demo points them at a scratch repository. `src/` is unchanged.

### A-045 — 2026-10-17 — Fix the 07-d adversarial minors before merge

Owner, after 07-d's standard PASS and adversarial PASS on `b5d4635` (two minors: arguments after the job file are ignored, so `node src/main.ts job.json cancel` runs the job; after `cancel` clears an ESCALATED parent, a job file still naming `parentCycleId` is refused with no hint), offered a fix before merge, parking, or a merge with the risks accepted: “Fix”.

Effect: both minors are fixed on `feat/07-d-accept-cancel`, test first. The run command refuses extra arguments with the usage line. A job whose `parentCycleId` names a cycle that is not ESCALATED is refused before any run, with a message saying to remove the field. The fix commit takes standard review 2, the ticket's last standard attempt; the adversarial budget is spent.

### A-044 — 2026-10-17 — Ticket 07-d: owner accept and cancel commands

Owner, told that nothing in plan row 9 is needed to run the factory on hobby projects one issue at a time, and that the main friction is the missing accept and cancel commands (a finished or stranded cycle blocks its work ID): “Yep, let's add the accept and cancel commands now.”

Effect: ticket 07-d-accept-cancel, Fast route, on `feat/07-d-accept-cancel` stacked on `feat/09-scoping`. It is numbered under step 7 because `main.ts` is that step's command and the lifecycle already holds both events; row 9 is not split by it. The row 9 split proposed in the handoff is still waiting for the owner's answer.

### A-043 — 2026-10-17 — Lift the scratch-repositories-only limit

Owner, after step 8 put developer, check and reviewer runs in bubblewrap, offered three answers on the working limit that the A-029 merge introduced (factory runs on scratch repositories only): lift it for repositories without secrets (recommended), keep it, or lift it fully. Told the two open gaps: every run has full network access, and a run can read its own CLI's config directory, credentials included, so a hostile or confused agent could send out the repository and the login. Reply: “lift it fully.”

Effect: the factory may run on any repository, including one that holds secrets. The two gaps stay open and are accepted for now. The network line in [work/parked.md](work/parked.md) is no longer tied to the first repository holding secrets; it waits for a later ticket. The parked lines that cite the limit are marked lifted.

### A-042 — 2026-10-17 — Weigh adversarial findings by risk; record accepted risks

Owner, asked whether to record the rule offered after the 08-e adversarial FAIL (park findings that need deliberately hostile code and do no damage by default): “No rule, we definitely want to consider malicious code - but I don't think we need to make something airtight and waste development time. So you should weigh up the risk when these recommendations come through and potentially merge accepting them. We should probably capture them somewhere in that case though”.

Effect: no default parking rule. Malicious code stays in scope, ranked after damage and leaving the remit (A-037). When an adversarial review fails, the implementer session weighs each finding's risk and recommends one of three outcomes: a fix ticket, parking against a named ticket, or a merge with the risk accepted. The owner still decides. A risk the owner accepts goes to [work/accepted-risks.md](work/accepted-risks.md), with the reason and the event that would reopen it. Unlike a parked line, an accepted risk does not gate any ticket.

### A-041 — 2026-10-16 — Fix ticket for the 08-e adversarial FAIL

Owner, after the 08-e adversarial FAIL on `eeffa15` (one major: a FIFO a check leaves in a gitlink's nested `.git` blocks the controller's git forever and nothing is recorded; one minor: the `update-index` arm of `treeDiff`'s catch has no test of its own), offered a fix ticket 08-f that gives the controller's git calls a timeout tied to the stage deadline, with tests for the FIFO case and the untested arm, or a merge with the hang parked: “Option 1 go”. The owner did not answer the offered rule to park hostile-check findings by default, so no such rule is recorded.

Effect: ticket 08-f-controller-git-timeout, Fast route, stacked on 08-e with fresh review budget. Every controller git call over a tree a run or a check wrote gets the stage deadline as its timeout and is killed with SIGKILL past it, and the failure is recorded with its reason. The ticket also covers the same hang on the developer side (the fetch from the clone in `land`, and `fix`'s git in the clone), which the implementer session reproduced while scoping, and the parked non-UTF-8 minor, which A-040 assigned to the next ticket that touches `verify.ts`.

### A-040 — 2026-10-16 — Fix ticket for the 08-d adversarial FAIL

Owner, after the 08-d adversarial FAIL on `64514a0` (one major: main.ts passing the sandbox to the adversarial and pi reviewers is untested; two minors: a malformed nested repository at a gitlink makes `treeDiff` throw before cleanup, a non-UTF-8 untracked name stops the removal), offered a fix ticket stacked on 08-d covering the major and the gitlink minor with the UTF-8 minor parked, or a merge with the findings parked: “Option 1 go”.

Effect: ticket 08-e-reviewer-sandbox-tests, Fast route, stacked on 08-d with fresh review budget. It tests the sandbox at every reviewer call site in main.ts and records a comparison that git cannot complete as `tree` dirt, then cleans the checkout. The UTF-8 minor goes to parked.md against the next ticket that touches `verify.ts`.

### A-039 — 2026-10-16 — Merge 08-c with the adversarial minor parked

Owner, after the 08-c standard PASS and adversarial PASS on `cfdcc16` (one adversarial minor: the per-run `/tmp` cleanup in `cliAdapter` throws on a directory chain past PATH_MAX; the adversarial reviewer could not write probes), asked to merge as it stands or run a second adversarial review first, and whether to park the minor against 08-d: “Merge and park it. But I'm away from the computer so I can't merge right now”.

Effect: `feat/08-c-developer-sandbox` is accepted for merge as it stands, with no second adversarial review; the owner merges it on return. The minor is parked against 08-d, which is not READY to merge until its done-when list covers it. 08-d starts now on `feat/08-d-reviewer-sandbox`, stacked on 08-c.

### A-038 — 2026-10-16 — 08-c and 08-d: developer and reviewer runs in the sandbox

Owner, after the runtime probe ([08-c-findings.md](work/08-c-findings.md)) and five questions (the developer's clone at `<runsDir>/<cycleId>` made with `--no-hardlinks`, its branch fetched into the repository with a sandboxed `upload-pack` and `fetch.fsckObjects`, the head checks run in the repository after the fetch; claude's configuration bound read-only and pi's as a temporary overlay, with a writable `auth.json` only if pi stops logging in; two stacked tickets, 08-c the developer with `--restricted` for claude and `--no-approve` for pi, 08-d the reviewers with the checkout read-only and `--no-context-files` for pi; 08-d also fixes the controller side of the two 08-b majors and takes the two parked verify minors; network on with `/run/systemd/resolve` bound for runtimes, `/tmp` a per-run directory on disk removed after the run): “Take all, go”.

Effect: 08-c-developer-sandbox is READY on the Design route with these answers; 08-d-reviewer-sandbox is drafted, stacked on 08-c, and becomes READY after 08-c's standard PASS. 08-c covers the parked 05-a pi bash and 05-b claude settings lines and the 08-a note on the controller's git reading the developer's git config; 08-d covers the 06-c pi context-files line, the two 08-b majors and the two 08-b minors.

### A-037 — 2026-10-16 — Merge 08-a and 08-b with the 08-b adversarial findings parked

Owner, after the 08-b adversarial FAIL on `dc6c461` (two majors: a committed gitlink directory and a dangling symlink survive the untracked removal and reach the unsandboxed reviewer; two minors: a tracked path starting with whitespace is deleted after a clean tree check, and a deep chain plus a locked directory makes the removal throw) and the question how likely they are: “Option 2, for the most part I'm not terribly concerned about malicious code - obviously that is a worry. My primary concern is agents going outside their remit to achieve a goal which they can't otherwise do, or making a mistake - causing damage to the repo or outside (i.e. deleting data from the whole of the tmp dir instead of their own space inside it)”.

Effect: `feat/08-b-tree-permissions` (08-a and 08-b) is merged by the owner with 08-a standard PASS, 08-a adversarial FAIL fixed by 08-b, 08-b standard PASS and 08-b adversarial FAIL on record. The two majors are parked against 08-c (developer and reviewer runs in the sandbox), which closes them: inside the sandbox the owner's home is not bound. The two minors are parked against the next ticket that touches `verify.ts`. Threat model for 08-c and later, in the owner's words: the first concern is an agent going outside its remit or making a mistake that damages the repository or anything outside its own space; deliberately malicious code is a secondary concern.

### A-036 — 2026-10-16 — Fix ticket for the 08-a adversarial FAIL

Owner, after the 08-a adversarial FAIL on `798eb1c` (one major: a check that removes the owner's permissions on a directory hides a rewritten tracked file from the tree comparison, because git warns on stderr, skips the path and exits 0; two minors: a check that removes permissions on the checkout itself makes the comparison throw, and untracked leftovers such as a planted `.git` directory or a symlink to the owner's files reach the unsandboxed reviewer): “Option 1 go”.

Effect: ticket 08-b-tree-permissions, Fast route, stacked on 08-a with fresh review budget. The controller restores owner access to the checkout before comparing, records any warning from the comparison as `tree` evidence, runs its git from the repository, and removes untracked entries before review. The developer and reviewer sandbox ticket becomes 08-c.

### A-035 — 2026-10-16 — Sandbox before plan row 8; five design answers

Owner, choosing between the sandbox ticket and plan row 8: “Sandbox, ideally I think this implementation deserves some research. My system is currently resource constrained so I don't want VMs as the solution, I also want to keep things local so cloud solutions are out as well. Though I don't want either of those solutions to be out of the picture eventually, this tool should ideally be agnostic.” Then, after the research summary ([08-a-findings.md](work/08-a-findings.md)) and five questions (a sandbox interface that wraps a command from a policy of read paths, write paths and network, the backend named in the job file, `none` explicit and scratch-only; the developer in its own clone, the controller fetching its branch; checks on the candidate's files with no git folder, the controller comparing them to the commit; no network for checks, full network for developers and reviewers, domain filtering parked; reads start empty and bind only what is needed): “Take all”.

Effect: the sandbox becomes plan row 8; GitHub sync, pools, release tracking and the improvement loop move to row 9. Row 8 is two tickets. 08-a-sandboxed-checks (Design route; READY on these five answers, its ticket text written after the reply) adds `src/sandbox.ts` with the bubblewrap backend and runs verification checks inside it on a checkout with no `.git`; it covers the parked 06-a symlink, `core.hooksPath` and evidence-file lines and the 07-b gitdir-swap, `git replace` and `core.fileMode` lines. 08-b (drafted after 08-a) moves developer and reviewer runs into the sandbox, the developer into its own clone; what claude and pi need inside comes from an owner-run probe, because listing their configuration directories was refused to this session as credential exploration.

### A-034 — 2026-10-16 — Fix ticket for the 07-b adversarial FAIL

Owner, after the 07-b adversarial FAIL on `f3b4e12` (one major: a check running git inside the verify checkout hides a rewritten tracked file from the `tree` check and review's guard through `skip-worktree`, `assume-unchanged` or a `.git` pointer swap; two minors: the newline flatten misses `\r` and the Unicode line separators, the `tree` status has a 1 MiB buffer): “Option 1 go”.

Effect: ticket 07-c-tree-check, Fast route, stacked on 07-b with fresh review budget. It records index flags as `tree` evidence before the status, widens the buffer, fixes the flatten in the prompt and in `main.ts`, and moves the step cap after the stop. The `.git` pointer swap, `git replace` and `core.fileMode` go to parked.md against the sandbox ticket: no git command run from inside a swapped checkout can see it.

### A-033 — 2026-10-16 — 07-a same-tree refusal on a fix run

Owner, after standard review 2 on `6261150` noted that `refuse` on a fix run also rejects a commit whose tree equals the failed candidate's (an empty commit on top of it), beyond A-032's "the head must differ from the previous head": “go with your recommendation”.

Effect: the rule stays. A fix run must produce a new SHA with a new tree; the reviewers still judge `base..head`, and descent from the previous head is still not required.

### A-032 — 2026-10-16 — Step 7 tickets: fix run and end-to-end loop

Owner, after reading the 07-a and 07-b design notes and five questions (two stacked tickets; `fix` beside `develop` reading findings from the store; a stage that throws escalates with `reject_dispatch`; `verify` records a dirty tracked tree as `tree: FAIL`; `run` returns the Cycle, branch and worktree with a thin `src/main.ts` over a job file, the "PR" being the local branch): “Take all recommendations”.

Effect: 07-a-fix-run and 07-b-end-to-end-loop are READY on the Design route with the recommended answers, 07-b stacked on 07-a. The 06-c parked minor is picked up by 07-b.

### A-031 — 2026-10-16 — Fix ticket for the 06-b adversarial FAIL

Owner, after the 06-b adversarial FAIL on `f7ed0be` (one major: a diff over 1 MiB strands the cycle on `execFileSync`'s default `maxBuffer`; six minors: `.gitattributes -diff` hides content, the cut drops the middle with no file list, the head filter untested, a check can rewrite the tracked tree the reviewer reads, pi lacks `--no-approve`, forgeable section headers): “option 1 go”.

Effect: ticket 06-c-reviewer-prompt-bounds, Fast route, stacked on 06-b with fresh review budget. It fixes the major and the six minors and adds `--strict-mcp-config` to the claude reviewer. `CLAUDE.md` auto-discovery in the claude reviewer is recorded as a non-goal pending a flag probe.

### A-030 — 2026-10-16 — 06-b reviewer runs: signature, tools, evidence source

Owner, after the 06-b question round (`review(store, adapter, cycleId, job, opts)` recomputing the checkout and evidence paths from `runsDir`; read-only reviewer tools, no bash; per-check results from the `verification` event with capped files attached; pick up the parked `MISSING`-under-cgroup minor): “go”.

Effect: 06-b is READY on the Design route with the recommended answers; A-028's `Bash(npm test)` for claude reviewers is withdrawn. `src/review.ts` builds the prompt and calls `execute`; `claudeReviewer` and `piReviewer` are read-only specs.

### A-029 — 2026-10-16 — Merge 06-a with the adversarial findings parked

Owner, after the 06-a adversarial FAIL on `4b20fb5` (one major: a symlink committed in the candidate lets a check read the developer's worktree, so evidence for a SHA depends on files in no commit; two minors: an unknown binary is `FAIL` not `MISSING` under cgroup isolation, and `git worktree add` runs a committed `post-checkout` hook through `core.hooksPath`): “option 2 go”.

Effect: `feat/06-a-verification` is merged with standard PASS (5d1a34b) and adversarial FAIL (4b20fb5) on record. The major and both minors are tracked in [work/parked.md](work/parked.md). All three need a developer with unscoped shell or `git config`, which today is pi on a scratch repository; the ticket that gives pi a policy or puts a sandbox around the worktree is not READY until its done-when list covers them. The `MISSING` classification goes to the next ticket that touches `verify.ts`.

### A-028 — 2026-10-16 — Step 6 design: verification and reviewer runs

Owner, after the step 6 question round (two tickets 06-a verification and 06-b reviewer runs; checks declared on `Job`, not read from the candidate; checks run in a fresh detached checkout of the candidate SHA; evidence as files under the runs directory keyed by SHA, no store change; `review()` mirroring `develop` over `execute`, claude reviewers with `Read,Glob,Grep,Bash(npm test)` and pi with `read,grep,find,ls`; a check that cannot start is `MISSING`, everything else non-zero is `FAIL`; no `runtime` on reviewer runs; parked head-guard variants stay parked): “take all”.

Effect: 06-a is READY on the Design route with the recommended answers; 06-b is drafted and becomes READY after 06-a's standard PASS. `src/verify.ts` owns the checkout, the check runs, the evidence files and the `verification` event.

### A-027 — 2026-10-16 — Fix ticket for the 05-a adversarial FAIL

Owner, after the 05-a adversarial FAIL on `18421ff` (two majors: a throw after `open` strands a QUEUED cycle and blocks the work item; `git log --output` and `git diff --output` let a claude developer write outside the worktree under the allow list): “option 1 go”.

Effect: ticket 05-b-contain-developer-run, Fast route, stacked on 05-a with fresh review budget. It fixes both majors, the four minors (parentless cycle after ESCALATED, relative `runsDir`, non-string `accept` return, user settings joining the grant) and the two mechanical notes; the pre-existing-commit note goes to step 6 in parked.md.

### A-026 — 2026-10-16 — 05-a developer run design

Owner, after reading the 05-a design note and five questions (one `develop()` seam; `accept` option on `execute` for the commit check; worktree per cycle on `sf/<cycleId>`, kept; scoped `--allowedTools` for claude and pi's unscoped bash recorded as a limit; `runtime` on the `claim` event with `Adapter.name` restored): “take all recommendations”.

Effect: 05-a is READY on the Design route with the recommended answers. `src/developer.ts` opens the cycle, makes the worktree, assembles the prompt and calls `execute`; `receive` rejects a claim the caller's `accept` refuses as `run_failed`; `EventStore.open` enforces the 02-b parked guards; the `claim` event carries `runtime`.

### A-025 — 2026-10-16 — Fix ticket for the 04-d adversarial FAIL

Owner, after the 04-d adversarial FAIL on `5347806` (one major: the claim-block regex backtracks catastrophically on an unclosed fence followed by blank lines, holding the controller's event loop past the deadline): “option 1 go”.

Effect: ticket 04-e-claim-scan, Fast route, stacked on 04-d with fresh review budget, replaces the regex with a linear scan and takes the four minors (unit-name validation, no group signal after exit under a scope, well-formed reason cut, probe timeout). 04-d and 04-e merge together.

### A-024 — 2026-10-16 — 04-d real adapters design

Owner, after reading the 04-d design note and five questions (cgroup logic inside `spawnRuntime`; refuse at construction without a user systemd; fenced `json` claim block; drop `Adapter.name`; four live runs): “go with all recommendations”.

Effect: 04-d is READY on the Design route with the recommended answers. `spawnRuntime` grows `isolation` and `maxOutputBytes`; `src/runtime/cli-adapter.ts` builds the claude and pi adapters from a spec; the runtime ends its reply with a fenced `json` block holding the claim; `Adapter.name` is dropped until the step 5 loop records `runtime` on the Run.

### A-023 — 2026-10-16 — Merge 04-a/04-b/04-c with the 04-c adversarial finding parked

Owner, after the 04-c adversarial FAIL on `e97a045` (one major: an outcome within about 60 bytes of V8's string cap strands a cycle; needs about 3 GB of heap to produce): “Yep I agree I think, we should really just accept it here and move on to actually implementing what we're trying to guard against right?”

Effect: the stacked branch carrying 04-a, 04-b and 04-c is merged with standard PASS and adversarial FAIL on record. The size bound is parked against 04-d (real claude and pi adapters), where the bytes come in and a stdout limit bounds them; the self-resolving-thenable hang is recorded as a non-goal of the in-process seam. Step 4 of the plan is done: the adapter seam, the fake adapter and the controller's receive path drive the state machine for normal, malformed, timeout, cancel and duplicate outcomes.

### A-022 — 2026-10-16 — Fix ticket for the 04-b adversarial FAIL

Owner, after the 04-b adversarial FAIL on `8664c1b` (two majors: hostile in-process values from an adapter strand a cycle; one minor: the stage guard rejects a reviewer run whose cycle was cancelled while it ran): “option 1 go”.

Effect: ticket 04-c-total-receive, Fast route, stacked on 04-b with fresh review budget. The real claude and pi adapter ticket becomes 04-d; the two 03-b parked lines move with it.

### A-021 — 2026-10-16 — Fix ticket for the 04-a adversarial FAIL

Owner, after the 04-a adversarial FAIL on `3ba5434` (three majors in `receive` and `run_failed`): “Option 1, go”.

Effect: ticket 04-b-receive-hardening, Fast route, stacked on 04-a with fresh review budget, fixes the three majors and the related minors. The real claude and pi adapter ticket becomes 04-c; the two 03-b parked lines move with it.

### A-020 — 2026-10-16 — 04-a adapter interface design

Owner, after reading the 04-a design note and four questions (split real adapters and cgroup cancel into 04-b; controller owns the deadline; new `run_failed` event; `append` returns the Cycle): “go with your recommendations”.

Effect: 04-a is READY on the Design route with the recommended answers. The two 03-b parked lines (process-tree escape; `cancel()` guard and cwd minors) move to 04-b, the ticket that wraps `spawnRuntime` into real claude and pi adapters. The adapter seam is `src/adapter.ts`; the controller in `src/controller.ts` is the only non-test caller of `EventStore.append`.

### A-019 — 2026-10-15 — Merge 03-a/03-b with the 03-b adversarial findings parked

Owner, after the 03-b adversarial FAIL on `d8a9d21`: “option 1”. Earlier, choosing the fix ticket after the 03-a adversarial FAIL on `85e32e9`: “Go ahead with option 1, 3b”.

Effect: the stacked branch carrying tickets 03-a and 03-b is merged with standard PASS and adversarial FAIL on record. The two majors (descendants that leave the process group survive cancel; a self-re-parenting child is misreported as exited) and the minors are tracked in [work/parked.md](work/parked.md) against 04-a, which is not READY until its done-when list covers them. The findings document is qualified accordingly.

### A-018 — 2026-10-15 — Merge 02-a/b/c with the 02-c adversarial finding parked

Owner, after the 02-c adversarial FAIL on `39d2c59`: “Yep lets do 1, and make sure we are tracking the finding for when it is relevant.”

Effect: the stacked branch carrying tickets 02-a, 02-b and 02-c is merged with standard PASS and adversarial FAIL on record. The finding (a caller applying the unserialised object can diverge from replay) and the other deferred findings are tracked in [work/parked.md](work/parked.md); the first ticket that calls `EventStore.append` from non-test code must cover it. Workflow addition: parked findings gate the ticket named against them.

### A-017 — 2026-10-15 — Working agreement

Owner: “Yes plase, that sounds good. And make some notes in agents.md or somewhere for this to be our agreed workflow going forward - taking items from the plan, breaking them down into that framework and potentially multiple pieces of work”.

Effect: [workflow.md](workflow.md) is the agreed process. Plan steps become Fast or Design tickets under `docs/work/`, one branch each, tests first, owner-run verification, one fresh-session standard review (two at most), one adversarial review, owner merge. First ticket: 02-a SQLite event store.

### A-016 — 2026-10-15 — Stop design iteration; implement the core

Owner, after reviewing twelve design cycles against the v0.3 plan: “I'd much rather go back to our simpler base and let it run implementation rather than just theorizing and agonizing over a plan and edge cases which don't/haven't occured”, then “Ignore my rules”, then asked to remove the accumulated design material.

Effect: cycle-13 withdrawn before review. v0.1 and v0.2 lifecycle specs, 120 scenarios, twelve review ledgers, the manual workflow and templates were removed from the tree. They remain in Git history before commit `1214ca2` for anyone who needs them. Directions D-008 to D-015 from those cycles (paused-failure handling, held results, child recovery of interrupted development, receipt ordering) are superseded by D-016's single rule.

### A-001 — 2026-10-15 — Bootstrap direction

Owner: “I'm happy with the approach, the tech stack and I think we should target Pi and Claude Code. It should run locally.”

Effect: TypeScript and SQLite, Pi and Claude Code first, local execution. Vendor neutrality remains a constraint.
