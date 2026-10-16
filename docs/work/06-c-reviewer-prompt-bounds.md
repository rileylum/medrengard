# 06-c — A reviewer prompt is bounded, complete and from the commit alone

Route: Fast. Fix ticket for 06-b's adversarial FAIL on `f7ed0be` (A-031). Internal, reversible, one obvious design per finding.

Goal: `review` never throws for a candidate the controller verified, whatever its size or attributes; the prompt names every changed file, quotes content as text, carries delimiters the candidate cannot forge; the reviewer's checkout is the commit and nothing else; the pi and claude reviewer specs load nothing from the candidate.

Done when:
- A candidate with a 1.3 MB committed text file reaches a reviewer run: the prompt carries the cut marker and the run starts; verified by test. A diff `git` cannot buffer at all (over the 64 MiB `maxBuffer` now set on the shared helper) is quoted as a one-line placeholder instead of thrown; verified by reading.
- A committed `.gitattributes` with `* -diff` does not hide content: the diff is taken with `--text` and the file's content appears in the prompt; verified by test.
- An uncut `git diff --name-status base head` precedes the cut diff, so every changed path is named even when the diff's middle is cut; verified by test with three files around a cut.
- `review` refuses a checkout whose tracked files differ from the commit (`git status --porcelain --untracked-files=no` non-empty), appending nothing; verified by test.
- Section delimiters carry a per-run nonce announced in the rules line; a committed file containing a forged `---- VERIFICATION` header appears as content and matches no delimiter; verified by test.
- `claudeReviewer.args` carries `--strict-mcp-config`; `piReviewer.args` carries `--no-approve`; verified by test on the args.
- The "last verification for this head" filter is dropped: the lifecycle admits a `verification` only for the candidate SHA in VERIFYING, so the last verification event is the current head's; `review` throws if that invariant fails (verified by reading, unreachable through the store); the 06-b ticket wording is corrected.
- `npm test` offline spawns neither `claude` nor `pi`; `RUNTIME_SPIKE=1 node --test tests/review.test.ts` still records a verdict per CLI with the new flags.

Constraints: zero dependencies. `lifecycle.ts`, `store.ts`, `controller.ts`, `adapter.ts`, `verify.ts` untouched. The 06-b interface (`review`, `ReviewOptions`) unchanged.
Non-goals: `CLAUDE.md` auto-discovery in the claude reviewer (candidate-controlled context; recorded, needs a flag probe); the committed-symlink and `core.hooksPath` lines; evidence sandboxing.
Verification: `npm test`, run by the owner on the reviewed SHA; `RUNTIME_SPIKE=1 node --test tests/review.test.ts` once.

## Log
- 2026-10-16 — owner: “option 1 go” (A-031). Branch `feat/06-c-reviewer-prompt-bounds` stacked on 06-b at `92c7c41`.
- 2026-10-16 — tests first (five new in `tests/review.test.ts` through a `committing` developer adapter that commits arbitrary files, plus assertions on the specs and the prompt; seven red on 06-b), then: `git()` takes a 64 MiB `maxBuffer`, and `review` quotes a placeholder when even that overflows (`quoteGit`); the diff is `--text`; an uncut `--name-status` section precedes the cut diff; `review` refuses a checkout where `git status --porcelain --untracked-files=no` is non-empty; every section delimiter is `==== <8-hex nonce>: TITLE ====` with the nonce announced in the rules; instruction files are tested with `cat-file -e` so only absence reads as absent; `claudeReviewer` adds `--strict-mcp-config`, `piReviewer` adds `--no-approve` (both flags confirmed in the CLIs' `--help`); the head filter is replaced by a consistency throw. Mutation checks on d0fd999, one replacement each, restored after: 8 run, 7 fail a test; the survivor is the consistency throw, unreachable through the store (apply admits a verification only for the candidate in VERIFYING), verified by reading. Live (`RUNTIME_SPIKE=1 node --test tests/review.test.ts`): claude verdict in 20.0 s, pi in 6.3 s with the new flags. lazy-review: nothing to cut. Implementer-run `npm test`: 150 tests, 127 pass, 18 skipped, 5 todo, 0 fail. Awaiting owner-run tests, then standard review 1.
- 2026-10-16 — owner-run on d0fd999: `npm test` 150 tests, 127 pass, 18 skipped, 5 todo, 0 fail. Standard review 1 launched on d0fd999.
