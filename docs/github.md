# Landing on GitHub

The steps that take a commission's commit to a merged pull request.

## The steps

`github` from `@medrengard/core/forges/github/steps.ts` returns four command steps for one
repository. Use them once a commit is the subject.

```ts
import { builtIn } from "@medrengard/core/defaults/kinds.ts";
import { github, pullRequest } from "@medrengard/core/forges/github/steps.ts";

const app = github({ repository: "owner/app", base: "main" });

// The factory's kinds: the steps claim and read pull-request.
const kinds = { ...builtIn, "pull-request": pullRequest };

const steps = {
  // …develop and test, which end with a commit as the subject, then:
  open: app.open({ on: { done: "approve" } }),
  approve: { kind: "approval", on: { approve: "land" } },
  land: app.land({ on: { done: "end", behind: "rebase" } }),
  rebase: app.rebase({ on: { done: "test", conflict: "develop" } }),
};
```

| Step     | Does                                         | Outcomes                      | Inputs                       | Workspace | Claims               |
| -------- | -------------------------------------------- | ----------------------------- | ---------------------------- | --------- | -------------------- |
| `open`   | pushes the subject, opens a pull request     | `done`                        | request, subject             | subject   | `pull-request`       |
| `land`   | merges it, unless the subject is behind      | `done`, `behind`              | subject, its `pull-request`s | empty     | none                 |
| `rebase` | rebases the subject onto `base`              | `done`, `conflict`            | none                         | subject   | `commit`, `document` |
| `watch`  | waits until it is merged, closed or reviewed | `merged`, `closed`, `changes` | subject, its `pull-request`s | empty     | `document`           |

Nothing merges from the factory without the approval step between `open` and `land`. To merge on
GitHub instead, follow `open` with `watch`.

## Setting up

1. Create a fine-grained personal access token for the repository, with _Contents_ and _Pull
   requests_ read and write. Keep it apart from your own `gh` login.
2. Save it as `~/.config/medrengard/github-token`.
3. Add `pullRequest` to the factory's kinds as `pull-request`.

| Option       | Meaning                                     | Default                             |
| ------------ | ------------------------------------------- | ----------------------------------- |
| `repository` | the repository, as `owner/name`             | required                            |
| `base`       | the branch pull requests are opened against | required                            |
| `token`      | the file that holds the token               | `~/.config/medrengard/github-token` |
| `git`        | where Git fetches and pushes go             | `https://github.com`                |
| `api`        | where API calls go                          | `https://api.github.com`            |

For GitHub Enterprise Server, `git` is `https://host` and `api` is `https://host/api/v3`.

## Changing a step

Each step function takes one object: `on`, and any field you change.

| Field      | Meaning                                      | Default                |
| ---------- | -------------------------------------------- | ---------------------- |
| `on`       | the edge for each outcome the step can claim | required               |
| `budget`   | attempts between your decisions              | 1                      |
| `limits`   | the limits you change                        | the factory's defaults |
| `access`   | the step's access                            | the forge's own        |
| `method`   | `land` only: `merge`, `squash` or `rebase`   | `merge`                |
| `interval` | `watch` only: seconds between checks         | 60                     |
| `wait`     | `watch` only: the most seconds it waits      | 604800, a week         |

- `land`, `rebase` and `watch` need an edge for each of their outcomes. The compiler checks it.
- You cannot pass `kind`, `run`, `inputs`, `escalate`, `watch` or `workspace`.
- To add a route, spread the step where you list the workflow's steps:

  ```ts
  land: {
    ...app.land({ on: { done: "end", behind: "rebase" }, method: "squash" }),
    escalate: { exit: "develop" },
  },
  ```

- A step that runs again with no decision of yours between needs a budget above 1.

## The `pull-request` kind

A `pull-request` is a judgement about the subject commit: that it is open as a pull request. Its
fields are `repository`, `number` and `url`. It has no verifier.

- The commit stays the subject, so verdicts about it stay evidence.
- `land` and `watch` read the latest `pull-request` about the current subject. After a new
  commit, run `open` again first, or they fail: `No pull request about the subject was opened`.

## `open`

- It force-pushes the subject to the branch `medrengard/<commission>`.
- It opens a pull request of that branch against `base`. The title is the request's title. The
  body is the request's body, then the commit's report if it has one.
- If a pull request of the branch is already open, the push updates it, and `open` claims that
  one.

## `land`

- It first asks GitHub whether `base` has commits the subject lacks. If so, it merges nothing and
  claims `behind`.
- Otherwise it merges the pull request with `method` and claims `done`.
- It passes the subject's SHA. GitHub refuses the merge if the pull request's head is any other
  commit.
- A refused merge fails the step: a moved head, a conflict, failing required checks. The
  commission escalates with the cause `exit`, and the attempt's errors hold GitHub's answer.

Commissions that land on one branch land one after another: the one behind rebases and tries
again, within its budgets. Two that land in the same instant can both pass the check. GitHub's
_Require branches to be up to date before merging_ rule closes that.

## `rebase`

- It fetches `base`, rebases the subject onto it, and claims `done` with the rebased commit.
- The rebased commit is a new subject. Earlier verdicts and the `pull-request` become history:
  test it, `open` it and approve it again. `rebase` pushes nothing; `open` does.
- Each commit keeps its author. The committer is `Medrengard <medrengard@localhost>`.
- On a conflict it claims `conflict` with a document that lists the conflicting files, one per
  line. The subject stays as it was. Route `conflict` to an approval step, or to an agent step
  that redoes the change on `base`.

## `watch`

`watch` is a watching step. It checks every `interval` seconds, for at most `wait` seconds.

```ts
const steps = {
  open: app.open({ on: { done: "watch" }, budget: 5 }),
  watch: app.watch({ on: { merged: "end", changes: "fix", closed: "end" }, budget: 5 }),
  // …fix, which ends with a new commit and goes back to open.
};
```

- Each check claims the first of these that holds, or nothing yet: `merged`; `closed`, unmerged;
  `changes`, when a reviewer's latest review of the subject commit requests changes.
- With `changes` it claims a document, `Review of pull request <number>`: each review of the
  subject commit that has text, then every inline comment on the pull request.
- Reviews of earlier commits do not count.
- After the fix, `open` pushes the new commit to the same pull request and claims it.
- It reads no CI. Run the tests in the factory's own steps, before `open`.

## The broker

The steps reach GitHub only through the broker `github`, which holds the token outside the
sandbox. Their access names no other host. The broker forwards, for `repository` alone:

- Git fetches and pushes;
- `POST /pulls`: open a pull request;
- `GET /pulls?head=<owner>:<branch>&state=open`: find the one open for a branch;
- `GET /pulls/<number>`, `/pulls/<number>/reviews` and `/pulls/<number>/comments`: read one;
- `GET /compare/<base>...<sha>`: compare a commit with a branch;
- `PUT /pulls/<number>/merge`: merge one.

Rules:

- Anything else gets a 403 that names the request: `Refused by Medrengard's GitHub broker: …`
- The broker does not limit which branch a push updates. Protect `base` on GitHub if only a pull
  request may change it.
- A `base` to compare with may hold letters, digits, `_` and `-`, in parts joined by `.` or `/`.
- Without a token file it can read, the broker does not start, and the commission escalates with
  the cause `broker`.
