# 07-b — End-to-end loop: READY to a reviewable branch

Route: Design. The loop is the owner's one command and the surface the reconcile and GitHub tickets extend; what it returns and how it treats a stage that throws have real alternatives. Approved A-032. Stacked on 07-a.

Goal: one `Job` goes from nothing to AWAITING_ACCEPTANCE (or ESCALATED, or CANCELLED) through `develop`, `verify`, `review`, `review`, with one `fix` after a standard FAIL, with no call between stages by a human, and the owner is told the branch and head to diff and merge.

## Design note

### Seam

One module, `src/run.ts`. It owns the order of stages and nothing else: each stage module already decides what it needs from the store and `runsDir`, and `apply` already decides where a result sends the cycle.

```ts
export interface Adapters {
  developer: DeveloperAdapter;
  standard: Adapter;
  adversarial: Adapter;
}

export interface RunOptions {
  /** Per stage: the developer run, each check, each reviewer run. */
  deadlineMs: number;
  /** Shared by every stage. Default /var/tmp/software_factory/runs. */
  runsDir?: string;
  /** Passed to verify. Default cgroup. */
  isolation?: VerifyOptions['isolation'];
  /** Passed to review. Default ['AGENTS.md']. */
  instructions?: string[];
}

export interface RunResult {
  cycle: Cycle;
  branch: string;
  worktree: string;
  /** Set when a stage threw: the message, after the cycle was escalated with it. */
  error?: string;
}

/** Drive one job from open to a stage the loop cannot leave. Never advances a stage itself. */
export function run(store: EventStore, adapters: Adapters, job: Job, opts: RunOptions): Promise<RunResult>;
```

Behind it:

1. `develop(store, adapters.developer, job, opts)`. A throw here propagates: `develop` has already cancelled any cycle it opened, and there is nothing for the loop to record.
2. Then, while the stage is one the loop can act on, one call per iteration on `cycle.stage`: DEVELOPING → `fix` (reached only after a standard FAIL; `apply` never returns to DEVELOPING otherwise), VERIFYING → `verify`, STANDARD_REVIEW → `review` with `adapters.standard`, ADVERSARIAL_REVIEW → `review` with `adapters.adversarial`. Every other stage (AWAITING_ACCEPTANCE, ESCALATED, CANCELLED, ACCEPTED, QUEUED) returns. The lifecycle's budgets bound the loop at two developer runs, two verifications and three reviews; a cap of ten iterations is the belt, and reaching it escalates as a controller bug.
3. A stage that throws is the spec's "cannot classify": the loop appends `reject_dispatch` with `<stage>: <message>` (the one event that escalates with a reason; nothing else is counted), and returns with `error` set. No retry, no cleanup of the worktree or checkout: the owner reads the message and decides.
4. Returned to the owner: the Cycle (stage, candidate head and base, counters, and the verdicts with their findings in `history`), the branch `sf/<cycleId>` and the worktree. With no GitHub remote, the "PR" is that branch in the repository: the owner runs `git diff <base>..<head>` and `git merge --no-ff sf/<cycleId>`. `accept` stays an owner event recorded by hand (spec: humans accept).

**Entry point.** `src/main.ts`, run as `node src/main.ts <job.json>`: reads `{ workId, ticket | ticketFile, repo, base?, checks, runtime: { developer, standard, adversarial } }` with each runtime `claude` or `pi`, opens the store at `<runsDir>/events.sqlite`, builds the real adapters from the 05-b and 06-b specs, calls `run` with a 120 s per-stage deadline, prints the final stage, branch, head, each verdict and its findings, the escalation or error if any, and the two Git lines above; exits 0 on AWAITING_ACCEPTANCE, 1 when the loop ran and stopped anywhere else, 2 when nothing ran (bad job file, unknown runtime name, a `develop` throw). Thin enough that the live test is its only test.

**06-c parked minor.** `verify` records a dirty tracked tree after the checks as a failed check named `tree` (evidence: the `git status --porcelain --untracked-files=no` output as stdout, `dirty` as exit), so a formatter or codegen check escalates the cycle with evidence instead of leaving it in STANDARD_REVIEW with `review` refusing on every call. `tree` is reserved: a job declaring a check by that name is refused as the duplicate-name rule refuses today. A clean tree records nothing, so the empty-checks event stays empty and existing verify tests hold. `review`'s dirty guard stays as the backstop.

### Alternatives

Stage throw: (1) escalate with `reject_dispatch` and return (chosen); (2) leave the cycle in its stage and rethrow, rejected because a restarted controller would find an open cycle with no record of why it stopped, and the 06-c minor shows a throw that repeats on every retry.

Return value: (1) the Cycle plus branch and worktree (chosen: the verdicts are already on the Cycle); (2) a flattened summary object, rejected as a second shape for the same facts; (3) print inside `run`, rejected because the tests would read stdout.

Entry point: (1) `src/main.ts` over a job file (chosen); (2) none until step 8, rejected because the plan row says one command and the live test would be the only caller.

Dirty tree: (1) `verify` records `tree: FAIL` (chosen); (2) `git checkout -- .` before review, rejected because it hides that the checks changed the commit's files and the reviewers would judge a tree the checks did not run on.

### Parked lines

| Line | How 07-b treats it |
| --- | --- |
| 06-c adversarial minor, dirty tree strands review | Fixed here: `tree: FAIL` recorded by `verify`. |
| 07-a adversarial minor and note, verdict `findings` shape and newlines in the fix prompt | Fixed here: `prompt` in `developer.ts` coerces `findings` to `string[]` and flattens newlines; one test with a string `findings` and one with a newline. |
| 02-a adversarial notes, busy timeout | Not touched: one process on the database. |
| 05-b notes, store failure after the claim | Not touched: reconcile ticket. The loop's `error` path covers a throw before a run starts, not one between a run's outcome and its event. |
| 06-a adversarial major and minor (symlink, hooksPath), 05-a minor (pi bash), 05-b minor (claude settings) | Not touched: `main.ts` is for scratch repositories until the pi-policy or sandbox ticket (A-029). |

## Done when

- Happy path: `run` with the fixture developer (`commit`) and fixture reviewers (`verdict pass`, `verdict pass`) returns AWAITING_ACCEPTANCE with `standard` 1, `adversarial` 1, one developer run, one verification event and two verdicts for the head; `store.load` agrees; the branch tip is the head and the repository's HEAD and tree are untouched; verified by test in `tests/run.test.ts`.
- Standard FAIL then fix: with a scripted standard reviewer (FAIL then PASS) `run` returns AWAITING_ACCEPTANCE with `standard` 2, two developer runs, two verification events (the second for the new head), the FAIL findings in the fix prompt, and the second standard prompt naming the new head; verified by test through the fake adapter's requests.
- Adversarial FAIL returns ESCALATED with `adversarial` 1 and the findings on the verdict event; second standard FAIL returns ESCALATED with `standard` 2; a failing check returns ESCALATED after one verification and no reviewer request; verified by test.
- A stage that throws (a check named `../x` makes `verify` throw before it runs anything) returns ESCALATED with `error` set and a `reject_dispatch` event naming the stage, and no later stage is called; verified by test.
- A FAIL verdict whose `findings` is a string, or holds a finding with a newline, still produces a fix prompt with one line per finding and no line of its own; verified by test in `tests/developer.test.ts`.
- A check that rewrites a tracked file records `tree: FAIL` with its status output as evidence and the cycle is ESCALATED; a job with a check named `tree` is refused; verified by test in `tests/verify.test.ts`.
- `run` never appends `developer_result`, `verification` or `verdict` itself: the only events it appends are `reject_dispatch`; verified by reading and by the event list in the happy-path test.
- `RUNTIME_SPIKE=1 node --test tests/run.test.ts` runs `main.ts` on the 05-a scratch ticket with `claude` as developer and both reviewers, 120 s per stage, and the printed stage is AWAITING_ACCEPTANCE or ESCALATED with verdicts for the head (a real reviewer may fail the scratch change; the test asserts the loop ran to a stop with no `error`). One live run, four paid calls.
- `npm test` offline spawns neither `claude` nor `pi`.

Constraints: zero dependencies; `execute`, `lifecycle.ts`, `store.ts`, `review.ts` unchanged; `developer.ts` changes only in `prompt` for the 07-a parked lines; `verify.ts` changes only for the `tree` check.
Non-goals: GitHub sync, pools, parallel cycles, restart recovery and reconcile (step 8 and the reconcile ticket); the owner's `accept` event through `main.ts`; retrying a stage; cleaning worktrees or evidence; a job schema beyond the fields `main.ts` reads.
Verification: `npm test` and `RUNTIME_SPIKE=1 node --test tests/run.test.ts`, run by the owner on the reviewed SHA. `lazy-review` on the diff before the standard review.

## Log
- 2026-10-16 — drafted with 07-a for the step 7 question round.
- 2026-10-16 — question round: owner “Take all recommendations” (A-032). READY. Branch `feat/07-a-fix-run` off main.
- 2026-10-16 — branch `feat/07-b-end-to-end-loop` off main after the 07-a merge. Tests first (`tests/run.test.ts`: happy path, FAIL-fix-PASS-PASS, three ESCALATED stops, a throwing stage, a develop throw, one live run of `main.ts`; three `tree` tests in `tests/verify.test.ts`; one findings-shape test in `tests/developer.test.ts`; all red), then `src/run.ts` (the loop, `reject_dispatch` on a stage throw, a ten-step cap), `src/main.ts` (job file, real adapters by name, printed summary and the two Git lines, exit 0 only on AWAITING_ACCEPTANCE), `verify` records `tree: FAIL` with the untrimmed porcelain status as evidence and refuses a check named `tree`, `prompt` in `developer.ts` coerces `findings` (list, bare string, else nothing) and flattens newlines. One bug found by the live run: `main.ts` opened the store before `runsDir` existed; fixed in 49971cc. Mutation checks on db755c3, one replacement each, restored after: 9 run, 8 fail a test; the survivor is the step cap, unreachable while every stage module moves the cycle or throws, kept as a belt. Live (`RUNTIME_SPIKE=1 node --test tests/run.test.ts`, claude in all three roles) on 49971cc: AWAITING_ACCEPTANCE in 54 s, exit 0; the test now prints the summary as a diagnostic (f3b4e12, test only). lazy-review: nothing to cut. Implementer-run `npm test`: 165 tests, 141 pass, 19 skipped (live), 5 todo, 0 fail. Awaiting owner-run tests on f3b4e12, then standard review 1.
- 2026-10-16 — owner-run on f3b4e12: `npm test` 165 tests, 141 pass, 19 skipped, 5 todo, 0 fail; live `main.ts` run AWAITING_ACCEPTANCE in 49.7 s (claude developer, standard, adversarial; one check, two PASS verdicts). Standard review 1 launched on f3b4e12.
- 2026-10-16 — Standard review 1 on f3b4e12: PASS, 0 major, 1 minor (the ticket said two exit codes; `main.ts` has three: 2 when nothing ran), 6 notes (`fix` forwards raw `findings`, forwarding only; parked lines closed here not yet marked; a store failure on the `reject_dispatch` append propagates, reconcile class; a check that moves the checkout's HEAD is a throw not a `tree: FAIL`, consistent with the design; done-when items each traced; mutation checks and `npm test` matched the owner run). Docs only: the entry-point paragraph now names the three codes, exit 2 kept because "did not run" is not "ran and stopped"; parked.md marks the 06-c and 07-a lines done. No code change, so the adversarial review runs on f3b4e12 with the owner-run results already recorded. Budget: standard 1 of 2 used. Adversarial review launched on f3b4e12.
- 2026-10-16 — Adversarial review on f3b4e12: FAIL. 1 major, reproduced through develop, verify and review (probe `/var/tmp/software_factory/07-b/probes/tree.ts`): the `tree` check and review's dirty guard both trust `git status` run inside the checkout, and a check that runs git there hides a rewritten tracked file from it (`update-index --skip-worktree`, `--assume-unchanged`, or a `.git` pointer swap to a private gitdir); the reviewer then reads a file that is not the commit and its verdict is counted for the SHA. The reviewer calls it the parked sandbox class and leaves narrowing or parking to the owner. 2 minors (the newline flatten misses `\r`, U+2028 and U+2029, in `prompt` and in `main.ts`'s printing; the `tree` status runs `execFileSync` with the default 1 MiB `maxBuffer`, so a formatter over about 12 000 files ends as `reject_dispatch` ENOBUFS instead of `tree: FAIL`). 4 notes (the step cap is tested before the default return, unreachable at 7 steps; exit codes probed offline, no 0 off AWAITING_ACCEPTANCE; `run` appends only `reject_dispatch`, every stage module moves the cycle or throws before its append; `git replace` and `core.fileMode` extend the parked hooksPath line). Budget: standard 1 of 2, adversarial 1 of 1; the ticket is stopped. Owner decides.
- 2026-10-16 — 07-c (`ef4ceea`) closes the adversarial FAIL's index-flag variants and both minors: standard 1 PASS and adversarial PASS on ef4ceea; the gitdir swap is parked. Awaiting owner merge of the stacked branch.
