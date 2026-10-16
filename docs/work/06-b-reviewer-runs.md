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
3. The per-check results come from the cycle's last `verification` event for this head (Q3): the candidate cannot touch the event. The evidence files are attached underneath, each cut to its first and last 16 KiB with the cut marked.
4. The prompt, a template string: the role line (standard: judge against the ticket, spec and rules; adversarial: break it), the output rule (end with one fenced `json` block `{"head": "<sha>", "verdict": "PASS" | "FAIL", "findings": ["..."]}`), the ticket, head and base, each instruction file as `git show <head>:<path>` (or "not present"), the verification results, `git diff <base> <head>` from the checkout cut at 256 KiB, then the evidence. It never includes a developer transcript: the controller has none.
5. `execute(store, cycleId, adapter, { role, prompt, cwd: checkout }, { deadlineMs })`. `requireStage` and `apply` do the rest: a stale-SHA verdict is counted and escalates, a missing block is `run_failed`.

**Reviewer specs** (Q2), beside the developer specs in `cli-adapter.ts`: `claudeReviewer` is `claude` with `--setting-sources project --allowedTools Read Glob Grep` and no `--tools ''`; `piReviewer` is `pi` with `--tools read,grep,find,ls`. No shell on either: the controller already ran the checks, and a reviewer with bash would run candidate code again as the owner, outside any scope (06-a adversarial).

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
| 05-b minor, project settings file joins the claude grant | Not touched: the reviewer has no Write, so only a settings file committed in the candidate applies; recorded, stays parked. |

## Done when

- After a fixture `develop` and a passing `verify`, `review` with the fixture CLI's `verdict` case (`pass`) moves STANDARD_REVIEW to ADVERSARIAL_REVIEW with `standard` 1, and again to AWAITING_ACCEPTANCE with `adversarial` 1; each run's role matches the stage; `store.load` agrees; both `claude` and `pi` fixtures; verified by `tests/review.test.ts` offline.
- `verdict` variants: `fail` moves STANDARD_REVIEW to DEVELOPING with the findings on the event; `stale` (a verdict for another SHA) is counted and the cycle is ESCALATED; `noblock` records `run_failed` and the cycle is ESCALATED; verified by test.
- The prompt names the role, carries the ticket text, the head and base SHAs, each instruction file's content from the candidate commit (or "not present"), the per-check results from the `verification` event, the diff (the committed file appears), each evidence file's content, and the output rule; an evidence file past 32 KiB appears cut with a marker; the run's cwd is the verify checkout; verified by test through the fake adapter's request.
- `review` throws and appends nothing when the cycle is not in a review stage, when the verify checkout is missing or not at the head, or when the evidence directory is missing; verified by test.
- `claudeReviewer.args` carries `--setting-sources project` and `--allowedTools Read Glob Grep` only (no `Bash`, `Edit`, `Write`, no `--tools ''`); `piReviewer.args` carries `--tools read,grep,find,ls`; verified by test on the args.
- An unknown binary (absolute path or PATH name) records `MISSING` under both `cgroup` and `process-group` isolation; verified by test in `tests/verify.test.ts`.
- `RUNTIME_SPIKE=1 node --test tests/review.test.ts` runs one standard review per real CLI on the 05-a scratch ticket (fixture developer, real reviewer) and records a verdict for the candidate SHA (the cycle leaves STANDARD_REVIEW without ESCALATED); two live runs, 120 s deadline each.
- `npm test` offline adds no skipped tests beyond the two live ones and spawns neither `claude` nor `pi`.

Constraints: zero dependencies; `execute`, `cliAdapter`, `EventStore`, `lifecycle.ts`, `adapter.ts` unchanged. `verify.ts` changes only in the binary resolution.
Non-goals: a fix run after a standard FAIL and the loop (step 7); reviewer bash or test execution; `runtime` on reviewer runs; a prompt template engine; evidence sandboxing.
Verification: `npm test` and `RUNTIME_SPIKE=1 node --test tests/review.test.ts`, run by the owner on the reviewed SHA. `lazy-review` on the diff before the standard review.

## Log
- 2026-10-16 — drafted alongside 06-a (A-028).
- 2026-10-16 — question round (signature, read-only tools, event-sourced evidence, pick up the `MISSING` minor): owner “go” (A-030). Branch `feat/06-b-reviewer-runs` off main after the 06-a merge.
