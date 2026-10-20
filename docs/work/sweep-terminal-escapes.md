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
- `proto/board.ts` and `proto/run.ts` print the same fields with only `oneLine`. They are prototypes; I left them alone. Wrapping their `oneLine(...)` calls in `printable(...)` is a five-line follow-up if you want it.
- Stage names come from the workflow, which may be a repository module; a hostile workflow already runs code in the controller (security finding 1), so escaping its stage names would not help.
- Prompts still carry raw control characters to the next agent. That reaches a model, not a terminal.

**Decision for you.** None needed to merge. Optional: the `proto/` follow-up above.

## Log
