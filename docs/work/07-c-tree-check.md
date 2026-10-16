# 07-c — The tree check sees index flags; one-line findings; wide status buffer

Route: Fast. Fix ticket for 07-b's adversarial FAIL on `f3b4e12` (A-034). Internal, reversible, one obvious design per finding.

Goal: a check that hides a rewritten tracked file behind `skip-worktree` or `assume-unchanged` records `tree: FAIL` with the flag as evidence; a finding with any line terminator is one line in the fix prompt and in `main.ts`; a status of any size is evidence, not a throw.

Done when:
- A check that sets `git update-index --skip-worktree` (or `--assume-unchanged`) on a tracked file and rewrites it records `tree: FAIL`; `tree.stdout` names the file with its flag (`S`/`h` from `git ls-files -v`) and the cycle is ESCALATED; verified by test in `tests/verify.test.ts`.
- A check that rewrites enough tracked files for the status to exceed 1 MiB records `tree: FAIL` with the full status as evidence, not `reject_dispatch`; verified by test.
- A finding holding `\r`, `\r\n`, U+2028, U+2029 or U+0085 is one `- ` line in the fix prompt and `Rules:` appears once; the same helper formats findings in `main.ts`; verified by test on the prompt and on the exported helper.
- The loop's step cap is checked after the stop, so a cycle in a stopped stage at the cap returns instead of escalating; verified by reading (unreachable at seven steps).
- `npm test` offline spawns neither `claude` nor `pi`.

Constraints: zero dependencies. `lifecycle.ts`, `store.ts`, `controller.ts`, `review.ts`, `developer.ts` beyond `prompt` and the exported helper, untouched. The 07-b interfaces (`run`, `RunOptions`, `RunResult`, the job file) unchanged.
Non-goals: the `.git` pointer swap, `git replace`, `core.fileMode` (parked: sandbox ticket); review's dirty guard (the backstop stays as is; `tree` is the classifier).
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-16 — owner: “Option 1 go” (A-034). Branch `feat/07-c-tree-check` stacked on 07-b at `970c877`.
- 2026-10-16 — tests first (`tests/verify.test.ts`: skip-worktree and assume-unchanged hidden rewrites, an 11 000-file rewrite whose status passes 1 MiB; `tests/developer.test.ts`: the five terminators through `oneLine` and the fix prompt; all red), then: `verify` lists `git ls-files -v` entries not tagged `H` ahead of the porcelain status in `tree.stdout`, both read with a 64 MiB `maxBuffer`; `oneLine` exported from `developer.ts` and used by `prompt` and `main.ts`; the loop checks the step cap after the stop. Mutation checks on ef4ceea, one replacement each, restored after: 5 run, 4 fail a test; the survivor is the step cap, unreachable at seven steps (07-b log). lazy-review: nothing to cut. Implementer-run `npm test`: 168 tests, 144 pass, 19 skipped, 5 todo, 0 fail. Awaiting owner-run tests on ef4ceea, then standard review 1.
- 2026-10-16 — Owner away: “Please run it yourself I'm away from the computer”. `npm test` on ef4ceea run by the implementer session in the owner's place: 168 tests, 144 pass, 19 skipped, 5 todo, 0 fail. Not an independent run; recorded as such. Standard review 1 launched on ef4ceea.
- 2026-10-16 — Standard review 1 on ef4ceea: PASS, 0 major, 0 minor, 5 notes (each done-when traced with the reviewer's own mutation runs; the filter also records `s`, `M`, `R`, `C`, `K` tags and a flag set without a rewrite, the conservative reading; `main.ts` calling `oneLine` is verified by reading and the test name overstates it; constraints held; `npm test` matched). No change. Budget: standard 1 of 2 used. Adversarial review launched on ef4ceea.
