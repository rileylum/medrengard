import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "./engine.ts";
import { defineWorkflow } from "./replay.ts";

/**
 * Starts an engine whose one workflow, `build`, has a single command step that runs `script`,
 * ends on `done`, repeats on `again`, has a budget of 2 and the given limits. The script's `$1` is a file it may append
 * to, named `started` in the returned directory.
 */
async function engineRunning(t: TestContext, script: string, limits = { idle: 1, attempt: 5 }) {
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
            run: ["sh", "-c", script, "sh", join(directory, "started")],
            on: { done: "end", again: "build" },
            budget: 2,
            limits,
          },
        },
      }),
    },
  });

  engine.commission("build", "first");

  return { engine, directory };
}

test("a commission whose command step leads to the end finishes", async (t) => {
  const { engine } = await engineRunning(
    t,
    `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
});

test("a step that exits non-zero escalates its commission", async (t) => {
  const { engine } = await engineRunning(
    t,
    `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"; exit 3`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    reason: "Step build exited with code 3.",
  });
});

test("a step that exits 0 without output.json escalates its commission", async (t) => {
  const { engine } = await engineRunning(t, "true");

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    reason: "Step build exited 0 without a readable output.json.",
  });
});

test("a step that claims an undeclared outcome escalates its commission", async (t) => {
  const { engine } = await engineRunning(
    t,
    `echo '{"outcome":"shipped"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    reason: 'Step build claimed an outcome it does not declare: "shipped".',
  });
});

test("a step that has spent its budget escalates instead of starting again", async (t) => {
  const { engine, directory } = await engineRunning(
    t,
    `echo started >> "$1"; echo '{"outcome":"again"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    reason: "Step build has spent its budget of 2 attempts.",
  });
  assert.equal(await readFile(join(directory, "started"), "utf8"), "started\nstarted\n");
});

test("a step that is idle for its idle limit is stopped and escalates", async (t) => {
  const { engine } = await engineRunning(t, "sleep 5");

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    reason: "Step build was idle for 1 s.",
  });
});

test("a step that keeps writing output runs past its idle limit", async (t) => {
  const { engine } = await engineRunning(
    t,
    `for tick in 1 2 3 4; do echo "$tick"; sleep 0.5; done
    echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
});

test("a step that runs for its attempt limit is stopped and escalates", async (t) => {
  const { engine } = await engineRunning(t, "while true; do echo tick; sleep 0.2; done", {
    idle: 1,
    attempt: 1,
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    reason: "Step build reached its attempt limit of 1 s.",
  });
});
