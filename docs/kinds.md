# Artifact kinds

What an artifact of each kind holds, and the programs that check a claim of it and build a workspace from it.

A kind says what an artifact of it holds, and how the engine checks a claim of it. The factory
passes its kinds by name; `@medrengard/core/defaults/kinds.ts` exports the built-ins as `builtIn`, to use
as they are, change, or add to:

```ts
import { contract } from "@medrengard/core/defaults/access.ts";
import { builtIn } from "@medrengard/core/defaults/kinds.ts";
import type { Kind } from "@medrengard/core/src/kinds.ts";

// A judgement, so the subject stays the commit it was opened for.
const pullRequest: Kind = {
  role: "judgement",
  description: "The pull request you opened for what the workflow is about.",
  fields: { url: { limit: 2048, required: true }, number: { limit: 16, required: true } },
  body: { required: false, limit: 64 * 1024 },
};

export const kinds = { ...builtIn, "pull-request": pullRequest };
```

- `role`: a `subject`, which becomes what the commission is about, or a `judgement` about it. The
  engine adds a judgement's `subject` field, so a judgement cannot define one.
- `description`: one line that tells a step what the kind is and how to claim it. The Claude Code
  adapter passes it to the agent.
- `fields`: each field's rule by name. Every field is text of at most `limit` bytes; `required:
  true` makes it required, and `values` limits it to a list.
- `body`: whether a UTF-8 body is required, and its `limit` in bytes.
- `outcome`, optional: a required field with `values` that must equal the claimed outcome, as a
  verdict's `verdict` does. A judgement with one routes the step, so a claim of it beside a new
  subject escalates: it would be about the subject that claim replaces.
- `verifier` and `materialiser`, optional: programs, each a `run`, an `access` and its `limits`,
  named as a step's are: `{ attempt, memory, processes }`, in seconds, bytes and a count; a
  verifier's also `kept`, the bytes of all the files it keeps for an artifact, 0 for one that
  keeps none. A commission started before limits were named so still reads. Each runs in its own sandbox, like a step;
  leaving the sandbox is an access you write, such as one that writes `/`. The built-ins' have 60 s, 4 GiB and
  1024 processes, and the commit verifier keeps 1 GiB, its bundle holding the whole history.

The kinds must include `document`, the kind of the owner's request, and cannot include `decision`,
which only the owner makes. Since the engine makes the request a document, with a title and a
body, `document` must be a subject, define `title`, require no other field and have no verifier, and
a request whose title or body breaks its rules is refused before it is commissioned. A name holds letters, digits and `-`, starting with a letter. A
commission records the kinds it started with, beside its workflow: editing a kind affects only new
commissions.

A verifier runs after a claim of its kind parses, in the attempt's workspace, in the mode its access
gives. Its `MEDRENGARD_IN` holds `claim.json`, with the claim's `kind` and `fields`, its `body` as a path to
the file `body` when it has one, and the commission's current `subject`. It writes `output.json`:
exactly `{ "accepted": true, "keep": [...] }`, naming files in its `MEDRENGARD_OUT` for the store to
keep, together at most its `kept` bytes, `[]` for none; or exactly `{ "accepted": false, "reason": "..." }`, and
the commission escalates with the reason. Anything else, a field more included, fails the verifier.

A materialiser builds a later step's workspace from a subject, the current one or an input's, in an
empty workspace. Its
`MEDRENGARD_IN` holds `artifact.json`, with the artifact's `hash`, `kind`, `fields`, `body` and
`kept` files as paths, and those files. A workflow whose workspace may be built from a kind without
one is refused when it is commissioned. A materialiser that can add other artifacts of its kind
to the workspace as branches says so, `branches: true`; then, when a step adds branches, its
`MEDRENGARD_IN` also holds `branches.json`, each artifact as `artifact.json` gives one, with its
`branch`, and its files under `branches/<branch>/`.

A verifier or materialiser gets less than a step: no fd 3 for notes, its stdout is discarded, and
its stderr is kept only when it fails, ending the escalation's reason (its last 1024 bytes). A
failure, a reached limit or a signal escalates the commission, naming the program and its step;
a step whose workspace could not be built never starts.
