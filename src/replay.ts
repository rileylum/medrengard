export type StepKind = "agent" | "command" | "approval";

/** A workflow over its step names `N`; `start` must name one of its steps. */
export type Workflow<N extends string = string> = {
  start: NoInfer<N>;
  steps: Record<N, { kind: StepKind }>;
};

type Commissioned = { type: "commissioned" };

type AttemptStarted = { type: "attempt-started"; step: string; attempt: number };

export type CommissionEvent = Commissioned | AttemptStarted;

export type CommissionState<N extends string = string> =
  | { status: "ready"; step: { name: N; kind: "agent" | "command" } }
  | { status: "awaiting"; step: { name: N; kind: "approval" } }
  | { status: "attempting"; step: { name: N; kind: "agent" | "command" } };

/** Declares a workflow, so the compiler checks that every step name it uses exists. */
export function defineWorkflow<N extends string>(workflow: Workflow<N>): Workflow<N> {
  return workflow;
}

/** Rebuilds a commission's state from its workflow and its events. */
export function replay<N extends string>(
  workflow: Workflow<N>,
  events: readonly [Commissioned, ...Exclude<CommissionEvent, Commissioned>[]],
): CommissionState<N> {
  const [, ...rest] = events;
  let state = begin(workflow);

  for (const event of rest) {
    state = apply(state, event);
  }

  return state;
}

function begin<N extends string>(workflow: Workflow<N>): CommissionState<N> {
  const name = workflow.start;
  const { kind } = workflow.steps[name];

  if (kind === "approval") {
    return { status: "awaiting", step: { name, kind } };
  }

  return { status: "ready", step: { name, kind } };
}

function apply<N extends string>(
  state: CommissionState<N>,
  event: Exclude<CommissionEvent, Commissioned>,
): CommissionState<N> {
  switch (event.type) {
    case "attempt-started":
      // lazy: replay alone enforces that attempts start only when ready. When the engine
      // writes attempt-started, move this rule somewhere both the writer and replay use.
      if (state.status !== "ready") {
        throw new Error(`An attempt cannot start while the commission is ${state.status}.`);
      }

      return { status: "attempting", step: state.step };
  }
}
