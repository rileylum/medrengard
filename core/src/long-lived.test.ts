// A long-lived agent as the core composes it: a chain of finite commissions, each a link that works
// from its memory, proposes the next memory for the owner to approve, and starts its successor
// through the agent's own trigger, handing it the approved memory. Nothing here is new to the
// core: the trigger names the chain and its allowance bounds it.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtIn } from "../defaults/kinds.ts";
import { limits } from "../defaults/limits.ts";
import { createEngine } from "./engine.ts";
import { defineWorkflow } from "./definition.ts";

const mayor = defineWorkflow({
  start: "work",
  steps: {
    // Works from its memory, the subject: the request for the first link, the approved memory
    // after. Here it only adds a line naming the link to what it remembers.
    work: {
      kind: "command",
      run: [
        "sh",
        "-c",
        `link=$(sed -n 's/^{"commission":"\\([^"]*\\)".*/\\1/p' "$MEDRENGARD_IN/input.json")
         { cat document; echo "$link worked."; } > "$MEDRENGARD_OUT/memory.md"
         echo '{"outcome":"done","artifacts":[{"kind":"document","fields":{"title":"Memory"},"body":"memory.md"}]}' > "$MEDRENGARD_OUT/output.json"`,
      ],
      workspace: "subject",
      inputs: {},
      claims: ["document"],
      on: { done: "remember" },
      budget: 1,
      access: {
        paths: ["/usr", "/etc", "/bin", "/lib", "/lib64"].map((path) => ({
          path,
          mode: "read" as const,
        })),
        network: false,
        environment: [],
        workspace: "write",
        sandboxes: false,
      },
    },
    // Memory steers every later link, so the owner approves each change to it.
    remember: { kind: "approval", on: { approve: "next" } },
    next: {
      kind: "commission",
      trigger: "mayor",
      workflow: "mayor",
      each: "request",
      given: { memory: "subject" },
      on: { done: "end" },
      budget: 1,
    },
  },
});

async function engineWith(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  return createEngine({
    log: join(directory, "log.sqlite"),
    kinds: builtIn,
    defaults: { limits },
    workflows: { mayor },
    triggers: { mayor: { workflows: ["mayor"], allowance: 3, unfinished: 2 } },
  });
}

type Engine = Awaited<ReturnType<typeof engineWith>>;

// Runs the link `link` to its approval, approves the memory it proposes, and runs it on.
async function approved(engine: Engine, link: string) {
  const awaiting = await engine.advance(link);

  assert.ok(awaiting.status === "awaiting", `${link} is ${awaiting.status}`);
  engine.decide(link, { subject: awaiting.subject, since: awaiting.since, outcome: "approve" });

  return engine.advance(link);
}

// The memory the link `link` starts with, its first subject.
const memoryOf = (engine: Engine, link: string) => {
  const { state } = engine.record(link);

  assert.ok(state.status !== "finished");

  return engine.artifact(state.subject).body;
};

test("a long-lived agent is a chain of commissions carrying approved memory, bounded by its trigger's allowance", async (t) => {
  const engine = await engineWith(t);

  engine.commission(
    "mayor",
    undefined,
    { title: "Mayor", body: "Keep the books.\n" },
    {
      trigger: "mayor",
    },
  );

  assert.partialDeepStrictEqual(await approved(engine, "mayor-1"), { status: "finished" });
  assert.equal(memoryOf(engine, "mayor-2"), "Keep the books.\nmayor-1 worked.\n");
  assert.partialDeepStrictEqual(engine.record("mayor-2").origin, {
    trigger: "mayor",
    from: { commission: "mayor-1", step: "next" },
  });

  assert.partialDeepStrictEqual(await approved(engine, "mayor-2"), { status: "finished" });

  // The third link would start a fourth: the allowance of 3 is spent, so the chain stops for the
  // owner.
  const stopped = await approved(engine, "mayor-3");

  assert.partialDeepStrictEqual(stopped, {
    status: "escalated",
    reason:
      "Step next would start 1 commission through trigger mayor, which has 0 of its allowance of 3 left.",
  });

  engine.renew("mayor");
  assert.ok(stopped.status === "escalated");
  engine.decide("mayor-3", { subject: stopped.subject, since: stopped.since, outcome: "retry" });

  assert.partialDeepStrictEqual(await engine.advance("mayor-3"), { status: "finished" });
  assert.equal(
    memoryOf(engine, "mayor-4"),
    "Keep the books.\nmayor-1 worked.\nmayor-2 worked.\nmayor-3 worked.\n",
  );
});
