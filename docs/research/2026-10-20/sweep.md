# Sweep: bugs, performance, test gaps, usability, docs drift (2026-10-20)

Agent slug: `sweep`. Base: `a3c74ff`. All probes ran on detached worktrees, now removed. Probe sources: `/var/tmp/software_factory/research-2026-10-20/sweep/probes/` (the `*.test.ts` files belong in `tests/probe/` of a worktree at `a3c74ff`; `race-open.ts` takes the path of `src/store.ts` as its argument).

Baseline on the worktree: `npm test` 419 tests, 395 pass, 0 fail, 19 skipped, 5 todo, 34.6 s wall (not independent). `npm run test:learn`: 6 pass.

## Ranked findings

### 1. `checkWorkflow` accepts workflows the driver can never run; each fails only after a paid developer run

**What.** Three workflow shapes pass `checkWorkflow` and the store, but `run` always escalates them with a controller error once the developer run has been paid for:

- (a) A command stage whose FAIL goes back to the developer (`VERIFYING: { budget: 2, FAIL: 'DEVELOPING' }`, the natural "tests failed, fix them" loop). `fix()` demands that the last event be a verdict FAIL for the candidate, so it throws: `DEVELOPING: cycle …: last verdict is not a FAIL for the candidate …`. A human stage whose FAIL goes to a commit stage has the same problem.
- (b) A second commit stage entered by PASS (`DEVELOPING → DOCS → VERIFYING`). The same `fix()` error.
- (c) A review stage reached from a commit stage with no command stage between them (`DEVELOPING → STANDARD_REVIEW`). `review()` throws `no verify checkout … run verify first`. After a fix it would also find a stale checkout.

**Evidence.** `src/developer.ts:123-128` (`fix` needs a commit stage with a head and a verdict FAIL for that head). `src/review.ts:56` (needs `<cycleId>-verify`). `src/lifecycle.ts:200-262` (no such rule in `checkWorkflow`). `src/run.ts:52-58` already refuses other setups "before a paid developer run", so this is the same principle left unapplied. The spec's Driver section says "a fix run at a commit stage", with no FAIL-verdict condition (`docs/specs/core-lifecycle-v1.md`, Driver).

**Reproduction.** Run `probes/verify-fail-loop.test.ts` and `probes/no-verify.test.ts`. Each asserts `checkWorkflow(w)` is `[]` and then runs the fixture developer. Result: `ESCALATED` with the errors above.

**Impact** 4 (any custom workflow that loops on a check failure, the most obvious custom workflow, costs a developer run and then dies with an internal-sounding message). **Effort** S for a pre-flight refusal; M to support (a). **Confidence** high.

**Implementable now?** A pre-flight refusal in `run()` is implementable now: refuse a commit stage other than the start unless every edge into it is a verdict stage's FAIL, and refuse a path from a commit stage to a verdict stage that skips every command stage. This follows the existing `run.ts` pre-flight pattern. Two things need an owner decision: whether the rule belongs in `checkWorkflow` (it changes which workflows are valid, D-023 territory), and whether shape (a) should be *supported*, meaning which "findings" a fix run gets after a check FAIL (overlaps plan "Structured findings").

### 2. `cancel` does not stop a run in flight: the paid run continues until it ends or hits the deadline

**What.** `main.ts cancel` records `cancel` from a second process. The driver does not watch the store while an adapter runs, so the developer or reviewer CLI keeps running, and costing money, until it finishes or the stage deadline fires. With the recommended `deadlineMs: 900000`, that is up to 15 minutes of a run whose outcome is then ignored. The 07-d reviewer saw "late outcome ignored" and called it correct for the event log; nobody looked at the cost.

**Evidence.** `src/controller.ts:381-394` (`bounded` aborts only on the deadline). `src/run.ts:99-121` (the loop checks the stage only between steps).

**Reproduction.** `probes/cancel-abort.test.ts`: a hanging developer with a 4 s deadline; a second `EventStore` appends `cancel` at 0.5 s. `run` returned after 4045 ms, `aborted: 1` (by the deadline), events `claim, cancel, run_failed`.

**Impact** 3 (cost and the owner's expectation; no state is corrupted). **Effort** S: in `bounded`, poll `store.load(cycleId).stage` every ~1 s (as `events --follow` does) and abort when it is settled. The adapter's scope kill already exists. **Confidence** high.

**Implementable now?** Yes, test-first, from the probe above. It may be better folded into row 11 because it shares the "watch the cycle during a run" seam. The same seam is where a SIGINT handler would abort the adapter (row 11 territory, so not raised separately).

### 3. Two `main.ts` runs of one job can open two cycles for one work ID

**What.** `EventStore.open` checks "one open cycle per work" (`cyclesFor`) with a read, then inserts in a separate statement. Two processes can both pass the check and both insert, because they use different cycle IDs, so the seq-0 primary key does not collide. Both then clone and pay for a developer run. Afterwards `accept` and `cancel` act on whichever open cycle `find` returns first. The spec rule "One work item has at most one open cycle" is broken. The code comment at `src/store.ts:262-264` covers only a same-ID race.

**Evidence.** `src/store.ts:245-270`.

**Reproduction.** `node --no-warnings probes/race-open.ts <worktree>/src/store.ts`. A third connection holds `BEGIN IMMEDIATE`, two child processes each call `open(<own id>, 'w1')`, then the lock is released. Output: `opened c-a`, `opened c-b`, `cycles for w1: [c-a QUEUED, c-b QUEUED]`. This uses the HANDOFF technique: hold the write lock so the children really race.

**Impact** 3 (needs the owner to start the same job twice, for example two terminals or a retry while the first run is still cloning; the result is a double charge and a broken invariant). **Effort** S: wrap the parent check, `cyclesFor` and the insert in `BEGIN IMMEDIATE … COMMIT`, as `addPositions` already does. **Confidence** high.

**Implementable now?** Yes. The probe becomes the red test.

### 4. Six "event the stage does not take" guards in `apply` survive deletion; two more engine rules are dead code

**What.** Mutation check over the whole suite, 36 mutants, one at a time. These survived (0 failing tests):

| Mutant (deleted or disabled line in `src/lifecycle.ts`) | Effect if it were lost |
| --- | --- |
| `verification` outside a command stage → escalate (l.429) | a verification PASS in a review stage would count as a review PASS and advance |
| `accept` outside a human stage (l.456) | `accept` for the candidate during review would advance a review stage |
| `request_changes` outside a human stage (l.462) | would FAIL any stage |
| `verdict` outside a review stage (l.437) | a verdict in VERIFYING would advance it |
| `developer_result` outside a commit stage (l.407) | |
| `dispute` outside a commit stage (l.420) | |
| claim while a developer run is active is ignored (l.397) | a second driver's claim would start a second run |
| `head_changed` with the same head ignored (l.446) | |
| `base_changed` with the same base ignored (l.451) | |

Also surviving: `run.ts:113` step cap (a safety net, hard to reach) and `review.ts:67` (redundant with the dirty-checkout check). The other 25 mutants were killed, including every budget, grant, `checkWorkflow`, store, dispute, `main.ts` and `developer.ts` guard tried.

The spec admits the first group ("**Proposal** for a test: only a late claim is tested"). The mutation result shows the gap is the whole family, not one row. Separately, **nothing in `src/` ever appends `head_changed` or `base_changed`** (`grep` finds them only in `lifecycle.ts`, tests and `learn/demos/sim.js`). The spec's engine rules "candidate head changes → ESCALATED" and "target base changes → ESCALATED" therefore have no producer: no code path detects a moved base before `accept`. Reviews are bound by SHA, so this is not a SHA-safety hole. But the owner gets no warning that `main` moved after the reviews, and the merge they run combines code nobody tested together.

**Impact** 3 for the tests (they are the engine's core rules; S effort, implementable now with one table-driven test: each event type in each stage kind it does not belong to → ESCALATED, nothing counted). For the base check: impact 2, needs an owner decision (escalate, or only warn at `accept`, when the job's base ref no longer points at the recorded base).

**Confidence** high (mutation runner output kept in `sweep/mutants.out`).

### 5. A verify interrupted mid-git leaves `<cycle>-verify.index.lock`, and every later verify of that cycle fails

**What.** `verify` deletes and remakes the `<cycleId>-verify` checkout but keeps its private index `<cycleId>-verify.index`, and so any `.lock` beside it. It removes the lock only when *its own* timeout kills git (`src/verify.ts:301-305`). After a Ctrl-C or a crash during `read-tree` or `checkout-index`, the next verify of the same cycle fails with `Unable to create '…-verify.index.lock': File exists`, and the cycle escalates with `reject_dispatch`. Today only `resume` reaches this (nothing calls it), so it is a trap for row 11 rather than a live bug.

**Evidence.** `src/verify.ts:150-157`, `292`.

**Reproduction.** `probes/stale-lock.test.ts`: develop with the fixture, create the empty lock file, call `verify`. It throws the error above.

**Impact** 2 now, 3 once row 11 resumes cycles. **Effort** S: remove `${worktree}.index` and `${worktree}.index.lock` together with the checkout (the index is rebuilt by `read-tree` anyway). **Confidence** high. **Implementable now?** Yes. Or list it as a row 11 acceptance case.

### 6. `main.ts` usability: no way to ask "where is my job?", and several confusing errors

**What.**

- **No `status` command.** After a run, the only record of the stage, the candidate SHA (needed in full for `accept`), the escalation reason and the worktree is the run's own terminal output. If that output is lost, the owner must read `events` JSON lines. Proposal: `status <job.json>` prints each cycle of the work with stage, head, base, budgets, escalation, the worktree path and the next command (`accept … <sha>`, `cancel`, or "add `parentCycleId: …`"). It reuses `decisionConfig`, `store.cycles` and `load`. Effort S to M; implementable now; needs a line in `learn/start.html#use` (HANDOFF note).
- **Confusing errors, from a probe of `main.ts` with bad job files:**
  - No `repo`: `The "paths[2]" argument must be of type string. Received undefined` (`src/config.ts:201`).
  - `"deadlineMs": "900000"`: `deadlineMs must be a positive integer …, got 900000`. It does not show that the value is a string (`src/controller.ts:248`; `JSON.stringify` the value).
  - `--help` is read as a job file: `ENOENT … --help`.
  - Missing job file: a bare `ENOENT … open '…'`.
  - No `workId` and no `runtime`: the message names only `runtime.developer`, so the owner fixes one field per attempt.

  A small `checkJob` in `config.ts` that names each missing or ill-typed field would fix all of these. Effort S; implementable now.
- **Disk.** Every cycle keeps a full `--no-hardlinks` clone plus a verify checkout, its index, evidence and `repo-config/` copies, and nothing ever deletes them. Measured on `~/dev/odnd-clone` (508 MB `.git`): the clone takes 1.05 s and 562 MB per cycle, against 41 ms for a hardlinked clone, which the sandbox design rules out. Twenty cycles on such a repository use about 11 GB of `/var/tmp`. A `prune <job.json>` that deletes settled cycles' clones and checkouts (keeping the evidence) needs an owner decision on what to keep. Impact 2.

### 7. Test suite wall time: `developer.test.ts` alone sets it

**Measured** (each file serially, `sweep/timefiles.py`; the mutant runner is `sweep/mutants.py`): `developer.test.ts` 27.1 s, `kits.test.ts` 21.0 s, `verify.test.ts` 18.6 s, `runtime.test.ts` 12.1 s, `stream.test.ts` 11.9 s, `main.test.ts` 9.3 s; all others under 8 s; serial total 137 s. Node runs files in parallel but each file's tests in order, so the wall time (29 to 35 s) is the slowest file. With `developer.test.ts` left out, the rest finished in 22.1 s against 29.2 s for the full run (same machine, back to back).

**Why the slow files are slow.** In `developer.test.ts`, about 16 s comes from six deadline tests (FIFO and "killed at the stage deadline" tests, 2.4 to 3.3 s each). They wait out real deadlines by design. In `kits.test.ts`, 10.7 s is a single test, "runtimeKit fails an adapter that does not settle after an abort", which waits out the hard-coded `SETTLE_MS = 10_000` (`src/kits/runtime.ts:14`).

**Fix.** Split `developer.test.ts` into two files (deadline tests apart), worth about 7 s (about 25 %). Letting `runtimeKit` take an optional settle time, so the test passes 1–2 s, is worth about 9 s of `kits.test.ts`, but it only shows in wall time once `verify.test.ts` (18.6 s) is split too. **Impact** 2. **Effort** S. **Implementable now?** Yes; no behaviour change.

### 8. Controller hot paths: measured, not a problem today

- **Replay.** `load` of a 5-event cycle: 0.07 ms. A 2000-event cycle: 4.9 ms (`history` is rebuilt by spreading, O(n²), still cheap at these sizes).
- **Full scans.** `cycles(workId)` scans every row (`seq = 0` cannot use the `(cycle_id, seq)` key, and `json_extract` runs per row): 7 ms with 2000 cycles (12k rows). `open` does that scan plus a replay per cycle of the work: 10 ms. Both grow linearly with the whole store, because the default `runsDir` is shared by every job. An expression index `ON events(json_extract(body,'$.workId')) WHERE seq = 0` would make both O(work). Not urgent.
- **Append.** Each append costs about 3 ms (one fsync'd transaction in rollback-journal mode), about 15 ms per cycle. Not an issue.
- **Git.** A full default cycle with one fix (developer, verify, FAIL, fix, verify, two reviews) ran 76 git processes in 0.69 s total wall on a tiny repository, against minutes of agent time. Not an issue. The clone is the only git cost that grows with repository size (see 6).

**Impact** 1. Nothing to do now beyond the index if stores grow.

### 9. Docs drift (small)

- The spec Driver section ("a fix run at a commit stage") omits the verdict-FAIL precondition (finding 1).
- The spec's engine table lists head and base change rules with no producer in `src/` (finding 4).
- `README.md` "Start here" numbers two items "3.".
- `learn/` passes `npm run test:learn` (6/6). I found no claim in `learn/*.html` that contradicts the code on cancel, resume, head or base change. The guide's "judge a workflow" demo uses `checkWorkflow`, so it will call the finding-1 workflows valid.

## Not raised (known or out of scope)

Row 11 items in HANDOFF (resume command, reviewer start record, stranded scopes, grant stage after a human stage); one workflow per work ID per runs directory; the three live-run gaps; SC-09/10/12/14/15 (they need models v1 does not have: readiness, waivers, dispositions, acceptance package; design, not test gaps).
