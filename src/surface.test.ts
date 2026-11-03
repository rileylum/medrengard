import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtIn } from "../defaults/kinds.ts";
import { createEngine } from "./engine.ts";

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

// What a client calls: the engine's methods.
test("the engine has exactly the pinned methods", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const engine = createEngine({
    log: join(directory, "log.sqlite"),
    workflows: {},
    kinds: builtIn,
  });

  assert.deepEqual(Object.keys(engine).sort(), [
    "advance",
    "artifact",
    "cancel",
    "commission",
    "commissions",
    "decide",
    "errors",
    "record",
    "state",
    "transcript",
  ]);
});
