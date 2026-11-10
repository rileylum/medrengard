# Landing on GitHub

The steps that take a commission's commit to a merged pull request.

`@medrengard/core/forges/github/steps.ts` takes a commission's commit to a merged pull request in
three steps, or follows one merged on GitHub with a fourth: `open` pushes the subject commit and opens a pull request of it, an approval step
records the owner's decision, and `land` merges it. Nothing merges without that decision. Work
that fell behind `base` while it waited is rebased onto it with a fifth, `rebase`, and tested
again before it lands.

```ts
import { builtIn } from "@medrengard/core/defaults/kinds.ts";
import { github, pullRequest } from "@medrengard/core/forges/github/steps.ts";

const app = github({ repository: "owner/app", base: "main" });

const kinds = { ...builtIn, "pull-request": pullRequest };

const steps = {
  // …steps, such as develop and test, that end with a commit as the subject, then:
  open: app.open({ on: { done: "approve" } }),
  approve: { kind: "approval", on: { approve: "land" } },
  land: app.land({ on: { done: "end", behind: "rebase" } }),
  rebase: app.rebase({ on: { done: "test", conflict: "develop" } }),
} as const;
```

- **The credential:** a fine-grained personal access token in `~/.config/medrengard/github-token`,
  or the file `token` names, for the repositories you choose, with _Contents_ and _Pull requests_
  read and write. Keep it apart from your own `gh` login. The steps reach GitHub only through a
  broker, which holds the token, so it never enters a sandbox.
- **What the broker forwards:** only Git fetches and pushes for `repository`, and the calls to open
  one of its pull requests, find the one open for a branch, read one with its reviews and their
  comments, compare a commit with a branch, and merge one. Anything else is refused with a 403 naming it.
- **`open`** pushes the subject to `medrengard/<commission>` and opens a pull request against
  `base`. Its title is the request's title, and its body is the request's body, then the commit's
  report if it has one. It claims a `pull-request`: a judgement about the commit, which stays the
  subject, so verdicts on it stay current. The kind has no verifier.
- **`land`** merges the latest `pull-request` about the subject, with a merge commit unless
  `method` says `squash` or `rebase`, and claims `done`. It passes the subject's SHA, and GitHub
  refuses the merge if the pull request's head is no longer that commit. A refused merge, such as
  a moved head, a conflict or failing required checks, fails the step, with GitHub's answer in its
  errors, and the commission escalates. First it asks GitHub whether `base` has commits the
  subject lacks, as when another commission landed meanwhile; if so it merges nothing and claims
  `behind`. So commissions landing on one branch land one after another, each on what the last
  left, without the engine holding the branch: the one behind rebases and tries again, within its
  budgets. Two landing in the same instant could both pass the check; GitHub's _Require branches
  to be up to date before merging_ rule closes that.
- **`rebase`** rebases the subject onto `base` and claims the result, a new subject, so its tests
  run again and earlier verdicts become history. Each commit keeps its author; Medrengard is the
  committer. If they conflict, it claims `conflict` with a document listing the conflicting files,
  one per line, and the subject stays as it was: route it to the owner, or to an agent step that
  redoes the change on `base`.
- **`watch`** follows the latest `pull-request` about the subject, checking every `interval`
  seconds (60 unless given) for at most `wait` (a week unless given). It claims `merged`; `closed`,
  unmerged; or `changes`, once a reviewer's latest review of the subject commit asks for them, with
  every review of it and their inline comments as a document. Each needs an edge:

  ```ts
  watch: app.watch({ on: { merged: "end", changes: "fix", closed: "end" } }),
  ```

  A merge made on GitHub ends the commission there; `changes` can go back to the step that writes
  the next commit, and `open` again pushes it to the pull request already open and claims that
  one. It reads no CI: run the tests in the factory's own steps, before `open`.

- All five are plain steps: spread one to change a field, such as its limits or budget. `git` and
  `api` point the broker elsewhere, such as at GitHub Enterprise Server's `https://host/api/v3`.
