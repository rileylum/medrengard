/** A position in the commission a step can be given as an input: its current subject. */
export type Input = "subject";

/**
 * A command step runs `run`, given `inputs`, and follows the edge its outcome names in `on`,
 * starting at most `budget` attempts between the owner's decisions. An attempt is stopped when it
 * writes nothing to stdout or stderr for `limits.idle` seconds, or runs for `limits.attempt` seconds.
 */
type Step<N extends string> =
  | { kind: "agent" }
  | {
      kind: "command";
      inputs: readonly Input[];
      run: readonly [string, ...string[]];
      on: Record<string, N | "end">;
      budget: number;
      limits: { idle: number; attempt: number };
    }
  | { kind: "approval"; on: Record<string, N | "end"> };

/** A workflow over its step names `N`; `start` must name one of its steps, and `end` is reserved. */
export type Workflow<N extends string = string> = {
  start: NoInfer<N>;
  steps: { [K in N]: K extends "end" ? never : Step<NoInfer<N>> };
};

// lazy: workflow names the definition by key in the engine's workflows. When a commission
// must keep running after its definition is edited, record the definitions by hash instead.
// request is the hash of the owner's request, the commission's first subject.
export type Commissioned = { type: "commissioned"; workflow: string; request: string };

// process names the engine process running the attempt, so another engine can tell a live
// attempt from an interrupted one.
type AttemptStarted<N extends string> = {
  type: "attempt-started";
  step: N;
  attempt: number;
  process: { pid: number; start: number };
};

// artifacts are the hashes of the artifacts the attempt claimed, in the order claimed.
type AttemptCompleted<N extends string> = {
  type: "attempt-completed";
  step: N;
  attempt: number;
  outcome: string;
  artifacts: readonly string[];
  next: N | "end";
};

// lazy: reason is free text for the owner. When an observer needs to group escalations,
// add a closed set of causes beside it; the text stays, as the why.
type Escalated = { type: "escalated"; reason: string; attempt?: number };

// decision and subject are artifact hashes; any feedback lives in the decision artifact.
type Decided<N extends string> = {
  type: "decided";
  step: N;
  decision: string;
  outcome: string;
  subject: string;
  next: N | "end";
};

export type CommissionEvent<N extends string = string> =
  | Commissioned
  | AttemptStarted<N>
  | AttemptCompleted<N>
  | Escalated
  | Decided<N>;

export type CommissionState<N extends string = string> =
  | { status: "ready"; step: { name: N; kind: "agent" | "command" }; subject: string }
  | { status: "awaiting"; step: { name: N; kind: "approval" }; subject: string }
  | { status: "attempting"; step: { name: N; kind: "agent" | "command" }; subject: string }
  | {
      status: "escalated";
      step: { name: N; kind: "agent" | "command" };
      subject: string;
      reason: string;
    }
  | { status: "finished"; by: "end" | "abandoned" };

/** Declares a workflow, so the compiler checks that every step name it uses exists. */
export function defineWorkflow<N extends string>(workflow: Workflow<N>): Workflow<N> {
  return workflow;
}

/** Rebuilds a commission's state from its workflow and its events. */
export function replay<N extends string>(
  workflow: Workflow<N>,
  events: readonly [Commissioned, ...Exclude<CommissionEvent<NoInfer<N>>, Commissioned>[]],
): CommissionState<N> {
  const [{ request }, ...rest] = events;
  let state = arrive(workflow, workflow.start, request);

  for (const event of rest) {
    state = apply(workflow, state, event);
  }

  return state;
}

function arrive<N extends string>(
  workflow: Workflow<N>,
  name: N,
  subject: string,
): CommissionState<N> {
  const { kind } = workflow.steps[name];

  if (kind === "approval") {
    return { status: "awaiting", step: { name, kind }, subject };
  }

  return { status: "ready", step: { name, kind }, subject };
}

function apply<N extends string>(
  workflow: Workflow<N>,
  state: CommissionState<N>,
  event: Exclude<CommissionEvent<N>, Commissioned>,
): CommissionState<N> {
  // The engine replays each event before writing it, so these rules also keep the log valid.
  switch (event.type) {
    case "attempt-started":
      if (state.status !== "ready") {
        throw new Error(`An attempt cannot start while the commission is ${state.status}.`);
      }

      return { status: "attempting", step: state.step, subject: state.subject };
    case "attempt-completed":
      if (state.status !== "attempting") {
        throw new Error(`An attempt cannot complete while the commission is ${state.status}.`);
      }

      if (event.next === "end") {
        return { status: "finished", by: "end" };
      }

      // lazy: every kind a step can claim is a subject, so the last artifact claimed is the
      // subject. Record each artifact's role once a step can claim a judgement.
      return arrive(workflow, event.next, event.artifacts.at(-1) ?? state.subject);
    case "escalated":
      if (state.status !== "ready" && state.status !== "attempting") {
        throw new Error(`A commission cannot escalate while it is ${state.status}.`);
      }

      return {
        status: "escalated",
        step: state.step,
        subject: state.subject,
        reason: event.reason,
      };
    case "decided":
      if (state.status !== "awaiting" && state.status !== "escalated") {
        throw new Error(`A decision cannot arrive while the commission is ${state.status}.`);
      }

      if (event.next === "end") {
        return { status: "finished", by: state.status === "escalated" ? "abandoned" : "end" };
      }

      return arrive(workflow, event.next, state.subject);
    default:
      return assertNever(event);
  }
}

/** Fails at compile time when a switch misses a case, and at run time if one arrives anyway. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled ${JSON.stringify(value)}.`);
}
