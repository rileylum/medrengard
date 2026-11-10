/**
 * The control protocol: one command per engine call, under the call's name. With --json, stdout
 * holds exactly the call's result as one JSON value, and an error is {"error": message} on stderr.
 * Without it the output is for the owner to read, not for a client to parse.
 *
 * Exits 0 when the call succeeded, an escalation included; 1 when the engine refused or failed;
 * 2 on a usage error.
 */
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import type { CommissionRecord } from "../src/engine.ts";
import type { Definition } from "../src/definition.ts";
import type { CommissionState } from "../src/replay.ts";
import type { Artifact } from "../src/store.ts";
import { openFactory, type Engine } from "./factory.ts";
import { describe, full, line, linesOf, visible, waiting, where } from "./readable.ts";

const usage = `Usage: medrengard <command> [--json] [--factory <path>]

  commission <workflow> [<commission>] [--trigger <name>] --title <title> (--body <text> | --body-file <path>)
  check      [<workflow>]
  advance    <commission>
  attend     <commission>
  state      <commission>
  show       <commission>
  watch      <commission>
  events     [--after <position>] [--follow]
  commissions
  engines
  run        [--parallel <n>]
  decide     <commission> <outcome> --subject <hash> --since <event>
             [--feedback <text> | --feedback-file <path>]
  cancel     <commission>
  renew      <trigger>
  transcript <commission> <attempt>
  errors     <commission> <attempt>
  artifact   <hash or a prefix of at least 8 characters>
  definition <commission>

The factory is --factory <path>, or else MEDRENGARD_FACTORY: a module whose default export is the
engine's options, { log, kinds, workflows, defaults } and any triggers, with log relative to the module.`;

// Each command's positional arguments, `optional` of them at the end, and the options it takes
// besides --json and --factory.
const commands = new Map<string, { arguments: number; optional?: number; options: string[] }>([
  ["commission", { arguments: 2, optional: 1, options: ["title", "body", "body-file", "trigger"] }],
  ["check", { arguments: 1, optional: 1, options: [] }],
  ["advance", { arguments: 1, options: [] }],
  ["attend", { arguments: 1, options: [] }],
  ["state", { arguments: 1, options: [] }],
  ["show", { arguments: 1, options: [] }],
  ["watch", { arguments: 1, options: [] }],
  ["events", { arguments: 0, options: ["after", "follow"] }],
  ["errors", { arguments: 2, options: [] }],
  ["commissions", { arguments: 0, options: [] }],
  ["engines", { arguments: 0, options: [] }],
  ["run", { arguments: 0, options: ["parallel"] }],
  ["decide", { arguments: 2, options: ["subject", "since", "feedback", "feedback-file"] }],
  ["cancel", { arguments: 1, options: [] }],
  ["renew", { arguments: 1, options: [] }],
  ["transcript", { arguments: 2, options: [] }],
  ["artifact", { arguments: 1, options: [] }],
  ["definition", { arguments: 1, options: [] }],
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
      trigger: text,
      subject: text,
      since: text,
      feedback: text,
      "feedback-file": text,
      parallel: text,
      after: text,
      follow: { type: "boolean" },
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
  args.length > spec.arguments ||
  args.length < spec.arguments - (spec.optional ?? 0) ||
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
  !/^[1-9]\d*$/.test(values.parallel ?? "1") ||
  !/^\d+$/.test(values.after ?? "0")
) {
  refuseUsage();
}

// Text given inline, or read from the file named.
const textOf = (inline?: string, file?: string) =>
  file === undefined ? inline : readFileSync(file, "utf8");

try {
  const body = textOf(values.body, values["body-file"]);
  const feedback = textOf(values.feedback, values["feedback-file"]);
  const { engine, workflows } = await openFactory(factory);

  const [first, second] = args;

  switch (command) {
    case "commission":
      // Named by its trigger when not given a name.
      printCommissioned(
        engine.commission(
          first,
          second,
          { title: values.title!, body: body! },
          { trigger: values.trigger },
        ),
      );
      break;
    case "advance":
      printState(await engine.advance(first));
      break;
    case "attend":
      printState(await engine.attend(first));
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
    case "check":
      check(engine, first === undefined ? workflows : [first], first !== undefined);
      break;
    case "cancel":
      engine.cancel(first);
      print(null, "");
      break;
    case "renew":
      engine.renew(first);
      print(null, "");
      break;
    case "show":
      printRecord(first, engine.record(first));
      break;
    case "watch":
      await watch(engine, first);
      break;
    case "events":
      await events(engine, Number(values.after ?? "0"), values.follow === true);
      break;
    case "transcript":
      printBytes(engine.transcript(first, Number(second)));
      break;
    case "errors":
      printBytes(engine.errors(first, Number(second)));
      break;
    case "artifact":
      printArtifact(engine.artifact(first));
      break;
    case "definition":
      printDefinition(engine.definition(first));
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
    case "engines": {
      const engines = engine.engines();

      print(
        engines,
        engines.length === 0
          ? "no engine is running\n"
          : engines
              .map(
                ({ host, pid, since, status }) =>
                  `${status.padEnd(8)}${host}  pid ${pid}  since ${new Date(since).toISOString()}\n`,
              )
              .join(""),
      );

      break;
    }

    case "run":
      await runner(engine, Number(values.parallel ?? "1"));
      break;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  process.stderr.write(visible(json ? `${JSON.stringify({ error: message })}\n` : `${message}\n`));
  process.exitCode = 1;
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
  | ({ workflow: string } | { workflow: string; error: string })[]
  | ReturnType<Engine["engines"]>
  | { stopping: { commission: string; step: string }[] }
  | { commission: string; state: CommissionState }
  | { commission: string }
  | Logged
  | Definition;

// One event as the log holds it, with its commission and its position in the log.
type Logged = ReturnType<Engine["events"]>[number];

function print(result: Printed, readable: string): void {
  process.stdout.write(visible(json ? `${JSON.stringify(result)}\n` : readable));
}

// The name of the commission just made, which a trigger's caller follows it by.
function printCommissioned(commission: string): void {
  print({ commission }, `${commission}\n`);
}

// The definition as JSON for people too: it is data, and its every field matters.
function printDefinition(definition: Definition): void {
  print(definition, `${JSON.stringify(definition, null, 2)}\n`);
}

// A step's bytes, as written to a file or program; on a terminal, as text with its controls visible.
function printBytes(bytes: Buffer): void {
  process.stdout.write(process.stdout.isTTY ? visible(new TextDecoder().decode(bytes)) : bytes);
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
async function runner(engine: Engine, parallel: number): Promise<void> {
  const advancing = new Map<string, Promise<void>>();

  // The commissions whose advance may start a step, which the limit counts.
  const stepping = new Set<string>();

  // Aborted by the first stop, so each advance returns once its running step ends.
  const stopping = new AbortController();

  // Listed by engines while it runs; a runner that dies without withdrawing is listed as dead.
  const withdraw = engine.register();

  print({ parallel }, `running at most ${parallel} steps in parallel\n`);

  const stop = () => {
    if (stopping.signal.aborted) {
      withdraw();
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

  // Says once that a commission is ready at an attended step, which only the owner starts.
  const toAttend = new Set<string>();

  const report = (commission: string, error: string) => {
    process.stderr.write(
      visible(json ? `${JSON.stringify({ commission, error })}\n` : `${commission}: ${error}\n`),
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

  // The log position the runner has looked up to.
  let position = 0;

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

      if (state.status === "ready" && state.step.kind === "agent" && state.step.attended) {
        if (!toAttend.has(commission)) {
          toAttend.add(commission);
          print({ commission, state }, `${commission}: ${describe(state)}\n`);
        }

        continue;
      }

      toAttend.delete(commission);

      if (state.status === "attempting") {
        advance(commission, false);
      } else if (state.status === "ready" && stepping.size < parallel) {
        advance(commission, true);
      }
    }

    // Woken by the next event in the log, or after a second at most: an attempt whose engine
    // died writes nothing, and the runner escalates it only when it looks.
    const look = new AbortController();

    await Promise.race([
      engine.next(position, { signal: look.signal }).then((found) => {
        position = found.at(-1)?.position ?? position;
      }),
      sleep(1000),
    ]);
    look.abort();
  }

  await Promise.all(advancing.values());
  withdraw();
}

/**
 * Checks each of `workflows` as commissioning would, printing whether it passed or why not; one
 * named alone prints, with --json, the definition it would be commissioned with. Exits 1 if any
 * failed, so a hook or CI can gate on it.
 */
function check(engine: Engine, workflows: readonly string[], named: boolean): void {
  if (named && json) {
    printDefinition(engine.check(workflows[0]!));

    return;
  }

  const results = workflows.map((workflow) => {
    try {
      engine.check(workflow);

      return { workflow };
    } catch (error) {
      return { workflow, error: error instanceof Error ? error.message : String(error) };
    }
  });

  print(
    results,
    results
      .map((result) => `${result.workflow}: ${"error" in result ? result.error : "ok"}\n`)
      .join(""),
  );

  if (results.some((result) => "error" in result)) {
    process.exitCode = 1;
  }
}

function printArtifact(artifact: Artifact): void {
  const fields = Object.entries(artifact.fields).map(([name, value]) => `${name}: ${value}`);
  const body = artifact.body === undefined ? [] : ["", artifact.body];

  print(artifact, `${[artifact.kind, ...fields, ...body].join("\n")}\n`);
}

// Follows the commission, printing each attempt, note, escalation and decision once, as the log
// records it, until the commission awaits the owner, escalates or finishes.
async function watch(engine: Engine, commission: string): Promise<void> {
  const printed = new Set<string>();

  // lazy: the latest position is found by reading the whole log once. Read it from the log's
  // end instead once a log grows large enough to make watch slow to start.
  let position = engine.events(0).at(-1)?.position ?? 0;

  for (;;) {
    const record = engine.record(commission);

    for (const [index, entry] of record.entries.entries()) {
      for (const [key, text] of linesOf(index, entry)) {
        if (!printed.has(key)) {
          printed.add(key);

          if (!json) {
            process.stdout.write(visible(`${text}\n`));
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

    // Woken by the next event in the log, any commission's, and looks again.
    position = (await engine.next(position)).at(-1)!.position;
  }
}

/**
 * Prints every commission's events after `position`, one line each; `follow`ing, then each event
 * as it is written, until stopped.
 */
async function events(engine: Engine, position: number, follow: boolean): Promise<void> {
  const stopping = new AbortController();

  process.on("SIGINT", () => stopping.abort());
  process.on("SIGTERM", () => stopping.abort());

  let found = engine.events(position);

  for (;;) {
    for (const logged of found) {
      print(logged, `${logged.position} ${logged.commission} ${eventLine(logged.event)}\n`);
      position = logged.position;
    }

    if (!follow || stopping.signal.aborted) {
      return;
    }

    found = await engine.next(position, { signal: stopping.signal });
  }
}

// An event in a few words: its type, and the step, outcome, note or reason it carries.
function eventLine(event: Logged["event"]): string {
  switch (event.type) {
    case "commissioned":
      return event.type;
    case "attempt-started":
      return `${event.type} ${event.step}`;
    case "attempt-completed":
    case "decided":
      return `${event.type} ${event.step}: ${event.outcome}`;
    case "noted":
      return `${event.type}: ${event.from === "engine" ? "engine: " : ""}${event.note}`;
    case "escalated":
    case "withdrawn":
      return `${event.type}: ${event.reason}`;
  }
}

// The record for the owner: where the commission is, every entry in order, and then what it is
// about now with every judgement about that, in full, as an owner reads at a gate.
function printRecord(commission: string, record: CommissionRecord): void {
  const { state, request, entries, origin } = record;

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
    ...(origin === undefined
      ? []
      : origin.from === undefined
        ? [`Started by trigger ${origin.trigger}.`]
        : [
            `Started by trigger ${origin.trigger}, from commission ${origin.from.commission}'s step ${origin.from.step}, attempt ${origin.from.attempt}.`,
          ]),
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
