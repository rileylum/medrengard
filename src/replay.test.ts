import { test } from "node:test";
import assert from "node:assert/strict";
import { defineWorkflow, replay } from "./replay.ts";

const startingAt = (kind: "agent" | "approval") =>
  defineWorkflow({ start: "second", steps: { first: { kind: "agent" }, second: { kind } } });

test("a commission starting at an agent step is ready at its start step", () => {
  assert.partialDeepStrictEqual(
    replay(startingAt("agent"), [
      { type: "commissioned", workflow: "test", request: "request-hash" },
    ]),
    {
      status: "ready",
      step: { name: "second" },
    },
  );
});

test("a commission starting at an approval step is awaiting at its start step", () => {
  assert.partialDeepStrictEqual(
    replay(startingAt("approval"), [
      { type: "commissioned", workflow: "test", request: "request-hash" },
    ]),
    {
      status: "awaiting",
      step: { name: "second" },
    },
  );
});

test("a commission with a started attempt is attempting at that step", () => {
  assert.partialDeepStrictEqual(
    replay(startingAt("agent"), [
      { type: "commissioned", workflow: "test", request: "request-hash" },
      { type: "attempt-started", step: "second", attempt: 1, process: { pid: 1, start: 1 } },
    ]),
    { status: "attempting", step: { name: "second" } },
  );
});

test("a completed attempt leaves the commission ready at the next step", () => {
  assert.partialDeepStrictEqual(
    replay(startingAt("agent"), [
      { type: "commissioned", workflow: "test", request: "request-hash" },
      { type: "attempt-started", step: "second", attempt: 1, process: { pid: 1, start: 1 } },
      { type: "attempt-completed", step: "second", attempt: 1, outcome: "done", next: "first" },
    ]),
    { status: "ready", step: { name: "first" } },
  );
});

test("a completed attempt leaves the commission awaiting at a next approval step", () => {
  // lazy: startingAt varies only the start step's kind, so this shape is written inline.
  // When another test needs a non-command next step, let the helper take both kinds.
  const workflow = defineWorkflow({
    start: "second",
    steps: { first: { kind: "approval" }, second: { kind: "agent" } },
  });

  assert.partialDeepStrictEqual(
    replay(workflow, [
      { type: "commissioned", workflow: "test", request: "request-hash" },
      { type: "attempt-started", step: "second", attempt: 1, process: { pid: 1, start: 1 } },
      { type: "attempt-completed", step: "second", attempt: 1, outcome: "done", next: "first" },
    ]),
    { status: "awaiting", step: { name: "first" } },
  );
});

test("a completed attempt to the end finishes the commission", () => {
  assert.partialDeepStrictEqual(
    replay(startingAt("agent"), [
      { type: "commissioned", workflow: "test", request: "request-hash" },
      { type: "attempt-started", step: "second", attempt: 1, process: { pid: 1, start: 1 } },
      { type: "attempt-completed", step: "second", attempt: 1, outcome: "done", next: "end" },
    ]),
    { status: "finished", by: "end" },
  );
});

test("an escalated attempt leaves the commission escalated at its step", () => {
  assert.partialDeepStrictEqual(
    replay(startingAt("agent"), [
      { type: "commissioned", workflow: "test", request: "request-hash" },
      { type: "attempt-started", step: "second", attempt: 1, process: { pid: 1, start: 1 } },
      { type: "escalated", reason: "exited with code 1", attempt: 1 },
    ]),
    { status: "escalated", step: { name: "second" }, reason: "exited with code 1" },
  );
});

test("an approval decision leaves the commission at the next step", () => {
  assert.partialDeepStrictEqual(
    replay(startingAt("approval"), [
      { type: "commissioned", workflow: "test", request: "request-hash" },
      {
        type: "decided",
        step: "second",
        decision: "decision-hash",
        outcome: "approved",
        subject: "plan-hash",
        next: "first",
      },
    ]),
    { status: "ready", step: { name: "first" } },
  );
});

test("a retry decision leaves the escalated step ready", () => {
  assert.partialDeepStrictEqual(
    replay(startingAt("agent"), [
      { type: "commissioned", workflow: "test", request: "request-hash" },
      { type: "attempt-started", step: "second", attempt: 1, process: { pid: 1, start: 1 } },
      { type: "escalated", reason: "exited with code 1", attempt: 1 },
      {
        type: "decided",
        step: "second",
        decision: "decision-hash",
        outcome: "retry",
        subject: "log-hash",
        next: "second",
      },
    ]),
    { status: "ready", step: { name: "second" } },
  );
});

test("an abandon decision finishes the escalated commission as abandoned", () => {
  assert.partialDeepStrictEqual(
    replay(startingAt("agent"), [
      { type: "commissioned", workflow: "test", request: "request-hash" },
      { type: "attempt-started", step: "second", attempt: 1, process: { pid: 1, start: 1 } },
      { type: "escalated", reason: "exited with code 1", attempt: 1 },
      {
        type: "decided",
        step: "second",
        decision: "decision-hash",
        outcome: "abandon",
        subject: "log-hash",
        next: "end",
      },
    ]),
    { status: "finished", by: "abandoned" },
  );
});
