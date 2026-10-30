import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "./engine.ts";
import { defineWorkflow } from "./replay.ts";

test("a commission whose command step leads to the end finishes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const engine = createEngine({
    log: join(directory, "log.sqlite"),
    workflows: {
      build: defineWorkflow({
        start: "build",
        steps: {
          build: {
            kind: "command",
            run: ["sh", "-c", `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`],
            on: { done: "end" },
          },
        },
      }),
    },
  });

  engine.commission("build", "first");

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
});
