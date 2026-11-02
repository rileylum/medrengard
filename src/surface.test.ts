import { test } from "node:test";
import assert from "node:assert/strict";

// Constraint 7: the public surface is listed here, so growing it fails until updated on purpose.
// Public is what a factory can import by path today; an installer's package exports would replace it.
const exports = {
  "src/replay.ts": ["assertNever", "defineWorkflow", "replay"],
  "src/kinds.ts": [],
  "defaults/access.ts": ["claudeCode", "contract", "full", "home"],
  "defaults/kinds.ts": ["builtIn"],
};

for (const [module, names] of Object.entries(exports)) {
  test(`${module} exports exactly the pinned names`, async () => {
    const loaded: object = await import(new URL(`../${module}`, import.meta.url).href);

    assert.deepEqual(Object.keys(loaded).sort(), names);
  });
}
