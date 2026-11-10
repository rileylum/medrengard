# Medrengard

Medrengard is a framework for building a personal software factory: workflows that take an idea
to merged code, on your own machine. You write workflows of steps that run coding agents, run
your own programs, or wait for you. Medrengard runs each step in a sandbox, keeps a record of
everything, and stops to ask you when something fails or needs approval.

- [`core/`](core/) is Medrengard itself, the package `@medrengard/core`. **Start with its
  [README](core/README.md)**: it shows how to write a factory and run it.
- [`docs/`](docs/) holds the reference for each part, and [`docs/core.md`](docs/core.md), the
  principles and exact rules Medrengard keeps.
- [`bench/`](bench/) holds benchmarks that compare Medrengard workflows, and their results.

Node 24 runs the TypeScript directly; nothing is built. `npm install` at the root links the
packages, and `npm test` checks them all.

## Licence

MIT: see [`LICENSE`](LICENSE). [`tools/oxlint/anti-slop/`](tools/oxlint/anti-slop/) is vendored
from [anti-slop](https://github.com/dmmulroy/anti-slop) under its own MIT licence, beside it.
