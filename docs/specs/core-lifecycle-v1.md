# Core delivery lifecycle — v1

Status: describes the code after plan rows 1 to 9 (A-016; rewritten by 09-d, A-054 to A-063). Source: architecture v0.3 §§6–8, 12–13, Appendix A–B. Edge-case semantics are added only when a test or a real incident demands them. Not yet described: row 10's grants, command `run` entries, `network` and the observation stream; a docs ticket brings the spec up to date (A-125).

Brackets name the test that holds a rule: the file under `tests/`, then the opening words of the test's name. A rule marked **proposal** has no test.

## Principles

Core rules, which no workflow can switch off:

1. The controller alone changes state and spends budget. Agents return claims; the controller checks each claim before it counts.
2. Every verdict and every piece of evidence binds to an exact commit SHA, the owner's `accept`, `request_changes` and moves included. A new commit invalidates evidence for the old one. Budget already spent stays spent, unless the owner overrules a FAIL: the overrule refunds one unit at the stage that recorded it, and is recorded with the owner's reason (A-114, A-109 B) [lifecycle: overrule refunds one unit].
3. Anything the controller cannot classify stops the cycle and asks the owner. There is no automatic retry of a quality gate and no silent recovery path. The escalated cycle waits for the owner, who moves it on in place with a reason (`retry`, `overrule`, `route`), opens a child cycle, or cancels (A-114) [lifecycle: retry enters the stage; route enters a named workflow stage]. Accept with risk is `route` to the human stage, then `accept`. (A-108, when built: a workflow may send a failed check to a fix run, so "no automatic retry of a quality gate" becomes default policy; then also `fix` with chosen findings.)

Default policy, which another workflow may change (D-023):

4. Two standard reviews and one adversarial review per cycle. A FAIL at the limit stops the cycle; an adversarial FAIL stops it at once.
5. Humans accept. No merge or deployment is automatic.

## Workflows

A workflow is plain data: a `start` stage and a table of named stages (`src/lifecycle.ts`). Each stage has a kind:

- **agent**: a run by a role. It produces a `commit` or a `verdict` and has one line of `roleText`. A commit stage may add `fixRoleText` for runs after a FAIL.
- **command**: the controller runs the job's declared checks.
- **human**: the owner accepts or requests changes.

Each stage has a `PASS` transition and may have a `FAIL` one. A stage with a `budget` may record that many outcomes per cycle. The engine owns `QUEUED`, `ESCALATED`, `CANCELLED` and `ACCEPTED`. A workflow may send a cycle to the last three but may not define any of them.

`checkWorkflow` refuses a workflow, with a reason, when a stage uses an engine stage name, has an unknown kind or has no `PASS` transition; when an agent stage has no role, produces neither a commit nor a verdict, or lacks one-line role text; when a review stage has fix role text; when a budget is not a positive integer; when one role produces both commits and verdicts; when the start or a transition names an unknown stage; when a loop spends no budget; or when a stage has no path to a stopped stage (`STOPPED`: ESCALATED, CANCELLED or ACCEPTED) [lifecycle: checkWorkflow refuses …]. A workflow with no human stage passes, and its last review's PASS reaches `ACCEPTED` [lifecycle: a workflow with no human stage].

`workflowHash` is the SHA-256 of the workflow's JSON. Key order counts, so reordering a workflow file makes a new workflow.

## Identities

| Record | Identity |
| --- | --- |
| Work | stable work ID |
| Cycle | cycle ID, parent cycle (if a revision), work ID, workflow name and hash, one budget counter per budgeted stage, append-only event log |
| Candidate | head SHA, base SHA; branch `sf/<cycleId>` |
| Run | run ID, role (any string the workflow names), runtime, input candidate |
| Result | run ID, head SHA, artifacts, `contractHash`, `roleTextHash` |
| Verdict | run ID, reviewed SHA, `PASS` / `FAIL`, findings, `contractHash`, `roleTextHash` |
| Dispute | run ID, the previous candidate's SHA, reason, `contractHash`, `roleTextHash` |
| Decision | `accept` or `request_changes` with the exact SHA, `cancel`; on an ESCALATED cycle, `owner_decision` with an action (`retry`, `overrule`, `route` and its stage), the exact SHA and a reason [lifecycle: owner_decision names an action]; a child cycle names its parent. Each may carry a `commandId` [lifecycle: an event from outside a run may carry a command ID] |

One work item has at most one open cycle, and a new cycle for the same work must name an `ESCALATED` parent [store: open enforces one open cycle; open enforces one open cycle per work item when two processes race]. Open means a run may act on it: an `ESCALATED` cycle is stopped, not settled (`SETTLED` is CANCELLED and ACCEPTED). The store refuses a move on a cycle that another cycle names as its parent, since starting over was chosen there, and a move while another cycle of the work is open; both under the write lock [store: the store refuses a move on a cycle another cycle names as its parent; a child open and a retry on its parent]. **Proposal:** a contract version on Work, and the model on Run.

## Default workflow

`defaultWorkflow` is the v1 lifecycle: `QUEUED → DEVELOPING → VERIFYING → STANDARD_REVIEW → ADVERSARIAL_REVIEW → AWAITING_ACCEPTANCE → ACCEPTED`.

| Stage | Kind | Budget | PASS | FAIL |
| --- | --- | --- | --- | --- |
| DEVELOPING | agent, `developer`, commit | — | VERIFYING | — |
| VERIFYING | command | — | STANDARD_REVIEW | ESCALATED |
| STANDARD_REVIEW | agent, `standard_reviewer`, verdict | 2 | ADVERSARIAL_REVIEW | DEVELOPING (fix run) |
| ADVERSARIAL_REVIEW | agent, `adversarial_reviewer`, verdict | 1 | AWAITING_ACCEPTANCE | ESCALATED |
| AWAITING_ACCEPTANCE | human | — | ACCEPTED | ESCALATED |

A claim moves a cycle from `QUEUED` to the start stage. A FAIL with the stage's budget spent escalates, so the second standard FAIL stops the cycle [lifecycle: SC-03]. A fix run produces a new candidate SHA, verification runs again, and no counter resets [lifecycle: SC-02]. Each scenario ends at its declared stage and counters [lifecycle: every shared scenario]; SC-09, SC-10, SC-12, SC-14 and SC-15 are still todo.

## Engine rules

These hold under every workflow [lifecycle: evidence for a non-candidate SHA escalates under a workflow other than the default].

| In | Event | Result |
| --- | --- | --- |
| any non-terminal | owner cancels | CANCELLED |
| any non-terminal | verdict for a SHA that is not the candidate | recorded, counted, ESCALATED [lifecycle: SC-17b] |
| any non-terminal | verification or `accept` for a SHA that is not the candidate | ESCALATED [lifecycle: SC-08; accept must name] |
| human stage | `request_changes` for a SHA that is not the candidate | ESCALATED [lifecycle: request_changes for the candidate]; one with no head is unclassifiable [lifecycle: request_changes names the head] |
| outside a commit stage | candidate head changes | ESCALATED [lifecycle: SC-16]; the same head is ignored [lifecycle: a base change naming the candidate's base]. No step records this event yet (A-103, A-111) |
| any non-terminal | target base changes | ESCALATED [lifecycle: SC-17]; the same base is ignored [lifecycle: a base change naming the candidate's base]. No step records this event yet; `accept` will warn when the base moved (A-111) |
| any non-terminal | duplicate result, verdict, dispute or run failure (same run ID) | no change [lifecycle: SC-06; lifecycle: outcomeRunId names the run; store: a duplicate event] |
| any | an event from outside a run with a command ID the cycle has already recorded | nothing written [store: a second event with the same command ID; a redelivered rejection under its command ID] |
| any non-terminal | event tagged for another stage | ESCALATED, nothing counted [lifecycle: an event with a step] |
| any non-terminal | event the stage's kind does not take | ESCALATED, nothing counted [lifecycle: an event the stage's kind does not take; store: store dedup matches apply]. A second claim while a developer run is active is ignored [lifecycle: a claim while a developer run is active] |
| any non-terminal | entering a budgeted stage whose budget is spent | ESCALATED [lifecycle: entering a budgeted stage] |
| any non-terminal | run failed (timeout, crash, no claim) | ESCALATED, no budget spent [lifecycle: run_failed escalates] |
| commit stage, fix run | developer disputes the findings | ESCALATED with the reason, no budget spent [lifecycle: dispute: a fix run escalates] |
| any non-terminal | event the engine cannot classify | ESCALATED [lifecycle: an event of unknown type] |
| ESCALATED | owner `retry` for the candidate | the stage the cycle escalated from; spent budget stays spent [lifecycle: retry enters the stage] |
| ESCALATED | owner `overrule` for the candidate | one unit refunded at the stage of the last verdict, a FAIL for the candidate not overruled already, which the cycle then enters [lifecycle: overrule refunds one unit] |
| ESCALATED | owner `route` to a stage, for the candidate | that workflow stage [lifecycle: route enters a named workflow stage] |
| ESCALATED | a move whose condition does not hold (another head, a spent budget, an engine or unknown stage, no FAIL to overrule) | recorded with a note; nothing else changes [lifecycle: retry is refused; overrule is refused; route … is refused] |
| ESCALATED | any move that holds | every developer run with no outcome is consumed, so its late outcome is a duplicate [lifecycle: a move consumes every developer run] |
| ESCALATED | any other event but cancel | ignored |
| outside ESCALATED | `owner_decision` | ESCALATED, nothing counted [lifecycle: a move outside ESCALATED] |
| ESCALATED | owner authorises a new cycle | child cycle with empty counters; this cycle stays ESCALATED [lifecycle: SC-05] |
| ACCEPTED, CANCELLED | anything | ignored [lifecycle: SC-19] |

## Cycle records

`EventStore` keeps one append-only SQLite table and rebuilds each cycle by replaying its events through `apply` [store: loading a cycle replays]. It refuses a workflow that `checkWorkflow` refuses, before it creates anything [store: the store refuses a workflow]. When a cycle opens, the store records the workflow's name and hash [store: open records the workflow name and hash]. It refuses to load a cycle whose hash differs from its own workflow's, naming both [store: a cycle opened under one workflow]. Cycles written before 09-b load under the default workflow only [store: a store written before 09-b].

An owner command appends with the history length it decided on. If another writer appended first, the store throws `StaleLoad` and writes nothing, so two commands decided on one load cannot both land [store: append refuses with StaleLoad; two processes deciding on one load] [main: two overlapping accepts before a grant stage]. `cancel` and run outcomes are not checked: they land whatever came between. A second delivery of a command the cycle already holds writes nothing and drives nothing, whatever its load; the command prints `Already recorded` and exits 0 [store: a redelivered command is a no-op; write reports whether] [main: two overlapping deliveries of one command ID].

## Driver

One driver, `run` in `src/run.ts`, runs any workflow that passes the check, within the limits below. It opens the cycle with the developer run, then acts on each stage by kind: a fix run at a commit stage, a review at a verdict stage, the checks at a command stage. It stops at a human or settled stage [run: another workflow runs from open]. It never moves a stage itself; `apply` decides from what each step records.

- The job file may name a workflow module, and `runtime` picks a CLI per role [main: main.ts runs the workflow the job file names]. `ROLE_ALIASES` keeps the old keys `standard` and `adversarial` working.
- A workflow named by the repository's `.factory/config.json` is imported only when a branch or tag outside `sf/*` contains the base, so a checked-out candidate never runs as the owner [config: a repository workflow at a base only sf/*] [main: cancel with a candidate branch checked out].
- A role with no adapter is refused before any cycle opens [run: a role with no adapter].
- An extension runtime's module is read and hashed only when a role selects that runtime, so a broken entry no role selects blocks neither a run nor `cancel` [main: a personal runtime whose module is missing]. `accept`, `cancel` and `events` build no adapter, so a broken module never blocks them, whichever role selects it [main: accept, cancel and events work when a role selects a runtime whose module is missing]. A run whose role selects it is refused before any cycle opens, naming `runtimes.<name>` and the path [main: a role whose runtime module is missing].
- `run` and `resume` share one preflight. Before any cycle opens or any step runs, it refuses what a later step would refuse only after a paid run: a sandbox that cannot start [run: a sandbox that cannot start]; a file argument with no `workflowDir` [run: a workflow whose command names a file]; a grant not given [run: run refuses a grant]; a job check name or empty command `verify` would refuse [run: run refuses a job check verify would refuse]; a check program, named without a slash, that is not found or lies outside the sandbox [run: run refuses a check program]. `resume` refuses the same [run: resume refuses what run refuses]. `verify` keeps its own checks.
- The driver cannot yet run every shape `checkWorkflow` passes. Its preflight refuses an edge into a commit stage where the last verdict may not be a review's `FAIL` for the candidate, because a fix run takes its findings from that verdict: an edge from a commit stage, a review's `PASS`, or an edge from a command or human stage that a commit or a review's `PASS` can reach without passing another review. A command or human stage between a review's `FAIL` and the fix runs [run: a command stage between a review FAIL; a human stage between a review FAIL]; and a review stage that a commit stage reaches with no command stage between, because a reviewer reads the checkout `verify` made of the candidate [run: run refuses a workflow shape the driver cannot run]. Both rules look only at stages the start reaches, and only at a commit stage's `PASS`, the one outcome `apply` takes there. These are limits of today's steps, not engine rules: `checkWorkflow` passes them and `apply` runs them. A known gap: a grant stage that a commit stage reaches with no review `PASS` between passes the preflight, and `verify`'s head gate refuses it only after the developer run. A check's `FAIL` back to the developer needs a fix run that reads the failed checks.
- A step that throws escalates the cycle with `reject_dispatch` naming the stage [run: a stage that throws].
- An owner's move is refused, writing nothing, when `apply` would only note it, and when the stage it enters is one a step would throw on at once: a commit stage needs a last verdict that is a FAIL for the candidate, a review stage a last verification of the candidate, a grant stage the head gate [decide: moveEvent refuses a stage the driver cannot run]. The head gate counts only outcomes a stage took, never one recorded while escalated. An owner move may not jump past a FAIL on the way to a grant stage. A move jumps when it enters a stage other than the one the cycle escalated from; without a jump the cycle moves only along edges the workflow declares. When a jump landed after a stage's last outcome and that outcome is a FAIL (a review's verdict, a command stage's checks, the owner's `request_changes`), the grant stage refuses unless an owner accept came after the FAIL; accept with risk, through the human stage, is the way past. A `retry`, or a `route` or `overrule` back into the stage the cycle escalated from, skips nothing, and a path the workflow declares from a FAIL runs, direct or through other stages. The grant stage's own failed run does not count, so going back into it is a second attempt [decide: a grant stage needs every review stage's last verdict to be a PASS; the grant rule reads each review stage's last verdict; a failed check and the owner's request_changes count as a FAIL; a FAIL counts only when an owner route landed after it; a move jumps when it enters a stage other than the one the cycle escalated from] [main: request-changes drives on into the stage the owner's FAIL leads to] (O-017). After an overrule, the reviewer of the stage it entered gets the owner's reason, on one line inside the prompt's delimiters, under its own contract version [prompts: a review prompt with the owner's ruling] [review: ownerRuling].
- `resume` continues a cycle from its stored stage [run: resume on a cycle left at VERIFYING].
- While an agent run is in flight, the controller reloads its cycle once a second. If another process has settled it, for example with the owner's cancel, the run is aborted and its CLI killed; the outcome is `run_failed` with reason `cancelled`, which the settled cycle ignores [run: a cancel from another process aborts the developer run, the standard reviewer run]. A store that cannot be read skips that check [controller: a store that cannot be read during the watch]. A check in flight is not aborted.

## Prompts and version records

An agent prompt is the stage's one line of role text, then the contract part, which the core builds in `src/prompt.ts`: the ticket, the SHAs, the claim or verdict format, the rules and the delimiters. Role text cannot forge a contract line [prompts: role text holding a fake delimiter]. `tests/fixtures/prompts/` holds the default prompts byte for byte, so a wording change must change those files on purpose [prompts: the default developer, fix].

Every `developer_result`, `verdict`, `dispute` and `run_failed` records `contractHash` and `roleTextHash` [prompts: every outcome event records; a run that fails; developer: a fix that disputes the findings]. The contract hash covers the wording for that kind of run (developer, fix or review), built from placeholders. It is never a hash of the text that was sent: each review prompt carries a fresh nonce.

## Evidence rules

- A developer result must name a commit that is the branch tip, descends from the base and changes something [developer: a claim whose head is not the branch tip]. A fix must also bring a new SHA [developer: a fix claim is refused]. It may keep the previous tree only by adding commits on top of the previous candidate, for example to fix a commit message [developer: a fix that adds a commit with the previous tree]; a same-tree fix that rewrites earlier commits is refused [developer: a fix with the previous tree that rewrites].
- A fix run may dispute the findings instead: it claims the previous candidate with a `dispute` reason. The cycle escalates with the reason, cut to one line and 2 KiB, and spends no budget [developer: a fix that disputes the findings; a dispute reason over 2 KiB]. A dispute naming any other commit is refused [developer: a dispute that names a new commit], and a dispute from a first run escalates [lifecycle: dispute: a fix run escalates].
- The controller runs the repository's declared checks in a sandbox, on a fresh checkout of the candidate with no `.git`, and stores output and exit code against the SHA [verify: passing checks run in a fresh checkout]. The controller's git writes that checkout as the commit's stored bytes: it reads no attributes, so no filter driver runs outside the sandbox [verify: a filter the candidate's .gitattributes or the owner's attributes file names is not run].
- A reviewer gets the ticket, the diff, the SHAs, the repository instructions and the verification evidence, never the developer's transcript [review: the prompt carries the role]. The instructions are quoted from the base, so the candidate cannot rewrite the rules it is judged by; when the candidate changes an instruction file, the section header says so [review: a candidate that edits an instruction file; unchanged instruction files]. It also gets each commit in `base..head`, oldest first, with full SHA, author and message, because its checkout has no `.git` [review: the COMMITS section lists every commit]. The diff is the plain patch whatever the owner's diff settings [review: the reviewer's diff is the plain patch].
- A verdict with the wrong SHA is recorded but cannot advance the cycle [lifecycle: SC-17b].
- `main.ts` prints agent text (findings, verdict heads, escalation and error reasons) with every control character but tab, every bidi control, and U+2028 and U+2029 shown as a visible `\u{..}`; the event log keeps the raw text. A claimed head that is not a commit is cut to 64 characters before a refusal names it [main: agent text with terminal escapes].
- Missing evidence is never PASS [verify: no declared checks; review: review throws and appends nothing].

## Recovery

A failed run escalates and spends no budget [lifecycle: run_failed escalates]; the owner may `retry` the stage [main: retry reruns the stage]. `drive` continues a cycle from its stored stage. `unsettled()` lists every cycle not ACCEPTED or CANCELLED, ESCALATED ones included, for `recover` (11-f) to leave to the owner [store: STOPPED is every stage no run acts on].

**Proposal (row 11, A-105):** on restart, the controller reloads every open cycle and reconciles its runs. It observes a live run. A run that died without a result is recorded as `run_failed` and escalates; it is not relaunched. Before that, the clone's branch tip is kept under a recovery ref. `resume` refuses a cycle whose job ticket or checks changed since it opened.

## Release handoff

`main.ts accept <job.json> <sha>` records the owner's acceptance of the exact candidate SHA and prints the merge command [main: main.ts end to end]. `request-changes <job.json> <sha>` records the owner's FAIL for that SHA, with the same refusals [main: request-changes records]. `retry <job.json> <sha> --reason <text>`, `overrule <job.json> <sha> --reason <text>` and `route <job.json> <sha> <stage> --reason <text>` record a move on the work's escalated cycle and drive it on as `accept` does; `preflight` runs before the move is written [main: live run 1; route to the human stage is accept with risk; a move is refused, writing nothing]. Every owner command takes `--source` and `--command-id` [main: owner commands take --source and --command-id]; the observer kit sends `<source>:<pos>:<command>`, from the stream line it handles [observe: observe runs a real accept]. Merging stays the owner's action; deployment is out of scope. **Proposal (row 12):** record the merge against the same SHA.

## Acceptance tests

`tests/lifecycle.test.ts` is the executable form of the engine and the default workflow; `tests/store.test.ts`, `tests/run.test.ts` and `tests/prompts.test.ts` hold the rest. Scenario names SC-01 to SC-19 are kept from earlier design work.
