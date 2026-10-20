# sweep-terminal-escapes — Escape control and bidi characters in agent text before printing

Route: Fast. Internal to `main.ts`'s output, no new interface, reversible, one obvious design.

Owner's instruction, 2026-10-20: "Once all this research comes back, triage it (merging similar things and organizing it, giving ratings for highest impact) - then create a worktree for each and spin up a sub agent to implement them. I want to come back tomorrow to a number of ready to merge branches, so we should only focus on the high quality and high impact ones. We will then work through them together, deciding if they should be merged or not, or if they need changes before going in - so you will need to explain each to me in plain english and defend the changes."

Triage item B5; source `research-2026-10-20/security.md` finding 2.

Goal: no text an agent controls reaches the owner's terminal as a control or bidi character.

Done when:
- A `main.ts` run whose reviewer returns a finding and a verdict head holding `ESC [2J` and an OSC 52 clipboard write prints no raw ESC or BEL on stdout or stderr, and shows the escapes as visible `\u{1b}` text [main: agent text with terminal escapes].
- The same for a developer claim whose `head` holds the escapes; the escalation shows the head cut to 64 characters.
- `npm test` passes.

Constraints: the event store keeps the raw text (it is the evidence). Zero dependencies. Prompts unchanged.
Non-goals: `proto/` (noted below); the JSON `events` stream (already safe: `JSON.stringify` escapes controls).
Verification: `npm test`, run by the implementer (not independent).

## For the owner

**What was wrong.** `main.ts` printed reviewer findings, the escalation reason and the run error as they were stored. Several of those hold agent text: a reviewer's findings, a developer's claimed `head` (any length), a dispute reason, an adapter's failure reason, and a file name a check created. `oneLine` folded line breaks but let ESC and the other control characters through. So a developer or reviewer could send terminal escape sequences to your terminal. It could erase lines, print a fake `Stage: AWAITING_ACCEPTANCE` with a fake merge command, set the window title, or write your clipboard (OSC 52, which many terminals honour).

**Reproduction.** The research probe `research-2026-10-20/security/probes/esc-runtime.ts`: an extension runtime whose adversarial reviewer FAILs with such a finding. `node src/main.ts job.json | od -c` showed raw `033 [ 1 A` and `033 ] 5 2 ;`. The new test in `tests/main.test.ts` does the same offline.

**What the change does.** A new function `printable` in `src/prompt.ts`, beside `oneLine`, turns every control character except tab, and every bidi control (U+061C, U+200E, U+200F, U+202A–202E, U+2066–2069), plus U+2028 and U+2029, into visible text such as `\u{1b}`. `main.ts` passes every stored or agent string it prints through it: the verdict head, each finding, the escalation, the run error, and the top-level error message on stderr. `refuse` in `src/developer.ts` now cuts a claimed head that is not a commit to 64 characters before it names it, so a developer cannot fill the escalation with one long head.

**Why at print, not at storage.** The event log is the evidence; it should hold what the agent sent, byte for byte, so an audit can see the attack. The JSON stream is already safe. Cleaning at storage would also need every producer (findings, refusals, dispute reasons, adapter reasons, verify errors, and whatever is added next) to remember to do it. One choke point at print is smaller and covers future reasons too. The cost: any other printer must call `printable` too. Today that is only `proto/`.

**Newlines.** `printable` also escapes `\n`. Escalation and error are one-line fields; a raw newline in one would let an agent print a fake `Stage:` line without any escape sequence. A multi-line git error in `Error:` now shows as one line with `\n` in it. Findings still go through `oneLine` first, so they keep reading as before.

**Risks and what this does not cover.**
- `proto/board.ts` and `proto/run.ts` print the same fields with only `oneLine`. They are prototypes; I left them alone. Wrapping their prints in `printable(...)` touches about a dozen lines in two files (the board also prints heads and reasons), so it is left as a follow-up if you want it.
- Stage names come from the workflow, which may be a repository module; a hostile workflow already runs code in the controller (security finding 1), so escaping its stage names would not help.
- Prompts still carry raw control characters to the next agent. That reaches a model, not a terminal.

**Decision for you.** None needed to merge. Optional: the `proto/` follow-up above.

The review also made a refused dispute cut the head it names, as a claim's refusal already did.

## Log
- 2026-10-20, implementer. Ticket committed first. New test `agent text with terminal escapes reaches stdout and stderr only as visible escapes` (`tests/main.test.ts`) with two new markers in `tests/fixtures/ext-runtime.ts`. On the unchanged code it failed for the stated reason: `AssertionError [ERR_ASSERTION]: EXT:esc-verdict`, `doesNotMatch /[\u0007\u001b‮]/`, with stdout holding `standard_reviewer \x1B[2JSta: FAIL` and the raw finding.
- Fix: `printable` in `src/prompt.ts`; `main.ts` wraps the verdict head, each finding, `Escalation:`, `Error:` and the top-level stderr message; `cut` in `src/developer.ts` bounds a non-commit claimed head to 64 characters. Test passes.
- Mutation checks, one at a time, restored with `git checkout`: `cut` bound raised to 64e6 fails the test (`EXT:esc-head`, stdout over 2,000 characters); `Escalation:` printed raw fails it (`EXT:esc-head`). Both killed.
- `grep -nP '[\x{2028}\x{2029}\x{202e}\x{1b}\x{07}]'` on the changed files: no raw characters.
- Spec: one evidence-rules bullet naming the test.
- `npm test`, implementer's run, not independent: tests 420, pass 396, fail 0, skipped 19, todo 5.
- lazy-review on `git diff main...HEAD`: lean already.
- Next: owner review; optional `proto/` follow-up.
- 2026-10-20, fresh standard review at 08f84c0: PASS with four findings. Outcomes:
  1. [minor] dispute refusal in `land` named the head uncut: fixed with `cut(head)`. Test first: new marker `EXT:esc-dispute` (a real FAIL, then a fix run disputing with a 10,000-character escaped head) failed the length assertion on the unchanged code, with stdout holding `a dispute must name the previous candidate <sha>, not \u{1b}[2JStage: ...` uncut. Passes after the fix.
  2. [minor] `Error:` and the top-level stderr print were not pinned: new test `a run error and a refusal on stderr show control characters only as visible escapes`, driven by a workflow module whose command stage names a missing file `ESC[2J CSI.sh` (reaches `Error:`) and one whose `start` is `ESC[2J` (reaches stderr). It passed at once; mutants killed: `Error:` printed raw, `console.error` printed raw.
  3. [minor] C1 controls: U+009B added to the fixture's escape string and both `doesNotMatch` classes. Mutant killed: `printable` matching only C0 and DEL fails both tests.
  4. [nit] spec bullet now names U+2028 and U+2029.
  - Also killed: the dispute `cut` reverted.
  - `proto/`: about a dozen lines across two files, not five; left noted.
- `npm test` after the review fixes, implementer's run, not independent: tests 421, pass 397, fail 0, skipped 19, todo 5.
