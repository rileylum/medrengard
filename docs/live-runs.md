# Live runs

A paid model run needs the owner's approval of a concrete scenario plan and
cost first. No paid runs are part of the core refactor. Historical Claude/Pi
runs used integrations now deleted; they do not demonstrate provider support
in the current API.

The shipped `commandRuntime(argv)` is a generic JSON process adapter: it sends
`AgentRequest` plus `artifacts` on stdin, expects one JSON result containing
`outcome` and `artifact` on stdout, and records its exit event. It executes
through `StageContext.execute` in bwrap. All controller execution currently
disables network access, with no provider credentials provisioned. This supports
local commands and stubs; a provider-backed integration needs an explicit
network and credential design before a paid run is possible.

## Procedure

1. Define scenarios, expected stage paths, artifacts and paid-run count; get
   the owner's quoted approval of the plan and cost.
2. Use a scratch repository and fresh SQLite path under
   `/var/tmp/software_factory/live-N/`. Supply trusted TypeScript `Options`,
   agent/runtime definitions and extensions to `Controller`. Import
   `defaultWorkflows(checkArgv)` if its policy fits. There are no job JSON
   files or `src/main.ts` commands.
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
The public controller tests start a descendant in a new session and verify
that it cannot outlive a stage deadline or controller death. The suite needs
working unprivileged user namespaces; it uses no model provider and incurs
no model spend.
