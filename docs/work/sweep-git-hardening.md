# sweep-git-hardening — Controller git: no candidate-chosen filters, plain diffs, no stale verify lock

Route: Fast. Three small fixes to how the controller calls git, each with a test; no lifecycle or event change.

Goal: the controller's own git calls run no filter or diff driver the candidate can choose, read plain patches whatever the owner's diff settings, and recover from a verify index lock a crash left behind.

Owner's instruction, 2026-10-20: "Once all this research comes back, triage it (merging similar things and organizing it, giving ratings for highest impact) - then create a worktree for each and spin up a sub agent to implement them. I want to come back tomorrow to a number of ready to merge branches, so we should only focus on the high quality and high impact ones. We will then work through them together, deciding if they should be merged or not, or if they need changes before going in - so you will need to explain each to me in plain english and defend the changes." Triage item B6 (security review finding 4 and its notes; sweep finding 5).

Done when:
- A candidate whose `.gitattributes` names `filter=probe`, with the owner's config defining `filter.probe.smudge` and `.clean` to write a marker, passes verify and the marker does not exist; the same holds when the owner's own attributes file (`core.attributesFile`) names the filter. Test in `tests/verify.test.ts`.
- The 08-a test "an untracked .gitattributes planted by a check does not change how the tree is compared" still passes.
- With the owner's `diff.external` and a textconv driver set, the reviewer's DIFF section is the plain patch. Test in `tests/review.test.ts`.
- With the owner's textconv driver that maps every version to the same text, a candidate that changes a file is not refused as "no changes". Test in `tests/developer.test.ts`.
- An empty `<cycle>-verify.index.lock` left before verify does not stop verify, and one left before review does not stop review. Test in `tests/verify.test.ts`.
- `npm test` passes.

Constraints: zero dependencies. Tests set owner git config through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` in the test process, never the owner's real config.
Non-goals: `core.autocrlf`, `core.eol` and `core.fsmonitor` from the owner's config still apply to the verify checkout (owner-chosen, not candidate-chosen). `$GIT_DIR/info/attributes` of the owner's repository still applies (the owner writes it; a developer cannot). The system git config is still read (see "For the owner").
Verification: `npm test`, run by the owner.

## For the owner

**What was wrong.**
1. Verify checks out the candidate with git, outside the sandbox. Git took file attributes from the candidate's own `.gitattributes`. A line such as `* filter=lfs` there makes git run the matching filter program from your git config, as you, with network. git-lfs is the realistic case: `git lfs install` sets `filter.lfs` in your global config, and git-lfs then reads the server address from the candidate's `.lfsconfig`. Nothing runs on this machine today, because no filter is configured here.
2. `review` built the reviewer's diff with plain `git diff`. If you set `diff.external` (difftastic, say) or a textconv driver, the reviewer got that tool's output instead of a patch. Verify's own `diff.patch` already turned these off.
3. While checking the other git calls: `develop` decides "the candidate changed nothing" with `git diff --quiet`. A textconv driver that renders two versions the same (a binary-to-text converter, for example) made git answer "no change", so a real change was refused.
4. A crash or SIGKILL during the controller's git calls on the verify checkout leaves `<cycle>-verify.index.lock` (on Ctrl-C, git removes its own lock). Every later verify or review of that cycle failed with "File exists". Only `resume` reaches this today (nothing calls it), so it matters for row 11.

**Reproduction.** Each new test fails on `a3c74ff`; the failure lines are in the log below.

**What the change does.**
1. `checkoutGit` (`src/verify.ts`) takes attributes from the empty tree, sets `core.attributesFile=/dev/null` and `GIT_ATTR_NOSYSTEM=1`. Git then reads no attributes from the candidate, from your global attributes file or from the system one. The checkout holds the commit's bytes as stored.
2. `review`'s diff gets `--no-ext-diff --no-textconv --no-color`, the same flags as verify's.
3. `develop`'s two `git diff --quiet` calls get `--no-ext-diff --no-textconv`.
4. The controller's checkout git (`checkoutGit`) deletes the private index's lock before its first call, so both verify and review's tree check recover. The index itself stays: git replaces it only by renaming a finished lock, so it is never half-written, and `read-tree` rebuilds it anyway.

**Why this approach.** The research suggested `GIT_CONFIG_NOSYSTEM=1`. That variable skips the system *config*, but a filter only runs when an *attribute* selects it, and the system *attributes* file is controlled by `GIT_ATTR_NOSYSTEM`. So the change sets `GIT_ATTR_NOSYSTEM` and leaves the system config alone. The empty tree, not "no `--attr-source`": without the flag git reads `.gitattributes` from the checkout, which a check can rewrite (08-a chose `--attr-source=<head>` to stop that, and the empty tree keeps it stopped).

**Does this undo a deliberate guarantee?** No. 08-a picked `--attr-source=<head>` so that a `.gitattributes` a check plants cannot change the comparison; that test still passes. 08-a listed "conversions the commit's own `.gitattributes` declares (`eol`, `ident`) are applied on both checkout and compare" as a known limit, not a promise. 06-c's CRLF concern (a `text=auto` commit with CRLF blobs reported dirty) cannot arise now, since no attribute converts anything.

**Risks.**
- A check that relied on the commit's `.gitattributes` conversions now sees the stored bytes. Example: a repository that stores `*.bat` with LF and declares `eol=crlf` used to get CRLF files in the verify checkout; now it gets LF. Such a check would now fail where it passed. I know of no repository here that does this.
- With no attributes read, a candidate can no longer opt files out of your `core.autocrlf` with `-text` or `binary`. If you set `core.autocrlf=true`, LF-only files get CRLF in the verify checkout (the standard reviewer reproduced this on git 2.56). A check then sees CRLF where the commit stores LF.
- A repository that keeps real content in git-lfs now gets pointer files in the verify checkout, not the content. Before, it got content only if you had lfs configured and the network let it through. Checks on lfs content would now fail visibly instead of fetching from a host the candidate chose.

**Not covered.** `core.autocrlf`/`core.eol` in your own config still convert line endings in the checkout. `core.fsmonitor`, if you set it, still runs during the tree check. Both are your settings, not the candidate's.

**A correction to the research.** The brief said a candidate's `.gitattributes` `diff=<driver>` could pick your textconv driver for the reviewer's diff. It cannot: `git diff base head` in your repository reads attributes from your working tree and `.git/info/attributes`, not from the candidate. The review fix still matters for your own `diff.external` and textconv settings.

**Decision for the owner.** Whether the stored-bytes checkout (risk 1) is acceptable. If not, the alternative is `--attr-source=<head>` with every `filter` attribute forced off, which keeps `eol`/`ident` but is harder to get right (macro attributes can set `filter` too).

## Log
- 2026-10-20 — branch `feat/sweep-git-hardening`, ticket `92b4b8f`. Tests first, on unchanged `a3c74ff` code, each failed for the stated reason:
  - verify filter: `AssertionError: candidate .gitattributes: the owner's filter ran`.
  - verify lock: `git read-tree for …-verify failed: fatal: Unable to create '…-verify.index.lock': File exists.`
  - review diff: `The input did not match the regular expression /^\+\+\+ b\/quiet\.txt$/m … actual: 'EXTERNAL\n'`.
  - develop textconv: `run failed: commit 37c0487… has no changes against the base 7a04fac…`.
- 2026-10-20 — implementation `06d33ed`, follow-up `a634ddb` (spec sentences; the index itself is no longer deleted, only its lock; the 08-a test name no longer says "from the head"). Mutation checks on `06d33ed`, each restored with `git checkout -- src`: without `core.attributesFile=/dev/null`, the filter test fails on its owner-attributes case; without `--attr-source`, the filter test and the 08-a planted-attributes test fail; without the lock removal, the lock test fails; review without `--no-textconv` or without `--no-color`, the review test fails. Surviving mutant: develop's `--quiet` without `--no-textconv` still passes, because on git 2.56 `--no-ext-diff` alone also stops the textconv comparison; both flags are kept and the comment says so. `GIT_ATTR_NOSYSTEM` has no test: it needs a file in `/usr/etc` or `/etc`. `npm run test:learn`: pass. `npm test` on `a634ddb`: 423 tests, 399 pass, 0 fail, 19 skipped, 5 todo (implementer's run, not independent). Next: owner runs `npm test`, then the standard review.
- 2026-10-20 — Standard review 1 on `5798065`: PASS, 2 minor, 2 nits. Minor 1: with no attributes read, a candidate cannot opt files out of the owner's `core.autocrlf`; added to Risks. Minor 2: review's tree check could still hit a lock left by a crashed review; test-first, the lock test now also leaves a lock before `review` and failed on `5798065` with `git read-tree for …-verify failed: fatal: Unable to create '…-verify.index.lock': File exists.`; fixed in `c79d805` by moving the lock removal into `checkoutGit`, before its first call. Nit 1: SIGINT lets git remove its lock; the ticket now says "a crash or SIGKILL". Nit 2: `tests/git-config.ts` restores any earlier `GIT_CONFIG_*` values instead of deleting them. `npm test` on `c79d805`: 423 tests, 399 pass, 0 fail, 19 skipped, 5 todo (implementer's run, not independent). Budget: standard 1 of 2 used. Next: owner runs `npm test`, then the adversarial review.
- 2026-10-20 — owner: “Okay this is good, but I'd want the tradeoff logged - probably as a limitation in the README if not elsewhere as well. It might be something we need to revisit” (A-099). Logged in the README's "Known limitations" and as a row in `docs/work/accepted-risks.md`. Main merged into the branch (clean); session's run, not independent: `npm test` 439 tests, 415 pass, 0 fail; `test:learn` 6 pass. Merged into main with `--no-ff`.
