import type { Definition, Workflow } from "./definition.ts";
import type { Kinds } from "./kinds.ts";

// workflow is the definition's name; definition is the hash of the definition as it was when the
// commission started, which the commission runs on. request is the hash of the owner's request,
// the commission's first subject.
// engine is the version of the engine that commissioned it, as attempt-started's.
// A child commission names its parent, the commission, step and attempt that commissioned it, and
// the artifacts it was given, by hash with their kinds and kept files: the latest subject among
// them is its first subject. One a trigger started names it as its origin, with the commission,
// step and attempt that started it through the trigger, if one did; the owner's has none.
export type Commissioned = {
  type: "commissioned";
  workflow: string;
  definition: string;
  request: string;
  engine?: string;
  origin?: { trigger: string; from?: { commission: string; step: string; attempt: number } };
  parent?: { commission: string; step: string; attempt: number };
  given?: readonly { hash: string; kind: string; kept: Readonly<Record<string, string>> }[];
};

// subject and inputs name what the attempt was given, by hash: each input's artifacts, oldest
// first, inputs in the order declared.
// process names the engine process running the attempt, so another engine can tell a live
// attempt from an interrupted one: its pid and start time, within the boot named by boot (absent
// in events written before it was recorded). Every engine on one log shares a pid namespace.
type AttemptStarted<N extends string> = {
  type: "attempt-started";
  step: N;
  attempt: number;
  subject: string;
  inputs: readonly { name: string; hashes: readonly string[] }[];
  process: { pid: number; start: number; boot?: string };
  // The version of the engine that ran it: a hash of its source, absent in events written before
  // engines recorded it. A commission runs on the engine it last ran on, or escalates.
  engine?: string;
};

/**
 * What an attempt's step reported it used, its latest report on fd 4: money in US dollars and
 * tokens, as its harness counts them. The step's claim; nothing verifies it.
 */
export type Usage = {
  usd?: number;
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

// artifacts are the artifacts the attempt claimed, in the order claimed, each with its kind, so a
// query can select by kind without the store, and the files its verifier kept, by name; transcript
// is the hash of its stdout and stderr, and errors of its stderr alone, when it wrote any; usage
// is its step's latest report, when it made one.
type AttemptCompleted<N extends string> = {
  type: "attempt-completed";
  step: N;
  attempt: number;
  outcome: string;
  artifacts: readonly { hash: string; kind: string; kept: Readonly<Record<string, string>> }[];
  transcript: string;
  errors?: string;
  usage?: Usage;
  // The session its program left in its output, by hash, when it left one.
  session?: string;
  next: N | "end";
};

// lazy: reason is free text for the owner. When an observer needs to group escalations,
// add a closed set of causes beside it; the text stays, as the why.
// transcript and errors are there when the attempt's program ran, errors only when it wrote to
// stderr; an interrupted attempt's are what it wrote before its engine died. usage is as on
// attempt-completed.
type Escalated = {
  type: "escalated";
  reason: string;
  attempt?: number;
  transcript?: string;
  errors?: string;
  usage?: Usage;
  session?: string;
  // When it escalated because this engine is not the one the commission last ran on: this
  // engine's version, which the owner's decision on it accepts.
  engine?: string;
};

// note is one line for the owner, recorded as it arrives: one the attempt's program wrote to fd 3,
// or, from the engine, what an attended step's output holds.
type Noted = { type: "noted"; attempt: number; note: string; from?: "engine" };

// A child commission its parent no longer waits for, finished by the engine, not the owner.
type Withdrawn = { type: "withdrawn"; reason: string };

// decision and subject are artifact hashes; any feedback lives in the decision artifact.
type Decided<N extends string> = {
  type: "decided";
  step: N;
  decision: string;
  outcome: string;
  subject: string;
  next: N | "end";
};

// at is when the engine wrote the event, in milliseconds since the epoch; an event written before
// events carried times has none.
export type CommissionEvent<N extends string = string> = (
  | Commissioned
  | AttemptStarted<N>
  | AttemptCompleted<N>
  | Escalated
  | Noted
  | Decided<N>
  | Withdrawn
) & { at?: number };

// The agent or command step a commission is at; an attended one waits for the owner to attend it.
type At<N extends string> =
  | { name: N; kind: "command" }
  | { name: N; kind: "agent"; attended?: true }
  | { name: N; kind: "children" }
  | { name: N; kind: "commission" };

// decision is the owner's latest decision about the current subject; one about an earlier
// subject is history.
export type CommissionState<N extends string = string> =
  | {
      status: "ready";
      step: At<N>;
      subject: string;
      decision?: string;
    }
  | {
      status: "awaiting";
      step: { name: N; kind: "approval" };
      subject: string;
      decision?: string;
      since: number;
    }
  | {
      status: "attempting";
      step: At<N>;
      subject: string;
      decision?: string;
    }
  | {
      status: "escalated";
      step: At<N>;
      subject: string;
      decision?: string;
      reason: string;
      since: number;
    }
  | { status: "finished"; by: "end" | "abandoned" | "withdrawn" };

/** Rebuilds a commission's state from its workflow and its events. */
export function replay<N extends string>(
  { workflow, kinds }: Definition<N>,
  events: readonly [Commissioned, ...Exclude<CommissionEvent<NoInfer<N>>, Commissioned>[]],
): CommissionState<N> {
  const [{ request, given = [] }, ...rest] = events;

  // A child's first subject is the latest subject it was given, or its request.
  const subject = given.findLast(({ kind }) => kinds[kind]?.role === "subject")?.hash ?? request;

  let state = arrive(workflow, workflow.start, subject, undefined, 0);

  for (const [index, event] of rest.entries()) {
    state = apply(workflow, kinds, state, event, index + 1);
  }

  return state;
}

// position is the event's in the commission's log: an approval step waits since it.
function arrive<N extends string>(
  workflow: Workflow<N>,
  name: N,
  subject: string,
  decision: string | undefined,
  position: number,
): CommissionState<N> {
  const step = workflow.steps[name];
  const { kind } = step;

  if (kind === "approval") {
    return { status: "awaiting", step: { name, kind }, subject, decision, since: position };
  }

  const at: At<N> =
    kind === "agent" && step.attended === true
      ? { name, kind, attended: true }
      : kind === "children" || kind === "commission"
        ? { name, kind }
        : { name, kind };

  return { status: "ready", step: at, subject, decision };
}

function apply<N extends string>(
  workflow: Workflow<N>,
  kinds: Kinds,
  state: CommissionState<N>,
  event: Exclude<CommissionEvent<N>, Commissioned>,
  position: number,
): CommissionState<N> {
  // The engine replays each event before writing it, so these rules also keep the log valid.
  switch (event.type) {
    case "attempt-started":
      if (state.status !== "ready") {
        throw new Error(`An attempt cannot start while the commission is ${state.status}.`);
      }

      return { ...state, status: "attempting" };
    case "attempt-completed":
      if (state.status !== "attempting") {
        throw new Error(`An attempt cannot complete while the commission is ${state.status}.`);
      }

      if (event.next === "end") {
        return { status: "finished", by: "end" };
      }

      {
        // A judgement, such as a verdict, leaves the subject where it was.
        const subject = event.artifacts.findLast(({ kind }) => kinds[kind]?.role === "subject");

        if (subject !== undefined) {
          return arrive(workflow, event.next, subject.hash, undefined, position);
        }
      }

      return arrive(workflow, event.next, state.subject, state.decision, position);
    // A note says what an attempt in flight is doing; it changes nothing.
    case "noted":
      if (state.status !== "attempting") {
        throw new Error(`A note cannot arrive while the commission is ${state.status}.`);
      }

      return state;
    case "escalated":
      if (state.status !== "ready" && state.status !== "attempting") {
        throw new Error(`A commission cannot escalate while it is ${state.status}.`);
      }

      return { ...state, status: "escalated", reason: event.reason, since: position };
    case "decided":
      if (state.status !== "awaiting" && state.status !== "escalated") {
        throw new Error(`A decision cannot arrive while the commission is ${state.status}.`);
      }

      if (event.next === "end") {
        return { status: "finished", by: event.outcome === "abandon" ? "abandoned" : "end" };
      }

      return arrive(workflow, event.next, state.subject, event.decision, position);
    // An attempt in flight ends first, so its transcript is kept.
    case "withdrawn":
      if (state.status === "attempting" || state.status === "finished") {
        throw new Error(`A commission cannot be withdrawn while it is ${state.status}.`);
      }

      return { status: "finished", by: "withdrawn" };
    default:
      return assertNever(event);
  }
}

/** Fails at compile time when a switch misses a case, and at run time if one arrives anyway. */
function assertNever(value: never): never {
  throw new Error(`Unhandled ${JSON.stringify(value)}.`);
}
