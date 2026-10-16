# 06-b — Fresh-context standard and adversarial reviewer runs

Route: Design. The reviewer prompt and the `review` seam are what step 7's loop drives and what the reviewer policy later tightens. Approved A-028, sharpened A-030.

Goal: a cycle in STANDARD_REVIEW or ADVERSARIAL_REVIEW gets one fresh-context reviewer run through `execute` with the contract, the diff, the SHA, the repository instructions and the verification evidence, and its verdict is recorded against the candidate SHA.

## Design note

### Seam

One module, `src/review.ts`, the same shape as `verify`: everything it needs is on disk or in the store, so a restarted controller or step 7's loop calls it with nothing in memory.

```ts
export interface ReviewOptions {
  deadlineMs: number;
  /** Same directory `develop` and `verify` used. Default /var/tmp/software_factory/runs. */
  runsDir?: string;
  /** Repository instruction files to quote, read from the candidate commit. Default ['AGENTS.md']. */
  instructions?: string[];
}

/** One reviewer run for whichever review stage the cycle is in. Returns the replayed Cycle. */
export function review(store: EventStore, adapter: Adapter, cycleId: string, job: Job, opts: ReviewOptions): Promise<Cycle>;
```

Behind it, in order:

1. `store.load(cycleId)`: STANDARD_REVIEW gives `standard_reviewer`, ADVERSARIAL_REVIEW gives `adversarial_reviewer`, anything else throws (controller misuse). The candidate head and base come from the cycle.
2. The checkout is `<runsDir>/<cycleId>-verify` and must be at the head (`git rev-parse HEAD`); the evidence is `<runsDir>/evidence/<head>/`. Either missing or stale throws before any run starts: the reviewer never sees a tree the controller did not verify.
3. The per-check results come from the cycle's last `verification` event (Q3): the candidate cannot touch the event, and the lifecycle admits a verification only for the candidate SHA in VERIFYING, so the last one is the current head's (`review` throws if not; 06-c dropped the head filter the adversarial review found untestable). The evidence files are attached underneath, each cut to its first and last 16 KiB with the cut marked.
4. The prompt, a template string: the role line (standard: judge against the ticket, spec and rules; adversarial: break it), the output rule (end with one fenced `json` block `{"head": "<sha>", "verdict": "PASS" | "FAIL", "findings": ["..."]}`), the ticket, head and base, each instruction file as `git show <head>:<path>` (or "not present"), the verification results, `git diff <base> <head>` from the checkout, head and tail of 128 KiB each, then the evidence. It never includes a developer transcript: the controller has none.
5. `execute(store, cycleId, adapter, { role, prompt, cwd: checkout }, { deadlineMs })`. `requireStage` and `apply` do the rest: a stale-SHA verdict is counted and escalates, a missing block is `run_failed`.

**Reviewer specs** (Q2), beside the developer specs in `cli-adapter.ts`: `claudeReviewer` is `claude` with `--restricted --allowedTools Read Glob Grep` and no `--tools ''` (`--restricted` replaced `--setting-sources project` after standard review 1: it loads no settings file at all and confines the file tools to the cwd); `piReviewer` is `pi` with `--tools read,grep,find,ls`. No shell on either: the controller already ran the checks, and a reviewer with bash would run candidate code again as the owner, outside any scope (06-a adversarial).

**Parked minor picked up** (Q4): `verify` resolves the check's binary (a path, or a PATH lookup) before spawning, so an unknown binary is `MISSING` under both isolations; the test gains a cgroup case.

### Alternatives

Signature: (1) `job` plus `runsDir`, paths recomputed (chosen); (2) `Verified` passed in from `verify` (A-028's first draft), rejected because it ties the review to the process that verified.

Tools: (1) read-only (chosen); (2) `Bash(npm test)` for claude (A-028), rejected after the 06-a adversarial review showed what a check can do as the owner's user.

Evidence source: (1) event results plus capped files (chosen); (2) files only, rejected because a later check can rewrite an earlier check's files (parked 06-a standard minor).

### Parked lines

| Line | How 06-b treats it |
| --- | --- |
| 06-a adversarial minor, `MISSING` under cgroup | Fixed here: the binary is resolved before spawn; cgroup test case. |
| 06-a standard minor, evidence files writable by a later check | Mitigated: the prompt's results come from the event; files are attached as detail. Stays parked for the sandbox ticket. |
| 06-a adversarial major and minor (committed symlink, `core.hooksPath`) | Not touched: pi-policy or sandbox ticket (A-029). |
| 05-b minor, project settings file joins the claude grant | Reviewer side closed: `--restricted` loads no user, project or local settings file, probed 2026-10-16 (a committed `.claude/settings.json` SessionStart hook ran under `--setting-sources project` and did not under `--restricted`). The developer side stays parked. |

## Done when

- After a fixture `develop` and a passing `verify`, `review` with the fixture CLI's `verdict` case (`pass`) moves STANDARD_REVIEW to ADVERSARIAL_REVIEW with `standard` 1, and again to AWAITING_ACCEPTANCE with `adversarial` 1; each verdict's run ID is consumed (reviewer runs have no claim event, so the role is checked on the adapter's request in the prompt test); `store.load` agrees; both `claude` and `pi` fixtures; verified by `tests/review.test.ts` offline.
- `verdict` variants: `fail` moves STANDARD_REVIEW to DEVELOPING with the findings on the event; `stale` (a verdict for another SHA) is counted and the cycle is ESCALATED; `noblock` records `run_failed` and the cycle is ESCALATED; verified by test.
- The prompt names the role, carries the ticket text, the head and base SHAs, each instruction file's content from the candidate commit (or "not present"), the per-check results from the `verification` event, the diff (the committed file appears), each evidence file's content, and the output rule; the per-check result line comes from the event even when the `.exit` file says otherwise; an evidence file past 32 KiB appears cut with a marker; after a standard FAIL and a fix run the prompt quotes the new head's verification (the last event; the lifecycle guarantees it is the candidate's); the run's cwd is the verify checkout; verified by test through the fake adapter's request.
- `review` throws and appends nothing when the cycle is not in a review stage (VERIFYING, CANCELLED, unknown), when the verify checkout is missing or not at the head, or when the evidence directory or any evidence file for the event's checks is missing; verified by test.
- `claudeReviewer.args` carries `--restricted` and `--allowedTools Read Glob Grep` only (no `Bash`, `Edit`, `Write`, no `--tools ''`, no `--setting-sources`); `piReviewer.args` carries `--tools read,grep,find,ls`; verified by test on the args.
- An unknown binary (absolute path or PATH name) records `MISSING` under both `cgroup` and `process-group` isolation; verified by test in `tests/verify.test.ts`.
- `RUNTIME_SPIKE=1 node --test tests/review.test.ts` runs one standard review per real CLI on the 05-a scratch ticket (fixture developer, real reviewer) and records a verdict for the candidate SHA (the cycle leaves STANDARD_REVIEW without ESCALATED); two live runs, 120 s deadline each.
- `npm test` offline adds no skipped tests beyond the two live ones and spawns neither `claude` nor `pi`.

Constraints: zero dependencies; `execute`, `cliAdapter`, `EventStore`, `lifecycle.ts`, `adapter.ts` unchanged. `verify.ts` changes only in the binary resolution.
Non-goals: a fix run after a standard FAIL and the loop (step 7); reviewer bash or test execution; `runtime` on reviewer runs; a prompt template engine; evidence sandboxing.
Verification: `npm test` and `RUNTIME_SPIKE=1 node --test tests/review.test.ts`, run by the owner on the reviewed SHA. `lazy-review` on the diff before the standard review.

## Log
- 2026-10-16 — drafted alongside 06-a (A-028).
- 2026-10-16 — question round (signature, read-only tools, event-sourced evidence, pick up the `MISSING` minor): owner “go” (A-030). Branch `feat/06-b-reviewer-runs` off main after the 06-a merge.
- 2026-10-16 — tests first (`tests/review.test.ts`, seven offline tests and two live; fixture CLI `verdict` case with `pass`, `fail`, `stale`, `noblock`; a cgroup `MISSING` test in `tests/verify.test.ts`; all red), then `src/review.ts`, `claudeReviewer` and `piReviewer` in `cli-adapter.ts`, and `executable()` in `verify.ts` resolving the binary before spawn. Deviation from the design note: reviewer runs have no claim event, so `Cycle.runs` never lists them; the role is asserted on the adapter's request and the verdict's run ID on `consumed` (ticket wording updated). Mutation checks on `09402c8`, one replacement each, restored after: 13 run, 12 fail a test; the survivor (the per-check result line printing `PASS` regardless) is unreachable in practice because a cycle reaches a review stage only when every check passed, recorded as verified by reading. Live (`RUNTIME_SPIKE=1 node --test tests/review.test.ts`): both real reviewers returned a verdict for the candidate SHA, claude in 24.5 s and pi in 9.4 s, read-only tools. lazy-review: nothing to cut. Implementer-run `npm test`: 144 tests, 121 pass, 18 skipped (live), 5 todo, 0 fail. Awaiting owner-run tests, then standard review 1.
- 2026-10-16 — owner-run on 09402c8: `npm test` 144 tests, 121 pass, 18 skipped, 5 todo, 0 fail. Standard review 1 launched on 09402c8.
- 2026-10-16 — Standard review 1 on 09402c8: PASS, 0 major, 6 minor (the "last verification for this head" filter untested; the test could not tell event-sourced results from file-sourced; the diff cap kept 256 KiB each side against the note's 256 KiB total; `--setting-sources project` loads a `.claude/settings.json` committed in the candidate, whose hooks run as the owner; a missing single evidence file was attached as "(file missing)" instead of refusing; the cut marker said bytes for characters), 5 notes (Read/Glob/Grep unscoped so the reviewer can read the developer's worktree next door; VERIFYING misuse untested; `accessSync X_OK` is true for a directory; offline reviews use process-group; constraints hold, tests matched the owner). Probed `claude` flags on a scratch directory with a committed SessionStart hook: the hook ran under `--setting-sources project`; it did not run under `--restricted`, which also ignores user and local settings and confines the file tools to the cwd (closes the note too). Fixed in f7ed0be: `claudeReviewer` uses `--restricted`; `review` requires every `<name>.exit|stdout|stderr` for the event's checks before building the prompt; `DIFF_MAX` 128 KiB per side; marker says characters; tests added for the event-sourced result line (`file.exit` rewritten to `exit 1`, prompt still says `file: PASS`), the fix-run path (standard FAIL, fixture fix commit through `execute`, `verify` with a new check list, prompt quotes only the new head's verification), a missing evidence file, and review before verify. Mutation checks on f7ed0be: all four new guards fail a test when removed. Live rerun with `--restricted`: claude verdict in 12.0 s, pi in 5.6 s. Budget: standard 1 of 2 used. Awaiting owner-run tests on f7ed0be, then the adversarial review.
- 2026-10-16 — owner-run on f7ed0be: `npm test` 145 tests, 122 pass, 18 skipped, 5 todo, 0 fail. Adversarial review launched on f7ed0be.
- 2026-10-16 — Adversarial review on f7ed0be: FAIL. 1 major, reproduced by probe `/var/tmp/software_factory/06-b/probes/probe.ts` (P1): a candidate whose `git diff base head` exceeds 1 MiB strands the cycle, because `git()` uses `execFileSync` with the default 1 MiB `maxBuffer`, so `review` throws `ENOBUFS` before `execute`, appends nothing, and every retry throws the same way; the 128 KiB cut is unreachable above 1 MiB. 6 minor: a committed `.gitattributes` with `* -diff` turns the prompt's diff into "Binary files differ" for every file (P2; fix `--text`); the head-and-tail cut drops the middle of a large diff and the prompt carries no file list, so a changed file in the middle is never named (P3; fix an uncut `--name-status` first); the "last verification for this head" filter is still untested after the standard 1 fix (the new head's verification is also the last event); `review` checks only `rev-parse HEAD`, so a check that rewrites a tracked file in the checkout leaves the reviewer reading a tree that is not the commit (P6; fix refuse when `git status --porcelain --untracked-files=no` is non-empty); `piReviewer` passes no `--no-approve`, so a trust decision saved for the runs directory or a parent would load `.pi/extensions` from the candidate (from pi's docs, not live); section headers are plain text a committed file can forge (P5; fix a per-run nonce in the delimiters). 3 notes: `--restricted` holds read-only by reading, but `CLAUDE.md` auto-discovery and project `.mcp.json` are candidate-controlled inputs (`--strict-mcp-config` is one flag); `executable()` drops empty PATH entries; parked lines confirmed, constraints hold, tests matched the owner, tree clean. Budget: standard 1 of 2, adversarial 1 of 1; the cycle is stopped. Owner decides.
- 2026-10-16 — owner: “option 1 go” (A-031): fix ticket 06-c stacked on this branch.
