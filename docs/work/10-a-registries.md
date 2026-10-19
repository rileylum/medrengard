# 10-a — Runtime and sandbox registries

Route: Design. Every later row 10 ticket, and every user runtime, chooses its adapter through this seam.

Goal: runtimes and sandbox backends are chosen by name from a registry, and a user can add a runtime as a TypeScript module that speaks one JSON `RunRequest` in and one JSON `RunOutcome` out (A-074, Q7).

Design note: a registry is a map from name to entry. A runtime entry builds an `Adapter` for a role, given the sandbox and whether the role writes; `claude` and `pi` are entries over today's `CliSpec`s. A sandbox entry holds `check` and `wrap`; `bwrap` and `none` are entries over today's code in `src/sandbox.ts`. The job file may add a runtime, `"runtimes": { "<name>": { "module": "<path>" } }`, relative to the job file; 10-b lets the personal layer add one too. An extension runtime runs through `cliAdapter`'s spawn path (sandbox, scope, deadline, byte cap, cancel), with the module's directory bound read-only and network on, as for `claude` and `pi`. Alternatives: (1) every runtime, `claude` and `pi` included, becomes an out-of-process module: one path, but it moves working, sandbox-tested code for no caller's gain; (2) keep the switches and add an `extension` case: no registry, and the next backend edits `main.ts` again.

Done when:
- `src/main.ts` holds no runtime-name switch, and `src/sandbox.ts` no backend-name comparison outside its registry entries. Verified by the existing `tests/main.test.ts`, `tests/sandbox.test.ts` and `tests/cli-adapter.test.ts` passing unchanged.
- An unknown runtime or backend name is refused before any run, and the reason lists the registered names. Verified by test.
- A job naming a fixture extension runtime runs a cycle from open to `AWAITING_ACCEPTANCE` with no paid call. Verified by test.
- An extension runtime that prints malformed JSON, exits non-zero, overruns its deadline or is cancelled ends as one `run_failed`, as a CLI runtime does. Verified by test.
- Every run outcome event records the runtime's name, and for an extension runtime the SHA-256 of its module file. Verified by test.
- A runtime contract kit, `runtimeKit(name, makeAdapter)`, registers `node:test` cases a user calls from their own test file. It passes against the fixture runtime and fails against a broken one. Verified by test.

Constraints: zero dependencies. No paid calls: tests use `tests/stub-cli.ts` and fixture modules. The extension runtime runs in the job's sandbox; with `bwrap` it cannot write outside its cwd and its own `/tmp`.
Non-goals: configuration layers (10-b); user-added sandbox backends (A-074 keeps them built in); hashing a module's imports (the docs ask for one bundled file).
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-19 — drafted on `feat/10-a-registries` (A-074). Not READY until the owner says go.
- 2026-10-19 — owner: "go". READY.
