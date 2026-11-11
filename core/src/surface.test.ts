import { test } from "node:test";
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtIn } from "../defaults/kinds.ts";
import { limits } from "../defaults/limits.ts";
import { createEngine } from "./engine.ts";

// Constraint 7: the public surface is listed here, so growing it fails until updated on purpose.
// Public is these modules, which a factory or a client imports by path; the rest are the engine's
// own. Types are erased at run time, so the names are read from each module's source.
const exports = {
  "src/definition.ts": [
    "Access",
    "Agent",
    "Children",
    "Commissioning",
    "Definition",
    "Factory",
    "Limits",
    "Money",
    "Query",
    "Routes",
    "Skill",
    "Trigger",
    "Wait",
    "Watch",
    "Workflow",
    "defineWorkflow",
  ],
  "src/replay.ts": [
    "Cause",
    "CommissionEvent",
    "CommissionState",
    "Commissioned",
    "Usage",
    "replay",
  ],
  "src/kinds.ts": ["Kind", "Kinds", "Program"],
  "src/engine.ts": ["CommissionRecord", "Entry", "createEngine"],
  "src/reading.ts": [
    "Moment",
    "Standing",
    "changed",
    "material",
    "standing",
    "timeline",
    "visible",
    "waits",
    "week",
  ],
  "src/store.ts": ["Artifact", "createStore"],
  "step/contract.ts": [
    "Artifact",
    "Claim",
    "Claimed",
    "Input",
    "Materialised",
    "Rules",
    "Session",
    "Usage",
    "accept",
    "artifactsOf",
    "bodyOf",
    "claim",
    "failed",
    "input",
    "note",
    "output",
    "readArtifact",
    "readBranches",
    "readClaim",
    "readInput",
    "reject",
    "reportUsage",
  ],
  "defaults/access.ts": ["claudeCode", "codex", "contract", "gitIdentity", "node"],
  "defaults/agents.ts": ["agent"],
  "defaults/kinds.ts": ["builtIn"],
  "defaults/limits.ts": ["limits"],
  "defaults/prepare.ts": ["prepare"],
  "defaults/programs.ts": ["programs"],
  "forges/github/steps.ts": ["Options", "github", "pullRequest"],
};

for (const [module, names] of Object.entries(exports)) {
  test(`${module} exports exactly the pinned names, types included`, async () => {
    const source = await readFile(new URL(`../${module}`, import.meta.url), "utf8");
    const lines = source.split("\n").filter((line) => line.startsWith("export "));

    const exported = lines.map(
      (line) => /^export (?:type|function|const|async function\*?) (\w+)/.exec(line)?.[1] ?? line,
    );

    assert.deepEqual(exported.sort(), names);
  });
}

// The package lets a client import these modules and no other, at the paths listed here.
test("the package exports exactly the public modules, at their paths", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.deepEqual(
    manifest.exports,
    Object.fromEntries(Object.keys(exports).map((module) => [`./${module}`, `./${module}`])),
  );
});

// A factory names the programs the package ships by these paths, real ones, as a sandbox grants.
test("the shipped programs are named by the real paths of their files", async () => {
  const { programs } = await import("../defaults/programs.ts");
  const real = (path: string) => realpathSync(new URL(`../${path}`, import.meta.url));

  assert.deepEqual(programs, {
    medrengard: real("cli/medrengard.ts"),
    claudeCode: real("adapters/claude-code.ts"),
    codex: real("adapters/codex.ts"),
  });
});

// Technology: Node 24 and its built-ins, with zero runtime dependencies.
test("the package has no runtime dependencies", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(manifest.dependencies, undefined);
});

// What a client calls: the engine's methods.
test("the engine has exactly the pinned methods", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const engine = createEngine({
    log: join(directory, "log.sqlite"),
    workflows: {},
    kinds: builtIn,
    defaults: { limits },
  });

  assert.deepEqual(Object.keys(engine).sort(), [
    "advance",
    "artifact",
    "attend",
    "cancel",
    "check",
    "commission",
    "commissions",
    "decide",
    "definition",
    "engines",
    "errors",
    "events",
    "next",
    "record",
    "register",
    "renew",
    "state",
    "transcript",
  ]);
});
