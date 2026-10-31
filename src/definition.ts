import { hasExactly, isRecord, isText } from "./json.ts";
import type { Workflow } from "./replay.ts";

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
    const { workspace, inputs, budget, limits } = step;
    const { agent } = step;
    const harness = agent?.harness;
    const argv = kind === "command" ? step.run : harness?.run;
    const seconds = { idle: limits?.idle, attempt: limits?.attempt };
    const transcript = limits?.transcript;

    const fields = ["kind", "workspace", "inputs", program, "on", "budget", "limits"];

    if (!hasExactly(step, fields)) {
      throw invalid(`step ${name} does not have exactly the fields a ${kind} step defines`);
    }

    if (workspace !== "subject" && workspace !== "empty") {
      throw invalid(`step ${name}'s workspace must be subject or empty`);
    }

    if (
      !Array.isArray(inputs) ||
      !inputs.every((input) => input === "subject" || input === "decision")
    ) {
      throw invalid(`step ${name}'s inputs must each be subject or decision`);
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

    if (!hasExactly(limits, ["idle", "attempt", "transcript"])) {
      throw invalid(`step ${name}'s limits must be idle, attempt and transcript`);
    }

    for (const [limit, value] of Object.entries(seconds)) {
      if (!Number.isFinite(value) || value <= 0 || value > longestLimit) {
        throw invalid(
          `step ${name}'s ${limit} limit must be a positive number of seconds, at most ${longestLimit}`,
        );
      }
    }

    if (!Number.isInteger(transcript) || transcript <= 0) {
      throw invalid(`step ${name}'s transcript limit must be a positive integer`);
    }
  }

  // SAFETY: every field the engine reads was checked above.
  return definition as Workflow;
}
