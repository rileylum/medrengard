# Medrengard

A framework for building a personal software factory: workflows that take an idea to merged code.

[`docs/core.md`](docs/core.md) holds what Medrengard is and the rules it keeps.

- [`core/`](core/): Medrengard itself, the package `@medrengard/core`: the engine, the sandbox, the
  CLI, the TUI and the Claude Code adapter. Its README shows how to build a factory on it.
- [`bench/`](bench/): benchmarks comparing Medrengard workflows, starting with SlopCodeBench, and
  their published results.

Node 24 runs the TypeScript directly; nothing is built. `npm install` at the root links the
packages; `npm test` checks them all.

## Licence

MIT: see [`LICENSE`](LICENSE). [`tools/oxlint/anti-slop/`](tools/oxlint/anti-slop/) is vendored
from [anti-slop](https://github.com/dmmulroy/anti-slop) under its own MIT licence, beside it.
