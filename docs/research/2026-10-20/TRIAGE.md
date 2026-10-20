# Triage, 2026-10-20

Sources (same folder): `deep-research.md`, `architecture.md`, `security.md`, `sweep.md`, `harnesses.md`, `extensibility.md`.
Rating: Impact 1–5. "Build" = built tonight on its own branch. "Owner" = needs an owner decision first.

## Built tonight (one branch each, off main `a3c74ff`)

| # | Branch | What | Merged from | Impact | Effort |
|---|---|---|---|---|---|
| B1 | `feat/sweep-open-race` | `EventStore.open` checks and inserts in one `BEGIN IMMEDIATE`, so two runs cannot open two cycles for one work ID | architecture 1, sweep 3 | 4 | S |
| B2 | `feat/sweep-preflight` | One preflight shared by `run` and `resume`, before the paid developer run: check names, check programs reachable in the sandbox, workflow shapes the driver cannot run (FAIL into a commit stage from a non-review stage; second commit stage entered by PASS; review with no command stage before it) | architecture 3, extensibility 1, sweep 1, harnesses 2 | 4 | S–M |
| B3 | `feat/sweep-head-workflow` | Refuse to import a repository workflow from a base the owner has not merged (HEAD reachable only from `sf/*` refs) | security 1 | 4 | S |
| B4 | `feat/sweep-cancel-aborts` | `cancel` stops a run in flight instead of waiting for the deadline | sweep 2, architecture 10 (signal seam) | 3 | S |
| B5 | `feat/sweep-terminal-escapes` | Escape control and bidi characters in agent text before printing | security 2 | 3 | S |
| B6 | `feat/sweep-git-hardening` | verify: attributes from the empty tree, no system git config; review diff with `--no-ext-diff --no-textconv`; clear a stale verify index lock | security 4 + minor, sweep 5 | 3 | S |
| B7 | `feat/sweep-lazy-runtimes` | Hash a runtime module only when a role uses it, so one broken entry does not block `cancel` and `accept`; name the entry in the error | extensibility 2 | 3 | S |
| B8 | `feat/sweep-stage-guards` | Tests that send each event type to each stage kind that does not take it (six guards in `apply` survive deletion today) | sweep 4 | 3 | S |
| B9 | `feat/sweep-reviewer-instructions` | Reviewer reads AGENTS.md etc. from the base, notes when the candidate changed one. **Reverses 06-b's choice: owner decides** | security 5, harnesses 6 | 3 | S |
| B10 | `feat/sweep-lifecycle-constants` | Pure refactor: `SETTLED` and `outcomeRunId` exported from `lifecycle.ts`; store, controller and the guide's shim use them | architecture 4 | 2 | S |

## Owner decisions (not built)

| Rank | Item | Source | Impact | Decision needed |
|---|---|---|---|---|
| 1 | Row 11 design: `run_started` for every run, `recover` command, restart rules (parked → leave, command stage → rerun, agent stage with no outcome → save tip under a recovery ref, `run_failed`), a lock before recovery, optional relaunch-once only after a crash | deep-research 1, 6; harnesses 1; architecture 6, 7, 10; sweep 5 | 5 | relaunch once or always escalate; job drift on resume (hash ticket/checks on open row) |
| 2 | Sandbox network reaches host loopback services (CUPS, PostgreSQL, Steam confirmed reachable) | security 3 | 4 | `pasta`/`slirp4netns` (new system dependency) or a proxy |
| 3 | Owner-held acceptance tests through the `{ file }` check argument; protected-path check (O-005) | deep-research 4, harnesses 7 | 5 | who writes them; must they fail on base |
| 4 | A red check gets 1–2 bounded fix rounds before escalating (everyone else does this) | harnesses 3 | 4 | changes the default flow; needs B2's refusal lifted for that shape |
| 5 | Structured findings: severity, file, line, `needs_owner`; only blocking findings FAIL; owner overrule within a cycle | deep-research 7, 8; harnesses 4 | 4 | verdict contract; O-011, O-013 |
| 6 | Reviewer wording from no-mistakes ("construct a concrete input and trace it"; "prior findings are claims, not evidence") | harnesses 5 | 4 | O-013; changes prompt fixtures |
| 7 | Exported `drive`, `decide.ts`, `main()` behind `import.meta.main` (pure refactor; makes the resume command, row-12 accept and grant-after-human one call each) | architecture 2 | 4 | best done as row 11's first ticket |
| 8 | `run_failed.cause`: infra / limit / output | deep-research 2 | 4 | event schema; row 11 |
| 9 | Cost, tokens and model per run; `--max-turns`, `--max-budget-usd` | deep-research 3, 9; extensibility 6 | 4 | event schema; cap values |
| 10 | Load workflows as JSON; require repository workflows to be data (closes A-078) | extensibility 5 | 4 | whether TS repository workflows stay |
| 11 | `doctor` command (`:checkhealth`) with config origin per key | extensibility 3 | 3 | name and output |
| 12 | `protocol: 1` on RunRequest, request.json, events | extensibility 4 | 3 | compatibility rule wording |
| 13 | `status` command; job-file validation naming each bad field | sweep 6 | 3 | none really; deferred to avoid main.ts conflicts tonight |
| 14 | `layout.ts` for cycle paths | architecture 5 | 3 | none; deferred, touches every module (conflicts) |
| 15 | Faster tests: `settleMs` on the runtime kit, split `developer.test.ts` | architecture 11, sweep 7 | 2 | none |
| 16 | Network flag on extension runtimes; kit helpers mounted at `/sf/kits` | extensibility 7, 8 | 2 | default; stable path |
| 17 | `head_changed`/`base_changed` have no producer; `accept` does not warn that main moved | sweep 4 | 3 | escalate or warn |
| 18 | Clone/checkout cleanup (562 MB per cycle on a 508 MB repo) | sweep 6 | 2 | what to keep |
| 19 | Single-process pool vs process-per-cycle (sync git) | architecture 9 | 3 | row 13 |

## Excluded

- Showing reviewers each check's argv, and keeping raw runtime output: these are live-run gaps in `docs/plan.md` the owner said not to raise.
- Already known (HANDOFF): resume command, reviewer start record, grant after human stage, stranded runs. Folded into owner item 1.
