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
import { readFileSync } from "node:fs";
import { join } from "node:path";

// What the adapter reads from input.json; the engine writes the rest for the agent to read.
type Given = { outcomes: string[]; agent: { model: string; prompt: string } };

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

const contract = `You are a step in a workflow. Your inputs are in ${input}: input.json lists them,
and each body is the file beside it that its "body" names.

When you are done, write ${join(output, "output.json")} as JSON:
{"outcome": one of ${JSON.stringify(given.outcomes)}, "artifacts": [...]}.
Leave out "artifacts" to claim none. To claim a document, which becomes what the workflow is about,
write its body as a file in ${output} and add
{"kind": "document", "fields": {"title": "..."}, "body": "<its path relative to ${output}>"}.
To claim a commit instead, commit in your working directory and add
{"kind": "commit", "fields": {"sha": "<the full SHA of HEAD>"}}.`;

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
  { stdio: ["ignore", "inherit", "inherit"] },
);

const closed = await once(claude, "close").catch((error: NodeJS.ErrnoException) => error);

if (closed instanceof Error) {
  console.error(`claude could not start: ${closed.code}.`);
  process.exitCode = 127;
} else {
  const [code] = closed;

  // A claude ended by a signal has no exit code; the attempt failed all the same.
  process.exitCode = code ?? 1;
}
