/**
 * The Claude Code harness adapter: runs the step's agent through `claude -p` and exits as it does.
 * The agent writes the claim itself, so the engine judges it like any step's.
 *
 * Usage: claude-code.ts [--permission-mode acceptEdits|bypassPermissions]
 *
 * acceptEdits, the default, lets the agent edit files but not run commands. bypassPermissions
 * lets it do anything its step's access allows, so the sandbox is its only boundary.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync, writeSync } from "node:fs";
import { join } from "node:path";

// The part of a kind the adapter explains to the agent.
type Kind = {
  description: string;
  fields: Record<string, { limit: number; required?: true; values?: string[] }>;
  body: { required: boolean; limit: number };
  outcome?: string;
};

// What the adapter reads from input.json; the engine writes the rest for the agent to read.
type Given = {
  outcomes: string[];
  claims: Record<string, Kind>;
  agent: { model: string; prompt: string };
};

const input = process.env.MEDRENGARD_IN!;
const output = process.env.MEDRENGARD_OUT!;

const modes = ["acceptEdits", "bypassPermissions"];
const args = process.argv.slice(2);
const mode = args.length === 0 ? "acceptEdits" : args[1];

if (!(args.length === 0 || (args.length === 2 && args[0] === "--permission-mode"))) {
  console.error("Usage: claude-code.ts [--permission-mode acceptEdits|bypassPermissions]");
  process.exit(2);
}

if (!modes.includes(mode)) {
  console.error(`The permission mode must be one of ${modes.join(", ")}, not ${mode}.`);
  process.exit(2);
}

// SAFETY: the engine encodes input.json for an agent step with these fields.
const given = JSON.parse(readFileSync(join(input, "input.json"), "utf8")) as Given;

// One line per field, saying what the claim's fields must hold.
const fieldsOf = (kind: Kind) =>
  Object.entries(kind.fields).map(
    ([field, { limit, required, values }]) =>
      `  - "${field}": ${required ? "required" : "optional"}, ${values ? `one of ${JSON.stringify(values)}` : `text of at most ${limit} bytes`}.`,
  );

const bodyOf = (kind: Kind) =>
  `  - "body": ${kind.body.required ? "required" : "optional"}, the path of a UTF-8 file you wrote in ${output}, relative to it, of at most ${kind.body.limit} bytes.`;

// Only the kinds the step may claim, so the agent is not told how to claim what it must not.
const kinds = Object.entries(given.claims).map(([name, kind]) =>
  [
    `- ${JSON.stringify(name)}: ${kind.description}`,
    ...fieldsOf(kind),
    bodyOf(kind),
    ...(kind.outcome === undefined ? [] : [`  Its "${kind.outcome}" must equal your outcome.`]),
  ].join("\n"),
);

const claiming =
  kinds.length === 0
    ? "Claim no artifacts."
    : `Each artifact is {"kind": ..., "fields": {...}, "body": ...}, of one of these kinds:\n${kinds.join("\n")}`;

const contract = `You are a step in a workflow. Your inputs are in ${input}: input.json lists each
input's artifacts, and each body is the file its "body" names, relative to ${input}.

When you are done, write ${join(output, "output.json")} as JSON:
{"outcome": one of ${JSON.stringify(given.outcomes)}, "artifacts": [...]}.
Leave out "artifacts" to claim none. ${claiming}`;

// Streamed, so the engine sees output while the agent works; plain -p prints only at the end, which
// the idle limit would stop.
const claude = spawn(
  "claude",
  [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    mode,
    // Before --model, which ends this list of directories.
    "--add-dir",
    input,
    output,
    "--model",
    given.agent.model,
    `${given.agent.prompt}\n\n${contract}`,
  ],
  // stdout is read, to note what the agent does, and passed on unchanged as the transcript.
  { stdio: ["ignore", "pipe", "inherit"] },
);

// The longest note the adapter writes; a longer message is cut, and says so with "…".
const noteLength = 200;

// Writes one note for the owner to fd 3, the step contract's notes.
function note(text: string): void {
  const line = text.replace(/\s+/g, " ").trim();

  if (line !== "") {
    writeSync(3, `${line.length > noteLength ? `${line.slice(0, noteLength - 1)}…` : line}\n`);
  }
}

// The parts of a tool's input that say what it did, as Claude Code's tools name them.
type ToolInput = {
  command?: string;
  file_path?: string;
  pattern?: string;
  path?: string;
  description?: string;
};

// A tool call as a note: the tool, and its command, file or pattern.
function toolNote(name: string, input: ToolInput): string {
  const said = input.command ?? input.file_path ?? input.pattern ?? input.path ?? input.description;

  return `${name}: ${said ?? JSON.stringify(input)}`;
}

// One stream-json event: what the agent said, each tool it called, and how the run finished.
// lazy: only the event fields the notes need; the transcript keeps the rest.
type StreamEvent = {
  type?: string;
  message?: {
    content?: { type: string; text?: string; name?: string; input?: ToolInput }[];
  };
  is_error?: boolean;
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
};

function notesOf(event: StreamEvent): void {
  if (event.type === "assistant") {
    for (const block of event.message?.content ?? []) {
      if (block.type === "text" && block.text !== undefined) {
        note(block.text);
      } else if (block.type === "tool_use" && block.name !== undefined) {
        note(toolNote(block.name, block.input ?? {}));
      }
    }
  }

  if (event.type === "result") {
    const how = event.is_error ? "Failed" : "Finished";

    note(
      `${how} in ${(event.duration_ms ?? 0) / 1000} s, ${event.num_turns} turns, $${event.total_cost_usd}.`,
    );
  }
}

let partial = "";

claude.stdout.on("data", (chunk: Buffer) => {
  process.stdout.write(chunk);

  const lines = (partial + chunk.toString()).split("\n");

  partial = lines.pop()!;

  for (const line of lines) {
    let event;

    try {
      event = JSON.parse(line);
    } catch {
      // Not stream-json, such as a warning: the transcript has it, and it is no note.
      continue;
    }

    notesOf(event);
  }
});

const closed = await once(claude, "close").catch((error: NodeJS.ErrnoException) => error);

if (closed instanceof Error) {
  console.error(`claude could not start: ${closed.code}.`);
  process.exitCode = 127;
} else {
  const [code] = closed;

  // A claude ended by a signal has no exit code; the attempt failed all the same.
  process.exitCode = code ?? 1;
}
