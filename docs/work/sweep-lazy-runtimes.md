# sweep-lazy-runtimes — Read a runtime module only when a role uses it

Route: Fast. Internal, no new interface, reversible, one obvious design. It brings the code in line with A-075's wording: "The module is hashed once, when its adapter is built."

Owner's instruction, 2026-10-20: "Once all this research comes back, triage it (merging similar things and organizing it, giving ratings for highest impact) - then create a worktree for each and spin up a sub agent to implement them. I want to come back tomorrow to a number of ready to merge branches, so we should only focus on the high quality and high impact ones. We will then work through them together, deciding if they should be merged or not, or if they need changes before going in - so you will need to explain each to me in plain english and defend the changes." This is the go to build the branch, not approval to merge. Triage item B7; source `extensibility.md` finding 2.

Goal: an extension runtime's module is read and hashed only when a role selects that runtime, and a module that cannot be read is refused with an error naming `runtimes.<name>` and the path.

Done when:
- A job whose roles use only built-in runtimes runs, and `cancel` succeeds, while the personal config names a runtime whose module is missing. Verified by test.
- A job whose role selects that runtime is refused before any cycle opens: no store, no runtime spawned, and the message names `runtimes.<name>` and the path. Verified by test.
- A used extension runtime still records its `moduleHash` on every outcome event. Verified by the existing 10-a tests.
- The runtime contract kit still passes. Verified by `tests/kits.test.ts`.

Constraints: zero dependencies. No paid calls. `extensionSpec` callers (the kits) still get `moduleHash` on their adapter. The grant check still sees each extension's bound folder.
Non-goals: checking a module's syntax or exports before use; any change to built-in runtimes; `doctor` (triage owner item 11).
Verification: `npm test`; implementer's run, not independent.

## For the owner

**What was wrong.** When the factory loaded a job, it read and hashed the module file of every extension runtime in the merged config, whether or not any role used it. One stale entry in the personal config, say `{"runtimes":{"old":{"module":"./gone.ts"}}}`, made every command fail: a run, `accept` and `cancel`. The error was a bare `ENOENT: no such file or directory, open '…/gone.ts'`. It did not say which config key was at fault. `cancel` is the only way out of a stranded cycle, so an unrelated typo could trap the owner.

**Reproduction.** Put the entry above in `~/.config/software_factory/config.json`, with no `gone.ts` beside it. Run `node src/main.ts cancel job.json` for a job that uses `claude`. Before this change it prints the bare `ENOENT` and exits 2.

**What the change does.** `extensionSpec` no longer reads the file. `cliAdapter` reads and hashes it when it builds the adapter. `main.ts` builds adapters only for the roles the workflow has, before the store opens. So a runtime no role selects is never read, and a role that selects a broken one is still refused before any cycle opens. The read error now reads `runtimes.old: cannot read module /path/gone.ts: ENOENT …`.

**Why this and not the obvious alternative.** The obvious fix is to catch the error in `runtimes()` and skip or warn. That still reads every module, and a skipped runtime would turn into a vaguer "runtime.developer must be one of …" error later. Hashing at adapter build is what A-075 already says, and it keeps the hash next to the run that records it.

**Risks and what it does not cover.**
- A broken entry no role uses is now silent until a job selects it. Before, every job reported it. A `doctor` command (triage owner item 11) would be the place to list such entries.
- When two roles use the same extension runtime, the module is now hashed once per role instead of once per job. If the file changed between those two reads, within milliseconds, the roles would record different hashes. That would be the truth about what each read, so it is not hidden.
- An error building an adapter for a kit names `runtimes.<name>` too, even when the kit author named it in code. It still names the path.

**Decisions for the owner.** None needed.

## Log
