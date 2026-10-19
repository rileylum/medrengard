# 10-f — Fixes for 10-a's adversarial minors

Route: Fast. Fix ticket for the four minors of 10-a's adversarial PASS on `bb40612` (A-076). Each fix is local, and the expected behaviour is already stated: "as a CLI runtime does" and the contract the controller keeps.

Goal: an extension runtime's failure reason is bounded like a CLI's, and `runtimeKit` judges an adapter by the contract the controller relies on, with each of its cases pinned by a test.

Done when:
- An extension's own `{ status: 'failed', reason }` is stored trimmed, cut to 1 KB and well-formed, as a CLI's reason is (`failed()` in `src/runtime/cli-adapter.ts`). A 5,000,000-character reason and a lone surrogate each become one `run_failed` with a bounded, well-formed reason. Verified by test.
- The kit passes an outcome the controller accepts, including `{ status: 'completed', claim, sessionId: undefined }`. Verified by test.
- The kit's reviewer case sends a role and prompt the controller sends (`standard_reviewer`, with the reviewer phrase), and an adapter that rejects for a reviewer role fails the kit. The fixture's reviewer case returns a verdict, not a commit. Verified by test.
- Removing the kit's name check or its abort check makes `tests/kits.test.ts` fail. Verified by test and by mutation.
- The `SHAPE` versions check is tested on `developer_result`, `verdict` and `dispute`, not only `run_failed` (adversarial note). Verified by mutation.

Constraints: zero dependencies; no paid calls. Existing tests pass unchanged except where a case above changes what they pin.
Non-goals: refusing lookalike runtime names (`Claude`), and the `__proto__` name (adversarial notes; the record still tells them apart). Unless the owner adds it: refusing `__proto__` is one line.
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-19 — drafted from 10-a's adversarial verdict (A-076). Not READY until the owner says go.
