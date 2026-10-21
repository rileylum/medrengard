# 11-b — A `layout` module names every cycle path once

Route: Fast. A pure refactor with one obvious design (A-112 item 3; `docs/research/2026-10-20/architecture.md` finding 5). Tier: Light (one review, A-125). Proposed split: the shared clones of A-126 are ticket 11-b2, Trust tier, stacked on this one.

Goal: `src/layout.ts` is the one place that names the default runs folder, the store file, and each cycle's clone, branch, verify checkout and evidence folder; every module reads them from it.

Interface:

```ts
// src/layout.ts
export const DEFAULT_RUNS_DIR = '/var/tmp/software_factory/runs';
/** Absolute: git -C repo would resolve a relative path against the repository, mkdir against cwd. */
export function runsRoot(runsDir: string | undefined): string;
export function storeFile(runsDir: string): string;           // <runsDir>/events.sqlite
export function cyclePaths(runsDir: string | undefined, cycleId: string): {
  clone: string;     // <runsDir>/<cycleId>
  branch: string;    // sf/<cycleId>
  checkout: string;  // <runsDir>/<cycleId>-verify
  evidence(head: string, stage: string): string; // <runsDir>/evidence/<head>/<stage>
};
```

Done when:
- `tests/layout.test.ts` pins each path above for a relative and an absolute `runsDir` and for `undefined`. Red step: the test before `src/layout.ts` exists.
- `developer.ts`, `run.ts`, `verify.ts`, `review.ts`, `config.ts`, `main.ts`, `kits/observe.ts` and `kits/command.ts` take these paths from `layout.ts`. `grep -n "'/var/tmp/software_factory/runs'\|-verify\`\|'evidence'\|sf/\${\|events.sqlite" src/` matches only `src/layout.ts` and doc comments.
- `DEFAULT_RUNS_DIR` moves to `layout.ts`. Only `run.ts` imported it from `developer.ts`, so `developer.ts` does not re-export it.
- Every existing test passes unchanged: no file under `tests/` is edited except the new one.
- `npm run test:learn` passes; `learn/shims/` gains an export for any new live import, as `sim-verify.js` did in 11-a2.

Constraints: zero dependencies; no paid calls; no change in behaviour, output or on-disk layout.
Non-goals: the shared clone and mirror (11-b2); the default sandbox `{ backend: 'bwrap' }`, written six times, which is not a path; `repo-config/<sha>/` (one module) and a run's `<runId>-tmp` (built from the run's cwd, not from `runsDir`); the guide's copies of these paths (Guide stand-ins row, A-112 item 7).
Verification: `npm test` and `npm run test:learn`; the owner's pre-merge hook runs `npm test` on the merge result. One review, in session, with a prompt file.

## Log
- 2026-10-21 — drafted on `feat/11-b-layout`. Not READY until the owner says go, and answers whether the shared clones are a ticket of their own (11-b2).
- 2026-10-21 — owner: “Split is good, one mirror per repo, probes are good. Go” (A-133). READY at Light tier.
- 2026-10-21 — implemented, tests first; code head `5c60b68`. Red: `tests/layout.test.ts` on the missing `src/layout.ts`. `src/layout.ts` exports `DEFAULT_RUNS_DIR`, `runsRoot`, `storeFile` and `cyclePaths` (clone, branch, verify checkout, evidence folder). `developer.ts`, `run.ts` (`clonePath` became `cloneOf`, which returns the clone and the branch), `verify.ts`, `review.ts`, `config.ts`, `main.ts`, `kits/observe.ts` and `kits/command.ts` read them there. `developer.ts` no longer exports `DEFAULT_RUNS_DIR`: only `run.ts` imported it. No file under `tests/` changed except the new one. Mutants of `layout.ts` against every other test, all caught (`/var/tmp/software_factory/11-b/mutants.sh`): verify checkout suffix (5 fail), evidence without the stage (20), branch prefix (12), store file name (18, then the 300 s timeout; the session removed the three `sf-*` folders its own run left). Implementer's `npm test`, not independent: 474 tests, 450 pass, 0 fail, 19 skipped, 5 todo. `test:learn` 6 of 6; the simulator page ran a ticket to AWAITING_ACCEPTANCE and accepted it, with no console errors. The live import of `src/layout.ts` needs no new stand-in.
- 2026-10-21 — Light review on `5c60b68` (in-session subagent, prompt `/var/tmp/software_factory/11-b/review-prompt.md`): PASS. One minor: `storeFile` was pinned only for an absolute `runsDir`, so a `resolve` inside it would pass. Notes: no behaviour change found at any call site; `learn/shims/sim-developer.js` still exports a `DEFAULT_RUNS_DIR` nobody imports (harmless; Guide stand-ins row). Reviewer's `npm test`: 474 tests, 450 pass, 0 fail; guide 6 of 6.
- 2026-10-21 — review minor fixed at `6414b6e`: the test pins `storeFile('runs')` as `runs/events.sqlite`; the reviewer's mutant now fails it. Implementer's `npm test` on `6414b6e`, not independent: 474 tests, 450 pass, 0 fail.
- Next: owner merges `feat/11-b-layout`; then the 11-b2 probes.
