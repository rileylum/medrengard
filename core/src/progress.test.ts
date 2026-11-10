import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { builtIn } from "../defaults/kinds.ts";
import { limits } from "../defaults/limits.ts";
import { contract } from "../defaults/access.ts";
import type { Children, Definition } from "./definition.ts";
import { admit, repeats, routeOf, waitOf, type Log } from "./progress.ts";

// Constraint 8: what the engine does next is judged from the log alone, so the module that judges
// it imports types alone and names nothing that reads a clock, randomness or a file.
test("progress is pure: its module imports only types and names no clock, randomness or I/O", async () => {
  const code = (await readFile(join(import.meta.dirname, "progress.ts"), "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  const imports = code.match(/^import .*$/gm) ?? [];

  assert.ok(imports.length > 0);
  assert.deepEqual(
    imports.filter((line) => !line.startsWith("import type ")),
    [],
  );
  assert.deepEqual(
    code.match(
      /\b(?:Date|Math|performance|crypto|globalThis|fetch|require|setTimeout|setInterval|queueMicrotask)\b|\bprocess\.|\bimport\(/g,
    ),
    null,
  );
});

/** A definition whose one step, build, has a budget of two attempts, and `usd` if given. */
const definitionWith = (usd?: number): Definition => {
  const definition: Definition = {
    workflow: {
      start: "build",
      steps: {
        build: {
          kind: "command",
          run: ["true"],
          workspace: "empty",
          inputs: {},
          claims: [],
          on: { again: "build", done: "end" },
          budget: 2,
          access: contract,
          limits,
        },
      },
    },
    kinds: builtIn,
    skills: {},
  };

  if (usd !== undefined) {
    definition.workflow.usd = usd;
  }

  return definition;
};

const commissioned = {
  type: "commissioned",
  workflow: "build",
  definition: "d",
  request: "r",
  engine: "one",
} as const;

/** An attempt of build, numbered `attempt`, that claimed again, reporting `usd` if given. */
const attempted = (attempt: number, usd?: number, engine = "one") => {
  const completed: Extract<Log[number], { type: "attempt-completed" }> = {
    type: "attempt-completed",
    step: "build",
    attempt,
    outcome: "again",
    artifacts: [],
    transcript: "t",
    next: "build",
  };

  if (usd !== undefined) {
    completed.usage = { usd };
  }

  return [
    {
      type: "attempt-started",
      step: "build",
      attempt,
      subject: "r",
      inputs: [{ name: "plan", hashes: [`h${attempt}`] }],
      process: { pid: 1, start: 1 },
      engine,
    },
    completed,
  ] as const;
};

const retried = {
  type: "decided",
  step: "build",
  decision: "x",
  outcome: "retry",
  subject: "r",
  next: "build",
} as const;

test("a step's budget counts its attempts since the latest decision", () => {
  const spent: Log = [commissioned, ...attempted(1), ...attempted(2)];

  assert.deepEqual(
    admit("first", definitionWith(), [commissioned, ...attempted(1)], "build", "one"),
    {
      attempt: 2,
    },
  );
  assert.deepEqual(admit("first", definitionWith(), spent, "build", "one"), {
    cause: "budget",
    reason: "Step build has spent its budget of 2 attempts.",
  });

  // Only the owner renews a budget; attempt numbers go on.
  assert.deepEqual(
    admit(
      "first",
      definitionWith(),
      [
        ...spent,
        { type: "escalated", cause: "budget", reason: "Step build has spent its budget." },
        retried,
      ],
      "build",
      "one",
    ),
    { attempt: 3 },
  );
});

test("a commission's money limit counts what its attempts reported since the latest decision, and unknown cost as over", () => {
  const within: Log = [commissioned, ...attempted(1, 0.25)];

  assert.deepEqual(admit("first", definitionWith(1), within, "build", "one"), {
    attempt: 2,
    commission: { limit: 1, spent: 0.25 },
  });
  assert.deepEqual(
    admit("first", definitionWith(1), [commissioned, ...attempted(1, 1)], "build", "one"),
    {
      cause: "money",
      reason: "The commission has spent $1.00 of its money limit of $1.",
    },
  );
  assert.deepEqual(
    admit("first", definitionWith(1), [commissioned, ...attempted(1)], "build", "one"),
    {
      cause: "money",
      reason:
        "The commission's spend is unknown: attempt 1 reported no cost, so it counts as over its money limit of $1.",
    },
  );
  assert.deepEqual(
    admit(
      "first",
      definitionWith(1),
      [
        commissioned,
        ...attempted(1, 1),
        { type: "escalated", cause: "money", reason: "The commission has spent its money." },
        retried,
      ],
      "build",
      "one",
    ),
    { attempt: 2, commission: { limit: 1, spent: 0 } },
  );
});

test("a commission that last ran on another engine is not admitted until the owner decides on the escalation naming this one", () => {
  const log: Log = [commissioned, ...attempted(1)];

  const upgraded = {
    cause: "upgrade",
    reason: "Commission first last ran on engine one; this engine is two.",
  } as const;

  assert.deepEqual(admit("first", definitionWith(), log, "build", "two"), upgraded);

  // An escalation alone accepts nothing, nor a decision on an escalation naming another engine.
  const escalated = { type: "escalated", ...upgraded, engine: "two" } as const;

  assert.deepEqual(admit("first", definitionWith(), [...log, escalated], "build", "two"), upgraded);
  assert.deepEqual(
    admit(
      "first",
      definitionWith(),
      [...log, { ...escalated, engine: "three" }, retried],
      "build",
      "two",
    ),
    upgraded,
  );
  assert.deepEqual(admit("first", definitionWith(), [...log, escalated, retried], "build", "two"), {
    attempt: 2,
  });

  // The engine is judged before the budget: the owner accepts it first.
  assert.partialDeepStrictEqual(
    admit("first", definitionWith(), [...log, ...attempted(2)], "build", "two"),
    { cause: "upgrade" },
  );
});

test("an attempt on the same subject and inputs as one since the latest decision would repeat it", () => {
  const log: Log = [commissioned, ...attempted(1)];

  const repeat = {
    cause: "repeat",
    reason: "Step build was already attempted on this subject and these inputs.",
  };

  assert.deepEqual(repeats(log, "build", "r", [{ name: "plan", hashes: ["h1"] }]), repeat);
  assert.equal(repeats(log, "build", "other", [{ name: "plan", hashes: ["h1"] }]), undefined);
  assert.equal(repeats(log, "build", "r", [{ name: "plan", hashes: ["h1", "h2"] }]), undefined);
  assert.equal(repeats(log, "build", "r", [{ name: "other", hashes: ["h1"] }]), undefined);
  assert.equal(repeats(log, "build", "r", []), undefined);
  assert.equal(repeats(log, "review", "r", [{ name: "plan", hashes: ["h1"] }]), undefined);
  assert.equal(
    repeats(
      [...log, { type: "escalated", cause: "repeat", reason: repeat.reason }, retried],
      "build",
      "r",
      [{ name: "plan", hashes: ["h1"] }],
    ),
    undefined,
  );
});

test("a children step's wait is met, can no longer be met, is late, or goes on", () => {
  const step = (until: Children<string>["until"]): Children<string> => ({
    kind: "children",
    workflow: "review",
    count: 3,
    width: 3,
    concurrent: 3,
    until,
    on: { done: "end" },
    budget: 1,
    limits: { wait: 60 },
  });

  const pass = { outcome: "pass" };
  const fail = { outcome: "fail" };
  // Abandoned or withdrawn: finished, on no outcome.
  const gone = {};

  // Every child, the first, or at least some, to reach its end.
  assert.deepEqual(waitOf(step("all"), 3, [pass, fail, undefined], 1), { wait: "on", failed: [] });
  assert.deepEqual(waitOf(step("all"), 3, [pass, fail, pass], 1), { wait: "met", failed: [] });
  assert.deepEqual(waitOf(step("all"), 3, [pass, gone, undefined], 1), {
    wait: "unmet",
    failed: [1],
  });
  assert.deepEqual(waitOf(step("first"), 3, [undefined, fail, undefined], 1), {
    wait: "met",
    failed: [],
  });
  assert.deepEqual(waitOf(step({ atLeast: 2 }), 3, [gone, pass, undefined], 1), {
    wait: "on",
    failed: [0],
  });
  assert.deepEqual(waitOf(step({ atLeast: 2 }), 3, [gone, gone, undefined], 1), {
    wait: "unmet",
    failed: [0, 1],
  });

  // Naming an outcome, only a child that ended on it counts.
  assert.deepEqual(waitOf(step({ all: "pass" }), 3, [pass, fail, undefined], 1), {
    wait: "unmet",
    failed: [1],
  });
  assert.deepEqual(waitOf(step({ atLeast: 2, outcome: "pass" }), 3, [pass, fail, pass], 1), {
    wait: "met",
    failed: [1],
  });

  // Past its wait limit, in seconds, a wait still going on is late; one decided is not.
  assert.deepEqual(waitOf(step("all"), 3, [pass, undefined, undefined], 61_000), {
    wait: "late",
    failed: [],
  });
  assert.deepEqual(waitOf(step("all"), 3, [pass, pass, pass], 61_000), { wait: "met", failed: [] });
});

test("only an attempt's escalation is routed, by its cause or else by any, and never the owner's own causes", () => {
  const definition = definitionWith();

  definition.workflow.steps.fan = {
    kind: "children",
    workflow: "review",
    count: 1,
    width: 1,
    concurrent: 1,
    until: "all",
    on: { done: "end" },
    escalate: { unmet: "build", any: "fan" },
    budget: 1,
    limits: { wait: 60 },
  };

  const log: Log = [
    commissioned,
    {
      type: "attempt-started",
      step: "fan",
      attempt: 1,
      subject: "r",
      inputs: [],
      process: { pid: 1, start: 1 },
    },
  ];

  assert.equal(routeOf(definition, log, { cause: "unmet", attempt: 1 }), "build");
  assert.equal(routeOf(definition, log, { cause: "limit", attempt: 1 }), "fan");

  // Before an attempt starts, and for a cause that is the owner's alone, there is no route.
  assert.equal(routeOf(definition, log, { cause: "limit" }), undefined);

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
  ] as const) {
    assert.equal(routeOf(definition, log, { cause, attempt: 1 }), undefined, cause);
  }
});
