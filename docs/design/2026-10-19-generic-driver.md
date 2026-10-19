Branch: feat/09-b-generic-driver

# Generic driver (ticket 09-b)

## Problem

09-a made `apply` run any workflow that passes `checkWorkflow`, but the driver still runs only the default one. `src/run.ts` switches on the four default stage names. `review` and `requireStage` find a role or stage through two fixed tables (`ROLE_FOR_STAGE` at `src/review.ts:33`, `REVIEW_STAGE` at `src/controller.ts:31`). `verify` and `fix` check for `VERIFYING` and `DEVELOPING` by name. `main.ts` prints role labels for the two default review stages. The step cap is a constant 10. A cycle can't be resumed, and nothing records which workflow a cycle was opened under, so a resume could replay a cycle under the wrong workflow.

Facts the design must respect:
- A workflow must start on a commit stage. Only a developer `claim` leaves `QUEUED`, and `apply` escalates a claim anywhere else.
- `review` reads only the tree and evidence that `verify` produced for the candidate. A review stage therefore needs a command stage before it.
- The store already replays under one workflow, so steps can read the workflow from it.

## Approaches considered

**A. One implementation per role.** The registry maps each role to a function bound to its adapter. A new role needs a new entry, and most entries are the same function with a different adapter.

**B. One implementation per step kind, one adapter per role.** The registry maps a step kind to its function. Roles map to adapters. A user workflow that names new roles needs no new code. Row 10's extension steps become a new kind.

**C. One function per workflow.** The ticket rejects it: no step reuse.

## Chosen approach

Approach B, with the owner's answers to Q1 to Q3 (A-059).

**Registry.** A step kind is the stage's `kind`, refined by `produces` for agent stages:

| Kind | Default step | Notes |
| --- | --- | --- |
| agent, `commit` | develop or fix | fix when the candidate has a head |
| agent, `verdict` | `review` | the role comes from the stage definition |
| command | `verify` | runs `job.checks` |
| human | none | the loop stops and returns the cycle |

A step is `(ctx: StepContext) => Promise<Cycle>`. The context carries the store, the loaded cycle, the stage definition, the role's adapter, the job, the options and the step's inputs. The driver works out the inputs; today the only one is the last FAIL verdict's findings for a fix run. The exported `develop`, `fix`, `verify` and `review` keep their signatures for their own tests, and the default steps wrap them.

**Adapters by role.** `run` takes adapters as a map from role to adapter. Today's `Adapters` shape (`developer`, `standard`, `adversarial`) is still accepted. One alias table, in one place, maps `standard` to `standard_reviewer` and `adversarial` to `adversarial_reviewer`. The job file's `runtime` uses the same keys and aliases (Q3). Before any run, the driver refuses a workflow with an agent role that has no adapter.

**Generic guards.** The step guards check the stage kind from the store's workflow, not a stage name: `verify` needs a command stage, `fix` a commit stage with a candidate head, and `review` a verdict stage. `requireStage` checks that the run's role is the current stage's role. `ROLE_FOR_STAGE` and `REVIEW_STAGE` go away. `main.ts` prints each verdict under the role of the stage it came from, and the review counts per budgeted stage. `main` exits 0 when the cycle stops at any human stage, not only `AWAITING_ACCEPTANCE`, and prints the accept hint there.

**The loop.** The loop moves out of `run` into `drive(store, cycleId, adapters, job, opts)`. `run` is develop, then `drive`. `resume(store, cycleId, …)` is `drive` alone, so a cycle left at `VERIFYING` runs its checks and continues without a developer run. A step that throws still escalates the cycle with `reject_dispatch`, naming the stage.

**Step cap.** The cap is (sum of budgets + 1) × number of stages. `checkWorkflow` refuses any loop that spends no budget, so between two budget spends a cycle visits each stage at most once. The default workflow's cap becomes 20. Reaching it is still a controller bug.

**Workflow record (Q2).** This moves from 09-c to 09-b. `Workflow` gets an optional `name`, and `defaultWorkflow` is named `default`. A content hash is the SHA-256 of the workflow's JSON. `store.open` writes the name and hash into the open marker. `load` refuses a cycle whose recorded hash does not match the store's workflow, with a reason naming both. A marker with no hash counts as the default workflow, so stores written before 09-b still load under the default.

**Job file (Q3).** `"workflow": "<path>"` names a TypeScript module, resolved against the job file, whose named export `workflow` is the definition. With no `workflow` field the job uses `defaultWorkflow`. `main` imports the module and builds the store with it. A workflow that `checkWorkflow` refuses is refused before any run, with the reasons. The `accept` and `cancel` commands load the same workflow from the same job file.

**The second workflow in the tests (Q1).** `DEV → CHECK → REVIEW (role reviewer, budget 1) → OWNER (human)`, run with fake adapters from open to `OWNER`. It replaces the ticket's "two stages", which the engine can't start.

**Parked 08-f minor.** One timeout test per controller git call site in `developer.ts` and `verify.ts`, each with a deadline other than 2000. It is independent of the rest and can come first.

## Risks

- **One workflow per store.** A store opened with workflow X refuses to load a cycle recorded under Y, including inside `store.cycles(workId)`, which `open` uses for its guards. Running two workflows over one runs directory for the same work ID fails with the refusal, not silently. A store that holds several workflows waits for a need.
- **The hash depends on key order.** The same module gives the same JSON, so a resume with an unchanged module matches. Reordering the keys in a workflow file counts as a different workflow. That is safe, but the owner may see a refusal after an edit that changes no behaviour.
- **A commit stage re-entered without a FAIL verdict.** Under the default workflow, the commit stage is re-entered only after a standard FAIL. A user workflow can loop back after a PASS (the loop test in `tests/lifecycle.test.ts`). The fix step then has no findings. The driver escalates that case with `reject_dispatch` and leaves it to the owner, rather than inventing a prompt.
- **The alias table keeps two default names in the driver.** It exists only so that today's `Adapters` and job files keep working. A test with no aliases (Q1's workflow) proves the driver doesn't depend on it.
- **The cap is loose.** 20 for the default workflow, where 10 caught a stalled stage sooner. A stage that returns without moving the cycle runs up to twice as many steps before it escalates, and a step can start a paid run before it returns.
- **09-c shrinks.** It loses the cycle-record item and keeps the prompt split and the per-run version hashes.
