import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { factoryIn, run } from "../cli/fixture.ts";
import { openFactory } from "../cli/factory.ts";
import { changed, material, standing, timeline, visible, waits, week } from "./reading.ts";

const cli = join(import.meta.dirname, "..", "cli", "medrengard.ts");

// A factory of fake steps with `commissions` started in it, each `[workflow, name, title]`, and
// its engine.
async function factoryWith(
  t: TestContext,
  commissions: readonly (readonly [string, string, string])[],
) {
  const { factory, directory } = await factoryIn(t);

  for (const [workflow, name, title] of commissions) {
    run(["commission", workflow, name, "--title", title, "--body", `${title}.`], factory);
  }

  const { engine } = await openFactory(factory);

  return { factory, directory, engine };
}

type Engine = Awaited<ReturnType<typeof factoryWith>>["engine"];

// Approves `commission` at the approval it awaits, as the owner would.
function approve(engine: Engine, commission: string, feedback?: string): void {
  const state = engine.state(commission);

  assert(state.status === "awaiting");
  engine.decide(commission, {
    subject: state.subject,
    since: state.since,
    outcome: "approve",
    feedback,
  });
}

test("standing says who each commission waits for, when it last changed and what it spent", async (t) => {
  const before = Date.now();

  const { factory, engine } = await factoryWith(t, [
    ["spending", "spent", "Spend"],
    ["build", "queued", "Queue"],
    ["spending", "ended", "End"],
  ]);

  run(["advance", "spent"], factory);
  run(["advance", "ended"], factory);
  approve(engine, "ended");

  const all = standing(engine);
  const [spent, queued, ended] = all;

  // An approval waits on the owner; a step nothing has attempted, on an engine that runs; one
  // finished, on nobody.
  assert.deepEqual(
    all.map(({ commission, waits: who }) => [commission, who]),
    [
      ["spent", "owner"],
      ["queued", "run"],
      ["ended", "nobody"],
    ],
  );
  assert.equal(spent.title, "Spend");
  assert.equal(spent.usd, 0.25);
  assert.equal(queued.usd, 0);
  assert.equal(spent.state.status, "awaiting");
  assert.ok(spent.since >= before && spent.since <= Date.now());
  assert.ok(ended.since >= spent.since);
});

test(
  "a step the owner is to attend waits on them, and one being attempted on its step",
  { timeout: 10_000 },
  async (t) => {
    const { factory, directory, engine } = await factoryWith(t, [
      ["attended", "sat", "Sit"],
      ["held", "busy", "Hold"],
    ]);

    const advancing = spawn(process.execPath, [cli, "--factory", factory, "advance", "busy"], {
      stdio: "ignore",
    });

    t.after(() => advancing.kill());

    while (!existsSync(join(directory, "held"))) {
      await sleep(20);
    }

    assert.deepEqual(
      standing(engine).map(({ commission, waits: who }) => [commission, who]),
      [
        ["sat", "owner"],
        ["busy", "step"],
      ],
    );

    await writeFile(join(directory, "held.go"), "");
    await once(advancing, "exit");
  },
);

test("timeline has one moment for each attempt, decision and stop, with what it spent and when", async (t) => {
  const before = Date.now();

  const { factory, engine } = await factoryWith(t, [
    ["spending", "spent", "Spend"],
    ["failing", "broke", "Break"],
  ]);

  run(["advance", "spent"], factory);
  run(["advance", "broke"], factory);
  approve(engine, "spent", "Good.");

  const [attempt, decision] = timeline(engine, "spent");
  const { started = 0, ended = 0, ...attempted } = attempt;
  const { ended: decided = 0, ...rest } = decision;

  assert.deepEqual(attempted, {
    what: "attempt",
    step: "build",
    attempt: 1,
    outcome: "done",
    usd: 0.25,
    claimed: [],
  });
  assert.ok(before <= started && started <= ended && ended <= decided);
  assert.deepEqual(rest, {
    what: "decision",
    step: "review",
    outcome: "approve",
    said: "Good.",
    usd: 0,
    claimed: [],
  });

  const [stopped] = timeline(engine, "broke");

  assert.equal(stopped.outcome, "stopped");
  assert.match(stopped.said ?? "", /exit/);

  // How long the owner was waited on: from the end of what came before their decision to it.
  assert.deepEqual(waits([attempt, decision]), [{ at: decided, lasted: decided - ended }]);
});

test("timeline names what an attempt claimed, by hash, kind and title", async (t) => {
  const { factory, engine } = await factoryWith(t, [["judged", "plan", "Plan it"]]);

  run(["advance", "plan"], factory);

  const [attempt] = timeline(engine, "plan");

  assert.equal(attempt.outcome, "pass");
  assert.deepEqual(
    attempt.claimed.map(({ kind, title, hash }) => [kind, title, hash.length]),
    [
      ["memo", "", 64],
      ["verdict", "", 64],
    ],
  );
});

test("material is a commission's whole record as one document, in the order it happened", async (t) => {
  const { factory, engine } = await factoryWith(t, [["judged", "plan", "Plan it"]]);

  run(["advance", "plan"], factory);
  approve(engine, "plan", "Go on.");

  const text = material(engine, "plan");

  assert.match(
    text,
    /^# Plan it\n\nPlan it\.\n\n## build: memo \(note: Checked\.\)\n\n## build: verdict \(verdict: pass\)\n\n/,
  );
  assert.match(text, /\n\n## The owner decided `approve` at review\n\nGo on\.$/);
});

test("changed names a record each time it gains an event, until it is told to stop", async (t) => {
  const first = await factoryWith(t, [["build", "one", "One"]]);
  const second = await factoryWith(t, [["build", "two", "Two"]]);
  const stop = new AbortController();
  const seen = changed({ first: first.engine, second: second.engine }, stop.signal);
  const next = seen.next();

  run(["advance", "two"], second.factory);

  assert.equal((await next).value, "second");

  const after = seen.next();

  stop.abort();

  assert.equal((await after).done, true);
});

test("week sums what happened on each of the seven days ending today, the oldest first", () => {
  const noon = new Date(2026, 10, 12, 12).getTime();
  const day = 24 * 60 * 60 * 1000;

  const things = [
    { at: noon, worth: 2 },
    { at: noon - 1000, worth: 3 },
    { at: noon - 6 * day, worth: 5 },
    { at: noon - 7 * day, worth: 7 },
  ];

  assert.deepEqual(
    week(
      things,
      noon,
      ({ at }) => at,
      ({ worth }) => worth,
    ),
    [5, 0, 0, 0, 0, 0, 5],
  );
});

test("visible writes out the characters a terminal would act on", () => {
  assert.equal(visible("a\u001b[1Ab‮c\n\td"), "a\\u001b[1Ab\\u202ec\n\td");
});
