Branch: feat/09-a-workflow-engine

# Workflow engine inside `apply` (ticket 09-a)

## Problem

`apply` in `src/lifecycle.ts` hard-codes the v1 stage table: stage names, the order, the two review limits and the counters `standard` and `adversarial`. A-054 to A-056 make the stages a workflow the user defines, with today's lifecycle as the default. 09-a must move the table out into `defaultWorkflow` and leave behind an engine that applies events under any workflow that passes `checkWorkflow`. A-056 settled the outside shape: plain data, today's event types with an optional `step` field, and stage names that the workflow defines. This note settles the inside shape.

## Approaches considered

**A. Keep the switch on event type.** Each case looks up the current stage in the workflow, checks the stage kind matches the event, works out the outcome, and calls one `advance()` helper that applies the budget and the transition. It is the least code, and the diff reads like today's `apply`. Row 10's extension steps bring new event types, so they arrive as new cases.

**B. A handler table keyed by step kind.** `apply` runs the engine rules, then dispatches to `KINDS[stage.kind]`. Each handler must still reject events of the other kinds, so it adds indirection that no 09-a test needs. A kind-to-implementation map belongs to 09-b's step registry, on the driver side.

**C. Compile the workflow to a lookup table** of `(stage, event, outcome) → stage`. It matches the spec's table, but the budget and SHA guards do not fit a lookup and end up as side cases. More code, less clear.

## Chosen approach

Approach A, with the owner's three answers ("take all recommendations", 2026-10-19).

**The workflow type.** `start` names the first stage. `stages` maps a stage name to:
- `kind`: `agent`, `command` or `human`.
- For `agent`: `role` (a string), and `produces`, either `commit` or `verdict`. `produces` separates the developer from reviewers without the engine naming roles.
- `transitions`: `{ PASS: stage, FAIL?: stage }`. A target is a workflow stage or an engine stage.
- `budget?`: a positive integer.

`defaultWorkflow` is the v1 table: DEVELOPING (agent, developer, commit), VERIFYING (command), STANDARD_REVIEW (agent, verdict, budget 2, FAIL → DEVELOPING), ADVERSARIAL_REVIEW (agent, verdict, budget 1, FAIL → ESCALATED), and AWAITING_ACCEPTANCE (human, PASS → ACCEPTED, FAIL → ESCALATED).

**Engine stages.** `QUEUED`, `ESCALATED`, `CANCELLED` and `ACCEPTED`. `QUEUED` means the cycle has not started; a `claim` in QUEUED enters `start` (answer Q2). `newCycle`, `openChild` and `store.open` stay workflow-free.

**Which events a stage accepts.** The event type decides:
- `claim` and `developer_result`: an agent stage that produces a commit.
- `verdict`: an agent stage that produces a verdict.
- `verification`: a command stage.
- `accept` and `request_changes`: a human stage.

Any other pairing escalates, as it does today. An event whose `step` names a stage other than the current one escalates. An event with no `step` belongs to the current stage.

**Outcomes.** A valid developer result is PASS; an invalid one escalates, because it is a malformed claim rather than a FAIL. Verification is PASS when every check passed, otherwise FAIL. A verdict carries its own outcome. `accept` is PASS and `request_changes` is FAIL. A FAIL with no `FAIL` transition escalates.

**Budgets.** `Cycle.budgets` maps a stage name to the number of outcomes recorded there. It replaces `standard` and `adversarial`. A budgeted stage counts every outcome, stale verdicts included. A FAIL follows `FAIL` while the count after it stays under the limit, and escalates at the limit. Entering a stage whose budget is used up escalates. Today that guard exists only on the way into STANDARD_REVIEW.

**Engine rules that no workflow changes.** Terminal and escalated cycles, `cancel`, duplicate run IDs, `run_failed`, head and base changes, and SHA binding: a verdict, verification or accept for a SHA that is not the candidate escalates under any workflow.

**`checkWorkflow(w)`** returns a list of reasons, empty when the workflow passes. It refuses a workflow when:
- `start` or a transition names an unknown stage;
- a stage uses an engine stage name;
- a loop in the transition graph passes through no budgeted stage;
- a stage has no path to a settled stage.

**Plumbing (answer Q3).** `apply(c, e, workflow = defaultWorkflow)`. `EventStore` takes an optional workflow and replays with it. The open marker records nothing new. 09-b decides how a job's workflow is recorded, alongside 09-c's version records.

**Types.** `Stage` and `Role` become `string`. The callers compare against literals, so they keep working.

**Wider constraint (answer Q1).** Besides `lifecycle.ts`, `store.ts` and their tests, 09-a edits the read sites of `c.standard` and `c.adversarial`: `src/main.ts:140` and the assertions in `tests/controller.test.ts`, `tests/review.test.ts`, `tests/run.test.ts` and `tests/developer.test.ts`. Each edit is mechanical and changes no behaviour.

**Order of work.** First build the fixture database from `tests/scenarios.ts` with today's code and commit it under `tests/fixtures/`. Then write the tests, then make the change.

## Risks

- **The replay check can pass on a weak fixture.** The fixture covers only the scenario events. Any real store written by `main` is a run of those same event types, so the risk is low. A cycle that relies on a quirk the scenarios miss would still replay differently.
- **The budget guard now applies to every stage entry, not only STANDARD_REVIEW.** Under the default workflow, the only other budgeted stage is ADVERSARIAL_REVIEW, which is entered once per cycle at most, so no scenario changes. The scenario table is the check.
- **`produces` is a field the ticket does not name.** It refines A-056's `agent` kind without adding a kind. If the owner reads it as a fourth kind, it needs a decision entry.
- **The loop check uses the transition graph only.** The implicit escalations from SHA binding and budgets are not edges. That is safe, because both lead to a settled stage.
- **A workflow could start on a stage that does not produce a commit.** Only `claim` leaves QUEUED, and a claim is accepted only by a commit stage, so such a workflow escalates at its first claim. That is safe but unhelpful. Design Studio (O-012) needs stages with no candidate, so `checkWorkflow` does not refuse it. A way to start a cycle without a developer claim belongs to 09-b or later.
- **Escalation reasons may change wording.** Some tests match today's reason strings, such as `claim outside QUEUED`. Keep the existing strings where a test matches them.
