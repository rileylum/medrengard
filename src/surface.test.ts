import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Constraint 7: the public surface is listed here, so growing it fails until updated on purpose.
// Public is these modules, which a factory or a client imports by path; the rest are the engine's
// own. Types are erased at run time, so the names are read from each module's source.
const exports = {
  "src/replay.ts": [
    "Access",
    "Agent",
    "CommissionEvent",
    "CommissionState",
    "Commissioned",
    "Definition",
    "Query",
    "Skill",
    "Workflow",
    "assertNever",
    "defineWorkflow",
    "replay",
  ],
  "src/kinds.ts": ["Kind", "Kinds", "Program"],
  "src/engine.ts": ["CommissionRecord", "Entry", "createEngine"],
  "src/store.ts": ["Artifact", "createStore"],
  "defaults/access.ts": ["claudeCode", "contract", "full", "home"],
  "defaults/kinds.ts": ["builtIn"],
};

for (const [module, names] of Object.entries(exports)) {
  test(`${module} exports exactly the pinned names, types included`, async () => {
    const source = await readFile(new URL(`../${module}`, import.meta.url), "utf8");
    const lines = source.split("\n").filter((line) => line.startsWith("export "));

    const exported = lines.map(
      (line) => /^export (?:type|function|const|async function) (\w+)/.exec(line)?.[1] ?? line,
    );

    assert.deepEqual(exported.sort(), names);
  });
}
