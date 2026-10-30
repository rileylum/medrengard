/**
 * A command step runs `run` and follows the edge its outcome names in `on`, starting at most
 * `budget` attempts between the owner's decisions. An attempt is stopped when it writes nothing to
 * stdout or stderr for `limits.idle` seconds, or runs for `limits.attempt` seconds.
 */
type Step<N extends string> =
  | { kind: "agent" }
  | {
      kind: "command";
      run: readonly [string, ...string[]];
      on: Record<string, N | "end">;
      budget: number;
      limits: { idle: number; attempt: number };
    }
  | { kind: "approval" };

/** A workflow over its step names `N`; `start` must name one of its steps, and `end` is reserved. */
export type Workflow<N extends string = string> = {
  start: NoInfer<N>;
  steps: { [K in N]: K extends "end" ? never : Step<NoInfer<N>> };
};

// lazy: workflow names the definition by key in the engine's workflows. When a commission
// must keep running after its definition is edited, record the definitions by hash instead.
export type Commissioned = { type: "commissioned"; workflow: string };

// process names the engine process running the attempt, so another engine can tell a live
// attempt from an interrupted one.
type AttemptStarted<N extends string> = {
  type: "attempt-started";
  step: N;
  attempt: number;
  process: { pid: number; start: number };
};

type AttemptCompleted<N extends string> = {
  type: "attempt-completed";
  step: N;
  attempt: number;
  outcome: string;
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
  | { status: "ready"; step: { name: N; kind: "agent" | "command" } }
  | { status: "awaiting"; step: { name: N; kind: "approval" } }
  | { status: "attempting"; step: { name: N; kind: "agent" | "command" } }
  | { status: "escalated"; step: { name: N; kind: "agent" | "command" }; reason: string }
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
  const [, ...rest] = events;
  let state = arrive(workflow, workflow.start);

  for (const event of rest) {
    state = apply(workflow, state, event);
  }

  return state;
}

function arrive<N extends string>(workflow: Workflow<N>, name: N): CommissionState<N> {
  const { kind } = workflow.steps[name];

  if (kind === "approval") {
    return { status: "awaiting", step: { name, kind } };
  }

  return { status: "ready", step: { name, kind } };
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

      return { status: "attempting", step: state.step };
    case "attempt-completed":
      if (state.status !== "attempting") {
        throw new Error(`An attempt cannot complete while the commission is ${state.status}.`);
      }

      if (event.next === "end") {
        return { status: "finished", by: "end" };
      }

      return arrive(workflow, event.next);
    case "escalated":
      if (state.status !== "ready" && state.status !== "attempting") {
        throw new Error(`A commission cannot escalate while it is ${state.status}.`);
      }

      return { status: "escalated", step: state.step, reason: event.reason };
    case "decided":
      if (state.status !== "awaiting" && state.status !== "escalated") {
        throw new Error(`A decision cannot arrive while the commission is ${state.status}.`);
      }

      if (event.next === "end") {
        return { status: "finished", by: state.status === "escalated" ? "abandoned" : "end" };
      }

      return arrive(workflow, event.next);
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled ${JSON.stringify(value)}.`);
}
