import { test } from "node:test";
import assert from "node:assert/strict";
import { defineWorkflow, replay, type StepKind } from "./replay.ts";

const startingAt = (kind: StepKind) =>
  defineWorkflow({ start: "second", steps: { first: { kind: "command" }, second: { kind } } });

test("a commission starting at an agent step is ready at its start step", () => {
  assert.partialDeepStrictEqual(replay(startingAt("agent"), [{ type: "commissioned" }]), {
    status: "ready",
    step: { name: "second" },
  });
});

test("a commission starting at an approval step is awaiting at its start step", () => {
  assert.partialDeepStrictEqual(replay(startingAt("approval"), [{ type: "commissioned" }]), {
    status: "awaiting",
    step: { name: "second" },
  });
});

test("a commission with a started attempt is attempting at that step", () => {
  assert.partialDeepStrictEqual(
    replay(startingAt("agent"), [
      { type: "commissioned" },
      { type: "attempt-started", step: "second", attempt: 1 },
    ]),
    { status: "attempting", step: { name: "second" } },
  );
});
