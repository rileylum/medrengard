/**
 * The step contract for a step's program written in TypeScript: reading its input, claiming its
 * outcome and artifacts, and writing notes and usage reports. A convenience over the contract's
 * files and descriptors, which a program in any language can use as they are. It imports nothing
 * of the engine's, so a step's access needs only this directory to run it.
 */
import { readFileSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

/** The step's input and output directories, as the engine names them. */
export const input = process.env.MEDRENGARD_IN!;
export const output = process.env.MEDRENGARD_OUT!;

/**
 * An artifact as input.json lists it: its body, when it has one, a path relative to the input;
 * the commission it came from, for a child's or a related commission's; and its branch, when the
 * workspace added it as one.
 */
export type Artifact = {
  hash: string;
  kind: string;
  fields: Record<string, string>;
  body?: string;
  commission?: string;
  branch?: string;
};

/** A session as input.json lists it, under the input a session query names: no artifact. */
export type Session = { hash: string; body: string };

/** What a claim of a kind holds, as input.json gives its rules. */
export type Rules = {
  description: string;
  fields: Record<string, { limit: number; required?: true; values?: string[] }>;
  body: { required: boolean; limit: number };
  outcome?: string;
};

/** input.json: `attended` and `agent` are there for an agent step alone. */
export type Input = {
  commission: string;
  step: string;
  attempt: number;
  outcomes: string[];
  // The escalation that routed the commission to this step, if one did: the step it left, its
  // attempt, and why.
  routed?: { step: string; attempt: number; cause: string; reason: string };
  inputs: Record<string, (Artifact | Session)[]>;
  claims: Record<string, Rules>;
  attended?: boolean;
  agent?: { model: string; prompt: string; skills: { name: string; path: string }[] };
};

/** The step's input.json. */
export function readInput(): Input {
  // SAFETY: the engine encodes input.json with these fields.
  return JSON.parse(readFileSync(join(input, "input.json"), "utf8")) as Input;
}

/** The artifacts the input `name` holds, oldest first; none for an input the step lacks. */
export function artifactsOf(given: Input, name: string): Artifact[] {
  return (given.inputs[name] ?? []).filter((listed) => "kind" in listed);
}

/** An artifact's or session's body as text, or undefined when it has none. */
export function bodyOf(listed: { body?: string }): string | undefined {
  return listed.body === undefined ? undefined : readFileSync(join(input, listed.body), "utf8");
}

/**
 * An artifact to claim: its body the path of a file the step wrote in its output, relative to it,
 * or `text` for this to write there; or one of the step's inputs to adopt, by its hash.
 */
export type Claimed =
  | { kind: string; fields?: Record<string, string>; body?: string; text?: string }
  | { adopt: string };

/** Writes output.json: the step's one outcome and the artifacts it claims, in order. */
export function claim(outcome: string, artifacts: readonly Claimed[] = []): void {
  const written = artifacts.map((artifact, index) => {
    if ("adopt" in artifact) {
      return artifact;
    }

    const { kind, fields = {}, body, text } = artifact;

    if (text === undefined) {
      return body === undefined ? { kind, fields } : { kind, fields, body };
    }

    writeFileSync(join(output, `body-${index + 1}`), text);

    return { kind, fields, body: `body-${index + 1}` };
  });

  writeFileSync(join(output, "output.json"), JSON.stringify({ outcome, artifacts: written }));
}

/** Writes one note for the owner to fd 3, on one line. */
export function note(text: string): void {
  const line = text.replace(/\s+/g, " ").trim();

  if (line !== "") {
    writeSync(3, `${line}\n`);
  }
}

/** Says on stderr why the step cannot do its work, and ends it, so the commission escalates. */
export function failed(why: string): never {
  console.error(why);
  process.exit(1);
}

/** A usage report: money in US dollars, when the step knows it, and tokens. */
export type Usage = {
  usd?: number;
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

/** Writes what the attempt has used so far to fd 4: the latest report stands. */
export function reportUsage(usage: Usage): void {
  writeSync(4, `${JSON.stringify(usage)}\n`);
}
