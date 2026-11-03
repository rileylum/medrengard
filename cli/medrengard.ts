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
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import type { CommissionRecord, createEngine as Create, Entry } from "../src/engine.ts";
import { isRecord } from "../src/json.ts";
import type { CommissionState } from "../src/replay.ts";
import type { Artifact } from "../src/store.ts";

const usage = `Usage: medrengard <command> [--json] [--factory <path>]

  commission <workflow> <commission> --title <title> (--body <text> | --body-file <path>)
  advance    <commission>
  state      <commission>
  show       <commission>
  watch      <commission>
  commissions
  run        [--parallel <n>]
  decide     <commission> <outcome> --subject <hash> --since <event>
             [--feedback <text> | --feedback-file <path>]
  cancel     <commission>
  transcript <commission> <attempt>
  errors     <commission> <attempt>
  artifact   <hash or a prefix of at least 8 characters>

The factory is --factory <path>, or else MEDRENGARD_FACTORY: a module whose default export is the
engine's options, { log, kinds, workflows }, with log relative to the module.`;

// Each command's positional arguments and the options it takes besides --json and --factory.
const commands = new Map([
  ["commission", { arguments: 2, options: ["title", "body", "body-file"] }],
  ["advance", { arguments: 1, options: [] }],
  ["state", { arguments: 1, options: [] }],
  ["show", { arguments: 1, options: [] }],
  ["watch", { arguments: 1, options: [] }],
  ["errors", { arguments: 2, options: [] }],
  ["commissions", { arguments: 0, options: [] }],
  ["run", { arguments: 0, options: ["parallel"] }],
  ["decide", { arguments: 2, options: ["subject", "since", "feedback", "feedback-file"] }],
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
      since: text,
      feedback: text,
      "feedback-file": text,
      parallel: text,
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
  (command === "decide" && (values.subject === undefined || !/^\d+$/.test(values.since ?? ""))) ||
  ((command === "transcript" || command === "errors") && !/^[1-9]\d*$/.test(args[1])) ||
  !/^[1-9]\d*$/.test(values.parallel ?? "1")
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

  refuseFactory(path, isRecord(options) ? Object.keys(options) : []);

  const log = resolve(dirname(path), options.log);

  mkdirSync(dirname(log), { recursive: true });

  const engine = createEngine({ log, workflows: options.workflows, kinds: options.kinds });
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
      printState(
        engine.decide(first, {
          subject: values.subject!,
          since: Number(values.since),
          outcome: second,
          feedback,
        }),
      );
      break;
    case "cancel":
      engine.cancel(first);
      print(null, "");
      break;
    case "show":
      printRecord(first, engine.record(first));
      break;
    case "watch":
      await watch(engine, first);
      break;
    case "transcript":
      process.stdout.write(engine.transcript(first, Number(second)));
      break;
    case "errors":
      process.stdout.write(engine.errors(first, Number(second)));
      break;
    case "artifact":
      printArtifact(engine.artifact(first));
      break;
    case "commissions":
      print(
        engine.commissions(),
        engine
          .commissions()
          .map((entry) =>
            "error" in entry
              ? `${entry.commission}: unreadable: ${entry.error}\n`
              : `${entry.commission}: ${describe(entry.state)}\n`,
          )
          .join(""),
      );
      break;
    case "run":
      await runner(engine, Number(values.parallel ?? "1"));
      break;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  process.stderr.write(json ? `${JSON.stringify({ error: message })}\n` : `${message}\n`);
  process.exitCode = 1;
}

// The factory module is the owner's code, so its shape is checked here, before the engine sees it;
// a misspelled key would otherwise be dropped and fail later, far from the cause.
function refuseFactory(path: string, given: readonly string[]): void {
  const keys = ["log", "kinds", "workflows"];
  const missing = keys.filter((key) => !given.includes(key));
  const extra = given.filter((key) => !keys.includes(key));

  if (missing.length > 0 || extra.length > 0) {
    const problems = [
      ...(missing.length > 0 ? [`missing ${missing.join(", ")}`] : []),
      ...(extra.length > 0 ? [`not allowed ${extra.join(", ")}`] : []),
    ];

    throw new Error(
      `Factory ${path} must default-export { log, kinds, workflows }: ${problems.join(", ")}.`,
    );
  }
}

function refuseUsage(): never {
  process.stderr.write(`${usage}\n`);
  process.exit(2);
}

// Prints `result` as JSON, or `readable` for the owner.
// Every result the CLI prints, as JSON with --json.
type Printed =
  | CommissionState
  | CommissionRecord
  | Artifact
  | null
  | ({ commission: string; state: CommissionState } | { commission: string; error: string })[]
  | { parallel: number }
  | { stopping: { commission: string; step: string }[] }
  | { commission: string; state: CommissionState };

function print(result: Printed, readable: string): void {
  process.stdout.write(json ? `${JSON.stringify(result)}\n` : readable);
}

// A state for the owner to read: where the commission is and what it is about.
function describe(state: CommissionState): string {
  if (state.status === "finished") {
    return `finished by ${state.by}`;
  }

  return [
    `${state.status} at ${state.step.name}${waiting(state)}, about ${state.subject}`,
    ...(state.status === "escalated" ? [`reason: ${state.reason}`] : []),
    ...(state.decision === undefined ? [] : [`decision: ${state.decision}`]),
  ].join("\n");
}

function printState(state: CommissionState): void {
  print(state, `${describe(state)}\n`);
}

/**
 * Advances ready commissions, at most `parallel` steps at once and the oldest commission first,
 * and lets the engine escalate attempts no live engine holds, until stopped. A first SIGINT or
 * SIGTERM starts nothing new and waits for the running steps; a second exits at once, and bwrap
 * takes the steps with it, so each escalates as interrupted when next advanced.
 */
async function runner(engine: ReturnType<typeof Create>, parallel: number): Promise<void> {
  const advancing = new Map<string, Promise<void>>();

  // The commissions whose advance may start a step, which the limit counts.
  const stepping = new Set<string>();

  // Aborted by the first stop, so each advance returns once its running step ends.
  const stopping = new AbortController();

  print({ parallel }, `running at most ${parallel} steps in parallel\n`);

  const stop = () => {
    if (stopping.signal.aborted) {
      process.exit(130);
    }

    stopping.abort();

    const waiting = [...stepping].flatMap((commission) => {
      const state = engine.state(commission);

      return state.status === "finished" ? [] : [{ commission, step: state.step.name }];
    });

    const names = waiting.map(({ commission, step }) => `${commission} at ${step}`);

    print({ stopping: waiting }, `stopping, waiting for: ${names.join(", ") || "nothing"}\n`);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // Says once why each commission the engine cannot read is left alone.
  const unreadable = new Set<string>();

  const report = (commission: string, error: string) => {
    process.stderr.write(
      json ? `${JSON.stringify({ commission, error })}\n` : `${commission}: ${error}\n`,
    );
  };

  const advance = (commission: string, step: boolean) => {
    if (step) {
      stepping.add(commission);
    }

    const done = engine
      .advance(commission, { signal: stopping.signal })
      .then(
        (state) => {
          // Still attempting: another live engine holds the attempt.
          if (state.status !== "attempting") {
            print({ commission, state }, `${commission}: ${describe(state)}\n`);
          }
        },
        (error: Error) => report(commission, error.message),
      )
      .finally(() => {
        advancing.delete(commission);
        stepping.delete(commission);
      });

    advancing.set(commission, done);
  };

  while (!stopping.signal.aborted) {
    for (const entry of engine.commissions()) {
      const { commission } = entry;

      if ("error" in entry) {
        if (!unreadable.has(commission)) {
          unreadable.add(commission);
          report(commission, entry.error);
        }

        continue;
      }

      const { state } = entry;

      if (advancing.has(commission)) {
        continue;
      }

      if (state.status === "attempting") {
        advance(commission, false);
      } else if (state.status === "ready" && stepping.size < parallel) {
        advance(commission, true);
      }
    }

    // The log has no notifications, so the runner looks again.
    await sleep(1000);
  }

  await Promise.all(advancing.values());
}

function printArtifact(artifact: Artifact): void {
  const fields = Object.entries(artifact.fields).map(([name, value]) => `${name}: ${value}`);
  const body = artifact.body === undefined ? [] : ["", artifact.body];

  print(artifact, `${[artifact.kind, ...fields, ...body].join("\n")}\n`);
}

// An artifact on one line: `label`, the start of its hash, and its fields but the subject.
function line(label: string, hash: string, artifact: Artifact): string {
  const fields = Object.entries(artifact.fields)
    .filter(([name]) => name !== "subject")
    .map(([, value]) => value);

  return [label.padEnd(8), hash.slice(0, 8), ...fields].join("  ");
}

// An artifact in full, as `artifact` prints it, under a heading and the verifier that accepted it.
function full(hash: string, artifact: Artifact, verifier: readonly string[] | null): string {
  const fields = Object.entries(artifact.fields)
    .filter(([name]) => name !== "subject")
    .map(([name, value]) => `${name}: ${value}`);

  const body = artifact.body === undefined ? [] : ["", artifact.body.trimEnd()];

  return [
    `${artifact.kind} ${hash}`,
    `verifier: ${verifier === null ? "none" : verifier.join(" ")}`,
    ...fields,
    ...body,
  ].join("\n");
}

// The lines for an entry in the record, each with a key that names it, so `watch` prints each
// once: an attempt's start, each of its notes, and its ending; or an escalation or a decision.
function linesOf(index: number, entry: Entry): [string, string][] {
  const at = entry.step.padEnd(12);

  switch (entry.entry) {
    case "attempt": {
      const number = String(entry.attempt).padEnd(2);
      const start: [string, string] = [`${index}:start`, `${number}${at} started`];

      const notes = entry.notes.map((note, n): [string, string] => [
        `${index}:${n}`,
        `     ${note}`,
      ]);

      if ("running" in entry) {
        return [start, ...notes];
      }

      const errors = entry.errors
        ? `  (errors: medrengard errors <commission> ${entry.attempt})`
        : "";

      // Left out for an attempt the log has no times for.
      const took =
        entry.started === undefined || entry.ended === undefined
          ? ""
          : ` (${((entry.ended - entry.started) / 1000).toFixed(1)} s)`;

      const ending =
        "escalated" in entry
          ? `${number}${at} escalated${took}: ${entry.escalated}${errors}`
          : [
              `${number}${at} ${entry.outcome}${took}${errors}`,
              ...entry.artifacts.map(
                ({ hash, artifact, verifier }) =>
                  `    ${line(artifact.kind, hash, artifact)}  ${verifier === null ? "(no verifier)" : "(verified)"}`,
              ),
            ].join("\n");

      return [start, ...notes, [`${index}:end`, ending]];
    }

    case "escalation":
      return [[`${index}`, `  ${at} escalated: ${entry.reason}`]];
    case "decision": {
      const feedback = entry.feedback === undefined ? "" : `: ${JSON.stringify(entry.feedback)}`;

      return [[`${index}`, `  ${at} ${entry.outcome}${feedback}`]];
    }
  }
}

// Where the commission is, in a few words.
// The event a waiting commission has waited since, which a decision names.
function waiting(state: CommissionState): string {
  return state.status === "awaiting" || state.status === "escalated"
    ? ` since event ${state.since}`
    : "";
}

function where(state: CommissionState): string {
  return state.status === "finished"
    ? `finished by ${state.by}`
    : `${state.status} at ${state.step.name}`;
}

// Follows the commission, printing each attempt, note, escalation and decision once, as the log
// records it, until the commission awaits the owner, escalates or finishes.
async function watch(engine: ReturnType<typeof Create>, commission: string): Promise<void> {
  const printed = new Set<string>();

  for (;;) {
    const record = engine.record(commission);

    for (const [index, entry] of record.entries.entries()) {
      for (const [key, text] of linesOf(index, entry)) {
        if (!printed.has(key)) {
          printed.add(key);

          if (!json) {
            process.stdout.write(`${text}\n`);
          }
        }
      }
    }

    const { state } = record;

    if (
      state.status === "awaiting" ||
      state.status === "escalated" ||
      state.status === "finished"
    ) {
      const reason = state.status === "escalated" ? `\nreason: ${state.reason}` : "";

      print(record, `${commission}: ${where(state)}${reason}\n`);

      return;
    }

    // The log has no notifications, so watch looks again.
    await sleep(500);
  }
}

// The record for the owner: where the commission is, every entry in order, and then what it is
// about now with every judgement about that, in full, as an owner reads at a gate.
function printRecord(commission: string, record: CommissionRecord): void {
  const { state, request, entries } = record;

  // An attempt shows as its ending, or as started while it runs; its notes are watch's.
  const timeline = entries.flatMap((entry, index) =>
    linesOf(index, entry)
      .filter(([key]) => (key.endsWith(":start") ? "running" in entry : !/:\d+$/.test(key)))
      .map(([, text]) => text),
  );

  const lines = [
    `${commission}: ${where(state)}${waiting(state)}`,
    ...(state.status === "escalated" ? [`reason: ${state.reason}`] : []),
    line("request", request.hash, request.artifact),
    ...timeline,
  ];

  if (state.status !== "finished") {
    const claimed = entries.flatMap((entry) => ("artifacts" in entry ? entry.artifacts : []));
    const subject = claimed.find(({ hash }) => hash === state.subject);
    const evidence = claimed.filter(({ artifact }) => artifact.fields.subject === state.subject);

    // The request is the owner's, and no verifier checks the owner.
    lines.push(
      "",
      "Subject:",
      full(state.subject, subject?.artifact ?? request.artifact, subject?.verifier ?? null),
    );

    for (const { hash, artifact, verifier } of evidence) {
      lines.push("", full(hash, artifact, verifier));
    }
  }

  print(record, `${lines.join("\n")}\n`);
}
