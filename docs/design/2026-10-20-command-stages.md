Branch: feat/10-c-command-stages

# Command stages (ticket 10-c)

## Problem

A command stage runs `job.checks` and nothing else (`verify` in `src/verify.ts`, called by `drive` in `src/run.ts`). A-074 makes the command stage the place for a user's custom step: a stage may name its own commands, gets its context in a file named by `SF_REQUEST`, writes to an `outputDir`, has network off unless it asks, and records a SHA-256 of each command argument that is a file next to the workflow. The default workflow must not change: its hash is recorded on open (`workflowHash`, `src/store.ts`).

Facts the design must respect:
- `verify` deletes `evidence/<head>/` and writes `<name>.stdout|stderr|exit` there. A second command stage on the same head would delete the first one's evidence.
- `review` reads only the last `verification` event, and its files under `evidence/<head>/` (`src/review.ts`). A reviewer after two command stages would see one of them.
- Every check runs under `bwrap --clearenv`, with the checkout as its only writable path and no network (`runCheck`). bwrap binds host paths at the same path, and a read root over a write root stays read-only (`binds`, `src/sandbox.ts`).
- The verify checkout has no `.git`, so a command cannot work out the diff itself.
- A repository workflow is one file copied to `<runsDir>/repo-config/<sha>/` (10-b). Nothing beside it is copied.

## Interface

**The stage** (`src/lifecycle.ts`).

```ts
| { kind: 'command'; transitions: Transitions; budget?: number;
    /** The stage's own commands, run in order like job.checks. Absent: job.checks. */
    run?: Command[];
    /** Default false. */
    network?: boolean }

/** As Check, but an argument may name a file next to the workflow. */
interface Command { name: string; command: (string | { file: string })[] }
```

`checkWorkflow` refuses: `run` that is not a non-empty array; a name that is not a file stem, is `tree` or is used twice in the stage; an empty `command`; an argument that is neither a string nor `{ file }`; a `file` that is absolute or contains `..`; `network` that is not a boolean. These are today's `verify` name rules, moved to load time for `run`.

**Evidence, per stage.** Everything a command stage writes goes under `evidence/<head>/<stage>/`, and `verify` deletes only that directory before it runs. The controller writes there:
- `<name>.stdout`, `<name>.stderr`, `<name>.exit` per command, as today, and `tree.*` when the checkout is dirty;
- `request.json`, the request;
- `diff.patch`, `git diff --text <base> <head>`, uncut, the same diff the reviewer prompt quotes;
- `files/<file>`, a copy of each file argument.

`output/` inside it is the command's `outputDir`, empty at the start, and the only path the command can write besides the checkout. The rest of the stage directory is bound read-only, so a command cannot rewrite the evidence the reviewer reads. The default workflow's evidence moves from `evidence/<head>/` to `evidence/<head>/VERIFYING/`; the workflow itself is unchanged.

**The request.** `SF_REQUEST` is set to the path of `request.json`, which holds:

```ts
interface CommandRequest { cycleId: string; workId: string; stage: string; head: string; base: string; ticket: string; diffFile: string; outputDir: string }
```

`Policy` (`src/sandbox.ts`) gains `env?: Record<string, string>`, set after `--clearenv` by bwrap and added to the spawn environment by `none`. `src/kits/request.ts` exports the type and `readRequest()`, which parses the file `SF_REQUEST` names.

**File arguments.** An argument `{ file: 'lint.ts' }` names a file next to the workflow: the workflow file's directory for a personal or job workflow; for a repository workflow, the same path in the repository at the base SHA, extracted by `loadConfig` beside the workflow copy. `verify` copies the file to `files/lint.ts`, hashes the copy and passes the copy's absolute path as the argument. The command runs the bytes that were hashed, even if the original changes during the run. The default workflow has no file arguments, and a workflow with them but no file of its own (passed as an object in a test) is refused at load.

`loadConfig` passes `workflowDir` to `run`, and `run` passes it to `verify`.

**What is recorded.** Each entry in the `verification` event's `checks` gains `files?: Record<string, string>`, file argument to SHA-256. It is optional, so stores written before 10-c still replay. `SHAPE` checks it.

**What the reviewer sees.** For each command stage, the last verification for the candidate head, found through `history[].from`. Each check is listed as `<stage>/<name>`. The reviewer is not shown `output/`; passing data between steps is out (A-074).

**The command-stage kit** (`src/kits/command.ts`, modelled on `src/kits/runtime.ts`). A user calls `commandKit(name, { stage, workflowDir, passing, failing })` from their own test file. `passing` and `failing` each change a scratch repository. The kit runs the stage through the real `verify` and checks:
- the command reads every field of the request with `readRequest`, and `diffFile` holds the change;
- the passing change gives PASS and the failing one FAIL;
- a write outside `outputDir` and the checkout fails, and nothing outside them changes;
- with `network` unset, a connection fails.

## Alternatives

1. **`run` as bare argv lists (`run: [['npm', 'test']]`), as A-074 writes it.** Shorter, but each command needs a name for its evidence files. An index (`run-0`) shifts when a command is added, so the owner's evidence names stop matching between runs. Rejected in favour of `Check`'s `{ name, command }`.
2. **Detect file arguments: any argument that names an existing file next to the workflow.** No new syntax, but `node lint.ts` would mean the workflow's `lint.ts` or the checkout's depending on what exists, and a typo would silently run the checkout's file. Rejected in favour of `{ file }`.
3. **Keep the evidence flat and give each command stage only `output/<stage>/`.** The default stage's paths stay put, but two command stages still overwrite each other's `<name>.*` files when their names match. Rejected.

## Tests

- The default workflow's hash is unchanged (a literal, computed on main).
- A command stage with `run` runs those commands and not `job.checks`; without `run` it runs `job.checks`.
- `request.json` holds every field; `diffFile` holds `git diff base head`; `SF_REQUEST` names it inside bwrap.
- A command writes `output/x`; a write to the stage directory, to another stage's directory and outside them fails.
- `network: true` reaches a local listener; without it the connection fails.
- A file argument runs the copied bytes; the event records its SHA-256; changing the original during the run does not change what ran. A repository workflow's file argument is read at the base SHA, not the working tree or a later commit.
- Two command stages on one head keep each other's evidence, and the reviewer prompt lists both as `<stage>/<name>`.
- `checkWorkflow` refuses each malformed `run`, `network` and `file` value, one test each.
- A store written before 10-c (`tests/fixtures/v1-store.sqlite`) still replays.
- The kit, run against a fixture command, passes; against fixtures that break each contract, the matching case fails.

## Risks

- **Evidence paths move.** Anything that reads `evidence/<head>/<name>.*` breaks. In `src/` that is `review.ts` only; `proto/` does not read evidence. Old cycles keep their old evidence, and a resumed old cycle re-verifies into the new layout.
- **A file argument is code outside the repository.** It runs in the sandbox like any check, so it gains nothing a check does not have. The hash records which bytes ran.
- **`network: true` lets a command reach the network with the candidate's code in its checkout.** The same as any runtime today (D-021), and only when the workflow asks for it.

## Questions for the owner

**Q1 — `run` entries are `{ name, command }`, not bare argv.** A-074 writes `run: [[argv], …]`. Recommended: named entries, so each command's evidence files keep their names (alternative 1).

**Q2 — Evidence per stage, with `outputDir` inside it.** A-074 makes `outputDir` `evidence/<head>/<stage>/`. Recommended: the controller's files go in `evidence/<head>/<stage>/`, and `outputDir` is its `output/` subdirectory, so a command cannot overwrite the evidence the reviewer reads. The default workflow's evidence moves to `evidence/<head>/VERIFYING/`.

**Q3 — File arguments are written `{ file: 'x.ts' }`.** Recommended: an explicit marker, copied, hashed and bound read-only (alternative 2). A repository workflow's file is read at the base SHA. A file argument is one self-contained file, as the repository workflow is: it reads `request.json` itself or copies `readRequest`, rather than importing the factory.

**Q4 — The reviewer sees every command stage's evidence for the head, not `output/`.** Recommended: yes. A reviewer that saw only the last stage would miss a custom step's result.

Reply with the numbers you want to change, or say skip to take all recommendations.
