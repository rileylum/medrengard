# 06-b — Fresh-context standard and adversarial reviewer runs

Route: Design. The reviewer prompt and the `review` seam are what step 7's loop drives and what the reviewer policy later tightens.

Status: drafted with 06-a (A-028). Not READY until 06-a has its standard PASS; the done-when list is confirmed then.

Goal: a cycle in STANDARD_REVIEW or ADVERSARIAL_REVIEW gets one fresh-context reviewer run through `execute` with the contract, the diff, the SHA, the repository instructions and the verification evidence, and its verdict is recorded against the candidate SHA.

## Design note (draft)

```ts
export interface ReviewInput {
  /** The contract, as the reviewer sees it. */
  ticket: string;
  /** Verification output from 06-a, read from `<runsDir>/evidence/<head>/`. */
  evidenceDir: string;
  /** The candidate checkout from 06-a; the reviewer's cwd and the source of `git diff base..head`. */
  worktree: string;
  /** Repository instruction files to include, relative to the checkout. Default ['AGENTS.md']. */
  instructions?: string[];
}

/** One reviewer run; the role is read from the cycle's stage. Returns the replayed Cycle. */
export function review(store: EventStore, adapter: Adapter, cycleId: string, input: ReviewInput, opts: { deadlineMs: number }): Promise<Cycle>;
```

- The prompt: role line (standard or adversarial), the output rule (end with one fenced `json` block `{ "head", "verdict", "findings" }`), the ticket, `git diff <base> <head>` from the checkout, the SHA, each instruction file, then each evidence file with its check name and result. A template string, no engine. It never includes a developer transcript: nothing in the controller has one.
- Reviewer specs beside the developer specs in `cli-adapter.ts`: `claudeReviewer` with `--setting-sources project --allowedTools Read,Glob,Grep,Bash(npm test)`; `piReviewer` with `--tools read,grep,find,ls`. No bash for pi, no `node --test` for claude in this ticket. The reviewer reads the controller's evidence rather than re-running checks.
- `execute` as it is: `requireStage` picks the stage, `apply` counts the verdict and escalates on a stale SHA. No `runtime` on reviewer runs; no lifecycle event change.
- Tests: the fixture CLI gains a `verdict` case (PASS, FAIL, wrong SHA, no block) at the adapter seam; one live run per CLI behind `RUNTIME_SPIKE=1` on the 05-a scratch ticket, 120 s deadline.

## Done when
- To be confirmed after 06-a.

## Log
- 2026-10-16 — drafted alongside 06-a (A-028); stacked on `feat/06-a-verification` when it starts.
