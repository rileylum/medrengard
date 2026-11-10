/**
 * What every harness adapter shares: reading the step contract's input, the contract as prompt
 * text for the agent, and writing notes, problems and usage reports as the contract defines them.
 * Vendor concepts stay in each adapter.
 */
import { readFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { input, output, readInput, type Input, type Rules } from "../step/contract.ts";

export { input, output, reportUsage } from "../step/contract.ts";

/** The part of a kind an adapter explains to the agent. */
export type Kind = Rules;

/** An agent step's input.json, which always says whether it is attended and names its agent. */
export type Given = Input & { attended: boolean; agent: NonNullable<Input["agent"]> };

/** The step's input.json. */
export function readGiven(): Given {
  // SAFETY: the engine encodes an agent step's input.json with attended and agent.
  return readInput() as Given;
}

// One line per field, saying what the claim's fields must hold.
const fieldsOf = (kind: Kind) =>
  Object.entries(kind.fields).map(
    ([field, { limit, required, values }]) =>
      `  - "${field}": ${required ? "required" : "optional"}, ${values ? `one of ${JSON.stringify(values)}` : `text of at most ${limit} bytes`}.`,
  );

const bodyOf = (kind: Kind) =>
  `  - "body": ${kind.body.required ? "required" : "optional"}, the path of a UTF-8 file you wrote in ${output}, relative to it, of at most ${kind.body.limit} bytes.`;

/**
 * The agent's prompt, then the step contract as text: where its inputs are and how to claim, for
 * only the kinds the step may claim, then `attended`, how it works with the owner when it does,
 * and that it continues an earlier conversation when it does.
 */
export function promptOf(given: Given, attended = ""): string {
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
Leave out "artifacts" to claim none. ${claiming}${attended}`;

  // A resumed agent remembers files its workspace may no longer hold: the workspace and the
  // conversation are two continuities, and only the commit carries the first.
  const resumed =
    continuedOf(given) === undefined
      ? ""
      : `

You are continuing your earlier conversation, now as this step. Your workspace was rebuilt from
the latest commit, so anything you did not commit is gone: check a file before you rely on it.`;

  return `${given.agent.prompt}\n\n${contract}${resumed}`;
}

/**
 * The session the step declared to continue, if an earlier attempt left one: an input listed
 * without a kind. More than one fails the attempt.
 */
export function continuedOf(given: Given): { hash: string; body?: string } | undefined {
  const continued = Object.values(given.inputs)
    .flat()
    .filter((listed) => !("kind" in listed));

  if (continued.length > 1) {
    failed(`An agent continues at most one session; its inputs hold ${continued.length}.`);
  }

  return continued[0];
}

// The longest note an adapter writes; a longer message is cut, and says so with "…".
const noteLength = 200;

/** Writes one note for the owner to fd 3, the step contract's notes. */
export function note(text: string): void {
  const line = text.replace(/\s+/g, " ").trim();

  if (line !== "") {
    writeSync(3, `${line.length > noteLength ? `${line.slice(0, noteLength - 1)}…` : line}\n`);
  }
}

/** Records a problem on stderr, as the attempt's errors, and in a note for the owner. */
export function report(problem: string): void {
  console.error(problem);
  note(problem);
}

/** Says why the attempt cannot run, and ends it. */
export function failed(why: string): never {
  report(why);
  process.exit(1);
}

/** Tokens as the step contract's usage report counts them. */
export type Counted = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** A usage report, as the step contract defines it: money, when the harness says, and tokens. */
export type Usage = { usd?: number; tokens: Counted };

/**
 * How an adapter keeps a session for the record: the conversation its harness wrote, with the
 * harness and session it belongs to, so a later attempt can continue it, and refuse another
 * harness's.
 */
export type Kept = { harness: string; version?: string; id: string; conversation: string };

/**
 * The session the step continues, as `harness` kept it, or the attempt fails: one that cannot be
 * read, or another harness's, is never started afresh instead.
 */
export function keptOf(continued: { body?: string }, harness: string, named: string): Kept {
  let kept: Kept;

  try {
    // SAFETY: an adapter's session is opaque to the engine; this one's is a Kept, checked below.
    kept = JSON.parse(readFileSync(join(input, continued.body!), "utf8")) as Kept;
  } catch (error) {
    return failed(
      `The session to continue cannot be read: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }

  if (kept.harness !== harness) {
    return failed(`The session to continue is ${kept.harness}'s, not ${named}'s.`);
  }

  return kept;
}
