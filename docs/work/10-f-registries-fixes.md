# 10-f — Fixes for 10-a's adversarial minors

Route: Fast. Fix ticket for the four minors and two notes of 10-a's adversarial PASS on `bb40612` (A-076). Each fix is local, and the expected behaviour is already stated: "as a CLI runtime does" and the contract the controller keeps.

Goal: an extension runtime's failure reason is bounded like a CLI's, and `runtimeKit` judges an adapter by the contract the controller relies on, with each of its cases pinned by a test.

Done when:
- An extension's own `{ status: 'failed', reason }` is stored trimmed, cut to 1 KB and well-formed, as a CLI's reason is (`failed()` in `src/runtime/cli-adapter.ts`). A 5,000,000-character reason and a lone surrogate each become one `run_failed` with a bounded, well-formed reason. Verified by test.
- The kit passes an outcome the controller accepts, including `{ status: 'completed', claim, sessionId: undefined }`. Verified by test.
- The kit's reviewer case sends a role and prompt the controller sends (`standard_reviewer`, with the reviewer phrase), and an adapter that rejects for a reviewer role fails the kit. The fixture's reviewer case returns a verdict, not a commit. Verified by test.
- Removing the kit's name check or its abort check makes `tests/kits.test.ts` fail. Verified by test and by mutation.
- A job-file runtime named `__proto__` is refused when the registry is built, with an error naming it, before its module is read (adversarial note). Verified by test.
- The `SHAPE` versions check is tested on `developer_result`, `verdict` and `dispute`, not only `run_failed` (adversarial note). Verified by mutation.

Constraints: zero dependencies; no paid calls. Existing tests pass unchanged except where a case above changes what they pin.
Non-goals: refusing lookalike runtime names such as `Claude` (adversarial note; their `moduleHash` tells them apart in the record).
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-19 — drafted from 10-a's adversarial verdict (A-076). Not READY until the owner says go.
- 2026-10-19 — owner: "Approve,d"; on `__proto__`: "Okay lets refuse it, then start work". `__proto__` refusal added to Done when. READY. Branch `feat/10-f-registries-fixes`.
- 2026-10-19 — implemented at `4775ac3`, tests first. `runtimes` refuses `__proto__` before reading the module (red: ENOENT, not the name). `extensionSpec`'s parse passes the module's own failed reason through `failed()` (red: reason stored uncut). The kit's plain-data check ignores properties set to undefined in plain objects (`defined` in `src/kits/runtime.ts`; red: "not plain data"). The kit's reviewer case sends role `standard_reviewer` with `reviewPrompt` over the default workflow's role text, and its diagnostic names the claim's keys, so `tests/kits.test.ts` pins one commit claim and one verdict claim (red on both). New kit files: `no-session`, `reviewer-role`, `nameless`, `deaf`; new fixture cases `EXT:fail-big`, `EXT:fail-surrogate`. New test: `isEvent` refuses a bad `runtime` or `moduleHash` on all four outcome types. The name and abort kit tests passed when written (the checks existed); mutation is their red step. Mutants caught: the name check removed; the abort check removed (it survived at first, because `assertOutcome('late')` also fails; the test now pins the abort message); `versions` dropped from `developer_result`, `verdict` and `dispute`, each. Changed pin: the good kit's two `# outcome completed` lines now carry claim keys. `npm test` by the implementer, not independent: 300 tests, 276 pass, 0 fail, 19 skipped, 5 todo. Lazy review: nothing to cut.
- Next: owner to run `npm test` on `4775ac3`, and to run or waive two standard reviews and one adversarial review.
- 2026-10-19 — owner: "review please, if you've already run the tests then I don't need to rerun". Owner-run `npm test` waived; the only runs are the implementer's and the reviewer's.
- 2026-10-19 — standard review 1 on `4775ac3` (`claude -p`, opus, effort high; prompt and verdict under `/var/tmp/software_factory/10-f/`): PASS. One minor: `defined` copies only objects whose prototype is `Object.prototype`, so the kit fails a null-prototype outcome or claim that the controller accepts (`src/kits/runtime.ts:96`; reproduced, `probes/nullproto.kit.ts`). One note: the kit has no `adversarial_reviewer` case, so an adapter that rejects only for that role passes it (judged by reading). The reviewer mutation-checked all six done-when items, and each mutant was caught. Reviewer's `npm test` on `e2bdbbe`: 300 tests, 276 pass, 0 fail.
