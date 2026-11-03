import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtIn } from "../defaults/kinds.ts";
import { createEngine } from "./engine.ts";

// A log and store written by the engine of 2026-11-03, never regenerated: a change that makes
// the engine unable to read them breaks commissions already in the owner's logs. One workflow:
// draft (a command step that drafts a plan, fails, or sleeps, as its request says), the approval
// gate, and review (a command step that claims a passing verdict). Seven commissions, one at each
// status, the attempting one left by an engine killed mid-attempt.
const fixture = join(import.meta.dirname, "fixtures", "2026-11-03");

test("a log written by the engine of 2026-11-03 still reads", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(fixture, directory, { recursive: true });

  const engine = createEngine({
    log: join(directory, "log.sqlite"),
    kinds: builtIn,
    workflows: {},
  });

  assert.deepEqual(
    engine
      .commissions()
      .map((entry) => ("error" in entry ? entry : [entry.commission, entry.state.status])),
    [
      ["finished", "finished"],
      ["abandoned", "finished"],
      ["escalated", "escalated"],
      ["awaiting", "awaiting"],
      ["ready", "ready"],
      ["retried", "ready"],
      ["attempting", "attempting"],
    ],
  );

  assert.partialDeepStrictEqual(engine.record("finished"), {
    state: { status: "finished", by: "end" },
    request: {
      artifact: { kind: "document", fields: { title: "finished" }, body: "Greet the owner." },
    },
    entries: [
      {
        entry: "attempt",
        step: "draft",
        notes: ["Reading the request."],
        outcome: "done",
        artifacts: [
          {
            artifact: {
              kind: "document",
              fields: { title: "Plan" },
              body: "Plan for: Greet the owner.\n",
            },
            verifier: null,
          },
        ],
      },
      { entry: "decision", step: "gate", outcome: "approve", feedback: "Go ahead." },
      {
        entry: "attempt",
        step: "review",
        outcome: "pass",
        artifacts: [
          {
            artifact: {
              kind: "verdict",
              fields: { verdict: "pass", summary: "Looks right." },
              body: "Fine.\n",
            },
            verifier: null,
          },
        ],
      },
    ],
  });
  assert.equal(engine.transcript("finished", 1).toString(), "drafting: Greet the owner.\n");

  assert.partialDeepStrictEqual(engine.record("abandoned"), {
    state: { status: "finished", by: "abandoned" },
    entries: [
      {
        entry: "attempt",
        step: "draft",
        escalated: "Step draft exited with code 1.",
        errors: true,
      },
      { entry: "decision", step: "draft", outcome: "abandon" },
    ],
  });
  assert.equal(engine.errors("escalated", 1).toString(), "cannot draft\n");
  assert.partialDeepStrictEqual(engine.state("awaiting"), {
    status: "awaiting",
    step: { name: "gate" },
  });
  assert.partialDeepStrictEqual(engine.record("ready").entries, [
    { entry: "attempt", outcome: "done" },
    { entry: "decision", outcome: "changes", feedback: "Shorter, please." },
  ]);
  assert.partialDeepStrictEqual(engine.record("retried").entries, [
    { entry: "attempt", escalated: "Step draft exited with code 1." },
    { entry: "decision", outcome: "retry", feedback: "Try once more." },
  ]);
  assert.partialDeepStrictEqual(engine.record("attempting").entries, [
    { entry: "attempt", step: "draft", running: true, notes: ["Reading the request."] },
  ]);
});
