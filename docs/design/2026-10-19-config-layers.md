Branch: feat/10-b-config-layers

# Configuration layers (ticket 10-b)

## Problem

`readJob` in `src/main.ts` is the only configuration reader. It reads one job file; every relative path in it resolves against that file, except `runsDir`, which resolves against the working directory. A-074 asks for four layers, later winning key by key: factory defaults, personal, repository, job. The repository layer is read at the base SHA and may not give grants or turn the sandbox off. This note settles how the layers merge, where each path resolves, and what each layer may set.

Facts the design must respect:
- `develop` resolves `job.base` to a SHA (`src/developer.ts:72`) after `main.ts` has built the adapters and loaded the workflow. If the repository layer is read at a SHA resolved earlier, and the ref moves in between, the developer works on a different commit from the one the configuration came from.
- The store refuses to load a cycle opened under a different workflow hash (`src/store.ts:137`). `accept` and `cancel` load the workflow through `readJob` before they open the store.
- The workflow is a TypeScript module that `main.ts` imports into the controller. It runs unsandboxed.
- `runtimes(extra, relativeTo)` in `src/runtime/registry.ts` takes one `relativeTo` for all extra runtimes.
- `sandbox.read` resolves against the job file; `runsDir` against the working directory.

## Interface

**One entry point** (`src/config.ts`).

```ts
export interface Config {
  path: string;                // the job file, absolute
  job: Job;                    // job.base is the resolved SHA, never a ref
  workflow: Workflow;
  registry: Record<string, RuntimeEntry>;
  runtime: Record<string, string>;
  sandbox: Sandbox;            // read paths absolute
  runsDir: string;             // absolute
  deadlineMs: number;
}
/** Reads the four layers for a job file. `env` gives XDG_CONFIG_HOME and HOME. Throws, before any run, naming the file and key at fault. */
export function loadConfig(jobFile: string, env?: NodeJS.ProcessEnv, opts?: { base?: string }): Promise<Config>;
```

`main.ts` calls `loadConfig` where it calls `readJob` now, and passes `config.job` to `run`. `readJob`, `loadWorkflow` and the sandbox-path mapping move into `config.ts`. `adaptersFor` stays in `main.ts`.

**Order of work inside `loadConfig`.**
1. Read the job file. It alone names `repo`, so it is read first.
2. Resolve `base` (default `HEAD`) to a SHA in `repo`, with the same `rev-parse` as `develop`. Put the SHA in `job.base`, so `develop` resolves it to itself.
3. Read the personal layer: `$XDG_CONFIG_HOME/software_factory/config.json`, else `$HOME/.config/software_factory/config.json`. A missing file is an empty layer. A file that is not a JSON object is refused.
4. Read the repository layer: `git show <sha>:.factory/config.json`. A missing path at that SHA is an empty layer.
5. Check each layer against its allowed keys, then merge: defaults, personal, repository, job.
6. Resolve paths, build the registry, load the workflow.

**Merging.** A top-level key in a later layer replaces the earlier value. Three object-valued keys merge one level down instead: `runtime` (per role), `runtimes` (per name) and `sandbox` (per field). Arrays — `checks`, `sandbox.read` — are replaced whole, never concatenated. So a repository can name its checks and the job can override them, but nobody gets a mix of two lists.

**What each layer may set.** An allow list per layer; any other key is refused, naming the key and the file.

| Key | defaults | personal | repository | job |
| --- | --- | --- | --- | --- |
| `workId`, `ticket`, `ticketFile`, `repo`, `base`, `parentCycleId` | | | | yes |
| `checks`, `workflow`, `runtime` | `workflow` | yes | yes | yes |
| `runtimes` | | yes | | yes |
| `sandbox` | `{ backend: 'bwrap' }` | yes | | yes |
| `deadlineMs`, `runsDir` | 120000, `/var/tmp/software_factory/runs` | yes | | yes |
| `grants` | | 10-e | refused | 10-e |

Until 10-e, `grants` is an unknown key in the personal and job layers too.

The repository layer may set exactly what A-074 lists: checks, the workflow and runtimes per role. So `sandbox` and `grants` are refused there by the same allow list, and each refusal gets its own test with its own message, because 10-e will make `grants` a known key in the other layers.

**Paths.** Each layer's relative paths resolve against that layer's file: personal against its directory, job against the job file's directory. The repository layer's paths resolve inside the repository at the base SHA. `runsDir` in the job file keeps resolving against the working directory, so today's job files mean what they meant (HANDOFF rough edge). Paths are resolved per layer before the merge, so a merged value is already absolute.

`runtimes(extra, relativeTo)` changes to take entries whose `module` is already absolute: `runtimes(extra: Record<string, { module: string }>)`. Its built-in-name, empty-name and `__proto__` checks stay where they are.

**The repository workflow.** A `workflow` path in the repository layer names a file in the repository. `loadConfig` reads it with `git show <sha>:<path>`, writes it to `<runsDir>/repo-config/<sha>/<path>` and imports that file. Only that one file is extracted, so the workflow must be one self-contained module, as an extension runtime must (10-a).

**accept and cancel.** They read the same layers, but at the base the open cycle was opened at, not the job file's ref, which has usually moved by then (the owner merges into it). The open row in the store gains a `base` field, the resolved SHA. `loadConfig` takes `opts.base`; `accept` and `cancel` read the open rows' `base` with one SQL query, with no replay and so no workflow, then call `loadConfig` with it. A cycle opened before 10-b has no `base`; it falls back to the job file's `base`, as today.

## Alternatives

- **Each caller reads the layers it needs.** `main.ts` reads the job, the registry reads the personal runtimes, 10-c reads the workflow's stages. Less code now, but the repository layer's limits would be enforced in several places, and 10-e's grant rule is exactly the kind a caller forgets.
- **Merge the raw JSON first, resolve paths afterwards.** One deep merge of four objects, then one pass of `resolve`. Shorter, but a merged `runtimes.foo.module` no longer knows whether the personal file or the job file set it, so it resolves against the wrong directory.

## Tests

At the `main.ts` command, as `tests/main.test.ts` does now, with `XDG_CONFIG_HOME` set to a scratch directory in the child's environment:
- Precedence: a personal `runtime.developer` is overridden by the repository's, which is overridden by the job file's. `runtime.standard` set only in the personal layer survives the merge.
- `checks` from the repository layer replace the personal layer's list whole.
- A `.factory/config.json` committed at the base is used. One changed only in the working tree, and one changed only on a later commit, are not.
- A repository layer with `grants`, and one with `sandbox: { backend: "none" }`, are each refused with exit 2 before the store exists. The message names the key and `.factory/config.json`.
- An unknown key in any layer is refused, naming the layer's file.
- A personal-layer extension runtime, given by a path relative to the personal file, runs the fixture extension to `AWAITING_ACCEPTANCE`.
- The base ref moves between the read and the run (a test hook commits on `main` after `loadConfig` returns): the cycle's `claim.base` is the SHA the repository layer was read at.
- `accept` after the base ref has moved, with a repository workflow, loads the cycle. Without the recorded `base` it would fail on the workflow hash.

At `loadConfig` directly: the personal-file location from `XDG_CONFIG_HOME`, then from `HOME`; a personal file that is not a JSON object is refused.

## Risks

- **The repository workflow runs in the controller.** It is imported, not sandboxed. It is code at the base SHA, which the owner has already merged, so the threat is the owner's own repository (A-037 puts damage before malice). A candidate cannot reach it. Owner question Q2 below.
- **The owner's personal file reaches tests.** Every test that spawns `main.ts` must set `XDG_CONFIG_HOME`. A missed one passes on a machine with no personal file and fails on the owner's.
- **Open rows grow.** One more field. Old rows have none and load as today.

## Questions for the owner

**Q1 — Repository layer: an allow list.** A-074 says the repository may set checks, the workflow and runtimes per role, and may not give grants or turn the sandbox off. Read as an allow list, the repository can set nothing else: not `sandbox.read`, not `deadlineMs`. Recommended: the allow list. A repository that can add a host path to `sandbox.read` can show the sandbox `~/.ssh`.

**Q2 — The repository workflow runs unsandboxed in the controller.** Recommended: allow it, as A-074 says, with the risk recorded in `work/accepted-risks.md`. The code is at the base SHA, so only merged code runs. The other choice is to refuse `workflow` in the repository layer until a workflow can be loaded as data.

**Q3 — Arrays replace, never concatenate.** Recommended: replace. A concatenated `checks` would run a check the job meant to drop, and nothing in the job could remove it.

**Q4 — accept and cancel read the layers at the cycle's own base.** This adds `base` to the store's open row. Recommended: yes. Without it, a repository workflow makes `accept` fail as soon as the owner's main branch moves.

Reply with the numbers you want to change, or say skip to take all recommendations.
