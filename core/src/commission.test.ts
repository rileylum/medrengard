import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtIn } from "../defaults/kinds.ts";
import { limits } from "../defaults/limits.ts";
import { createEngine } from "./engine.ts";
import type { Access, Workflow } from "./replay.ts";

const access: Access = {
  paths: ["/usr", "/etc", "/bin", "/lib", "/lib64"].map((path) => ({
    path,
    mode: "read" as const,
  })),
  network: false,
  environment: [],
  workspace: "write",
  sandboxes: false,
};

type Options = Parameters<typeof createEngine>[0];

type Triggers = NonNullable<Options["triggers"]>;

// A plan step that claims `count` documents, titled Task 1 and on, whose bodies say which.
const plan = (count: number) => ({
  kind: "command" as const,
  run: [
    "sh",
    "-c",
    `artifacts=""
     for i in $(seq 1 ${count}); do
       echo "Do task $i." > "$MEDRENGARD_OUT/task-$i.md"
       artifacts="$artifacts\${artifacts:+,}{\\"kind\\":\\"document\\",\\"fields\\":{\\"title\\":\\"Task $i\\"},\\"body\\":\\"task-$i.md\\"}"
     done
     echo "{\\"outcome\\":\\"done\\",\\"artifacts\\":[$artifacts]}" > "$MEDRENGARD_OUT/output.json"`,
  ] as const,
  workspace: "empty" as const,
  inputs: {},
  claims: ["document"],
  on: { done: "spawn" },
  budget: 1,
  access,
});

// The workflow `plan`: plans `count` tasks, then starts one `work` commission per task through the
// trigger `workers`, handing each the plan's request as its brief. `work` awaits the owner.
function workflows(count: number) {
  return {
    plan: {
      start: "plan",
      steps: {
        plan: plan(count),
        spawn: {
          kind: "commission",
          trigger: "workers",
          workflow: "work",
          each: { from: ["plan"], kind: "document" },
          given: { brief: "request" },
          on: { done: "end" },
          budget: 1,
        },
      },
    },
    work: { start: "review", steps: { review: { kind: "approval", on: { approve: "end" } } } },
  } satisfies Record<string, Workflow>;
}

const workers = (caps: Partial<Triggers[string]> = {}): Triggers => ({
  workers: { workflows: ["work"], allowance: 10, unfinished: 10, ...caps },
});

async function engineWith(
  t: TestContext,
  {
    count = 2,
    triggers = workers(),
    log,
  }: { count?: number; triggers?: Triggers; log?: string } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const options = (more: Partial<Options> = {}): Options => ({
    log: log ?? join(directory, "log.sqlite"),
    kinds: builtIn,
    defaults: { limits },
    workflows: workflows(count),
    triggers,
    ...more,
  });

  return { engine: createEngine(options()), options };
}

const request = { title: "Plan", body: "Plan the work." };

test("a commission step starts one top-level commission per document through its trigger, and goes on at once", async (t) => {
  const { engine } = await engineWith(t);

  engine.commission("plan", "first", request);

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });

  const started = engine.commissions().filter(({ commission }) => commission !== "first");

  assert.deepEqual(
    started.map(({ commission }) => commission),
    ["workers-1", "workers-2"],
  );

  for (const [index, name] of ["workers-1", "workers-2"].entries()) {
    const record = engine.record(name);

    assert.deepEqual(record.origin, {
      trigger: "workers",
      from: { commission: "first", step: "spawn", attempt: 2 },
    });
    assert.equal(record.request.artifact.fields.title, `Task ${index + 1}`);
    // Given the plan's request as its brief, its first subject is that document.
    assert.partialDeepStrictEqual(record.state, {
      status: "awaiting",
      subject: engine.record("first").request.hash,
    });
  }

  // Top-level, not children: the started commissions name no parent.
  const commissioned = engine
    .events(-1)
    .filter(({ commission, position }) => commission !== "first" && position === 0);

  assert.ok(commissioned.every(({ event }) => !("parent" in event)));

  // The step ran no program: it claimed done with nothing.
  const spawned = engine.record("first").entries.at(-1);

  assert.partialDeepStrictEqual(spawned, { entry: "attempt", step: "spawn", outcome: "done" });
});

test("a commission step whose documents do not fit its trigger starts none and escalates", async (t) => {
  const { engine } = await engineWith(t, { count: 3, triggers: workers({ allowance: 2 }) });

  engine.commission("plan", "first", request);

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    reason:
      "Step spawn would start 3 commissions through trigger workers, which has 2 of its allowance of 2 left.",
  });
  assert.deepEqual(
    engine.commissions().map(({ commission }) => commission),
    ["first"],
  );
});

test("a trigger's allowance counts every commission it started until the owner renews it", async (t) => {
  const { engine } = await engineWith(t, { count: 1, triggers: workers({ allowance: 2 }) });

  engine.commission("plan", "first", request);
  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });

  // A program outside the engine spends the trigger's allowance too.
  engine.commission("work", undefined, request, { trigger: "workers" });

  engine.commission("plan", "second", request);

  const escalated = await engine.advance("second");

  assert.partialDeepStrictEqual(escalated, {
    status: "escalated",
    reason:
      "Step spawn would start 1 commission through trigger workers, which has 0 of its allowance of 2 left.",
  });
  assert.throws(() => engine.commission("work", undefined, request, { trigger: "workers" }), {
    message: "Trigger workers has started 2 commissions since it was last renewed, its allowance.",
  });

  engine.renew("workers");

  assert.ok(escalated.status === "escalated");
  engine.decide("second", { subject: escalated.subject, since: escalated.since, outcome: "retry" });
  assert.partialDeepStrictEqual(await engine.advance("second"), { status: "finished" });
  assert.equal(engine.record("workers-3").origin?.from?.commission, "second");
});

test("a commission step is bounded by its trigger's unfinished limit", async (t) => {
  const { engine } = await engineWith(t, { count: 2, triggers: workers({ unfinished: 3 }) });

  engine.commission("plan", "first", request);
  await engine.advance("first");
  engine.commission("plan", "second", request);

  assert.partialDeepStrictEqual(await engine.advance("second"), {
    status: "escalated",
    reason:
      "Step spawn would start 2 commissions through trigger workers, which has 2 unfinished of its limit of 3.",
  });
});

test("a started commission runs on the factory's definitions when it starts, not its starter's", async (t) => {
  const { options } = await engineWith(t, { count: 1 });

  const before = createEngine(options());

  before.commission("plan", "first", request);

  // The factory's work workflow changes before the commission step runs.
  const changed = {
    ...workflows(1),
    work: {
      start: "review",
      steps: { review: { kind: "approval", on: { approve: "end", reject: "end" } } },
    },
  } satisfies Record<string, Workflow>;

  const after = createEngine(options({ workflows: changed }));

  await after.advance("first");

  assert.deepEqual(after.definition("workers-1").workflow, changed.work);
});

test("renewing a trigger the factory lacks, or one without an allowance, is refused", async (t) => {
  const { engine } = await engineWith(t, {
    triggers: {
      ...workers(),
      nightly: { workflows: ["work"], rate: { count: 1, per: 60 }, unfinished: 1 },
    },
  });

  assert.throws(() => engine.renew("hourly"), { message: "There is no trigger named hourly." });
  assert.throws(() => engine.renew("nightly"), {
    message: "Trigger nightly has no allowance to renew.",
  });
});

for (const [what, triggers, message] of [
  [
    "a trigger the factory lacks",
    {},
    "Step spawn of workflow plan starts commissions through trigger workers, which the factory lacks.",
  ],
  [
    "a trigger without an allowance",
    { workers: { workflows: ["work"], rate: { count: 1, per: 60 }, unfinished: 1 } },
    "Step spawn of workflow plan starts commissions through trigger workers, which has no allowance: only one the owner renews bounds commissions that start commissions.",
  ],
  [
    "a trigger that may not start its workflow",
    { workers: { workflows: ["plan"], allowance: 1, unfinished: 1 } },
    "Step spawn of workflow plan starts commissions of workflow work, which trigger workers may not start.",
  ],
] as const) {
  test(`an engine whose commission step names ${what} is refused`, async (t) => {
    await assert.rejects(engineWith(t, { triggers }), { message });
  });
}

test("a trigger with neither a rate nor an allowance is refused", async (t) => {
  await assert.rejects(
    engineWith(t, { triggers: { workers: { workflows: ["work"], unfinished: 1 } } }),
    {
      message:
        "Trigger workers is invalid: it must name workflows of the factory, a rate of at least 1 commission per positive number of seconds or an allowance of at least 1 commission, or both, at least 1 unfinished commission, and any money limit above zero.",
    },
  );
});

for (const [what, change, problem] of [
  [
    "a field it does not define",
    { width: 2 },
    "fields must be a commission step's: its trigger, workflow, each, any given, on and budget",
  ],
  [
    "each that names no documents",
    { each: { from: ["plan"], kind: "verdict" } },
    "each must be request, or a query of documents, which become the commissions' requests",
  ],
  [
    "an outcome other than done",
    { on: { done: "end", failed: "end" } },
    "edges must be done alone: it goes on once it has started its commissions",
  ],
  ["no budget", { budget: 0 }, "budget must be a positive integer"],
] as const) {
  test(`a commission step with ${what} is refused`, async (t) => {
    const { engine, options } = await engineWith(t);
    const base = workflows(2);

    const changed = {
      ...base,
      plan: {
        ...base.plan,
        steps: { ...base.plan.steps, spawn: { ...base.plan.steps.spawn, ...change } },
      },
    };

    assert.ok(engine);
    assert.throws(() => createEngine(options({ workflows: changed })).check("plan"), {
      message: `Workflow plan is invalid: step spawn's ${problem}.`,
    });
  });
}
