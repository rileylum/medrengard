# 05-a — Real developer run in a scratch repository

Route: Design. The developer-run loop is the seam step 6 (verification, reviews) and step 7 (end to end) build on; where the commit check sits and how tools are granted have real alternatives.

Goal: one READY ticket in a scratch Git repository, run through `execute` with the real `claude` or `pi` adapter, produces a commit in an isolated worktree, and the cycle reaches VERIFYING only if that commit exists on the cycle's branch.

## Design note

### Seam

One module, `src/developer.ts`. It owns the cycle from open to the first developer outcome: it opens the cycle, creates the worktree, assembles the prompt, calls `execute`, and hands back the Cycle the store replayed. Callers (step 7's loop, the tests) learn one function.

```ts
export interface Job {
  workId: string;
  /** The contract: ticket text as the developer sees it. */
  ticket: string;
  /** Path of the repository to work in; the worktree is made from it. */
  repo: string;
  /** Ref to start from; resolved to a SHA at open. Default HEAD. */
  base?: string;
  /** Required when the work already has an ESCALATED cycle. */
  parentCycleId?: string;
}

export interface DevelopOptions {
  deadlineMs: number;
  /** Where worktrees live. Default /var/tmp/software_factory/runs. */
  runsDir?: string;
}

/** A ready adapter, or one built once the worktree path is known (claude's allow list is path-scoped). */
export type DeveloperAdapter = Adapter | ((worktree: string) => Adapter);

/** Open a cycle, run the developer once, return the replayed Cycle and where its branch lives. */
export function develop(store: EventStore, adapter: DeveloperAdapter, job: Job, opts: DevelopOptions): Promise<{ cycle: Cycle; worktree: string; branch: string }>;
```

Behind it, in order:

1. `git -C repo rev-parse --verify <base>^{commit}` gives the base SHA; a ref that does not resolve throws before anything is opened.
2. `store.open(cycleId, workId, parentCycleId)` with `cycleId = randomUUID()`. `open` now enforces the 02-b parked line: the parent must exist and be ESCALATED, and no other cycle for the same work may be open (QUEUED to AWAITING_ACCEPTANCE). Both throw; nothing is launched.
3. `git -C repo worktree add -b sf/<cycleId> <runsDir>/<cycleId> <baseSha>`. One worktree per cycle, not per run: the Candidate is `repo, branch, head, base`, and a fix run after a standard FAIL continues on the same branch. The worktree is not deleted by this ticket; the owner inspects it, and the reconcile ticket owns cleanup. Tests delete their own.
4. Prompt: the ticket text, then the working rules (commit the work on the current branch, do not push, do not change branch), then the claim instruction with the exact fence the live tests already use: end the reply with ```` ```json {"head": "<full commit sha>", "artifacts": ["<paths>"]} ``` ````. A template string in `developer.ts`; no template engine.
5. `execute(store, cycleId, adapter, { role: 'developer', prompt, cwd: worktree }, { deadlineMs, base: baseSha, accept })`.

**Commit check.** The spec's DEVELOPING → VERIFYING guard is "result valid, commit exists, run matches". `apply` checks the first; the third is the run ID. "Commit exists" needs Git, which the pure lifecycle cannot run, so it goes into the controller's receive path: `ExecuteOptions` grows `accept?: (claim: unknown) => string | undefined`. `receive` calls it after `plain()` and before `append`; a returned string is the reason for a `run_failed` event (the cycle escalates with `commit <sha> is not on <branch>`, the same path as a malformed result). `develop` supplies an `accept` that requires `head` to be a full SHA that `git -C worktree cat-file -e <head>^{commit}` finds, that `git merge-base --is-ancestor <baseSha> <head>` holds, that `head` is the branch tip, and that `git diff --quiet base head` reports a change (spec evidence rule: the diff is non-empty). All `spawnSync`, so `receive` stays synchronous.

**`runtime` and `model` on the Run.** `Adapter` regains `name: string` (dropped in 04-d until a reader existed; this is the reader). The `claim` event gains `runtime: string` and the lifecycle `Run` carries it. `isEvent` requires it; `apply` copies it. `model` is left off the event until something sets it: neither spec passes `--model` today, so the value would be the CLI's default and unknown to the controller. One new scenario in `tests/scenarios.ts` covers the field; existing scenarios gain `runtime: 'fake'` on their claims.

**Tools.** Developer runs need tools on, so `develop` does not use the specs' default `args`. The caller passes an adapter already configured; this ticket ships two ready-made specs in `cli-adapter.ts` beside the tool-less ones:

- `claudeDeveloper(worktree)`: `-p --output-format json --no-session-persistence --allowedTools Read Glob Grep "Edit(<worktree>/**)" "Write(<worktree>/**)" "Bash(git add:*)" "Bash(git commit:*)" "Bash(git status:*)" "Bash(git diff:*)" "Bash(git log:*)" "Bash(git rev-parse:*)"`. A function of the worktree because the Edit and Write rules are path-scoped. Anything outside the list is denied and the run fails on a missing claim or a missing commit; no permission prompt is possible under `-p`.
- `piDeveloper`: `-p --mode json --no-session --tools read,edit,write,bash`. `pi` has no path or command scoping: `bash` is unrestricted inside the scope. The containment is the scratch repository, the worktree cwd and the cgroup kill. Recorded as a known limit.

Rejected: `--dangerously-skip-permissions` for claude (no reason to widen beyond the list for a scratch repository), and having the controller make the commit after the developer edits (removes git from the policy, but then the developer cannot name the head in its claim and the spec's "developer result must name the commit" has nothing to check).

### Alternatives

Seam:
1. **`develop()` owns open, worktree, prompt and execute** (chosen). One entry point; the step 7 loop and the tests cross the same seam; the worktree and prompt have no second adapter, so they get no seam of their own.
2. **A `Workspace` module (worktree add, head, remove) plus glue in the caller.** Smaller functions, but open, prompt and execute then recur in every caller and test. Rejected by the deletion test.

Commit check:
1. **`accept` option on `execute`, run inside `receive`** (chosen). The controller decides; a rejected claim is `run_failed` like every other invalid result; the check is a function so the fake adapter tests can exercise the path offline.
2. **A wrapping adapter that checks the commit before returning the claim.** Keeps the controller untouched, but then an adapter decides whether a claim is valid, against the first rule in AGENTS.md.
3. **Check after `execute` returns and append `head_changed` or `cancel`.** The cycle is already in VERIFYING by then; the result would have been recorded as valid. Rejected.

Worktree:
1. **Per cycle, branch `sf/<cycleId>`, kept** (chosen). Matches the Candidate record; a fix run continues the branch.
2. **Per run, detached at the base.** Simpler naming, but a fix run would start from a fresh checkout of the base and lose the first run's commit.

### Parked lines

| Line | How 05-a covers it |
| --- | --- |
| 02-b minor, `open` guards | `EventStore.open` throws when `parentCycleId` names a cycle that is missing or not ESCALATED, and when another cycle for the same `workId` is open; tests in `store.test.ts` |
| 02-a notes, busy timeout | Not touched: one process on the database in this ticket. Stays parked for step 6 |

## Done when

- `develop` against a scratch repository (`git init`, one commit) and the fixture CLI case `commit` (writes a file in its cwd, commits it, replies with the real SHA) leaves the cycle in VERIFYING with `candidate.head` equal to the worktree's branch tip and `runs[0].runtime` set; verified by `tests/developer.test.ts` through `store.load()`, offline.
- A claim whose `head` is not a commit, is not on the branch, is not the tip, or equals the base makes the cycle ESCALATED with a `run_failed` whose reason names the SHA; verified offline with fixture cases and with the fake adapter through `execute` and `accept`.
- The worktree is `<runsDir>/<cycleId>` on branch `sf/<cycleId>`, created from the resolved base SHA, and `repo` keeps its HEAD and working tree (`git status --porcelain` empty, HEAD unmoved; it gains the `sf/<cycleId>` ref); verified by test.
- `store.open` rejects a missing or non-ESCALATED parent and a second open cycle for one work item; a child of an ESCALATED cycle opens; verified by `store.test.ts`.
- The `claim` event carries `runtime`; `Run` exposes it; a new scenario in `tests/scenarios.ts` passes through `lifecycle.test.ts` and `store.test.ts` replay.
- `RUNTIME_SPIKE=1 npm test` runs one developer run per real CLI with `claudeDeveloper` and `piDeveloper` on a ticket of the form "create FILE with CONTENT and commit it" and reaches VERIFYING; two live runs, each with a 120 s deadline, worktrees under a temporary `runsDir` that the test deletes.
- `npm test` offline adds no skipped tests beyond the two live ones and spawns neither `claude` nor `pi`.

Constraints: zero dependencies; `node:child_process` (`spawnSync`) for Git, `node:fs` for directories; `execute`, `cliAdapter` and `EventStore` as they are, plus the `accept` option, the `name` field and the `open` guards. Worktrees under `/var/tmp`, never `/tmp`.
Non-goals: verification checks (step 6), reviewers, the fix run after a standard FAIL (the branch is ready for it; the loop is step 7), deleting worktrees, `model` on the Run, retries, two processes on one database.
Verification: `npm test` and `RUNTIME_SPIKE=1 npm test`, run by the owner on the reviewed SHA. `lazy-review` on the diff before the standard review.

## Log
- 2026-10-16 — A-026 "take all recommendations". Branch `feat/05-a-developer-run`. Built test-first; offline `npm test` 125 tests, 104 pass, 16 skipped (14 earlier live, 2 new live), 5 todo, 0 fail. Live: pi reached VERIFYING first time (19 s); claude escalated on its first run and passed after the fix below (16 s). Deviations from the design note: (1) `develop` takes `Adapter | ((worktree) => Adapter)` because `claudeDeveloper` needs the worktree path, which exists only after open; (2) claude path rules need the `//` filesystem-root prefix (`Edit(//var/tmp/.../**)`); a single slash is project-relative and denied every write, found by the live run and a probe under `/var/tmp/software_factory/05-a/probe-claude/`; (3) `open` checks "cycle already open" before the work guard so the old message stays; (4) `Run.runtime` is optional on the type because reviewer runs do not set it until step 6; the claim event requires it. ESCALATED does not count as an open cycle for the one-per-work guard (spec: the parent stays ESCALATED beside its child). Observed in the probe: the owner's user-level Claude Code hooks and settings load into a developer run (a PreToolUse hook refused a commit on `main`); not a problem on `sf/<cycleId>`, noted for the policy discussion. Mutation checks, one replacement each, restored after: 15 run, 13 failed a test on the first pass; the two survivors (abbreviated-SHA guard, worktree base) got a tighter test and a new test and then failed. lazy-review: one shrink in `receive`, applied.
- 2026-10-16 — owner-run on c7adae7: `npm test` 125 tests, 104 pass, 16 skipped, 5 todo, 0 fail; `RUNTIME_SPIKE=1 node --test tests/developer.test.ts` 9 pass, both live developer runs reach VERIFYING (claude 16.6 s, pi 19.2 s). Standard review 1 launched on c7adae7.
- 2026-10-16 — Standard review 1 on c7adae7: PASS, 0 major, 2 minor (the design note's `merge-base --is-ancestor` check was missing, so an unrestricted developer could rewrite the branch to an orphan root and pass; `open` did not check the parent belongs to the same work), 3 notes (`head !== base` let `git commit --allow-empty` through; a worktree failure after `open` left a QUEUED cycle behind the one-open-cycle guard; "repo unchanged" overstated, it gains the branch ref). Reviewer ran `npm test` (matched the owner) and three mutation checks; `Edit` restores were by hand because `git checkout -- src` was denied. All five fixed in 18421ff: `refuse` requires `merge-base --is-ancestor base head` and a non-empty `git diff --quiet base head`, with fixture variants `orphan` and `empty`; `open` refuses a parent from another work; a failed `mkdir` or `worktree add` appends `cancel` to the cycle it opened and rethrows, tested with a file where `runsDir` should be; ticket wording corrected. Mutation checks on 18421ff: each of the four new checks fails a test when removed. Budget: standard 1 of 2 used. Awaiting owner-run tests on 18421ff, then the adversarial review.
- 2026-10-16 — owner-run on 18421ff: `npm test` 126 tests, 105 pass, 16 skipped, 5 todo, 0 fail. Adversarial review launched on 18421ff.
