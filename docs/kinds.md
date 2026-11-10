# Artifact kinds

What an artifact of each kind holds, and the programs that verify a claim of it and build a workspace from it.

A kind is data: a role, a schema for an artifact's fields, a rule for its body, and optionally a
verifier, a materialiser and an outcome field. A step states the kinds it may claim. Your factory
passes its kinds by name, as `kinds`. `@medrengard/core/defaults/kinds.ts` exports the built-in
ones as `builtIn`: use them as they are, change one, or add your own beside them.

```ts
import { builtIn } from "@medrengard/core/defaults/kinds.ts";
import type { Kind, Kinds } from "@medrengard/core/src/kinds.ts";

// A judgement, so the subject stays the commit the pull request was opened for.
const pullRequest: Kind = {
  role: "judgement",
  description: "The pull request you opened for what the workflow is about.",
  fields: { url: { limit: 2048, required: true }, number: { limit: 16, required: true } },
  body: { required: false, limit: 64 * 1024 },
};

export const kinds: Kinds = { ...builtIn, "pull-request": pullRequest };
```

## Fields

| Field          | Required | Meaning                                                                                                       |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `role`         | yes      | `"subject"`: a claimed artifact becomes the commission's subject. `"judgement"`: it is about the subject.     |
| `description`  | yes      | One line that tells a step what the kind is and how to claim it. A step reads it in `input.json`.             |
| `fields`       | yes      | Each field's rule, by name. A field is text of at most `limit` bytes.                                         |
| `body`         | yes      | `{ required, limit }`: whether a claim must have a body, and the body's limit in bytes. A body is UTF-8 text. |
| `outcome`      | no       | The name of a field that must equal the outcome claimed with the artifact.                                    |
| `verifier`     | no       | A [program](#programs) that accepts or rejects a claim of the kind.                                           |
| `materialiser` | no       | A [program](#programs) that builds a workspace from an artifact of the kind.                                  |

A field's rule is `{ limit, required?, values? }`: the most bytes its text may hold, over 0;
`required: true` when a claim must have it; and the list of texts it may be.

## Rules

- A kind's name is letters, digits and `-`, starting with a letter.
- The kinds must include `document`, the kind of the owner's request.
- No kind is named `decision`: only the owner makes a decision.
- `document` must be a subject and define `title`. Only `title` may be required, and it has no
  verifier. A request whose title or body breaks its rules is refused before the commission starts.
- A judgement cannot define a field `subject`. The engine adds it: the subject the attempt was
  given.
- `outcome` names a required field with `values`. A step that may claim the kind needs an edge for
  each value.
- A judgement with an `outcome` routes its step. A claim of it beside a new subject escalates: the
  judgement would be about the subject the claim replaces.
- A commission records the kinds it started with. Editing a kind affects only new commissions.

## The built-in kinds

| Kind       | Role      | Fields                                                      | Body                     | Verifier                      | Materialiser                            |
| ---------- | --------- | ----------------------------------------------------------- | ------------------------ | ----------------------------- | --------------------------------------- |
| `document` | subject   | `title`, required, 200 bytes                                | required, 1 MiB          | none                          | Writes the body to the file `document`. |
| `commit`   | subject   | `sha`, required, 64 bytes                                   | optional report, 1 MiB   | See below. Keeps up to 1 GiB. | Clones the commit. Adds branches.       |
| `verdict`  | judgement | `verdict`, required, `pass` or `fail`; `summary`, 200 bytes | optional findings, 1 MiB | none                          | none                                    |

`verdict`'s outcome field is `verdict`. The owner's decision is the fourth built-in kind,
`decision`; the engine writes it, and a step that claims one escalates.

The commit verifier rejects a claim with the first of these reasons that holds:

- `The workspace has no Git HEAD.`
- `HEAD is <head>, not <sha>.` Claim the full SHA of `HEAD`.
- `<sha> is already the subject.`
- `<sha> changes nothing: its tree is its parent's.` The commit is empty.
- `<sha> changes nothing: its tree is the subject's.`
- `<sha>'s history is incomplete in the workspace.` The repository is shallow, for one.

More about it:

- It compares a subject of any kind that has a `sha` field, when that commit is in the workspace's
  repository.
- It keeps `commit.bundle`, a Git bundle that holds the commit's whole history.
- It reads the workspace and cannot write it.

The commit materialiser clones the bundle, checks out the SHA with `HEAD` detached, and removes the
remote. It then fetches each branch's commit from its bundle as the branch `<branch>`.

## Programs

A verifier and a materialiser are programs. Each runs in a sandbox of its own, like a step's.

```ts
import { node } from "@medrengard/core/defaults/access.ts";
import type { Kind } from "@medrengard/core/src/kinds.ts";

const factory = "/path/to/factory";

// `node`, with the programs and the node_modules they import the contract module through.
const program = (file: string, workspace: "read" | "write") => ({
  run: [process.execPath, `${factory}/kinds/${file}`] as const,
  access: {
    ...node,
    workspace,
    paths: [
      ...node.paths,
      { path: `${factory}/kinds`, mode: "read" as const },
      { path: `${factory}/node_modules`, mode: "read" as const },
    ],
  },
  limits: { attempt: 60, memory: 1024 * 1024 * 1024, processes: 256 },
});

const verifying = program("build-verifier.ts", "read");

export const build: Kind = {
  role: "subject",
  description: "The build you made at dist/app.js, which becomes what the workflow is about.",
  fields: { version: { limit: 32, required: true } },
  body: { required: false, limit: 64 * 1024 },
  verifier: { ...verifying, limits: { ...verifying.limits, kept: 16 * 1024 * 1024 } },
  materialiser: program("build-materialiser.ts", "write"),
};
```

| Field              | Required                      | Meaning                                                                               | Unit    |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------- | ------- |
| `run`              | yes                           | The command and its arguments.                                                        |         |
| `access`           | yes                           | Its [access](access.md). `network` is `true` or `false`: it cannot list hosts.        |         |
| `limits.attempt`   | yes                           | The longest it may run. Over 0, at most 2147483.                                      | seconds |
| `limits.memory`    | yes                           | The most memory its processes may use. Over 0.                                        | bytes   |
| `limits.processes` | yes                           | The most processes and threads it may run at once. Over 0.                            | count   |
| `limits.kept`      | a verifier only               | The most all the files it keeps for one artifact may hold. 0 for one that keeps none. | bytes   |
| `branches`         | a materialiser only, optional | `true`: it can add other artifacts of its kind to the workspace as branches.          |         |

- The built-in programs have 60 s, 4 GiB of memory and 1024 processes.
- The workspace is in the mode the program's `access.workspace` gives. Give a verifier `"read"`: it
  judges the workspace and must not change it.
- What a program writes counts toward the step's `disk` limit.

A kind's program gets less than a step's:

| What                | A kind's program has                                         |
| ------------------- | ------------------------------------------------------------ |
| Working directory   | The workspace.                                               |
| `MEDRENGARD_IN`     | A read-only directory with the files below.                  |
| `MEDRENGARD_OUT`    | An empty directory.                                          |
| Environment         | Only what its access names, the two above and `PWD`.         |
| stdin               | Empty.                                                       |
| stdout              | Discarded.                                                   |
| stderr              | Kept only when it fails: the last 1024 bytes end the reason. |
| Descriptors 3 and 4 | None: no notes and no usage reports.                         |

A TypeScript program reads and writes its files with the contract module,
`@medrengard/core/step/contract.ts`. [The step contract](step-contract.md) lists its functions.

## Verifier

A verifier accepts or rejects a claim, and names the files the store keeps for the artifact. It
runs after a claim of its kind parses, in the attempt's workspace. An adopted artifact is not
verified again.

```ts
// kinds/build-verifier.ts
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { accept, output, readClaim, reject } from "@medrengard/core/step/contract.ts";

const { fields } = readClaim();

if (existsSync("dist/app.js")) {
  copyFileSync("dist/app.js", join(output, "app.js"));
  accept(["app.js"]);
} else {
  reject(`Build ${fields.version} has no dist/app.js.`);
}
```

The same with plain files:

```sh
#!/bin/sh
if [ -f dist/app.js ]; then
  cp dist/app.js "$MEDRENGARD_OUT/app.js"
  echo '{"accepted":true,"keep":["app.js"]}' > "$MEDRENGARD_OUT/output.json"
else
  echo '{"accepted":false,"reason":"The build has no dist/app.js."}' > "$MEDRENGARD_OUT/output.json"
fi
```

It reads `claim.json` in `MEDRENGARD_IN`:

```json
{
  "kind": "build",
  "fields": { "version": "1.4.0" },
  "body": "body",
  "subject": { "hash": "9f2c…", "kind": "document", "fields": { "title": "Plan" } }
}
```

- `body` is the path of the body's file in `MEDRENGARD_IN`. It is left out when there is none.
- `subject` is the commission's current subject.
- A judgement's `fields` hold the `subject` the engine added.

It writes `output.json` in `MEDRENGARD_OUT`, and exits 0:

| It writes exactly                          | Then                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `{ "accepted": true, "keep": ["app.js"] }` | The claim is accepted. The store keeps the files named. `[]` keeps none. |
| `{ "accepted": false, "reason": "..." }`   | The commission escalates, cause `claim`, with the reason.                |

- A kept file is a file the verifier wrote in `MEDRENGARD_OUT`, named by a plain name: letters,
  digits, `.`, `_` and `-`, no path.
- The kept files together hold at most `limits.kept` bytes.
- Anything else fails the verifier: no `output.json`, one over 64 KiB, a field more, a file that is
  missing or over the limit.
- The record names the verifier that accepted an artifact, or that its kind has none.

## Materialiser

A materialiser builds a later step's workspace from an artifact: the current subject, or the one
artifact an input names. It starts in an empty workspace and writes the workspace there.

```ts
// kinds/build-materialiser.ts
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { input, readArtifact } from "@medrengard/core/step/contract.ts";

const { kept } = readArtifact();

copyFileSync(join(input, kept["app.js"]!), "app.js");
```

The same with plain files:

```sh
#!/bin/sh
cp "$MEDRENGARD_IN/kept/app.js" app.js
```

It reads `artifact.json` in `MEDRENGARD_IN`. Each path is relative to `MEDRENGARD_IN`:

```json
{
  "hash": "77d0…",
  "kind": "build",
  "fields": { "version": "1.4.0" },
  "body": "body",
  "kept": { "app.js": "kept/app.js" }
}
```

- `body` is left out when the artifact has none.
- `kept` holds the path of each file its verifier kept, by name: `kept/<name>`.

Branches:

- A materialiser that can add other artifacts of its kind to the workspace as branches states
  `branches: true`.
- When a step's workspace adds branches, `MEDRENGARD_IN` also holds `branches.json`: a list, each
  entry as `artifact.json` with its `branch`. Its files are under `branches/<branch>/`: `body` and
  `kept/<name>`.
- A step that adds none gives no `branches.json`.

A workflow is refused before its commission starts when:

- a step's workspace may be built from a kind without a materialiser;
- a step's workspace may add branches of a kind whose materialiser does not state `branches: true`.

## When a program fails

A kind's program fails when it exits other than 0, a signal ends it, it cannot start, or it reaches
its `attempt` or `memory` limit. A verifier also fails as [above](#verifier).

- The commission escalates with cause `kind`. The reason names the kind's program and the step:
  `The build verifier failed on step package's claim: it exited with code 1. Its stderr: "…".`
- Nothing the attempt claimed is recorded.
- A step whose workspace could not be built never starts, and its attempt has no transcript.
- The owner's cancel stops a kind's program too, and the commission escalates with cause
  `cancelled`.
