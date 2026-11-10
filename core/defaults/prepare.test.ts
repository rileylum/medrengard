import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../src/engine.ts";
import { defineWorkflow } from "../src/definition.ts";
import { contract } from "./access.ts";
import { builtIn } from "./kinds.ts";
import { limits } from "./limits.ts";
import { prepare } from "./prepare.ts";

type Run = readonly [string, ...string[]];

/**
 * Commissions `first` on a workflow whose one command step, `build`, runs what `runOf` makes of a
 * directory of the test's own the step may write to, which is returned as `out`.
 */
async function engineRunning(t: TestContext, runOf: (out: string) => Run) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const out = join(directory, "out");

  await mkdir(out);

  const engine = createEngine({
    kinds: builtIn,
    defaults: { limits },
    log: join(directory, "log.sqlite"),
    workflows: {
      build: defineWorkflow({
        start: "build",
        steps: {
          build: {
            kind: "command",
            workspace: "empty",
            inputs: {},
            claims: [],
            run: runOf(out),
            on: { done: "end" },
            budget: 1,
            access: { ...contract, paths: [...contract.paths, { path: out, mode: "write" }] },
          },
        },
      }),
    },
  });

  engine.commission("build", { title: "Build", body: "Build it." }, { name: "first" });

  return { engine, out };
}

// The step's own program: it leaves a file in `out` to say it ran, and is done only if preparation
// left its file in the workspace.
const step = (out: string): Run => [
  "sh",
  "-c",
  `touch '${join(out, "ran")}'
   [ -f prepared ] && echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
];

test("a prepared step runs its program in the workspace its preparation made, and notes it", async (t) => {
  const { engine } = await engineRunning(t, (out) =>
    prepare("mkdir -p cache\ntouch prepared", step(out)),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });

  const [entry] = engine.record("first").entries;

  assert.partialDeepStrictEqual(entry, { outcome: "done", errors: false });
  assert.ok(entry?.entry === "attempt");
  assert.match(entry.notes[0]!.note, /^Prepared in \d+ s: mkdir -p cache touch prepared$/);
});

test("a step whose preparation fails escalates before its program runs, saying so", async (t) => {
  const { engine, out } = await engineRunning(t, (out) =>
    prepare("echo 'npm: not found' >&2; exit 127", step(out)),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "exit",
    reason: "Step build exited with code 127.",
  });
  assert.partialDeepStrictEqual(engine.record("first").entries, [
    {
      notes: [
        {
          note: "Preparation failed: echo 'npm: not found' >&2; exit 127 exited with 127.",
          from: "step",
        },
      ],
    },
  ]);
  assert.match(engine.errors("first", 1).toString(), /^npm: not found$/m);
  assert.ok(!existsSync(join(out, "ran")));
});
