import { normalize } from "node:path";
import { hasExactly, isRecord, isText } from "./json.ts";
import type { Workflow } from "./replay.ts";

// lazy: the built-in kinds, until kinds are definitions.
const kinds = ["document", "commit", "verdict", "decision"];

// An input name, which is also a directory in the step's input, so it cannot leave that directory
// or collide with input.json.
const inputName = /^[A-Za-z][A-Za-z0-9_-]*$/;

// A variable name the shell can pass on.
const variable = /^[A-Za-z_][A-Za-z0-9_]*$/;

// setTimeout fires at once past 2^31 - 1 ms, so a longer limit would stop a step immediately.
const longestLimit = 2_147_483;

/**
 * Parses the workflow definition `text`, as stored for the commission, refusing one the engine
 * could not run as written.
 */
export function parseWorkflow(name: string, text: string): Workflow {
  const invalid = (problem: string) => new Error(`Workflow ${name} is invalid: ${problem}.`);
  const definition = JSON.parse(text);
  const start = definition?.start;
  const steps = definition?.steps;

  if (!hasExactly(definition, ["start", "steps"]) || !isRecord(steps)) {
    throw invalid("it is not a start and its steps");
  }

  const names = Object.keys(steps);

  if (names.includes("end")) {
    throw invalid("end is reserved, so no step can be named end");
  }

  if (!names.includes(start)) {
    throw invalid("its start is not one of its steps");
  }

  for (const [name, step] of Object.entries(steps)) {
    const on = step?.on;
    const kind = step?.kind;

    const leads =
      isRecord(on) &&
      Object.values(on).every((next) => isText(next) && (next === "end" || names.includes(next)));

    if (!leads) {
      throw invalid(`step ${name}'s edges must each lead to a step or the end`);
    }

    if (kind === "approval") {
      if (!hasExactly(step, ["kind", "on"])) {
        throw invalid(`step ${name} has fields an approval step does not define`);
      }

      continue;
    }

    if (kind !== "command" && kind !== "agent") {
      throw invalid(`step ${name} has an undeclared kind: ${JSON.stringify(kind)}`);
    }

    const program = kind === "command" ? "run" : "agent";
    const { workspace, inputs, budget, access, limits } = step;
    const { paths, network, environment } = access ?? {};
    const workspaceAccess = access?.workspace;
    const { agent } = step;
    const harness = agent?.harness;
    const argv = kind === "command" ? step.run : harness?.run;
    const seconds = { idle: limits?.idle, attempt: limits?.attempt };
    const bytes = { transcript: limits?.transcript, input: limits?.input };

    const fields = ["kind", "workspace", "inputs", program, "on", "budget", "access", "limits"];

    if (!hasExactly(step, fields)) {
      throw invalid(`step ${name} does not have exactly the fields a ${kind} step defines`);
    }

    if (workspace !== "subject" && workspace !== "empty") {
      throw invalid(`step ${name}'s workspace must be subject or empty`);
    }

    if (isRecord(inputs) && !Object.keys(inputs).every((input) => inputName.test(input))) {
      throw invalid(
        `step ${name}'s input names must each be letters, digits, - or _, starting with a letter`,
      );
    }

    if (
      !isRecord(inputs) ||
      !Object.values(inputs).every(
        (query) =>
          query === "subject" ||
          query === "request" ||
          (isRecord(query) &&
            Object.entries(query).every(
              ([field, value]) =>
                (field === "from" &&
                  Array.isArray(value) &&
                  value.every((from) => names.includes(from))) ||
                (field === "kind" && kinds.includes(value)) ||
                (field === "about" &&
                  (value === "subject" || value === "earlier" || value === "any")) ||
                (field === "take" && (value === "latest" || value === "all")),
            )),
      )
    ) {
      throw invalid(
        `step ${name}'s inputs must each be subject, request, or a query of its steps, a kind, a subject and latest or all`,
      );
    }

    if (
      kind === "agent" &&
      (!isText(agent?.model) ||
        !isText(agent?.prompt) ||
        !hasExactly(agent, ["harness", "model", "prompt"]) ||
        !hasExactly(harness, ["run"]))
    ) {
      throw invalid(`step ${name}'s agent must be a harness, a model and a prompt`);
    }

    if (!Array.isArray(argv) || argv.length === 0 || !argv.every(isText)) {
      throw invalid(`step ${name}'s program must be a command and its arguments`);
    }

    if (!Number.isInteger(budget) || budget <= 0) {
      throw invalid(`step ${name}'s budget must be a positive integer`);
    }

    if (!hasExactly(access, ["paths", "network", "environment", "workspace"])) {
      throw invalid(`step ${name}'s access must be its paths, network, environment and workspace`);
    }

    if (
      !Array.isArray(paths) ||
      !paths.every((entry) => {
        const { path, mode, size } = entry ?? {};

        return (
          isText(path) &&
          path === normalize(path) &&
          path.startsWith("/") &&
          (mode === "empty"
            ? hasExactly(entry, ["path", "mode", "size"]) && Number.isInteger(size) && size > 0
            : hasExactly(entry, ["path", "mode"]) && (mode === "read" || mode === "write"))
        );
      })
    ) {
      throw invalid(
        `step ${name}'s paths must each be an absolute path and a mode: read, write, or empty with a size`,
      );
    }

    if (network !== true && network !== false) {
      throw invalid(`step ${name}'s network access must be true or false`);
    }

    if (
      environment !== "all" &&
      !(Array.isArray(environment) && environment.every((each) => variable.test(each)))
    ) {
      throw invalid(`step ${name}'s environment must be all or a list of variable names`);
    }

    if (workspaceAccess !== "read" && workspaceAccess !== "write") {
      throw invalid(`step ${name}'s workspace access must be read or write`);
    }

    if (!hasExactly(limits, ["idle", "attempt", "transcript", "input"])) {
      throw invalid(`step ${name}'s limits must be idle, attempt, transcript and input`);
    }

    for (const [limit, value] of Object.entries(seconds)) {
      if (!Number.isFinite(value) || value <= 0 || value > longestLimit) {
        throw invalid(
          `step ${name}'s ${limit} limit must be a positive number of seconds, at most ${longestLimit}`,
        );
      }
    }

    for (const [limit, value] of Object.entries(bytes)) {
      if (!Number.isInteger(value) || value <= 0) {
        throw invalid(`step ${name}'s ${limit} limit must be a positive integer`);
      }
    }
  }

  // SAFETY: every field the engine reads was checked above.
  return definition as Workflow;
}
