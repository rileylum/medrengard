# The workflow engine as a design (research-foundations, slug `engine`)

Read at `42f174e` (main). Probes are in `/var/tmp/software_factory/research-foundations/engine/probes/`. `npm test` in a detached worktree at `42f174e` gave 450 tests: 426 passed, 0 failed, 19 skipped, 5 todo, in 29 s. The run left no `sf-*` folders behind.

## 1. Short answer

- **What is sound.** The core is right, and it is better than most of what others ship:
  - an append-only log;
  - one pure `apply` that is the only writer of state;
  - a workflow that is data, interpreted by fixed code, so replay never runs user code;
  - a cycle pinned to its definition's hash;
  - a static rule that every loop spends a budget.

  Temporal, Azure Durable, DBOS and Restate all spend real effort on keeping replay deterministic. The factory avoids that problem by construction. A fuzz of 15,000 random workflows that pass `checkWorkflow` found that every run settles within the driver's step cap. Keep all of this.
- **Problem 1: escalation is a dead end.** `ESCALATED` takes no event but `cancel` (`src/lifecycle.ts:404`). The owner's only other move is a child cycle that starts again from the base, with the ticket alone (`src/developer.ts:72-91`). A-109 B (overrule a finding), A-105 (a crashed run escalates) and O-011 all hit this. Every system studied lets a human resume a parked run in place, with a recorded decision.
- **Problem 2: steps have hidden inputs and only two outcomes.** A step's inputs (the last FAIL verdict's findings, `verify`'s checkout) are not declared anywhere. The driver therefore guesses them from graph shape (`driverLimits`, `src/run.ts:110-160`) and refuses workflows the engine accepts. That includes the three shapes A-108 asks for, which a probe confirmed. Steps also have only two outcomes, PASS and FAIL, so A-109's "needs the owner" class has nowhere to route.
- **Problem 3: new step kinds need core code.** The event vocabulary is tied to the stage kinds. Each new kind of step needs new event types, `SHAPE` entries and `apply` cases. Under A-113 that is the wrong place for the seam.
- **Smaller defects:**
  - `request_changes` names no SHA, and owner events carry no idempotency key. An at-least-once observer can therefore reject a candidate nobody read (probe).
  - A change to `apply` silently re-interprets old logs, with no divergence check.
  - `apply`'s copied history makes a replay quadratic in the number of events. That matters once heartbeats arrive (A-113).
- **What to change first:**
  1. Owner decisions on an escalated cycle, in place (P1).
  2. SHA and idempotency key on every owner or external event (P2). Do this before row 12 builds a producer.
  3. Named outcomes and declared step inputs and outputs, in the design of the A-108 and A-109 tickets, before either is built (P3). Then a step-type registry (P4).
  4. Leave parallel stages and sub-workflows until the pool model is chosen.

## 2. What we have

### The model

- **A workflow is plain data** (`src/lifecycle.ts:52-60`): a `start` stage and named stages. Each stage has a kind:
  - `agent`, with a `role` and `produces: commit | verdict`;
  - `command`, which runs `run` or `job.checks` and may hold `grants` and `network`;
  - `human`.

  Each stage has `transitions: { PASS, FAIL? }` and an optional `budget` (`:20-44`). `defaultWorkflow` is the v1 lifecycle (`:63-84`).
- **The engine owns four stages:** QUEUED, ESCALATED, CANCELLED and ACCEPTED (`:11`). `SETTLED` is the last three (`:14`). Only ACCEPTED and CANCELLED are terminal (`:357`). ESCALATED ignores every event except `cancel` (`:404`).
- **One cycle holds one active stage** (`Cycle.stage`, `:190-203`). It also holds:
  - per-stage outcome counters (`budgets`);
  - one candidate `{head, base}`;
  - runs, and consumed run IDs;
  - a full history copied on every event (`record`, `:359-361`).
- **The event vocabulary is fixed, and tied to stage kinds** (`:121-138`):

  | Stage kind | Events it takes |
  | --- | --- |
  | commit | `claim`, `developer_result`, `dispute` |
  | verdict | `verdict` |
  | command | `verification` |
  | human | `accept`, `request_changes` |
  | any stage | `cancel`, `head_changed`, `base_changed`, `reject_dispatch`, `run_failed` |

  An optional `step` field ties an event to a stage. Nothing in `src/` sets it (grep: no producer).
- **Outcomes are binary** (`Outcome = 'PASS' | 'FAIL'`, `:9`). Each outcome is worked out per event type in `apply` (`:398-497`):
  - a valid `developer_result` is PASS;
  - a `verification` is PASS when every check passed;
  - a verdict carries its own outcome;
  - `accept` is PASS and `request_changes` is FAIL.

  Anything else escalates: run failures, disputes, stale SHAs, an event in the wrong place, an unknown type.
- **Budgets** (`advance` and `enter`, `:378-391`):
  - A budgeted stage counts every outcome.
  - A FAIL at the limit escalates, whatever the FAIL edge says.
  - Entering a stage whose budget is spent escalates.
  - Spent budget never resets inside a cycle.
- **Work and cycles.** One open cycle per work item. A new cycle must name an ESCALATED parent, and the store checks both inside `BEGIN IMMEDIATE` (`src/store.ts:116-152`). The child starts from a fresh clone at the base (`src/developer.ts:72-91`).

### The checker (`checkWorkflow`, `src/lifecycle.ts:214-277`)

It checks:
- shapes and names;
- one `produces` per role;
- that `start` and every target exist;
- **that every loop spends a budget**: with budgeted stages removed, the graph must be acyclic (`:250-262`);
- **that every stage has a path to a settled stage** (`:264-275`).

It does not check reachability from `start`. The grant rule is a shape rule (`:327-338`); the head-binding part of that rule is enforced at run time in `verify` (`src/verify.ts:117-130`).

The termination argument holds:
- An event can leave a budgeted stage only through `advance`, which counts the outcome.
- Entering a spent stage escalates.
- No external event moves the stage, except `cancel` and escalations.

The probe `fuzz.ts` generated 6,256 random workflows; 3,000 of them passed the check. It drove each 20 times with random outcomes, at five seeds. Every run settled. The longest first driver segment used 0.88 of `stepCap` (`src/run.ts:174-177`). So the cap is safe, and fairly tight.

### Durability and replay (`src/store.ts`)

- **One table.** Each row holds `(cycle_id, seq, type, run_id, body, pos, at)`. Row 0 is the `open` marker. It records the workflow's name and hash, the base, and the whole definition (`:10-20`, `:144`).
- **Every `append` validates the serialised body** (`isEvent`), inserts, then replays the cycle (`:162-176`). `load` refuses a cycle whose workflow hash differs from the store's (`:189-192`).
- **One outcome per run.** A partial unique index on `(cycle_id, run_id)` keeps a second outcome out (`:118-119`). `apply` ignores a duplicate too (`:405`, `:417`, `:436`, `:472`).
- **Positions and times** (10-d) are set inside the single insert statement, outside the event body, so replay is unchanged (`:24-31`).
- **Replay under the recorded definition** is decided (A-112 item 6) but not built. Only `stream.ts#workflowOf` does it today (`src/stream.ts:28-32`).

### The driver (`src/run.ts`)

- `run` calls `preflight`, then `develop`, then `drive`. `resume` calls `preflight`, then `drive` (`:49-79`).
- `drive` is a synchronous-in-spirit loop. It picks the step by an `if` chain on the stage kind (`:186-189`):
  - a commit stage runs `fix`;
  - a verdict stage runs `review`;
  - a command stage runs `verify`;
  - anything else returns.

  Each step appends its own events through `execute` and `receive` (`src/controller.ts`).
- **A step that throws** becomes `reject_dispatch`, which escalates and counts nothing (`:192-197`).
- **`driverLimits`** (`:110-160`) refuses two shapes the engine accepts but the steps cannot run:
  - an edge into a commit stage where the last verdict may not be a FAIL for the candidate;
  - a review stage with no command stage between it and the last commit.

  Both rules exist because `fix` reads "the last verdict" from the history (`src/developer.ts:128-129`), and `review` reads `verify`'s checkout and evidence from the filesystem (`src/review.ts:62-80`). Neither input is declared.
- **The driver stops at a human or settled stage and the process exits.** Nothing drives on after `accept`, so a grant stage placed after a human stage never runs (HANDOFF, known gap).
- **A run in flight** reloads its cycle once a second, to see a cancel made from another process (`src/controller.ts:28`, `:56-59`).

### What it does well

- **No user code runs during replay.** Temporal, Azure, DBOS, Restate, Inngest and Cloudflare all replay *code*. Each documents rules ("same calls in the same sequence"), patch APIs, or step-name caching to keep that safe (see section 4). The factory replays *data* through one fixed reducer, so a workflow edit cannot cause a nondeterminism error.
- **Pinning.** A cycle runs under the definition it was opened with, by hash, and the definition is stored in the log. That is the Temporal DSL sample's choice (the definition as input, stored in history), and DBOS's (version = source hash; recover only on the same version).
- **Termination is proved before anything runs.** Attractor has no such lint rule (only `max_retries` per node and a goal-gate loop). LangGraph has a runtime recursion limit of 1,000 super-steps. Symphony retries with no cap.
- **Evidence binds to a SHA in the engine itself**, not in step code. A stale verdict is counted and never applied. This is the factory's one domain-specific engine rule, and it is the right one.
- **Dedup by run ID in the storage layer** works as a fence against a late result from a relaunched run (`docs/research/2026-10-20/deep-research.md`).

## 3. What we don't have

Each gap below comes with a concrete flow it fails on.

### G1. No way out of ESCALATED except starting again

- **What happens.** A reviewer misreads a silent check's `exit 0` (live run 1, `docs/STATUS.md` item 52). The developer disputes, and the cycle escalates. The owner agrees with the developer. Today the owner can cancel, or open a child cycle that clones the base again and repeats the paid developer run with the ticket alone. Neither choice keeps the work.
- **The same wall:**
  - A-109 B ("refund the budget the FAIL spent, rerun the same review stage") needs an escalated cycle to move again. `apply` ignores everything in ESCALATED (probe `human.ts`: `'ignored: escalated; owner must open a child cycle or cancel'`).
  - A-105 makes every crashed run escalate. With no resume-in-place, every controller crash costs a full restart from the base.

### G2. Only PASS and FAIL; no route chosen by the kind of outcome

A-109 A wants three routes after a review:
- "only a blocking finding can FAIL";
- "minor findings go to the owner, not the fix run";
- "a needs-the-owner finding escalates".

That is at least three outcomes: PASS, FAIL (fixable) and NEEDS_OWNER, and PASS with minors is arguably a fourth. With two outcomes, these rules must be hard-coded into `apply`'s verdict case or into `review`. Either way they become core policy, which A-113 says to avoid. A-074 Q8 parked named outcomes. A-109 makes them due now.

### G3. Step inputs and outputs are implicit

- `fix` takes its findings from "the last verdict in history".
- `review` takes "every command stage's last verification of this head" from the filesystem.

Neither input is in the workflow, so `checkWorkflow` cannot check it. `driverLimits` approximates it with two graph walks. The probe `shapes.ts` shows the cost. These three workflows pass `checkWorkflow`, and the driver refuses each one before any run:

| Workflow | Asked for by |
| --- | --- |
| A review PASS that enters an editing commit stage | A-108's "reviewer that may make small edits" |
| A red check back to the developer | A-108, primitive 1 |
| A human FAIL back to the developer | the source's "owner requests changes" |

A-108 and A-109 both ask for data passed between steps. A-109's owner note asks whether "a workflow definition or an extension may declare the shape of what a step takes and returns".

### G4. The core must change for each new step kind

- **Adding a kind of step means editing the core:**
  - the `Event` union;
  - `SHAPE`;
  - `outcomeRunId`;
  - an `apply` case;
  - a branch in `drive`;
  - often a `driverLimits` rule.
- **D-024 folds custom steps into command stages.** A command stage can return only an exit code. It cannot:
  - return a commit (the tree check refuses a changed checkout, `src/lifecycle.ts:304-309`);
  - return a verdict with findings;
  - return data a later step reads.
- **So these planned uses each need a core edit today:**
  - acceptance evidence ("an agent step writes a script, a command step runs it", `docs/plan.md`);
  - A-112 item 10 (a reviewer's failing-test script);
  - the A-108 editing reviewer.

### G5. No parallel stages, no fan-out or fan-in

Flows that need them:
- standard review and a security reviewer in parallel;
- lint, typecheck and tests as separate stages that report separately and run at once;
- best-of-N developers (SWE-agent's RetryAgent, Attractor's fan-in "select best candidate");
- the source's own pools (D-006: two or three reviewers at a time).

Today a second reviewer adds its full wall time to every cycle. The harness research already noted that compound-engineering and Copilot run reviewers in parallel (`harnesses.md`, "Is the flow right?").

### G6. No timers, no generic wait for an external event

- A human stage waits forever. There is no "remind after two days" and no "escalate after seven".
- Row 12 needs "a GitHub merge records `accept`". That is a wait for an external event, today expressible only because `accept` happens to exist.
- A deploy stage that waits for CI on the merged commit cannot be written at all.

### G7. Owner and external events are not bound to a SHA, and not idempotent

- **The defect.** `request_changes` carries no head (`src/lifecycle.ts:132`).
- **The probe** (`human.ts`, a workflow whose OWNER stage sends FAIL to DEVELOPING):
  1. The owner rejects `h1`.
  2. The developer produces `h2`.
  3. A redelivered `request_changes` rejects `h2`, which nobody has read.
  4. A late `accept h1` then escalates the cycle.
- **Why it will happen.** 10-d's observers are at-least-once by design ("delivery is at least once"). Row 12's webhooks redeliver. No owner command carries a command ID.
- **The rule it breaks.** Spec principle 2 says every verdict binds to a SHA. The owner's FAIL is a verdict.

### G8. A change to `apply` re-interprets every old log, silently

- The store replays with today's `apply`.
- 10-d rejected storing the derived stage per row, so that `apply` stays the one source (`docs/design/2026-10-20-observation-stream.md`, alternative 3).
- The cost: an engine change can move a settled cycle in replay (an ACCEPTED cycle could replay as ESCALATED), and nothing notices. The one guard is a golden fixture (`tests/fixtures/v1-store.sqlite`), and it covers only the fixture's events.
- Temporal, Restate and Azure all *detect* divergence between replay and history and stop, rather than re-interpreting.

### G9. A recorded definition can stop replaying when `checkWorkflow` tightens

- A-112 item 6 replays a cycle under its recorded definition "when that passes `checkWorkflow`".
- Any later tightening of `checkWorkflow` (a new reachability rule, a grant rule) makes older cycles unloadable, including ACCEPTED ones that `events` and `accept` read.

### G10. Replay cost grows quadratically, and A-113 adds many events

- `record` copies the history array on every event.
- `append` replays the cycle, and the watch reloads it once a second.
- The probe `replay.ts` measured one replay at:

  | Events | One replay |
  | --- | --- |
  | 1,000 | 2.4 ms |
  | 5,000 | 13.5 ms |
  | 20,000 | 1,160 ms |

- Today a cycle has about 10 to 40 events, so this is harmless. A-113's heartbeats and progress events would put hundreds of events per run into the cycle, if they go into the same log.
- Temporal caps history at 51,200 events and offers Continue-As-New. Azure warns that history growth "caus[es] performance problems".

### G11. Loops cannot change behaviour by iteration, and exhaustion always escalates

- A-113 item 3 ("a stronger model for the last fix") can be written only by unrolling the loop. The probe `shapes.ts` shows `D → V → R1 → F1 → V1 → R2 → F2(dev_strong) → V2 → R3` passes both checks.
- The looped form, a single `R` with budget 3, cannot pick another role on its last round.
- A spent budget always escalates. A workflow cannot say "when the budget is spent, go to the owner's human stage" or "go to a stronger model".
- Superpowers does exactly this: up to five fix rounds, a fresh agent on a stronger model from round 4, then adjudication.

### G12. Limits on whole cycles are missing

- Budgets are per stage. Nothing bounds a cycle's total agent runs, total cost or wall time.
- O-007 ("backpressure: max outstanding PRs, cost and time limits") has no engine hook.
- DBOS keeps crash-recovery attempts (`maxRecoveryAttempts`) apart from step retries. The factory has neither counter: A-105 withdrew relaunch "for now".

### G13. No composition and no sub-workflows

- The source plans a separate release lifecycle after ACCEPTED, and a Design Studio before READY (O-012).
- Neither can be attached to a cycle except as a different job.
- A child cycle is the only link between cycles, and it means "revision after escalation".

### G14. Small checker gaps (probe `cap.ts`)

- A PASS edge straight to `ESCALATED` passes `checkWorkflow`. It yields an escalated cycle whose `escalation` is `undefined`, so `main.ts` prints no reason.
- A stage that `start` cannot reach passes with no warning. Attractor makes reachability an ERROR.
- The grant rule "only after a PASS verdict for the head" is enforced only at run time, after a paid run (spec, Driver, "a known gap").

### G15. The driver is a one-shot CLI loop, not a reconciler

- `drive` runs until a human or settled stage, and then the process exits.
- Four separate entry points each need "work out the next action from the stored state":
  - resume after a crash (row 11);
  - drive on after `accept` (the grant-after-human gap);
  - react to a GitHub merge (row 12);
  - a watchdog stopping one run (A-113).
- No common function exists for that today.
- No step records its start except a developer's `claim`, so recovery cannot tell "never started" from "started and died" for reviewers and commands (A-105 item 3).

### What the model expresses that it should not (or not silently)

- **ACCEPTED is reachable with no human stage** (by design, D-023). `main.ts` still prints "To merge" only at a human stage. The name ACCEPTED now means "the workflow finished". The owner should know that a workflow with no human stage produces ACCEPTED cycles nobody accepted. The `accept` event's `source` covers that only when there was an accept.
- **`apply` accepts FAIL edges from a commit stage**, but no event produces one. `driverLimits` has to explain this (`src/run.ts:118-121`).
- **`checkWorkflow` counts that unusable edge as a path to a settled stage.** The check is sound only because escalation is always possible.
- **A budget of 1 on a stage with a FAIL edge** means the edge can never be followed. The first FAIL is at the limit and escalates (`advance`, `:384-388`). The checker accepts it silently. I found this while writing the probes: the obvious "one fix round" workflow has to leave the review stage unbudgeted.

## 4. What others do

The model of each system, what it gets right, what bit its users, and a verdict for the factory.

### Durable-execution engines (replay code)

| System | Model | Gets right | What bit users | For us |
| --- | --- | --- | --- | --- |
| **Temporal** | Event History. Workflow code re-runs, and "the Commands that are emitted are compared with the existing Event History" ([docs](https://docs.temporal.io/workflow-definition)). History cap 51,200 events or 50 MB; Continue-As-New ([limits](https://docs.temporal.io/cloud/limits)). Signals, Updates and Queries for external input. | Divergence is *detected*: `NON_DETERMINISTIC_ERROR`. Pinned Worker Versioning: "A Pinned Workflow is guaranteed to complete on a single Worker Deployment Version" ([worker versioning](https://docs.temporal.io/worker-versioning)). | "The in-flight Workflow hits a non-determinism error and stops dead ... Those LLM calls you already paid for? Gone" ([Temporal blog](https://temporal.io/blog/safe-deployments-with-temporal-worker-versioning-on-kubernetes)). Patching "requires you to maintain both code paths until all old Workflows complete". Stuck executions "will not clear up on its own" ([troubleshooting](https://docs.temporal.io/troubleshooting/execution-failures)). | **Adopt** divergence detection (P6). **Adopt** "signals" as the shape for external events (P2, P8). **Avoid** code-as-workflow; we already have something better. The [DSL sample](https://raw.githubusercontent.com/temporalio/samples-go/main/dsl/starter/main.go) passes a YAML definition as workflow input, so it lives in history: that is our `definition` on the open row. |
| **DBOS** | Postgres checkpoints of inputs and step outputs. Recovery re-calls the workflow and skips checkpointed steps ([architecture](https://docs.dbos.dev/architecture)). | "Application version is automatically computed from a hash of workflow source code", and "it only recovers workflows whose version matches" ([upgrading](https://docs.dbos.dev/typescript/tutorials/upgrading-workflows)). **Fork** "from a specific step" into a new workflow ID ([management](https://docs.dbos.dev/typescript/tutorials/workflow-management)). Workflow ID as idempotency key. | Any change to step order is breaking; old processes must drain. | **Confirms** hash pinning (A-059, A-112 item 6). **Adapt** fork: a child cycle that *starts at a named stage with the parent's candidate* (P1). **Adopt** idempotency keys (P2). |
| **Restate** | A journal per invocation; replay skips completed steps ([concepts](https://docs.restate.dev/foundations/key-concepts)). Awakeables: "one-shot" signals with an ID that external systems resolve ([external events](https://docs.restate.dev/develop/ts/external-events)). | Immutable deployments: "Existing requests continue on the original deployment". A journal mismatch raises **RT0016** instead of guessing ([versioning](https://docs.restate.dev/operate/versioning)). | Editing code in place "can cause in-flight invocations to fail when they replay". | **Adopt** the awakeable shape for waits: an ID the stage hands out, resolved once (P8). |
| **Inngest** | The handler replays; step results are memoized by step ID plus an occurrence counter ([execution](https://www.inngest.com/docs/learn/how-functions-are-executed), [versioning](https://www.inngest.com/docs/learn/versioning)). `step.waitForEvent`, `step.sleep`. Workflow Kit runs JSON workflows through a `loader` ([engine](https://www.inngest.com/docs/reference/workflow-kit/engine)). | No version markers for compatible changes. | A renamed step "is treated as new and runs again": silent re-execution of side effects. Reordering only logs a warning. Limits: 1,000 steps and 32 MiB of state. The Workflow Kit's loader is not documented to snapshot the definition per run (unverified). | **Avoid** silent re-execution and an unpinned loader. Our pinning is stronger. |
| **Cloudflare Workflows** | Steps memoized by name in an SQLite-backed Durable Object ([blog](https://blog.cloudflare.com/building-workflows-durable-execution-on-workers/)). `waitForEvent` (default 24 h timeout), `sleep` up to 365 days ([API](https://developers.cloudflare.com/workflows/build/workers-api/)). | Simple rules: "Step names act as the 'cache key'" ([rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)). | What happens to in-flight instances on redeploy is undocumented (unverified). There is no divergence detection. | **Avoid** relying on names alone without detection. |
| **Azure Durable Functions** | Event sourcing: the orchestrator "replays multiple times, and it must produce the same result each time" ([constraints](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-code-constraints)). `WaitForExternalEvent` and `CreateTimer` are history events. | "When an orchestration instance is created, it gets a version permanently associated with it"; workers accept or reject by version ([versioning](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-orchestration-versioning)). | Doing nothing on a breaking change leaves orchestrations "stuck indefinitely in a Running status" ([versioning](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-versioning)). Eternal orchestrations accumulate history; hence Continue-As-New ([eternal](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-eternal-orchestrations)). | **Confirms** a version per instance. **Adopt** the lesson on history growth: keep telemetry out of the replayed log (P9). |

The cross-cutting lesson: every one of these engines' main pain is a deploy that changes replay while runs are in flight. The factory has removed the workflow half of that problem, through pinned data. It has not removed the *engine* half: a change to `apply` (G8).

### Declarative orchestrators

In this table, "(unverified)" marks a claim from a search summary or a page I did not fetch.

| System | Model | Gets right | What bit users | For us |
| --- | --- | --- | --- | --- |
| **AWS Step Functions (ASL)** | JSON states: Task, Choice, Parallel, Map, Wait, Pass, Succeed and Fail, with Retry and Catch ([spec](https://states-language.net/spec.html)). `.waitForTaskToken` pauses a Task until `SendTaskSuccess` or `SendTaskFailure`; AWS names human approval as a use case; `HeartbeatSeconds` bounds the wait ([docs](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html)). Versions are "numbered, immutable snapshot[s]"; aliases route between them ([versions](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-state-machine-version.html)). | Data definitions. Immutable versions per execution. **One callback primitive for every external or human wait.** A validation API (`ValidateStateMachineDefinition`) for CI ([CLI ref](https://docs.aws.amazon.com/cli/latest/reference/stepfunctions/validate-state-machine-definition.html)). | AWS replaced its JSONPath data-mapping fields with JSONata in November 2024. With JSONPath, teams wrote Lambda functions for simple transformations, and the five path fields caused "developer pain" ([AWS blog](https://aws.amazon.com/blogs/compute/simplifying-developer-experience-with-variables-and-jsonata-in-aws-step-functions/)). History is capped at 25,000 events, and "the execution will fail" there ([quotas](https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html)). A wait with no heartbeat can sit for a year. | **Adopt** one wait primitive with a token and a timeout (P8). **Avoid** a data-mapping language (P3). **Confirms** pinning. |
| **Conductor** (Netflix, Orkes) | SIMPLE tasks run on external workers. System tasks include WAIT, HUMAN ("stays in progress until an API call completes it"), SWITCH, FORK_JOIN, DYNAMIC_FORK, DO_WHILE and SUB_WORKFLOW ([system tasks](https://docs.conductor-oss.org/documentation/configuration/workflowdef/systemtasks/index.html)). A task type "MUST be registered before being used", with retry, timeout and heartbeat (`responseTimeoutSeconds`) settings ([taskdef](https://docs.conductor-oss.org/documentation/configuration/taskdef.html)). | **Registered task types** with per-type timeouts and heartbeats. Each execution keeps the definition it started with (unverified; [versioning](https://docs.conductor-oss.org/devguide/how-tos/Workflows/versioning-workflows)). | `inputKeys` and `outputKeys` "are not strictly enforced". DO_WHILE has no documented iteration cap, and keeping every iteration risks "database bloat, memory exhaustion"; two expression syntaxes coexist ([do-while](https://docs.conductor-oss.org/documentation/configuration/workflowdef/operators/do-while-task.html)). | **Adopt** a task-type registry (P4), but *enforce* declared inputs and outputs (P3). **Keep** our mandatory loop budget; Conductor's unbounded loop is the failure our checker prevents. |
| **Argo Workflows** | `steps` (sequential groups that run in parallel within a group) or a `dag`. `suspend` until `argo resume` or a `duration` ([suspend](https://argo-workflows.readthedocs.io/en/latest/walk-through/suspending/)). `retryStrategy` with a policy and an expression ([retries](https://argo-workflows.readthedocs.io/en/latest/retries/)). `onExit` "always executes" ([exit handlers](https://argo-workflows.readthedocs.io/en/latest/walk-through/exit-handlers/)). **Executor plugins** add template types as HTTP sidecars; they are off by default and need extra RBAC ([plugins](https://argo-workflows.readthedocs.io/en/latest/executor_plugins/)). | Custom step types behind one small protocol (execute, return a phase). Suspend with a timeout. | Run state in one Kubernetes object hits etcd's 1 MB limit; offloading to a database then hides graph data from tools ([offloading](https://argo-workflows.readthedocs.io/en/latest/offloading-large-workflows/)). | **Adapt** plugins: a step type whose executor runs in the sandbox, speaking the existing JSON protocol (P4). The research agent judged plugin-defined stage kinds an "avoid" for a tiny engine; I disagree only because A-113 asks for that extension point. Keep the set of *effects* fixed. |
| **GitHub Actions** | Jobs run in parallel unless `needs` orders them; `if:` conditions; job outputs capped at 1 MB ([syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)). Environments with up to six required reviewers and "Prevent self-review" ([environments](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment)). Concurrency groups ([concurrency](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs)). `action.yml` declares inputs and outputs. | Declared step inputs and outputs. A human gate as an environment rule, not a step. | **Script injection**: `${{ }}` is substituted into the script before the shell runs, so an attacker-controlled PR title runs commands. The fix is to pass values through `env:` ([hardening](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)). The "skip if any need was skipped" rule forces `always()` workarounds. | **Adopt** "data reaches a step as a file or variable, never templated into argv"; `SF_REQUEST` already does this, so keep it for P3's outputs. **Avoid** an expression language. |
| **Airflow, Dagster, Prefect** | Data-pipeline DAGs. Airflow 2 always ran the latest DAG code, so one run could mix versions; Airflow 3's versioned DAG bundles keep a run on one version (unverified; [Astronomer](https://www.astronomer.io/docs/learn/airflow-dag-versioning), [AIP-63](https://cwiki.apache.org/confluence/display/AIRFLOW/AIP-63%3A+DAG+Versioning)). Dagster checks `DagsterType` on op inputs and outputs at run time ([types](https://docs.dagster.io/concepts/types)). | Typed IO (Dagster). | Airflow's years of unpinned runs are the cautionary tale for not pinning. | **Confirms** pinning. **Adapt** Dagster's run-time checks of outputs against a declared shape (P3). Prefect was not researched. |
| **BPMN 2.0, Camunda** | Exclusive, parallel, inclusive and event-based gateways. In an event-based gateway, the first event wins ([Camunda](https://docs.camunda.io/docs/components/modeler/bpmn/event-based-gateways/)). Boundary timers on tasks, compensation, call activities. User tasks with `assignee` and `candidateGroups` ([user task](https://docs.camunda.org/manual/latest/reference/bpmn20/tasks/user-task/)). | "Running process instances will continue to run in the version they were started in" ([versioning](https://docs.camunda.org/manual/latest/user-guide/process-engine/process-versioning/)). An approval racing a timeout as one construct (the event-based gateway). | Instance migration needs a mapping for every active element; it cannot change element types, and the instance must be in a wait state ([migration](https://docs.camunda.io/docs/components/concepts/process-instance-migration/)). Moving live instances between graphs is hard. | **Confirms** pinning. **Avoid** migration: a changed workflow means a new cycle. **Adapt** "a decision or a timeout signal, whichever comes first" for wait stages (P8). Assignees later. |
| **XState, statecharts, SCXML** | Compound, `<parallel>` and `<history>` states, `<final>` with `done` events, `<invoke>` ([SCXML](https://www.w3.org/TR/scxml/)). Model-based testing through `xstate/graph`: `getShortestPaths`, `getSimplePaths` and `createTestModel` ([graph](https://stately.ai/docs/graph)). | **Path generation from the machine as data** for tests. | Users report a steep learning curve and verbosity (forum and blog sources, weak). | **Adopt** path enumeration (P7). **Avoid** hierarchy, parallel states and history at the top level. |
| **Petri nets, workflow nets** | van der Aalst's soundness has three parts: option to complete, proper completion, no dead transitions. It is decidable in polynomial time for free-choice nets, and hard or undecidable for most extensions ([van der Aalst](https://www.vdaalst.com/publications/p628.pdf)). The theorem statements were seen through snippets only. | A precise vocabulary for what a checker should prove. | Soundness gets expensive as soon as you add tokens (parallelism) or extensions. | Our one-token machine is a safe free-choice net. `checkWorkflow` proves option to complete (a path to settled) and, with budgets, termination; proper completion holds trivially. **It does not prove "no dead transitions"**: there is no reachability check, and FAIL edges out of commit stages are dead by construction (G14). **Adopt** the vocabulary in the spec, and add a reachability warning (P7). This is also the reason to keep parallelism inside a step type (P10), not in the engine. |

### Agent and factory frameworks

| System | Model | Gets right | What bit users or is risky | For us |
| --- | --- | --- | --- | --- |
| **StrongDM Attractor** (`repos/strongdm_attractor/attractor-spec.md`) | A Graphviz DOT graph. One node runs at a time at top level (§3.8). Handlers come from a registry keyed by `type` or shape (§4.2, §4.12). The outcome is `SUCCESS / PARTIAL_SUCCESS / RETRY / FAIL / SKIPPED`, plus `preferred_label`, `suggested_next_ids` and `context_updates` (§5.2). Edges carry conditions in a small expression language (§10). `checkpoint.json` is saved after every node (§5.3). | **Parallelism lives inside a handler** (§4.8 `parallel` with `join_policy`, §4.9 fan-in), so the engine keeps one active node. Pluggable handlers. Lint rules with severities, including `reachability` as an ERROR, and custom lint rules (§7.2-7.4). A DOT file renders as a picture for free. | There is no termination rule: loops are bounded only by per-node `max_retries`, and `goal_gate` plus `retry_target` can loop. Routing can follow an LLM's `preferred_label`. The shared mutable `context` is a global key-value bag with naming conventions, not declared inputs. The checkpoint is a snapshot, not an event log, so there is no audit trail of decisions. | **Adopt** a handler registry with a common outcome (P4), parallel as a step type (P10), and lint severities, warnings and custom rules (P7). **Adapt** routing: a step may *propose* a named outcome, but only from the stage's declared outcomes; that is what a verdict already is. **Avoid** the global context bag and the condition language (P3). |
| **no-mistakes** (`repos/kunchenguid_no-mistakes/repo`) | A fixed linear pipeline: intent, rebase, review, test, document, lint, push, pr, ci (`internal/types/types.go:61-69`, `:139-140`). A Go `Step` interface returns a rich `StepOutcome`: `NeedsApproval`, `AutoFixable`, `Findings`, `RestartFrom`, `ReviewApprovedHeadSHA` (`internal/pipeline/pipeline.go:166-219`). | **A parked gate the owner answers in place** with `approve / fix / skip / abort` (`internal/types/types.go:283-286`). An approval that overrides a red condition is recorded as an explicit override (`ApprovalOverrideVerifier`, `pipeline.go:269-292`). `RestartFrom` lets a step send the run back to an earlier step. `ApprovalGateReconciler` settles a parked gate from an external source of truth (a merged PR) (`:224-235`). | Steps and order are fixed in Go; a user cannot add a step. | **Adopt** in-place owner decisions with override records (P1). **Adopt** "an external source settles a parked gate" for row 12 (P8). |
| **OpenAI Symphony** (`repos/openai_symphony/repo/SPEC.md`) | The tracker's states are the workflow. The orchestrator is a poll-and-reconcile loop: "Reconciliation runs before dispatch on every tick" (§7.4, §8.1). There is no durable orchestrator database (§7.4). `WORKFLOW.md` hot-reloads, and applies to future dispatch only (§6.2). | Level-triggered reconciliation; distinct terminal reasons for runs, "because retry logic and logs differ" (§7.2). | No pinning: a reload changes behaviour for in-flight issues at their next dispatch. Retries with no cap (§8.4). | **Adopt** the reconcile loop shape for the driver (P8). **Avoid** hot reload without pinning, and uncapped retries. |
| **LangGraph** | A `StateGraph` over typed state with per-key reducers. Conditional edges; the `Send` API for map-reduce; `Command(update, goto)`. Pregel-style super-steps, where "Nodes that run in parallel are part of the same super-step". Recursion limit 1,000 super-steps ([graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)). Checkpointer per thread. | `interrupt()` plus `Command(resume=...)`: a human resumes the same thread in place ([interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)). | "Any code that ran before the interrupt will execute again." Resume values match interrupts "strictly index-based". Side effects before `interrupt` must be idempotent. "A node can write to any state channel": no declared inputs. | **Adopt** resume-in-place (P1). **Avoid** shared writable state and index-matched resumes. Our resumes should name the decision and the SHA (P2). |
| **Mastra** | Steps built with `createStep({ inputSchema, outputSchema })`. `.then`, `.parallel`, `.branch`, `.dowhile`, `.dountil`, `.foreach({concurrency})`, `.map`. A workflow can be a step. Suspend and resume ([overview](https://mastra.ai/docs/workflows/overview), [control flow](https://mastra.ai/docs/workflows/control-flow)). | "Each step's `outputSchema` must match the next step's `inputSchema`": data contracts between steps are explicit, and `.map` reshapes when they differ. Nested workflows. | Code-defined, and bound by schema library (Zod and others). I found no documented version pinning of persisted runs. | **Adopt** declared input and output shapes per step, checked along each edge (P3). This is the clearest model for A-109's owner note. |
| **OpenAI Agents SDK** | Handoffs "are represented as tools to the LLM" ([handoffs](https://openai.github.io/openai-agents-python/handoffs/)). The host defines the destinations, `input_filter` and `is_enabled`. | Clean separation of what the receiving agent sees (`input_filter`). | The model chooses the route. | **Avoid** for control flow (D-001: agents claim, the controller decides). |
| **CrewAI Flows** | `@start`, `@listen`, `@router` returning labels; `or_` and `and_` joins; structured state; `@persist`, and fork through `restore_from_state_id` ([flows](https://docs.crewai.com/en/concepts/flows)). | Router labels declared as a `Literal` so `flow.plot()` can draw them; `and_` joins. | `@human_feedback` with `emit` uses **an LLM to map the human's reply to an outcome**: a nondeterministic reading of a human decision. | **Adopt** declared outcome labels that a plot can draw (P3, P7). **Avoid** LLM-classified human decisions. |

## 5. Ranked proposals

Effort is S, M, L or XL. Impact runs from 1 to 5.

### P1. Owner decisions on an escalated cycle, in place

- **Description.** Make ESCALATED a stage that waits for the owner, as a human stage does, instead of a dead end.
  - **New event:** `owner_decision { action, reason, source, commandId, head }`.
  - **Actions:**
    - `retry`: re-enter the stage the cycle escalated from. Spent budget stays spent.
    - `overrule`: A-109 B. Mark the FAIL wrong with a quoted reason, refund one unit of that stage's budget, and re-run the stage.
    - `route <stage>`: go to a named workflow stage. The checker lists which stages may be named.
    - `cancel`: as today.
  - **A child cycle stays** for "start over". Add DBOS's "fork": an option to open the child at a named stage with the parent's candidate, rather than from the base.
  - Every decision is recorded with its source and, for an overrule, its reason. That is no-mistakes's `OverrideReason`.
- **Decision implied.**
  - D-016 widens: anything unclassified still escalates, and the owner chooses child, cancel, **retry, overrule or route**.
  - "ESCALATED never moves again" (`SETTLED`, `src/lifecycle.ts:13-14`) stops being true. The one-open-cycle rule must then treat ESCALATED as open-but-waiting, as it already does for the parent check.
  - A-072 Q2 is answered in the overrule's favour, which A-109 B already chose.
- **Cost.** M. The new event and its `apply` case, the `SETTLED` and open-cycle rules, `decide.ts` (A-112 item 2), and the guide's shims. It touches A-105 (a crash still escalates, but then costs one `retry`, not a new cycle) and O-011.
- **What it buys.**
  - A-109 B becomes buildable.
  - Row 11 recovery stops throwing away work.
  - The live run 1 case resolves in one command.
  - The data for O-011 (what owners actually choose) gets recorded.
- Impact 5. Confidence high. Every studied system that has a human gate resumes in place:
  - no-mistakes (`approve / fix / skip / abort`);
  - LangGraph (`Command(resume)`);
  - Temporal (signals);
  - Restate (awakeables);
  - Step Functions (task token);
  - DBOS (fork).
- **A-113 fit.** The capability goes in the core. Policy goes to extensions: an observer may issue `retry` for infrastructure failures with its own `source`. That is opt-in automatic relaunch, without changing A-105's default.

### P2. Bind every owner or external event to a SHA, and give it an idempotency key

- **Description.**
  - `request_changes` gains `head`, checked as `accept`'s is.
  - Every event from outside a run gains an optional `commandId`: `accept`, `request_changes`, `cancel`, `owner_decision`, and future signals. The store dedups it with a second partial unique index, as it dedups run outcomes.
  - `main.ts` and the observer kit's `Owner` mint the IDs. An observer's retry passes the same ID again.
- **Decision implied.** Spec principle 2 extends to human verdicts. 10-d's observer contract gains "send the same command ID on retry".
- **Cost.** S. It widens A-074 Q6a and 10-d. Do it **before** row 12, or any `request_changes` producer, exists.
- **What it buys.** It closes the probe's failure: a redelivered rejection lands on a candidate nobody read, then a late accept escalates. It also makes at-least-once observers safe. T3 Code's "command receipts" and DBOS's idempotency keys are the precedent.
- Impact 4. Confidence high (reproduced). **A-113 fit:** a core capability that every extension relies on.

### P3. Named outcomes, and declared step inputs and outputs (the A-108 and A-109 design)

- **Description.**
  - A stage declares its **outcomes**, with transitions keyed by them. The default is `PASS`/`FAIL`, so today's workflows are unchanged. A review step type declares, for example, `PASS`, `PASS_WITH_MINORS`, `FAIL` and `NEEDS_OWNER`.
  - A stage declares its **inputs** by name and source, for example `findings: from STANDARD_REVIEW` or `failedChecks: from VERIFYING`. Its step type declares its **outputs**.
  - `checkWorkflow` checks that every input is produced on every path into the stage. That is the dataflow version of today's `driverLimits`. Delete `driverLimits` once it is covered.
  - Outputs are SHA-bound files under `evidence/<head>/<stage>/`, with a hash in the outcome event, and are read by the next step from its request file. **Never** interpolate them into argv or prompts through an expression language.
- **Decision implied.**
  - Unpark A-074 Q8.
  - A-108's "a commit stage's input: findings, failed checks or none" becomes three input declarations, and its "no change" outcome becomes a named outcome.
  - A-109 A's routes become workflow edges, not core rules.
- **Cost.** M to L. It widens A-056 (event shape) and A-057, and reverses `driverLimits` (A-096).
- **What it buys.** All three refused shapes in `shapes.ts` become writable and checkable. A-109's "needs the owner" routes without core policy. The plan's "data passed between steps" row is met.
- Impact 5. Confidence high on the need; medium on the exact schema.
- **A-113 fit.** This is the extension point that lets policy live in the workflow. Mastra (schemas checked between chained steps), GitHub Actions (`action.yml` inputs and outputs) and Attractor (outcome plus labels) show the shape. ASL's JSONPath and later JSONata, and Actions' `${{ }}`, show what to avoid: a home-grown expression language.

### P4. A step-type registry: the engine keeps three effects, step types plug in

- **Description.**
  - Move kind-specific code out of `apply` and `drive`. The engine keeps a small generic lifecycle per stage visit:
    - `step_started` (A-105 needs this anyway);
    - one outcome event, `{ stage, runId, head, outcome, outputs, versions }`;
    - three effects only the core performs: **candidate change** (a commit, with `land`'s checks), **evidence about the head** (anything with an outcome bound to `head`), and **wait for a decision** (a human or a signal).
  - A step type is registered by name. It declares:
    - its config schema;
    - its inputs and outputs (P3);
    - its outcomes;
    - which effect it may claim;
    - its executor: built in, a command in the sandbox, or a runtime adapter.
  - Today's `develop`, `fix`, `review` and `verify` become the first four registered types. Old event types stay readable through a mapping, so old logs replay.
- **Decision implied.**
  - Revisit D-024 ("no separate extension step kind"). A command stage stays one step type, but extensions can add types that return verdicts, outputs or commits through the same effects.
  - Revisit A-057's approach A (a switch on event type).
- **Cost.** L to XL. It touches every module, the event schema (keep backward-compatible replay) and the guide.
- **What it buys.** These no longer need a core edit:
  - acceptance evidence;
  - A-112 item 10 (a reviewer's failing-test script run at the SHA);
  - the editing reviewer;
  - Design Studio steps with no candidate.
- **Precedents.** Conductor's registered task types and Argo's executor plugins, and Attractor's handler registry (§4.2, §4.12). Temporal's activities are the same split: the engine knows a generic task lifecycle, and workers own the semantics.
- Impact 4. Confidence medium: large, and the right cut of "effects" needs a design note.
- **A-113 fit.** This is A-113 applied to the engine itself. **Guardrail:** a step type returns a claim that maps onto one of the three effects. It never sets `stage` or budgets, so D-001 and the SHA rule stay core.

### P5. Exhaustion edges and cycle-level limits

- **Description.**
  - `transitions.EXHAUSTED` says where a stage goes when its budget is spent. The default is `ESCALATED`, as today.
  - Optional cycle limits: `maxAgentRuns`, `maxCostUsd` (once A-111's run records exist) and `maxWallClock`. Each escalates with a reason.
  - The limits count every run, including those an owner's move starts (11-d2). `retry` spends no budget and needs no FAIL, so stage budgets alone do not bound a `retry` loop from an observer.
  - The checker treats EXHAUSTED edges as edges in the loop rule, so termination still holds.
  - The checker warns when a budget-1 stage has a FAIL edge, because that edge is never followed (G14).
- **Decision implied.** It widens D-023's "every agent loop has a finite budget" to the whole cycle, and gives O-007 its engine hook.
- **Cost.** S to M.
- **What it buys.** "A stronger model on the last round" (A-113 item 3) as a loop instead of an unrolled graph, the Superpowers ladder, and a budget the owner can name in dollars.
- Impact 3. Confidence high. **A-113 fit:** capability in the core; the default workflow sets none.

### P6. Detect replay divergence; version the engine; replay leniently

- **Description.**
  - Store the stage `apply` produced as a check column on each row, `to`. It is a checksum, not a source of truth.
  - On load, compare. On a mismatch, refuse to drive the cycle and name the first row that diverged, as Temporal's `NON_DETERMINISTIC_ERROR` and Restate's RT0016 do.
  - Record an engine version on the open row.
  - When replaying a recorded definition (A-112 item 6), use a **replay check**: only what `apply` needs to not crash. Run the full `checkWorkflow` only on new cycles, so a tightened rule never makes an old cycle unloadable (G9).
- **Decision implied.** It partly reverses the rejection of alternative 3 in 10-d: the column is a checksum, and `apply` stays the one source. It refines A-112 item 6.
- **Cost.** S to M.
- **What it buys.** An engine change can no longer silently move settled cycles. Upgrades get a test: replay every real store and diff.
- Impact 3. Confidence high. **A-113 fit:** neutral; it protects the core's guarantee.

### P7. Workflow tooling: JSON Schema, lint with severities, a picture, and path enumeration

- **Description.**
  - Ship a JSON Schema for workflow files, alongside A-111's JSON loading, so editors validate them.
  - Split `checkWorkflow` into errors and **warnings**. Warn on: an unreachable stage, PASS to ESCALATED with no reason, a budget-1 stage with a FAIL edge, and a grant stage before a review PASS (move that rule from run time to the checker).
  - Accept custom lint rules from the personal layer, as Attractor does (§7.4).
  - Add `workflow show`, which prints Mermaid or DOT from the definition.
  - Add **`workflowKit(w, invariants)`**. Because `apply` is pure, enumerate every outcome sequence up to the budgets (`fuzz.ts` does a random version in under a second). Assert the invariants. Report the worst-case number of paid runs per cycle.
- **Decision implied.** None big. It fits A-111's JSON workflows.
- **Cost.** S to M.
- **What it buys.** Users can test their own workflows the way XState model-based testing does. The owner can see a workflow's worst-case cost before running it. It gives O-007 a number.
- Impact 3. Confidence high.

### P8. The driver as a reconciler, and a generic wait stage

- **Description.**
  - Turn `drive` into a level-triggered `reconcile(cycleId)`: read the stored state, then do the next action. Before any side effect, append `step_started`. The same function is called by:
    - `run` and `resume`;
    - `accept` (drive on after a human stage);
    - `recover` (every unsettled cycle);
    - row 12's sync;
    - a daemon tick, if O-006 picks a daemon.
  - Generalise the human kind into a **wait stage**. It declares named signals and the outcome each maps to (for example `accept → PASS`, `request_changes → FAIL`, `merged → PASS`). Any source may append a signal through the owner commands, as an observer does today. That is Restate's awakeables, Step Functions' task token, and no-mistakes's `ApprovalGateReconciler`.
  - Timers stay outside the engine. A watchdog observer appends a `timeout` signal, so `apply` stays pure, and the timeout is a recorded event, as Temporal records timers.
- **Decision implied.** It builds on A-112 item 2 (exported `drive`). It closes the grant-after-human gap, and widens D-024's observer rule so observers may send declared signals.
- **Cost.** M.
- **What it buys.** One code path for row 11, row 12 and A-113's watchdog.
- Impact 4. Confidence high. **A-113 fit:** the core gives the signal capability; the reminder and escalation timing is an observer's policy.

### P9. Keep high-frequency telemetry out of the replayed log; make the history append cheap

- **Description.**
  - Heartbeats and progress (A-113) go to their own table or file, read by the stream but never by `apply`.
  - Change `record` to avoid copying the history on every event, or have `load` keep history out of the reducer.
- **Cost.** S.
- **What it buys.** It avoids the quadratic replay (G10) before A-113 produces many events.
- Impact 2 now, 3 with pools. Confidence high (measured).

### P10. Parallel review and command stages, as a step type rather than a second engine

- **Description.**
  - A `parallel` step type runs several verdict or command branches on the same head. It joins them with a declared policy:
    - all PASS;
    - any FAIL, with each branch's findings merged;
    - a quorum.
  - The top-level engine keeps one active stage, as Attractor's `parallel` handler does (§3.8, §4.8).
  - No commit step may sit inside a branch: one writer per branch (source §06).
  - Budgets count per branch.
- **Decision implied.** Needs P4, and the pool decision (row 13, A-112 item 5), because the driver must run steps at once. That means async git, per `architecture.md` finding 9.
- **Cost.** L.
- **What it buys.** A second reviewer no longer adds its full wall time to every cycle. Best-of-N developers stay out of scope: they need several candidates, which breaks the one-candidate rule, and are not worth it yet.
- Impact 3. Confidence medium.

### P11. Composition: successor cycles under another workflow

- **Description.** At a settled stage, a workflow may name a successor workflow. The release lifecycle after ACCEPTED is the example. The store opens a linked cycle under that workflow with the same work ID and the accepted head. This is Temporal's Continue-As-New with a new definition, and Camunda's call activity, without nesting.
- **Cost.** M. Defer until O-009 or O-012 needs it.
- Impact 2. Confidence medium.

### Keep as it is (with reasons)

- **A pure `apply` over an append-only log, and a workflow as data.** Section 4 shows the code-replay engines' main pain. We do not have it.
- **One active stage at the top level.** Attractor keeps it too, and puts parallelism inside a node type. A Petri-net or BPMN token model would cost a great deal of checker and replay complexity for flows the factory does not run yet.
- **No compensation or saga engine.** A grant stage's FAIL escalates (`src/lifecycle.ts:336`). A wrong merge is undone by a new cycle that reverts it. General compensation (BPMN compensation, Step Functions `Catch` chains) is for many outward effects per run; we have one or two, and the owner should see each one.
- **No agent-chosen routing.** OpenAI handoffs, Attractor's `preferred_label` and CrewAI's LLM-mapped human feedback put the model in charge of the next stage. A verdict choosing among *declared* outcomes (P3) is the safe version.
- **No human assignees yet.** Camunda's `assignee` and `candidateGroups` matter for teams. `source` is enough for one owner. Revisit with the corporate deployment.

## 6. Challenged decisions

### Revisit

- **D-016 and the spec's principle 3 ("the owner chooses: a new cycle, or cancel").** Keep "anything unclassified escalates". Widen the owner's moves to include retry, overrule and route, in place (P1). The evidence: every studied system with a human gate resumes in place, and the factory's own decisions (A-105, A-109 B, O-011) keep running into this wall.
- **`SETTLED` including ESCALATED, and "escalated cycles … never move again"** (`src/lifecycle.ts:13`). The same point, at the code level.
- **D-024 ("a custom step is a command stage; there is no separate extension step kind").** A command stage can return only an exit code. A-108, A-109, A-112 item 10 and the acceptance-evidence row each need a step that returns a commit, a verdict or data. D-024 was right to avoid a *protocol* for steps. It is wrong to make the command stage the only shape (P4).
- **A-074 Q8 (named outcomes parked).** Unpark it now. A-109 A needs at least three outcomes. Building A-109 on PASS/FAIL would hard-code its routing into the core (P3).
- **A-057 approach A (a switch on event type; new step kinds arrive as new cases).** Under A-113 this makes every step kind a core change. It was the right call for 09-a. It should not be the pattern for row 13 (P4).
- **10-d's rejection of "store the stage on each row".** Keep `apply` the source, but store the stage as a checksum to detect divergence (P6).
- **A-112 item 6 ("replay … when that passes `checkWorkflow`").** Use a lenient replay check, not the full checker, or a future tightening strands old cycles (G9).
- **A-056 Q2 (the `step` field).** No producer sets it. Either make every producer set it (it becomes the fence for parallel branches and stale events) or drop it. I recommend setting it.
- **A-108 item 2, and the "VERIFYING FAIL → ESCALATED" default.** Not a challenge to the owner's choice to keep the default. Note only that the cheapest route to the A-108 primitive is P3, not a third `driverLimits` exception.

### Confirmed

- **A-054, A-056 Q1, D-023: a strong core and a workflow as checkable, hashable data.** Confirmed by the comparison. No surveyed durable engine makes a data definition the workflow; the closest are Temporal's DSL sample and Inngest's Workflow Kit. Ours is a deliberate strength.
- **A-059 Q2 and A-112 item 6: pin a cycle to its definition hash; replay under the recorded definition.** Confirmed. This is what DBOS (a source hash, recover only on the same version), Azure (a version "permanently associated" with an instance), Temporal (pinned versions), Restate (immutable deployments) Step Functions (immutable versions), Conductor and Camunda ("continue to run in the version they were started in") do.
- **A-054's "every agent loop has a finite budget", checked statically.** Confirmed, and stronger than Attractor, LangGraph and Symphony. Fuzzing found no counterexample.
- **A-105 (always escalate a crashed run).** Confirmed as the default. With P1, the cost of that choice falls to one owner command.
- **A-113 (capabilities in the core, policy in workflows and extensions).** Confirmed, with two caveats:
  1. An extension point must never bypass the core's three guarantees: the controller decides, evidence binds to a SHA, and loops are budgeted. Every proposal here keeps step types and observers on the claim side.
  2. A capability with no workflow that uses it in a test is unproven. Each one should ship with a test workflow, as 09-b did with `DEV → CHECK → REVIEW → OWNER`.
- **D-001 (deterministic controller).** Confirmed against agent-routing frameworks.
- **A-112 item 5 (no pool direction yet).** I add only one input. If P8's reconciler is built, "one process per cycle" and "one process for many cycles" become the same code with different callers, which lowers the stakes of the choice.

## Scratch

Probes: `fuzz.ts`, `fuzz2.ts`, `cap.ts`, `shapes.ts`, `human.ts` and `replay.ts` in `/var/tmp/software_factory/research-foundations/engine/probes/`. They import from the worktree, which has since been removed, so rerunning them needs a fresh worktree at `42f174e`. `repos/strongdm_attractor` was cloned shallow for this report. It holds specs only; nothing was run.
