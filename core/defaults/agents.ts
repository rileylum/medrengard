/**
 * Agents as markdown files: frontmatter that names the agent's harness, model and skills, and a
 * body that is its prompt. The factory reads them when it loads, so a commission's definition
 * holds the text, pinned, and editing a file affects only new commissions.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Agent } from "../src/replay.ts";

const keyed = /^([a-z]+):(?: (.*))?$/;

const item = /^ {2}- (.+)$/;

const known = ["harness", "model", "skills"];

/**
 * The agent the markdown file at `path` defines, its harness one of `harnesses` by name. The
 * frontmatter states `harness`, `model` and optionally `skills`, as `- path` lines relative to the
 * file; each value is plain text. Anything else throws, naming the file and line.
 */
export function agent(path: string, harnesses: Readonly<Record<string, Agent["harness"]>>): Agent {
  const invalid = (problem: string) => new Error(`Agent file ${path} is invalid: ${problem}.`);
  const lines = readFileSync(path, "utf8").split("\n");

  if (lines[0] !== "---") {
    throw invalid("it must start with --- and its frontmatter");
  }

  // Checked in the file's order: a line's problem before a missing end. Without an end, the
  // frontmatter runs to the file's last line, not the empty text after its final newline.
  const end = lines.indexOf("---", 1);
  const last = end !== -1 ? end : lines.at(-1) === "" ? lines.length - 1 : lines.length;

  const stated = new Map<string, string>();
  const skills: string[] = [];

  // `listing` is the line of a key with no value, which only skills may be, until its items end.
  let listing: number | undefined;

  for (const [index, line] of lines.slice(1, last).entries()) {
    const number = index + 2;
    const listed = item.exec(line);

    if (listed !== null && listing !== undefined) {
      skills.push(listed[1]);
      continue;
    }

    const [, key, value] = keyed.exec(line) ?? [];

    if (key === undefined) {
      throw invalid(`line ${number} must be key: value`);
    }

    if (!known.includes(key)) {
      throw invalid(`line ${number} states ${key}, which an agent file does not define`);
    }

    if (stated.has(key)) {
      throw invalid(`line ${number} states ${key} again`);
    }

    if (value === undefined && key !== "skills") {
      throw invalid(`line ${number}: only skills is a list`);
    }

    if (value !== undefined && /^["'[{]/.test(value)) {
      throw invalid(`line ${number}'s value must be plain text, without quotes or brackets`);
    }

    stated.set(key, value ?? "");
    listing = value === undefined ? number : undefined;
  }

  if (end === -1) {
    throw invalid("its frontmatter must end with ---");
  }

  for (const required of ["harness", "model"]) {
    if (!stated.has(required)) {
      throw invalid(`its frontmatter must state ${required}`);
    }
  }

  const named = stated.get("harness")!;

  if (!Object.hasOwn(harnesses, named)) {
    throw invalid(`its harness ${named} is not one of ${Object.keys(harnesses).join(", ")}`);
  }

  const found = {
    harness: harnesses[named],
    model: stated.get("model")!,
    prompt: lines.slice(end + 1).join("\n"),
  };

  return stated.has("skills")
    ? { ...found, skills: skills.map((skill) => resolve(dirname(path), skill)) }
    : found;
}
