export type StepKind = "agent" | "command" | "approval";

/** A workflow over its step names `N`; `start` must name one of its steps, and `end` is reserved. */
export type Workflow<N extends string = string> = {
  start: NoInfer<N>;
  steps: Record<N, { kind: StepKind }> & { end?: never };
};

type Commissioned = { type: "commissioned" };

type AttemptStarted<N extends string> = { type: "attempt-started"; step: N; attempt: number };

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

export type CommissionEvent<N extends string = string> =
  | Commissioned
  | AttemptStarted<N>
  | AttemptCompleted<N>
  | Escalated;

export type CommissionState<N extends string = string> =
  | { status: "ready"; step: { name: N; kind: "agent" | "command" } }
  | { status: "awaiting"; step: { name: N; kind: "approval" } }
  | { status: "attempting"; step: { name: N; kind: "agent" | "command" } }
  | { status: "escalated"; step: { name: N; kind: "agent" | "command" }; reason: string }
  | { status: "finished" };

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
  // lazy: replay alone enforces which events each status accepts. When the engine
  // writes events, move these rules somewhere both the writer and replay use.
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
        return { status: "finished" };
      }

      return arrive(workflow, event.next);
    case "escalated":
      if (state.status !== "ready" && state.status !== "attempting") {
        throw new Error(`A commission cannot escalate while it is ${state.status}.`);
      }

      return { status: "escalated", step: state.step, reason: event.reason };
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled ${JSON.stringify(value)}.`);
}
