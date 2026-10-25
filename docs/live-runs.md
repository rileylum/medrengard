# Live runs

A paid model run needs the owner's approval of a concrete scenario plan and
cost first, including small checks.

Two runtimes ship. `commandRuntime(argv)` is a generic JSON process adapter: it
sends `AgentRequest` plus `artifacts` on stdin and expects one JSON result
containing `outcome` and `artifact` on stdout. `claudeCodeRuntime` (in
`extensions/claude-code/`) runs headless `claude -p` and turns its final message
into a document. Both execute through `StageContext.execute` in bwrap. An agent
gets network and named environment variables only when its `Sandbox` declares
them (`network`, `env`); a Claude Code subscription token is passed as
`CLAUDE_CODE_OAUTH_TOKEN` by name, with the value kept outside the factory
(ticket 13: `~/.config/medrengard/claude-token`, mode 600). Network is
all-or-nothing under the risk accepted in A-146. The first live run is recorded
in [ticket 13](work/13-phase-1-plan.md).

## Procedure

1. Define scenarios, expected stage paths, artifacts and paid-run count; get
   the owner's quoted approval of the plan and cost.
2. Use a scratch repository and fresh SQLite path under
   `/var/tmp/medrengard/live-N/`, or the owner's factory as built when the owner
   approves it (ticket 13 did, for read-only design stages). Supply trusted TypeScript `Options`,
   agent/runtime definitions and extensions to `Controller`. Import
   `defaultWorkflows({ check })` if its policy fits, with the `check` and `pr`
   extensions. A factory drives the
   controller through `cli/medrengard.ts`.
3. Show the owner the scenario inputs and definitions before paid execution.
   Use a named fake runtime to seed deterministic failures through the same
   controller API; record which stages were seeded. Do not edit the database.
4. Call `open` and `advance`, inspect `state` and `events`, and call `decide`
   only with the current subject. Approval of a spec uses its hash; owner
   acceptance and changes use the reviewed SHA. The default owner changes
   transition authorizes a new revision and fresh review budgets.
5. Compare recorded outcomes and artifacts with expectations. On restart,
   `recover` escalates pending work without relaunching or spending again;
   it does not adopt an old process result. Historical event databases are
   refused, not migrated.
6. Record scenario results, seeded stages, actual paid-run count and the next
   action in the work log and `docs/STATUS.md`. A path that did not occur is
   reported as not occurring.

## Local verification

`npm test` exercises stub runtimes, the real JSON process adapter and bwrap.
Process confinement and cleanup are described in the
[threat model](security/threat-model.md). The suite needs working unprivileged user namespaces;
it uses no model provider and incurs no model spend.
