import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtIn } from "../defaults/kinds.ts";
import { limits } from "../defaults/limits.ts";
import { createEngine } from "./engine.ts";
import type { Access, Query, Workflow } from "./definition.ts";

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

// A command step that claims a document titled `title`, or, given inputs, prints its input.json.
const command = (script: string, inputs: Readonly<Record<string, Query>>, next: string) => ({
  kind: "command" as const,
  run: ["sh", "-c", script] as const,
  workspace: "empty" as const,
  inputs,
  claims: ["document"],
  on: { done: next },
  budget: 1,
  access,
});

const claiming = (title: string, next: string) =>
  command(
    `echo "${title}" > "$MEDRENGARD_OUT/body.md"
     echo '{"outcome":"done","artifacts":[{"kind":"document","fields":{"title":"${title}"},"body":"body.md"}]}' > "$MEDRENGARD_OUT/output.json"`,
    {},
    next,
  );

const printing = (inputs: Readonly<Record<string, Query>>, next: string) =>
  command(
    `cat "$MEDRENGARD_IN/input.json"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    inputs,
    next,
  );

// plan claims Task 1 and Task 2, spawn starts a work commission about each, and gather reads what
// they claimed. work drafts, then reads its siblings' latest documents and its origin's plans.
function workflows() {
  return {
    plan: {
      start: "plan",
      steps: {
        plan: command(
          `for i in 1 2; do echo "Do $i." > "$MEDRENGARD_OUT/$i.md"; done
           echo '{"outcome":"done","artifacts":[{"kind":"document","fields":{"title":"Task 1"},"body":"1.md"},{"kind":"document","fields":{"title":"Task 2"},"body":"2.md"}]}' > "$MEDRENGARD_OUT/output.json"`,
          {},
          "spawn",
        ),
        spawn: {
          kind: "commission",
          trigger: "workers",
          workflow: "work",
          each: { from: ["plan"], kind: "document" },
          on: { done: "gather" },
          budget: 1,
        },
        gather: printing(
          { started: { across: "started", kind: "document", take: "latest" } },
          "end",
        ),
      },
    },
    work: {
      start: "draft",
      steps: {
        draft: claiming("Draft", "read"),
        read: printing(
          {
            siblings: { across: "siblings", kind: "document", take: "latest" },
            plans: { across: "origin", from: ["plan"], kind: "document" },
          },
          "end",
        ),
      },
    },
    fan: {
      start: "fan",
      steps: {
        fan: {
          kind: "children",
          workflow: "child",
          count: 1,
          width: 1,
          concurrent: 1,
          until: "all",
          on: { done: "end" },
          budget: 1,
          limits: { wait: 60 },
        },
      },
    },
    child: {
      start: "read",
      steps: { read: printing({ parent: { across: "origin", kind: "document" } }, "end") },
    },
  } satisfies Record<string, Workflow>;
}

async function engineWith(t: TestContext, changed: Record<string, Workflow> = workflows()) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  return createEngine({
    log: join(directory, "log.sqlite"),
    kinds: builtIn,
    defaults: { limits },
    workflows: changed,
    triggers: { workers: { workflows: ["work"], allowance: 10, unfinished: 10 } },
  });
}

type Engine = Awaited<ReturnType<typeof engineWith>>;

// What the attempt `attempt` of `commission` was given under `input`, as its input.json lists
// it: each artifact's title and the commission it came from.
function given(engine: Engine, commission: string, attempt: number, input: string) {
  const { inputs } = JSON.parse(engine.transcript(commission, attempt).toString());

  return inputs[input].map(
    ({ fields, commission: from }: { fields: { title: string }; commission?: string }) => [
      fields.title,
      from,
    ],
  );
}

const request = { title: "Plan", body: "Plan the work." };

test("a query across siblings reads what each has now, unfinished or not, naming whose it is", async (t) => {
  const engine = await engineWith(t);

  engine.commission("plan", "first", request);
  await engine.advance("first");

  // workers-2 has claimed nothing yet: its latest document is its request.
  assert.partialDeepStrictEqual(await engine.advance("workers-1"), { status: "finished" });
  assert.deepEqual(given(engine, "workers-1", 2, "siblings"), [["Task 2", "workers-2"]]);

  assert.partialDeepStrictEqual(await engine.advance("workers-2"), { status: "finished" });
  assert.deepEqual(given(engine, "workers-2", 2, "siblings"), [["Draft", "workers-1"]]);
});

test("a query across the origin reads the commission that started this one", async (t) => {
  const engine = await engineWith(t);

  engine.commission("plan", "first", request);
  await engine.advance("first");
  await engine.advance("workers-1");

  assert.deepEqual(given(engine, "workers-1", 2, "plans"), [
    ["Task 1", "first"],
    ["Task 2", "first"],
  ]);
});

test("a query across the commissions this one started reads each, in the order started", async (t) => {
  const engine = await engineWith(t);

  engine.commission("plan", "first", request);

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
  assert.deepEqual(given(engine, "first", 3, "started"), [
    ["Task 1", "workers-1"],
    ["Task 2", "workers-2"],
  ]);
});

test("a child's origin is its parent, and a commission the owner started has none", async (t) => {
  const engine = await engineWith(t);

  engine.commission("fan", "first", request);
  await engine.advance("first");
  await engine.advance("first.fan.1.1");

  assert.deepEqual(given(engine, "first.fan.1.1", 1, "parent"), [["Plan", "first"]]);

  engine.commission("child", "alone", request);
  await engine.advance("alone");

  assert.deepEqual(given(engine, "alone", 1, "parent"), []);
});

for (const [what, query, problem] of [
  [
    "a relation it does not define",
    { across: "cousins", kind: "document" },
    "inputs must each be subject, request, a query whose from names its steps, kind a kind, about subject, earlier or any, and take latest or all, a session of one of its steps that runs a program, a children step's children, a kind and any take, or across origin, started or siblings, with any from naming steps, kind and take",
  ],
  [
    "about, which another commission's subject would decide",
    { across: "origin", about: "subject" },
    "inputs must each be subject, request, a query whose from names its steps, kind a kind, about subject, earlier or any, and take latest or all, a session of one of its steps that runs a program, a children step's children, a kind and any take, or across origin, started or siblings, with any from naming steps, kind and take",
  ],
] as const) {
  test(`a query across commissions with ${what} is refused`, async (t) => {
    const changed = workflows();

    // SAFETY: the query is invalid on purpose, as a factory's untyped definition could hold it.
    const bad = query as Query;

    const work = {
      ...changed.work,
      steps: { ...changed.work.steps, read: printing({ bad }, "end") },
    };

    const engine = await engineWith(t, { ...changed, work });

    assert.throws(() => engine.check("work"), {
      message: `Workflow work is invalid: step read's ${problem}.`,
    });
  });
}

test("a workspace is not built from another commission's artifact", async (t) => {
  const changed = workflows();

  const read = {
    ...printing({ base: { across: "origin", kind: "document", take: "latest" } }, "end"),
    workspace: { input: "base" },
  };

  const engine = await engineWith(t, {
    ...changed,
    work: { ...changed.work, steps: { ...changed.work.steps, read } },
  });

  assert.throws(() => engine.check("work"), {
    message:
      "Workflow work is invalid: step read's workspace must be subject, empty, or one of its inputs that names at most one artifact of this commission's: subject, request or a query that takes the latest.",
  });
});
