import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtIn } from "../defaults/kinds.ts";
import { limits } from "../defaults/limits.ts";
import { createEngine } from "./engine.ts";
import type { Access, Workflow } from "./definition.ts";

const access: Access = {
  paths: [
    ...["/usr", "/etc", "/bin", "/lib", "/lib64"].map((path) => ({ path, mode: "read" as const })),
    { path: tmpdir(), mode: "write" },
  ],
  network: false,
  environment: [],
  workspace: "write",
  sandboxes: false,
};

const done = `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`;

/** A command step that runs `script`, with `$1` the test's directory. */
const command = (directory: string, script: string, on: Record<string, string>, budget = 1) =>
  ({
    kind: "command",
    run: ["sh", "-c", script, "sh", directory],
    workspace: "empty",
    inputs: {},
    claims: [],
    on,
    budget,
    access,
    limits: { idle: 30, attempt: 60, transcript: 65536, input: 65536 },
  }) as const;

/** An engine on the workflow `build` that `workflow` makes, with `first` commissioned under it. */
async function engineWith(t: TestContext, workflow: (directory: string) => Workflow) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  // The log's directory is hidden from every step, so it is not the one they write in.
  await mkdir(join(directory, "record"));

  const engine = createEngine({
    log: join(directory, "record", "log.sqlite"),
    kinds: builtIn,
    defaults: { limits },
    workflows: { build: workflow(directory) },
  });

  return { engine, directory };
}

const request = { title: "Build", body: "Build it." };

test("a step routes an attempt's escalation, by its cause, to another step, which is told why", async (t) => {
  const { engine, directory } = await engineWith(t, (path) => ({
    start: "build",
    steps: {
      build: {
        ...command(path, "echo broken >&2; exit 3", { done: "end" }),
        escalate: { exit: "fix" },
      },
      fix: command(path, `cp "$MEDRENGARD_IN/input.json" "$1/fix.json"; ${done}`, { done: "end" }),
    },
  }));

  engine.commission("build", request, { name: "first" });

  // No owner in between: the commission goes on to fix, and ends there.
  assert.deepEqual(await engine.advance("first"), { status: "finished", by: "end" });
  assert.partialDeepStrictEqual(engine.record("first").entries, [
    {
      entry: "attempt",
      step: "build",
      escalated: "Step build exited with code 3.",
      cause: "exit",
      next: "fix",
      errors: true,
    },
    { entry: "attempt", step: "fix", outcome: "done" },
  ]);
  assert.deepEqual(JSON.parse(await readFile(join(directory, "fix.json"), "utf8")).routed, {
    step: "build",
    attempt: 1,
    cause: "exit",
    reason: "Step build exited with code 3.",
  });
});

test("a cause's own route wins over the route for any, and a cause with neither goes to the owner", async (t) => {
  const { engine } = await engineWith(t, (path) => ({
    start: "build",
    steps: {
      build: {
        ...command(path, "exit 3", { done: "end" }),
        escalate: { any: "other", exit: "fix" },
      },
      claim: {
        ...command(path, `echo '{"outcome":"shipped"}' > "$MEDRENGARD_OUT/output.json"`, {
          done: "end",
        }),
        escalate: { exit: "fix" },
      },
      fix: command(path, `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`, {
        done: "claim",
      }),
      other: command(path, done, { done: "end" }),
    },
  }));

  engine.commission("build", request, { name: "first" });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "claim" },
    cause: "claim",
  });
  assert.deepEqual(
    engine.record("first").entries.map((entry) => ("step" in entry ? entry.step : undefined)),
    ["build", "fix", "claim"],
  );
});

// Principle 10: a route is followed only for an attempt's escalation, which spent a unit of its
// step's budget, and renews nothing, so a step routed back to itself stops with its budget.
test("a step routed back to itself runs until its budget is spent, then waits for the owner", async (t) => {
  const { engine, directory } = await engineWith(t, (path) => ({
    start: "build",
    steps: {
      build: {
        ...command(path, `echo started >> "$1/started"; exit 1`, { done: "end" }, 3),
        escalate: { exit: "build" },
      },
    },
  }));

  engine.commission("build", request, { name: "first" });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "budget",
    reason: "Step build has spent its budget of 3 attempts.",
  });
  assert.equal(await readFile(join(directory, "started"), "utf8"), "started\n".repeat(3));

  // The owner's retry renews the budget, as for any step.
  const state = engine.state("first");

  assert.ok(state.status === "escalated");
  engine.decide("first", { subject: state.subject, since: state.since, outcome: "retry" });
  await engine.advance("first");
  assert.equal(await readFile(join(directory, "started"), "utf8"), "started\n".repeat(6));
});

test("an escalation before an attempt starts is the owner's, whatever the step routes", async (t) => {
  const { engine } = await engineWith(t, (path) => ({
    start: "build",
    steps: {
      build: {
        ...command(path, done, { done: "end" }),
        limits: { idle: 30, attempt: 60, transcript: 65536, input: 1 },
        inputs: { request: "request" },
        escalate: { any: "build" },
      },
    },
  }));

  engine.commission("build", request, { name: "first" });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "limit",
    reason: "Step build's inputs are 9 bytes, over its input limit of 1.",
  });
  assert.deepEqual(
    engine.record("first").entries.map(({ entry }) => entry),
    ["escalation"],
  );
});

test("the owner's cancel is never routed", async (t) => {
  const { engine } = await engineWith(t, (path) => ({
    start: "build",
    steps: {
      build: { ...command(path, "sleep 30", { done: "end" }), escalate: { any: "build" } },
    },
  }));

  engine.commission("build", request, { name: "first" });

  const advancing = engine.advance("first");

  while (engine.state("first").status !== "attempting") {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  engine.cancel("first");

  assert.partialDeepStrictEqual(await advancing, {
    status: "escalated",
    cause: "cancelled",
    reason: "Step build was cancelled by the owner.",
  });
});

test("a workflow is refused whose step routes a cause the owner alone answers, or to no step", async (t) => {
  const refused = async (escalate: Record<string, string>) => {
    const { engine } = await engineWith(t, (path) => ({
      start: "build",
      // SAFETY: an invalid definition, as a factory not checked by the compiler could hold.
      steps: { build: { ...command(path, done, { done: "end" }), escalate } } as never,
    }));

    return () => engine.commission("build", request, { name: "first" });
  };

  for (const cause of [
    "budget",
    "money",
    "repeat",
    "inputs",
    "engine",
    "cancelled",
    "withdrawn",
    "upgrade",
    "trigger",
    "unknown",
  ]) {
    assert.throws(
      await refused({ [cause]: "build" }),
      new RegExp(
        `Workflow build is invalid: step build routes ${cause}, which is not a cause a step may route: limit, claim, exit, kind, broker, interrupted, unmet or any\\.`,
      ),
    );
  }

  assert.throws(
    await refused({ exit: "missing" }),
    /Workflow build is invalid: step build routes exit to missing, which is not one of its workflow's steps\./,
  );
  assert.throws(
    await refused({ exit: "end" }),
    /Workflow build is invalid: step build routes exit to end, which is not one of its workflow's steps\./,
  );
});
