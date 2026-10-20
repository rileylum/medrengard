# sweep-head-workflow — Import a repository workflow only from a merged base

Route: Design. It narrows the accepted risk A-078 Q2 (a repository workflow runs unsandboxed in the controller), and it has real alternatives.

Owner's instruction, 2026-10-20: "Once all this research comes back, triage it (merging similar things and organizing it, giving ratings for highest impact) - then create a worktree for each and spin up a sub agent to implement them. I want to come back tomorrow to a number of ready to merge branches, so we should only focus on the high quality and high impact ones. We will then work through them together, deciding if they should be merged or not, or if they need changes before going in - so you will need to explain each to me in plain english and defend the changes." This is the go to build the branch, not approval to merge.

Source: TRIAGE.md item B3; security.md finding 1 (`/var/tmp/software_factory/research-2026-10-20/security.md`).

Goal: `loadConfig` imports a workflow named by the repository layer only when the base commit is on a branch or tag the owner keeps, never when only the factory's candidate refs contain it.

Design: before `extractWorkflow`, `loadConfig` asks `git for-each-ref --contains <base> refs/heads refs/tags` and drops `refs/heads/sf/*`. If nothing is left, it throws, naming the base and telling the owner to set `base` in the job file to a merged branch or to check one out. The check runs whatever gave the base: the job file, `HEAD`, or a base recorded in the store (`decisionConfig`). It uses the controller's existing `git` helper.

Why an allow list of `refs/heads` and `refs/tags`, not "every ref except `sf/*`": `git stash` on a checked-out candidate writes `refs/stash`, a commit whose parent is the candidate, so a deny list would let a stash count as merged. `refs/sf/incoming/*` (written by `src/developer.ts`) and `refs/remotes/*` are outside the list too.

Alternatives:
1. Require `base` in the job file whenever the repository layer names a workflow. Rejected: the owner can still write `"base": "HEAD"` or `"base": "sf/<cycleId>"`, so it moves the choice without checking it; and every job file that relies on `HEAD` today stops working.
2. Remove `workflow` from the repository layer's allow list (only the personal and job layers name a workflow). Closes A-078 Q2 whole, but undoes an approved design (A-078 Q2) and needs the owner's decision.

Done when:
- With a candidate branch `sf/<id>` checked out and no `base` in the job file, `cancel` refuses with the ref message and the candidate's workflow module never runs (a marker file it would write does not appear). Verified by test in `tests/main.test.ts`.
- A detached `HEAD` at a commit only `sf/*` and `refs/stash` contain is refused the same way by `loadConfig`. Verified by test in `tests/config.test.ts`.
- A workflow at the `HEAD` of an ordinary branch the owner made (not `main`, not merged) still loads. Verified by test in `tests/config.test.ts`. Existing tests that load a repository workflow at `main` keep passing.

Constraints: zero dependencies. No paid calls. No change when the repository layer names no workflow, or when the job file names one.
Non-goals: the other repository-layer keys (`checks`, `runtime`; see "For the owner"); updating `docs/work/accepted-risks.md` (the session does that after the owner merges).
Verification: `npm test`, run by the owner on the reviewed SHA.

## For the owner

**What was wrong.** A repository can name a workflow in `.factory/config.json`. The factory imports that module into the controller, with your full rights and no sandbox. A-078 accepted this because "it is read at the base SHA, so only code the owner has merged runs". But when the job file has no `base`, the base is your repository's current `HEAD`. If you check out a candidate branch to look at it (`git switch sf/<cycleId>`), `HEAD` is the candidate. The next `node src/main.ts cancel job.json` (or `accept`, `events`, or a new run) then imports the candidate's workflow and runs its code as you. The developer agent wrote that code; nobody merged it.

**Reproduction.** In a scratch repository, on branch `sf/x`, commit `.factory/config.json` with `{"workflow":"flow.ts"}` and a `flow.ts` whose top level writes a file `PWNED`. Leave `sf/x` checked out. Run `node src/main.ts cancel job.json` with a job file that has no `base`. Before this change: "nothing to cancel …", and `PWNED` exists. After: exit 2, "base … is only on factory candidate refs …", and no `PWNED`.

**What the change does.** Before it imports a repository workflow, `loadConfig` asks Git which branches and tags contain the base commit. It ignores the factory's own `sf/*` branches. If no other branch or tag contains the commit, it stops and says so. It tells you to set `base` in the job file to a merged branch, or to check one out.

**Why this and not "require `base` in the job file".** Requiring `base` only moves the problem: `"base": "HEAD"` or `"base": "sf/x"` would still load the candidate. The ref check tests the thing A-078 assumed, that the code is on a branch you keep.

**Risks and what it does not cover.**
- "Merged" means "on any local branch or tag that is not `sf/*`". If you copy a candidate to a branch of your own (`git switch -c look sf/x`) or merge it locally, its workflow loads. That is your merge, so it matches A-078, but it is a weaker meaning than "on `main`".
- A cycle opened on a feature branch that you later squash-merge or rebase-merge and delete has a base only its own `sf/<cycleId>` holds. `accept`, `cancel` and `events` then fall back to the tip. If the tip's workflow matches the cycle's, they work as before. If it does not, they stop with the ref message, naming the base, instead of the store's workflow-mismatch error. To decide on such a cycle, recreate a branch at its base (`git branch keep <base>`).
- Remote-tracking branches (`refs/remotes/*`) do not count. Today the repository has no remote. If a job ever runs from a fresh clone with only `origin/main`, create the local branch first.
- Other repository-layer content read at the same base: `checks` run inside the sandbox in verify; `runtime` can only pick a runtime already registered by the personal or job layer; `{ file }` arguments are read only for a repository workflow, so this check covers them. None of these runs code in the controller, so the change leaves them alone. One related gap stays: a new run whose base is a candidate starts the next cycle on top of unreviewed code, and the reviewers see only `base..head`. This change refuses that only when the repository names a workflow.
- `git for-each-ref --contains` walks history. On a large repository with many branches it adds a short delay to every command that loads a repository workflow.

**Decisions for you.**
1. Is "any non-`sf/*` local branch or tag" the right meaning of merged, or should only the default branch count? The narrower rule needs the default branch named somewhere (a job or personal key).
2. After merge, the session should update A-078's row in `docs/work/accepted-risks.md`: "only code the owner has merged runs" now holds by check, not by assumption, with the limits above.

## Log
- 2026-10-20 — drafted on `feat/sweep-head-workflow` from TRIAGE B3, under the owner's instruction above.
- 2026-10-20 — implemented at `5f49d64`, tests first. `checkMerged` in `src/config.ts` runs `git for-each-ref --contains <base> refs/heads/ refs/tags/` through the existing `git` helper and throws unless a ref outside `refs/heads/sf/` is left; `loadConfig` calls it before `extractWorkflow`, only when the repository layer's workflow is used. Red on the unchanged code for the stated reason: `tests/main.test.ts` "cancel with a candidate branch checked out …" got `nothing to cancel for work w in …` (the candidate workflow had run), and `tests/config.test.ts` "a repository workflow at a base only sf/* …" got `Missing expected rejection`. "… the head of an unmerged branch the owner made, or at an older commit of main, still loads" passed at once, as it should. Mutants, one at a time on the committed code, each caught: no ref patterns (all refs, so `refs/stash` and `refs/remotes` count); `sf/*` not filtered; `refs/remotes/` added; only `refs/heads/main` counted; the call removed. Untested: a tag alone counting as merged. Spec: one bullet under Driver. `lazy-review`: lean already. Implementer's `npm test` on `5f49d64`, not independent: 422 tests, 398 pass, 0 fail, 19 skipped, 5 todo.
- Next: owner to read "For the owner", answer decision 1, and say whether to run the reviews. After merge, the session updates A-078's row in `docs/work/accepted-risks.md`.
- 2026-10-20 — standard review (fresh reviewer, coordinator's run) on `6149022`: PASS. One minor: a cycle whose base was on a feature branch later squash-merged and deleted is held only by `sf/<cycle>`; `decisionConfig` swallowed the ref refusal and fell back to the tip, so `accept`, `cancel` and `events` failed with the store's workflow-mismatch error. One nit: `learn/config.html` did not mention the check. Fixed at `6dc58b8`, tests first. Red for the stated reason: the reviewer's reproduction (commit on `feat`, run, squash-merge into `main`, delete `feat`, change the workflow on `main`) got `cycle … was opened under workflow v1 (…), this store runs v2 (…)`. Now `checkMerged`'s error carries `code: 'UNMERGED_BASE'`; `decisionConfig` keeps the first such refusal, still tries the tip, and throws the refusal when the tip fails to load or its workflow hash differs from the cycles'. The same test pins that a tip with a matching workflow still cancels. A first version threw before trying the tip, which would have broken that case. Mutant caught: the hash comparison removed. Untested: the tip failing to load while a recorded base was refused (`throw unmerged ?? err`). Guide: one clause in `learn/config.html`. Implementer's `npm test` on `6dc58b8`, not independent: 423 tests, 399 pass, 0 fail, 19 skipped, 5 todo; `npm run test:learn`: 6 pass, 0 fail.
- Next: owner to read "For the owner", answer decision 1, and decide on the merge. After merge, the session updates A-078's row in `docs/work/accepted-risks.md`.
