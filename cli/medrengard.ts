/**
 * The control protocol: one command per engine call, under the call's name. With --json, stdout
 * holds exactly the call's result as one JSON value, and an error is {"error": message} on stderr.
 * Without it the output is for the owner to read, not for a client to parse.
 *
 * Exits 0 when the call succeeded, an escalation included; 1 when the engine refused or failed;
 * 2 on a usage error.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { CommissionState } from "../src/replay.ts";
import type { Artifact } from "../src/store.ts";

const usage = `Usage: medrengard <command> [--json] [--factory <path>]

  commission <workflow> <commission> --title <title> (--body <text> | --body-file <path>)
  advance    <commission>
  state      <commission>
  decide     <commission> <outcome> --subject <hash> [--feedback <text> | --feedback-file <path>]
  cancel     <commission>
  transcript <commission> <attempt>
  artifact   <hash>

The factory is --factory <path>, or else MEDRENGARD_FACTORY: a module whose default export is the
engine's options, { log, workflows }, with log relative to the module.`;

// Each command's positional arguments and the options it takes besides --json and --factory.
const commands = new Map([
  ["commission", { arguments: 2, options: ["title", "body", "body-file"] }],
  ["advance", { arguments: 1, options: [] }],
  ["state", { arguments: 1, options: [] }],
  ["decide", { arguments: 2, options: ["subject", "feedback", "feedback-file"] }],
  ["cancel", { arguments: 1, options: [] }],
  ["transcript", { arguments: 2, options: [] }],
  ["artifact", { arguments: 1, options: [] }],
]);

const text = { type: "string" } as const;

let parsed;

try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      factory: text,
      title: text,
      body: text,
      "body-file": text,
      subject: text,
      feedback: text,
      "feedback-file": text,
    },
  });
} catch {
  refuseUsage();
}

const { values, positionals } = parsed;
const [command = "", ...args] = positionals;
const json = values.json === true;
const factory = values.factory ?? process.env.MEDRENGARD_FACTORY;
const spec = commands.get(command);

const given = Object.keys(values).filter((name) => name !== "json" && name !== "factory");

if (
  spec === undefined ||
  args.length !== spec.arguments ||
  !given.every((name) => spec.options.includes(name)) ||
  factory === undefined
) {
  refuseUsage();
}

// Text is given inline or as a file, never both.
const both = (inline?: string, file?: string) => inline !== undefined && file !== undefined;

if (
  both(values.body, values["body-file"]) ||
  both(values.feedback, values["feedback-file"]) ||
  (command === "commission" &&
    (values.title === undefined || (values.body ?? values["body-file"]) === undefined)) ||
  (command === "decide" && values.subject === undefined) ||
  (command === "transcript" && !/^[1-9]\d*$/.test(args[1]))
) {
  refuseUsage();
}

// node:sqlite warns that it is experimental on every start; stderr is for errors only, so the
// engine is imported once that warning is dropped.
process.removeAllListeners("warning");

process.on("warning", (warning) => {
  if (warning.name !== "ExperimentalWarning") {
    process.stderr.write(`${warning.stack}\n`);
  }
});

const { createEngine } = await import("../src/engine.ts");

// Text given inline, or read from the file named.
const textOf = (inline?: string, file?: string) =>
  file === undefined ? inline : readFileSync(file, "utf8");

try {
  const body = textOf(values.body, values["body-file"]);
  const feedback = textOf(values.feedback, values["feedback-file"]);
  const path = resolve(factory);
  const options = (await import(pathToFileURL(path).href)).default;
  const log = resolve(dirname(path), options.log);

  mkdirSync(dirname(log), { recursive: true });

  const engine = createEngine({ log, workflows: options.workflows });
  const [first, second] = args;

  switch (command) {
    case "commission":
      engine.commission(first, second, { title: values.title!, body: body! });
      print(null, "");
      break;
    case "advance":
      printState(await engine.advance(first));
      break;
    case "state":
      printState(engine.state(first));
      break;
    case "decide":
      printState(engine.decide(first, { subject: values.subject!, outcome: second, feedback }));
      break;
    case "cancel":
      engine.cancel(first);
      print(null, "");
      break;
    case "transcript":
      process.stdout.write(engine.transcript(first, Number(second)));
      break;
    case "artifact":
      printArtifact(engine.artifact(first));
      break;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  process.stderr.write(json ? `${JSON.stringify({ error: message })}\n` : `${message}\n`);
  process.exitCode = 1;
}

function refuseUsage(): never {
  process.stderr.write(`${usage}\n`);
  process.exit(2);
}

// Prints `result` as JSON, or `readable` for the owner.
function print(result: CommissionState | Artifact | null, readable: string): void {
  process.stdout.write(json ? `${JSON.stringify(result)}\n` : readable);
}

function printState(state: CommissionState): void {
  if (state.status === "finished") {
    print(state, `finished by ${state.by}\n`);

    return;
  }

  const lines = [
    `${state.status} at ${state.step.name}, about ${state.subject}`,
    ...(state.status === "escalated" ? [`reason: ${state.reason}`] : []),
    ...(state.decision === undefined ? [] : [`decision: ${state.decision}`]),
  ];

  print(state, `${lines.join("\n")}\n`);
}

function printArtifact(artifact: Artifact): void {
  const fields = Object.entries(artifact.fields).map(([name, value]) => `${name}: ${value}`);
  const body = artifact.body === undefined ? [] : ["", artifact.body];

  print(artifact, `${[artifact.kind, ...fields, ...body].join("\n")}\n`);
}
