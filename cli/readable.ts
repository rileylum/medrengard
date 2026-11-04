/**
 * The record as the owner reads it in a terminal, shared by the CLI and the TUI: every text a
 * step wrote passes through `visible` before it reaches the owner's terminal.
 */
import type { Entry } from "../src/engine.ts";
import type { CommissionState } from "../src/replay.ts";
import type { Artifact } from "../src/store.ts";

/**
 * `text` with each control character written as \uXXXX: visible to the owner, and in JSON, where
 * they can only stand inside a string, the same value.
 */
export function visible(text: string): string {
  return Array.from(text, (character) => {
    const code = character.charCodeAt(0);

    return isControl(code) ? `\\u${code.toString(16).padStart(4, "0")}` : character;
  }).join("");
}

// What a terminal acts on rather than shows: C0 controls but newline and tab, DEL, C1 controls and
// the bidi controls. A step's text can hold any of them, and could move the cursor, rewrite what
// the owner reads at a gate, set the clipboard or reorder a line.
function isControl(code: number): boolean {
  return (
    (code < 0x20 && code !== 0x0a && code !== 0x09) ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/** A state in a few lines: where the commission is and what it is about. */
export function describe(state: CommissionState): string {
  if (state.status === "finished") {
    return `finished by ${state.by}`;
  }

  return [
    `${state.status} at ${state.step.name}${waiting(state)}, about ${state.subject}`,
    ...(state.status === "escalated" ? [`reason: ${state.reason}`] : []),
    ...(state.decision === undefined ? [] : [`decision: ${state.decision}`]),
  ].join("\n");
}

/**
 * The event a waiting commission has waited since, which a decision names; or that the owner is
 * to attend the step it is ready at.
 */
export function waiting(state: CommissionState): string {
  if (state.status === "ready" && state.step.kind === "agent" && state.step.attended) {
    return ", to attend";
  }

  return state.status === "awaiting" || state.status === "escalated"
    ? ` since event ${state.since}`
    : "";
}

/** Where the commission is, in a few words. */
export function where(state: CommissionState): string {
  return state.status === "finished"
    ? `finished by ${state.by}`
    : `${state.status} at ${state.step.name}`;
}

/** An artifact on one line: `label`, the start of its hash, and its fields but the subject. */
export function line(label: string, hash: string, artifact: Artifact): string {
  const fields = Object.entries(artifact.fields)
    .filter(([name]) => name !== "subject")
    .map(([, value]) => value);

  return [label.padEnd(8), hash.slice(0, 8), ...fields].join("  ");
}

/** An artifact in full, under a heading and the verifier that accepted it. */
export function full(hash: string, artifact: Artifact, verifier: readonly string[] | null): string {
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

/**
 * The lines for an entry in the record, each with a key that names it, so a follower prints each
 * once: an attempt's start, each of its notes, and its ending; or an escalation or a decision. An
 * attempt that wrote to stderr says how to read it: `errors` of its number.
 */
export function linesOf(
  index: number,
  entry: Entry,
  errors = (attempt: number) => `medrengard errors <commission> ${attempt}`,
): [string, string][] {
  const at = entry.step.padEnd(12);

  switch (entry.entry) {
    case "attempt": {
      const number = String(entry.attempt).padEnd(2);
      const start: [string, string] = [`${index}:start`, `${number}${at} started`];

      const notes = entry.notes.map(({ note, from }, n): [string, string] => [
        `${index}:${n}`,
        `     ${from === "engine" ? "engine: " : ""}${note}`,
      ]);

      if ("running" in entry) {
        return [start, ...notes];
      }

      const read = entry.errors ? `  (errors: ${errors(entry.attempt)})` : "";

      // Left out for an attempt the log has no times for.
      const took =
        entry.started === undefined || entry.ended === undefined
          ? ""
          : ` (${((entry.ended - entry.started) / 1000).toFixed(1)} s)`;

      const ending =
        "escalated" in entry
          ? `${number}${at} escalated${took}: ${entry.escalated}${read}`
          : [
              `${number}${at} ${entry.outcome}${took}${read}`,
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
