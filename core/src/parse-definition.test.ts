import { test } from "node:test";
import assert from "node:assert/strict";
import { contract } from "../defaults/access.ts";
import { builtIn } from "../defaults/kinds.ts";
import { limits } from "../defaults/limits.ts";
import { parseDefinition } from "./parse-definition.ts";

// Constraint 9: old logs stay readable. A commission runs on the definition stored when it
// started, so each shape a definition has had still parses, into the shape the engine reads now.
test("a definition stored in an earlier shape parses into the one the engine reads now", () => {
  const { limits: bounds, ...program } = builtIn.commit.verifier;

  const stored = {
    workflow: {
      start: "fan",
      steps: {
        fan: {
          kind: "children",
          workflow: "child",
          count: 1,
          width: 1,
          concurrent: 1,
          // Before what a children step waits until was named so.
          wait: { atLeast: 1 },
          on: { done: "end" },
          budget: 1,
          limits: { wait: 60 },
        },
      },
    },
    workflows: {
      child: { start: "review", steps: { review: { kind: "approval", on: { approve: "end" } } } },
    },
    kinds: {
      ...builtIn,
      commit: {
        ...builtIn.commit,
        // Before a kind's program stated its limits as a step does.
        verifier: {
          ...program,
          access: contract,
          limit: bounds.attempt,
          memory: bounds.memory,
          processes: bounds.processes,
          kept: bounds.kept,
        },
      },
    },
    defaults: { limits },
    skills: {},
  };

  const { workflow, kinds } = parseDefinition("build", JSON.stringify(stored));

  assert.partialDeepStrictEqual(workflow.steps.fan, { kind: "children", until: { atLeast: 1 } });
  assert.ok(!Object.hasOwn(workflow.steps.fan ?? {}, "wait"));
  assert.deepEqual(kinds.commit?.verifier, { ...program, access: contract, limits: bounds });
});

// A definition of one approval step, stored as a commission's is, with `labels` on the step.
// What a factory might write as a step's labels, rightly or not.
type Written = string | readonly string[] | Readonly<Record<string, string | number>>;

const labelled = (labels: Written) =>
  JSON.stringify({
    workflow: {
      start: "review",
      steps: { review: { kind: "approval", on: { approve: "end" }, labels } },
    },
    workflows: {},
    kinds: builtIn,
    defaults: { limits },
    skills: {},
  });

test("a step's labels are kept in the definition as written, whatever its kind", () => {
  const labels = { stage: "Yours", wants: "a change to approve" };

  assert.deepEqual(parseDefinition("build", labelled(labels)).workflow.steps.review, {
    kind: "approval",
    on: { approve: "end" },
    labels,
  });
});

test("labels that are not short texts by name are refused, naming the step", () => {
  for (const labels of [
    ["Yours"],
    { stage: 1 },
    { stage: "" },
    { stage: "x".repeat(257) },
    "Yours",
  ]) {
    assert.throws(
      () => parseDefinition("build", labelled(labels)),
      /^Error: Workflow build is invalid: step review's labels must each be a text of 1 to 256 characters, by name\.$/,
    );
  }
});
