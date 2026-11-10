import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtIn } from "../defaults/kinds.ts";
import { limits } from "../defaults/limits.ts";
import { createEngine } from "./engine.ts";
import type { Access } from "./replay.ts";

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

type Triggers = NonNullable<Parameters<typeof createEngine>[0]["triggers"]>;

/**
 * An engine whose workflow `build` runs `script` once and ends, and whose workflow `other` does
 * the same, with `triggers`.
 */
async function engineWith(t: TestContext, triggers: Triggers, script = "true") {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const workflow = {
    start: "build",
    steps: {
      build: {
        kind: "command",
        run: ["sh", "-c", `${script}; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`],
        workspace: "empty",
        inputs: {},
        claims: [],
        on: { done: "end" },
        budget: 1,
        access,
      },
    },
  } as const;

  return createEngine({
    log: join(directory, "log.sqlite"),
    kinds: builtIn,
    defaults: { limits },
    workflows: { build: workflow, other: workflow },
    triggers,
  });
}

const request = { title: "T", body: "B" };

const nightly = (caps: Partial<Triggers[string]> = {}): Triggers => ({
  nightly: {
    workflows: ["build"],
    rate: { count: 10, per: 3600 },
    unfinished: 10,
    ...caps,
  },
});

test("a trigger's commission is named after it unless named, and records it as its origin", async (t) => {
  const engine = await engineWith(t, nightly());

  assert.equal(engine.commission("build", undefined, request, { trigger: "nightly" }), "nightly-1");
  assert.equal(engine.commission("build", "named", request, { trigger: "nightly" }), "named");
  assert.equal(engine.commission("build", undefined, request, { trigger: "nightly" }), "nightly-3");

  assert.deepEqual(engine.record("nightly-1").origin, { trigger: "nightly" });
  assert.deepEqual(engine.record("named").origin, { trigger: "nightly" });
});

test("the owner's own commission has no origin and no caps", async (t) => {
  const engine = await engineWith(t, nightly({ rate: { count: 1, per: 3600 }, unfinished: 1 }));

  engine.commission("build", undefined, request, { trigger: "nightly" });

  assert.equal(engine.commission("build", "mine", request), "mine");
  assert.equal(engine.commission("build", "also", request), "also");
  assert.equal(engine.record("mine").origin, undefined);
});

/** Asserts that the next commission by nightly is refused for `reason`, recording nothing. */
function refused(engine: ReturnType<typeof createEngine>, reason: string, workflow = "build") {
  const before = engine.commissions().length;

  assert.throws(() => engine.commission(workflow, undefined, request, { trigger: "nightly" }), {
    message: reason,
  });
  assert.equal(engine.commissions().length, before);
}

test("a trigger past its rate is refused, recording nothing", async (t) => {
  const engine = await engineWith(t, nightly({ rate: { count: 2, per: 3600 } }));

  engine.commission("build", undefined, request, { trigger: "nightly" });
  engine.commission("build", undefined, request, { trigger: "nightly" });

  refused(engine, "Trigger nightly started 2 commissions in the last 3600 s, its rate.");
});

test("a trigger with as many unfinished commissions as it may have is refused until one finishes", async (t) => {
  const engine = await engineWith(t, nightly({ unfinished: 1 }));

  engine.commission("build", undefined, request, { trigger: "nightly" });

  refused(engine, "Trigger nightly has 1 unfinished commission, its limit.");

  assert.partialDeepStrictEqual(await engine.advance("nightly-1"), { status: "finished" });
  assert.equal(engine.commission("build", undefined, request, { trigger: "nightly" }), "nightly-2");
});

test("a trigger whose commissions cost its money limit in its period is refused", async (t) => {
  const engine = await engineWith(t, nightly({ usd: 5 }), `echo '{"usd":3}' >&4`);

  engine.commission("build", undefined, request, { trigger: "nightly" });
  await engine.advance("nightly-1");

  // $3 of $5: room for another.
  engine.commission("build", undefined, request, { trigger: "nightly" });
  await engine.advance("nightly-2");

  refused(
    engine,
    "Trigger nightly's commissions in the last 3600 s cost $6, its money limit of $5.",
  );
});

test("a trigger with a money limit is refused once one of its commissions reported no cost", async (t) => {
  const engine = await engineWith(t, nightly({ usd: 5 }));

  engine.commission("build", undefined, request, { trigger: "nightly" });
  await engine.advance("nightly-1");

  refused(
    engine,
    "Trigger nightly's commission nightly-1 reported no cost, so its spend counts as over its money limit of $5.",
  );
});

test("a trigger cannot start a workflow it does not name, nor can a trigger the factory lacks", async (t) => {
  const engine = await engineWith(t, nightly());

  refused(engine, "Trigger nightly may not start workflow other.", "other");

  assert.throws(() => engine.commission("build", undefined, request, { trigger: "hourly" }), {
    message: "There is no trigger named hourly.",
  });
});

test("a commission needs a name unless a trigger names it", async (t) => {
  const engine = await engineWith(t, nightly());

  assert.throws(() => engine.commission("build", undefined, request), {
    message: "A commission needs a name unless a trigger starts it.",
  });
});

for (const [what, triggers] of [
  ["a rate of no commissions", nightly({ rate: { count: 0, per: 3600 } })],
  ["no unfinished commissions", nightly({ unfinished: 0 })],
  ["a workflow the factory lacks", nightly({ workflows: ["missing"] })],
  ["a money limit of nothing", nightly({ usd: 0 })],
] as const) {
  test(`a trigger with ${what} is refused`, async (t) => {
    await assert.rejects(engineWith(t, triggers), {
      message:
        "Trigger nightly is invalid: it must name workflows of the factory, a rate of at least 1 commission per positive number of seconds, at least 1 unfinished commission, and any money limit above zero.",
    });
  });
}
