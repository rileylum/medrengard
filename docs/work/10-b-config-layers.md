# 10-b — Configuration layers

Route: Design. 10-c (command stages) and 10-e (grants) read their settings through this seam.

Goal: a job's settings come from four layers, later winning key by key: factory defaults, personal (`~/.config/software_factory/config.json`), repository (`.factory/config.json` at the base SHA) and the job file (A-074, Q7).

Design note: [2026-10-19-config-layers.md](../design/2026-10-19-config-layers.md). One module, `src/config.ts`, replaces `readJob` in `src/main.ts`. It resolves the base to a SHA once, reads the repository layer with `git show <sha>:.factory/config.json`, refuses keys a layer may not set, merges, and resolves each path against the layer it came from. Alternatives: (1) each caller reads the layers it needs: no single place that enforces the repository layer's limits; (2) merge into one JSON object and resolve paths afterwards: a merged value no longer knows which file it came from.

Done when:
- A key set in a later layer replaces the earlier layer's value; `runtime`, `runtimes` and `sandbox` merge one level down. Verified by test.
- The repository layer is read at the base SHA, never from the working tree or the candidate: a `.factory/config.json` that differs in the working tree or on the developer's branch has no effect. Verified by test.
- A repository layer that gives `grants`, or sets `sandbox.backend: "none"`, is refused before any run, naming the key and the file. Verified by one test each.
- A personal-layer runtime module resolves against the personal file's directory, and a job-file one against the job file's. Verified by test, with the fixture extension runtime.
- The developer runs on the SHA the repository layer was read at, even if the base ref moves after the read. Verified by test.
- With no personal or repository file, every existing test passes unchanged, except that the test helpers point `XDG_CONFIG_HOME` at a scratch directory so the owner's own file never reaches a test.

Constraints: zero dependencies. No paid calls. The default workflow stays byte-identical (its hash is recorded on open).
Non-goals: grants themselves (10-e: here the repository refusal only); command-stage settings (10-c); a command to print the merged configuration.
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-19 — drafted on `feat/10-b-config-layers` (A-074). Not READY until the owner says go; no code before the design note is approved.
- 2026-10-19 — owner: “take all recommendations and go” (A-078). READY; design note approved with Q1 to Q4 as recommended.
- 2026-10-19 — implemented at `32fc54e`. `src/config.ts` holds `loadConfig(jobFile, env, { base })`, which replaces `readJob` in `src/main.ts`: it resolves the base to a SHA once and returns it as `spec.base`; reads the personal file (`$XDG_CONFIG_HOME`, else `~/.config`), `.factory/config.json` with `git show <sha>:` and the job file; checks each against its allow list (repository: `checks`, `workflow`, `runtime`; `grants` and `sandbox` get their own messages); resolves each layer's paths against its own file; and merges defaults, personal, repository, job, with `runtime`, `runtimes` and `sandbox` merged one level down and arrays replaced. A repository workflow is copied to `<runsDir>/repo-config/<sha>/<path>` and imported; a path that is absolute or contains `..` is refused. The store's open row records `base`; `openings(db, workId)` reads the open rows without replay, and `accept` and `cancel` use the base whose workflow hash matches them. Tests first, red for the stated reasons, except four that passed on first run and were each checked with a mutant instead: the `HOME` fallback, `checks` replaced whole, the base pinned to a SHA (`tests/config.test.ts`), and the repository refusal at the `main.ts` command (no mutant: `loadConfig` throws before anything runs). One test first passed for a wrong reason: a relative module path climbed past `/` and resolved the same from either folder; it now copies the module beside the personal file. New: `tests/config.test.ts` (11 tests); 3 in `tests/main.test.ts`. Changed: `tests/main.test.ts` and `tests/run.test.ts` set `XDG_CONFIG_HOME` to a scratch folder. Departures from the design note: `runtimes(extra, relativeTo)` keeps its signature (modules arrive absolute); precedence and the moved base are tested at `loadConfig`, not through a hook in `main.ts`. Untested: a personal `runsDir` or `sandbox.read` resolving against the personal file. `npm test` by the implementer, not independent: 316 tests, 292 pass, 0 fail, 19 skipped, 5 todo. `lazy-review`: one guard shortened.
- Next: owner to run `npm test` on `32fc54e` or waive it, and to run or waive two standard reviews and one adversarial review.
