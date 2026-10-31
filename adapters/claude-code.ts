/**
 * The Claude Code harness adapter: runs the step's agent through `claude -p` and exits as it does.
 * The agent writes the claim itself, so the engine judges it like any step's.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// What the adapter reads from input.json; the engine writes the rest for the agent to read.
type Given = { outcomes: string[]; agent: { model: string; prompt: string } };

const input = process.env.MEDRENGARD_IN!;
const output = process.env.MEDRENGARD_OUT!;

// SAFETY: the engine encodes input.json for an agent step with these fields.
const given = JSON.parse(readFileSync(join(input, "input.json"), "utf8")) as Given;

const contract = `You are a step in a workflow. Your inputs are in ${input}: input.json lists them,
and each body is the file beside it that its "body" names.

When you are done, write ${join(output, "output.json")} as JSON:
{"outcome": one of ${JSON.stringify(given.outcomes)}, "artifacts": [...]}.
Leave out "artifacts" to claim none. To claim a document, which becomes what the workflow is about,
write its body as a file in ${output} and add
{"kind": "document", "fields": {"title": "..."}, "body": "<its path relative to ${output}>"}.`;

// Streamed, so the engine sees output while the agent works; plain -p prints only at the end, which
// the idle limit would stop.
const claude = spawn(
  "claude",
  [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
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
