/**
 * The record as the owner reads it in a terminal, shared by the CLI and the TUI: every text a
 * step wrote passes through `visible` before it reaches the owner's terminal.
 */
import type { Entry } from "../src/engine.ts";
import type { CommissionState, Usage } from "../src/replay.ts";
import type { Artifact } from "../src/store.ts";

export { visible } from "../src/reading.ts";

/** A state in a few lines: where the commission is and what it is about. */
export function describe(state: CommissionState): string {
  if (state.status === "finished") {
    return `finished by ${state.by}`;
  }

  return [
    `${state.status} at ${state.step.name}${waiting(state)}, about ${state.subject}`,
    ...(state.status === "escalated" && state.cause !== undefined ? [`cause: ${state.cause}`] : []),
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
// What an attempt's step reported it used: dollars to the cent, or to a hundredth of one below a
// cent, and every token counted, in thousands or millions.
function spentOf({ usd, tokens }: Usage): string {
  const dollars = usd === undefined ? [] : [`$${usd.toFixed(usd > 0 && usd < 0.01 ? 4 : 2)}`];

  const total =
    tokens === undefined
      ? undefined
      : tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;

  const counted =
    total === undefined
      ? []
      : [
          `${
            total < 1000
              ? total
              : total < 1_000_000
                ? `${(total / 1000).toFixed(1)}k`
                : `${(total / 1_000_000).toFixed(1)}M`
          } tokens`,
        ];

  return [...dollars, ...counted].join(", ");
}

export function linesOf(
  index: number,
  entry: Entry,
  // How the owner reads an attempt's errors where the lines are shown.
  errors: (attempt: number) => string,
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

      const spent = entry.usage === undefined ? "" : ` (${spentOf(entry.usage)})`;

      const ending =
        "escalated" in entry
          ? `${number}${at} escalated${took}${spent}: ${entry.escalated}${entry.next === undefined ? "" : ` On to ${entry.next}.`}${read}`
          : [
              `${number}${at} ${entry.outcome}${took}${spent}${read}`,
              ...entry.artifacts.map(
                ({ hash, artifact, verifier }) =>
                  `    ${line(artifact.kind, hash, artifact)}  ${verifier === null ? "(no verifier)" : "(verified)"}`,
              ),
            ].join("\n");

      return [start, ...notes, [`${index}:end`, ending]];
    }

    case "escalation":
      return [[`${index}`, `  ${at} escalated: ${entry.reason}`]];
    case "withdrawal":
      return [[`${index}`, `  ${at} withdrawn: ${entry.reason}`]];
    case "decision": {
      const feedback = entry.feedback === undefined ? "" : `: ${JSON.stringify(entry.feedback)}`;

      return [[`${index}`, `  ${at} ${entry.outcome}${feedback}`]];
    }
  }
}
