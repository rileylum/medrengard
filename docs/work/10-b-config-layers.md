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
