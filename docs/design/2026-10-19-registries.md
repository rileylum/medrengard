Branch: feat/10-a-registries

# Runtime and sandbox registries (ticket 10-a)

## Problem

`src/main.ts` picks an adapter with two `if (name === 'claude')` switches (`developer`, `reviewer`). `src/sandbox.ts` compares `backend` in `wrap`, `reachable` and `checkSandbox`, and `BACKENDS` lists the names. A user cannot add a runtime without editing `main.ts`. The ticket's inline note chose a registry over making every runtime a module, and over adding an `extension` case. This note settles the four interface questions the ticket left open.

Facts the design must respect:
- `cliAdapter` already owns the spawn path: sandbox, scope, deadline, byte cap and cancel. It writes `req.prompt` to stdin and calls `spec.parse` on the output.
- `CliSpec.config` paths are relative to the owner's home. A module's directory is not.
- `SHAPE` in `src/lifecycle.ts` tolerates extra fields, so older logs replay. A new optional field still needs a type check when present, or a malformed value is stored.
- `execute` records `runtime` on the developer's `claim` only. Reviewer runs record no claim.

## Interface

**Runtime registry** (`src/runtime/registry.ts`).

```ts
export interface RuntimeEntry {
  /** One adapter for a role. `writes` is true when the role produces a commit. */
  adapter(opts: { sandbox: Sandbox; writes: boolean }): DeveloperAdapter;
}
export const BUILT_IN: Record<string, RuntimeEntry>;   // claude, pi
export function runtimes(extra: Record<string, { module: string }> | undefined, relativeTo: string): Record<string, RuntimeEntry>;
export function runtimeFor(registry, name: string | undefined, role: string): RuntimeEntry;   // throws listing the names
```

`claude` and `pi` wrap today's `CliSpec`s, so the adapters are built exactly as now. `main.ts` keeps `adaptersFor` and asks the registry instead of switching. The job file's `runtime` value becomes any registered name.

**Extension runtime.** `extensionSpec(name, modulePath): CliSpec` runs `node <module>` through `cliAdapter`. `CliSpec` gains three optional fields, and the CLI specs set none of them:
- `input(req)`: what goes to stdin. Default `req.prompt`. The extension spec sends `JSON.stringify(req)`.
- `bind`: absolute paths bound read-only. The extension spec binds the module's directory.
- `moduleHash`: the SHA-256 of the module file, taken when the adapter is built.

`CliSpec.name` widens from `'claude' | 'pi'` to `string`. The extension's `parse` refuses a non-zero exit, then parses the whole of stdout as one JSON value and returns it as the outcome. The controller's `normalise` already turns an unknown shape into `run_failed`. Malformed JSON, a deadline overrun and a cancel each become one `run_failed` on the same path as a CLI.

A job-file runtime may not reuse a built-in name. `claude` silently meaning someone's module would hide which runtime ran.

**Runtime on every outcome event (Q1).** `Adapter` gains an optional `moduleHash`. `execute` puts `runtime: adapter.name` and `moduleHash` (when set) on every outcome event: `developer_result`, `verdict`, `dispute` and `run_failed`. They travel with the prompt versions on the same spread. The type becomes `RunVersions = PromptVersions & { runtime: string; moduleHash?: string }`. `SHAPE` checks each field is a string when present. The `claim` keeps its required `runtime`.

**Sandbox registry (Q4).** `src/sandbox.ts` gets a `BACKENDS` table: `{ bwrap: { check, wrap, reachable }, none: { ... } }`. The exported `wrap`, `reachable` and `checkSandbox` keep their signatures. Each looks up the entry, and an unknown name throws `sandbox backend "x" is not one of bwrap, none`. `Sandbox.backend` widens to `string`. User-added backends stay out of scope (A-074), so the table is not exported for adding to.

**Contract kit (Q3).** `src/kits/runtime.ts` exports `runtimeKit(name, makeAdapter: () => Adapter | Promise<Adapter>)`. It registers `node:test` cases:
- `name` is a non-empty string;
- for a developer request and for a reviewer request, `start` resolves (never rejects) to plain data in the `RunOutcome` union;
- after an abort, `start` settles within the grace period.

A user's test file imports the kit by path, for example `import { runtimeKit } from '../software_factory/src/kits/runtime.ts'`. The project is not a package, and A-074 does not ask for one. Publishing it waits for a need.

**Request shape (Q2).** One JSON `RunRequest` on stdin: `{ runId, role, prompt, cwd }`. One JSON `RunOutcome` on stdout. The extension runs in the job's sandbox. It gets the network, its module's directory and `node`'s directory read-only, and its cwd writable only for a commit role.

## Alternatives

- **The module exports a function, and a factory shim runs it.** The user writes `start(req)`, and the kit can call it in-process. But the shim's directory (the factory's `src/`) must then be bound into every extension run. The protocol stops being stdin and stdout, which A-074 kept.
- **Hash the module at every start, or run a copy.** This closes the gap between the hash and the run when the owner edits the module mid-job. It costs a file copy per run, and edits mid-job are the owner's own. Hashing once, when the adapter is built, is enough for now.

## Tests

- `tests/registry.test.ts`: an unknown runtime and an unknown backend are each refused, and the reason lists the names; a job-file runtime that reuses a built-in name is refused.
- `tests/fixtures/ext-runtime.ts`: an extension that commits as the developer and PASSes as a reviewer. In `tests/main.test.ts`, a job naming it runs from open to `AWAITING_ACCEPTANCE`, and every outcome event carries `runtime` and the module's hash.
- Fixtures that print bad JSON, exit 1, and sleep. Each run ends as one `run_failed` (malformed, exit, `timeout`, cancelled).
- `tests/kits.test.ts`: the kit passes against the fixture and fails against a broken module. It checks by running the kit in a child `node --test` and reading the exit code.
- The existing `main`, `sandbox` and `cli-adapter` tests pass unchanged.

## Risks

- **`node` inside bwrap.** The extension runs the controller's `node` (`process.execPath`), bound by its real directory. A `node` installed under `$HOME` (nvm, say) binds that whole directory read-only.
- **An unbundled module fails.** Only the module's own directory is bound, so a relative import above it fails inside bwrap. The kit run without a sandbox would not catch that. The docs must say to bundle into one file, as the ticket's non-goal assumes.
- **Outcome events grow.** Every outcome event carries the runtime name. Old logs have none and replay unchanged.
