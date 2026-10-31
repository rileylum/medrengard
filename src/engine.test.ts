import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createEngine } from "./engine.ts";
import { defineWorkflow, type Workflow } from "./replay.ts";

/**
 * Starts an engine whose one workflow, `build`, is made by `workflow` from the test's directory,
 * and commissions `first` under it. Returns the options too, so a test can start a second engine
 * on the same log.
 */
async function engineWith<N extends string>(
  t: TestContext,
  workflow: (directory: string) => Workflow<N>,
) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const options = { log: join(directory, "log.sqlite"), workflows: { build: workflow(directory) } };
  const engine = createEngine(options);

  engine.commission("build", "first", { title: "Greet", body: "Say hello." });

  return { engine, directory, options };
}

/**
 * Starts an engine with a single command step that runs `script`, ends on `done`, repeats on
 * `again`, has a budget of 2 and the given limits. The script's `$1` is a file it may append to,
 * named `started` in the returned directory.
 */
function engineRunning(t: TestContext, script: string, limits = { idle: 1, attempt: 5 }) {
  return engineWith(t, (directory) =>
    defineWorkflow({
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
  );
}

/** Starts an engine whose commission awaits the owner at `review`, before a command step. */
function engineAwaiting(t: TestContext) {
  return engineWith(t, () =>
    defineWorkflow({
      start: "review",
      steps: {
        review: { kind: "approval", on: { approve: "build", reject: "end" } },
        build: {
          kind: "command",
          run: ["true"],
          on: { done: "end" },
          budget: 1,
          limits: { idle: 1, attempt: 5 },
        },
      },
    }),
  );
}

/** The commission's current subject, which a decision must name. */
function subjectOf(engine: ReturnType<typeof createEngine>): string {
  const state = engine.state("first");

  if (state.status === "finished") {
    throw new Error("A finished commission has no subject.");
  }

  return state.subject;
}

/** Waits until the step has written to its `started` file. */
async function untilStarted(directory: string): Promise<string> {
  for (;;) {
    const started = await readFile(join(directory, "started"), "utf8").catch(() => "");

    if (started.endsWith("\n")) {
      return started;
    }

    await sleep(20);
  }
}

test("a commission whose command step leads to the end finishes", async (t) => {
  const { engine } = await engineRunning(
    t,
    `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
});

test("a commission's request is its first subject, kept in the store", async (t) => {
  const { engine } = await engineRunning(t, "true");
  const state = engine.state("first");

  assert.equal(state.status, "ready");
  assert.deepEqual(engine.artifact(state.subject), {
    kind: "document",
    fields: { title: "Greet" },
    body: "Say hello.",
  });
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

test("a step whose program cannot start escalates its commission", async (t) => {
  const { directory, options } = await engineRunning(t, "true");
  const { build } = options.workflows;
  const missing = { ...build.steps.build, run: [join(directory, "missing")] as const };

  const engine = createEngine({
    ...options,
    workflows: { build: { ...build, steps: { build: missing } } },
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    reason: "Step build could not start: ENOENT.",
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

test("an attempt held by a live engine is left attempting", async (t) => {
  const { engine, directory, options } = await engineRunning(
    t,
    `echo started >> "$1"; sleep 1; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    { idle: 5, attempt: 5 },
  );

  const running = engine.advance("first");

  await untilStarted(directory);

  assert.partialDeepStrictEqual(await createEngine(options).advance("first"), {
    status: "attempting",
  });
  assert.partialDeepStrictEqual(await running, { status: "finished" });
});

test(
  "an attempt whose engine process died escalates as interrupted",
  { timeout: 10_000 },
  async (t) => {
    const { engine, directory, options } = await engineRunning(t, `echo $$ > "$1"; exec sleep 30`, {
      idle: 60,
      attempt: 60,
    });

    const crashing = join(directory, "crashing.ts");

    await writeFile(
      crashing,
      `import { createEngine } from ${JSON.stringify(join(import.meta.dirname, "engine.ts"))};
    await createEngine(${JSON.stringify(options)}).advance("first");`,
    );

    const child = spawn(process.execPath, [crashing], { stdio: "ignore" });
    const step = Number(await untilStarted(directory));

    // The step outlives its engine in its own process group, so the test ends it.
    t.after(() => process.kill(-step, "SIGKILL"));
    child.kill("SIGKILL");
    await once(child, "exit");

    assert.partialDeepStrictEqual(await engine.advance("first"), {
      status: "escalated",
      step: { name: "build" },
      reason: "Step build was interrupted.",
    });
  },
);

test("an attempt cancelled from another engine is stopped and escalates", async (t) => {
  const { engine, directory, options } = await engineRunning(t, `echo started >> "$1"; sleep 30`, {
    idle: 60,
    attempt: 60,
  });

  const running = engine.advance("first");

  await untilStarted(directory);
  createEngine(options).cancel("first");

  assert.partialDeepStrictEqual(await running, {
    status: "escalated",
    step: { name: "build" },
    reason: "Step build was cancelled by the owner.",
  });
});

test("a commission without an attempt in flight cannot be cancelled", async (t) => {
  const { engine } = await engineRunning(t, "true");

  assert.throws(() => engine.cancel("first"), {
    message: "Commission first is ready, so no attempt can be cancelled.",
  });
});

test("an approval decision leaves the commission ready at the next step", async (t) => {
  const { engine } = await engineAwaiting(t);

  assert.partialDeepStrictEqual(
    engine.decide("first", { subject: subjectOf(engine), outcome: "approve" }),
    { status: "ready", step: { name: "build" } },
  );
});

test("a decision about a stale subject is refused and records nothing", async (t) => {
  const { engine } = await engineAwaiting(t);

  assert.throws(() => engine.decide("first", { subject: "stale", outcome: "approve" }), {
    message: `Commission first is about ${subjectOf(engine)}, not stale.`,
  });
  assert.partialDeepStrictEqual(engine.state("first"), { status: "awaiting" });
});

test("a decision with an undeclared outcome is refused and records nothing", async (t) => {
  const { engine } = await engineAwaiting(t);

  assert.throws(() => engine.decide("first", { subject: subjectOf(engine), outcome: "ship" }), {
    message: 'Step review does not declare outcome "ship".',
  });
  assert.partialDeepStrictEqual(engine.state("first"), { status: "awaiting" });
});

test("a retry renews the budget of the escalated step", async (t) => {
  const { engine, directory } = await engineRunning(
    t,
    `echo started >> "$1"; echo '{"outcome":"again"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  await engine.advance("first");
  engine.decide("first", { subject: subjectOf(engine), outcome: "retry" });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    reason: "Step build has spent its budget of 2 attempts.",
  });
  assert.equal(await readFile(join(directory, "started"), "utf8"), "started\n".repeat(4));
});

test("an abandon decision finishes the escalated commission as abandoned", async (t) => {
  const { engine } = await engineRunning(t, "exit 1");

  await engine.advance("first");

  assert.partialDeepStrictEqual(
    engine.decide("first", { subject: subjectOf(engine), outcome: "abandon" }),
    { status: "finished", by: "abandoned" },
  );
});
