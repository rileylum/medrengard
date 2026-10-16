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
