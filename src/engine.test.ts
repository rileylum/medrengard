import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
          inputs: [],
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
          inputs: [],
          run: ["true"],
          on: { done: "end" },
          budget: 1,
          limits: { idle: 1, attempt: 5 },
        },
      },
    }),
  );
}

/**
 * Starts an engine with a single command step that declares `inputs`, runs `script` and ends on
 * `done`. The script's `$1` is the directory `received` in the returned directory, empty at start.
 */
async function engineReceiving(t: TestContext, inputs: readonly "subject"[], script: string) {
  const started = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "build",
      steps: {
        build: {
          kind: "command",
          inputs,
          run: ["sh", "-c", script, "sh", join(directory, "received")],
          on: { done: "end" },
          budget: 1,
          limits: { idle: 1, attempt: 5 },
        },
      },
    }),
  );

  await mkdir(join(started.directory, "received"));

  return started;
}

/** What a test step writes as its output.json, including fields output.json does not define. */
type Claim = {
  outcome: string;
  artifact?: readonly never[];
  artifacts?: readonly { kind: string; fields: Record<string, string>; body?: string }[];
};

/**
 * Starts an engine whose `build` step runs `setup`, then writes `claim` as its output.json, and
 * leads on `done` to `read`, which receives the subject into the directory `received` and leads to
 * the approval step `review`.
 */
async function engineClaiming(t: TestContext, setup: string, claim: Claim) {
  const limits = { idle: 1, attempt: 5 };

  const started = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "build",
      steps: {
        build: {
          kind: "command",
          inputs: [],
          run: [
            "sh",
            "-c",
            `${setup}
             echo '${JSON.stringify(claim)}' > "$MEDRENGARD_OUT/output.json"`,
          ],
          on: { done: "read" },
          budget: 1,
          limits,
        },
        read: {
          kind: "command",
          inputs: ["subject"],
          run: [
            "sh",
            "-c",
            `cp "$MEDRENGARD_IN"/* "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            "sh",
            join(directory, "received"),
          ],
          on: { done: "review" },
          budget: 1,
          limits,
        },
        review: { kind: "approval", on: { approve: "end" } },
      },
    }),
  );

  await mkdir(join(started.directory, "received"));

  return started;
}

/** A claim of the outcome `done` with one document, titled Plan, whose body is at `body`. */
function planAt(body: string) {
  return {
    outcome: "done",
    artifacts: [{ kind: "document", fields: { title: "Plan" }, body }],
  };
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

test("a step that declares the subject receives it in its input", async (t) => {
  const { engine, directory } = await engineReceiving(
    t,
    ["subject"],
    `cp "$MEDRENGARD_IN"/* "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  const subject = subjectOf(engine);

  await engine.advance("first");

  const received = join(directory, "received");

  assert.deepEqual(JSON.parse(await readFile(join(received, "input.json"), "utf8")), {
    commission: "first",
    step: "build",
    attempt: 1,
    outcomes: ["done"],
    inputs: {
      subject: { hash: subject, kind: "document", fields: { title: "Greet" }, body: "subject" },
    },
  });

  assert.equal(await readFile(join(received, "subject"), "utf8"), "Say hello.");
});

test("a step that declares no inputs receives only input.json", async (t) => {
  const { engine, directory } = await engineReceiving(
    t,
    [],
    `ls -A "$MEDRENGARD_IN" > "$1/listing"; cp "$MEDRENGARD_IN/input.json" "$1"
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  await engine.advance("first");

  const received = join(directory, "received");

  assert.equal(await readFile(join(received, "listing"), "utf8"), "input.json\n");
  assert.deepEqual(JSON.parse(await readFile(join(received, "input.json"), "utf8")).inputs, {});
});

test("a step cannot write to its input", async (t) => {
  const { engine } = await engineReceiving(
    t,
    ["subject"],
    `test -f "$MEDRENGARD_IN/subject" &&
     ! touch "$MEDRENGARD_IN/note" 2> /dev/null &&
     ! (echo changed > "$MEDRENGARD_IN/subject") 2> /dev/null &&
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
});

test("a claimed document becomes the subject the next step receives", async (t) => {
  const { engine, directory } = await engineClaiming(
    t,
    `printf 'Do it.' > "$MEDRENGARD_OUT/plan.md"`,
    planAt("plan.md"),
  );

  const request = subjectOf(engine);

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "awaiting",
    step: { name: "review" },
  });

  const subject = subjectOf(engine);
  const received = join(directory, "received");

  assert.notEqual(subject, request);

  assert.deepEqual(engine.artifact(subject), {
    kind: "document",
    fields: { title: "Plan" },
    body: "Do it.",
  });

  assert.equal(
    JSON.parse(await readFile(join(received, "input.json"), "utf8")).inputs.subject.hash,
    subject,
  );

  assert.equal(await readFile(join(received, "subject"), "utf8"), "Do it.");
});

test("a claim with a field output.json does not define escalates", async (t) => {
  const { engine } = await engineClaiming(t, "true", { outcome: "done", artifact: [] });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    reason: 'Step build wrote an output.json with fields it does not define: ["artifact"].',
  });
});

test("a claimed artifact of an undeclared kind escalates", async (t) => {
  const { engine } = await engineClaiming(t, "true", {
    outcome: "done",
    artifacts: [{ kind: "memo", fields: {} }],
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    reason: 'Step build claimed an artifact of undeclared kind: "memo".',
  });
});

test("a claimed decision escalates, since only the owner decides", async (t) => {
  const { engine } = await engineClaiming(t, "true", {
    outcome: "done",
    artifacts: [{ kind: "decision", fields: { outcome: "approve", subject: "any" } }],
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    reason: "Step build claimed a decision, which only the owner makes.",
  });
});

test("a claimed document without a title escalates", async (t) => {
  const { engine } = await engineClaiming(t, `printf 'Do it.' > "$MEDRENGARD_OUT/plan.md"`, {
    outcome: "done",
    artifacts: [{ kind: "document", fields: { name: "Plan" }, body: "plan.md" }],
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    reason: "Step build claimed a document that is not a title and a body path.",
  });
});

test("a claimed body the step did not write escalates", async (t) => {
  const { engine } = await engineClaiming(t, "true", planAt("plan.md"));

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    reason: 'Step build claimed a body it did not write: "plan.md".',
  });
});

test("a claimed body outside the step's output escalates", async (t) => {
  const { engine } = await engineClaiming(
    t,
    `ln -s "$MEDRENGARD_IN/input.json" "$MEDRENGARD_OUT/plan.md"`,
    planAt("plan.md"),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    reason: 'Step build claimed a body outside its output: "plan.md".',
  });
});

test("an output.json over its size limit escalates", async (t) => {
  const { engine } = await engineRunning(
    t,
    `{ printf '{"outcome":"done","padding":"'; head -c 65536 /dev/zero | tr '\\0' a; printf '"}'; } \\
       > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    reason: "Step build wrote an output.json over its limit of 65536 bytes.",
  });
});

test("a claimed document title over its size limit escalates", async (t) => {
  const { engine } = await engineClaiming(t, `printf 'Do it.' > "$MEDRENGARD_OUT/plan.md"`, {
    outcome: "done",
    artifacts: [{ kind: "document", fields: { title: "a".repeat(201) }, body: "plan.md" }],
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    reason: "Step build claimed a document title over its limit of 200 bytes.",
  });
});

test("a claimed body over its size limit escalates", async (t) => {
  const { engine } = await engineClaiming(
    t,
    `head -c 1048577 /dev/zero | tr '\\0' a > "$MEDRENGARD_OUT/plan.md"`,
    planAt("plan.md"),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    reason: 'Step build claimed a body over its limit of 1048576 bytes: "plan.md".',
  });
});

test("a claimed body that is not UTF-8 escalates", async (t) => {
  const { engine } = await engineClaiming(
    t,
    `printf 'Do \\377.' > "$MEDRENGARD_OUT/plan.md"`,
    planAt("plan.md"),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    reason: 'Step build claimed a body that is not UTF-8: "plan.md".',
  });
});

test("a commission whose command step leads to an approval step awaits the owner", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({
      start: "build",
      steps: {
        build: {
          kind: "command",
          inputs: [],
          run: ["sh", "-c", `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`],
          on: { done: "review" },
          budget: 1,
          limits: { idle: 1, attempt: 5 },
        },
        review: { kind: "approval", on: { approve: "end" } },
      },
    }),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "awaiting",
    step: { name: "review" },
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
