export type StepKind = "agent" | "command" | "approval";

/** A workflow over its step names `N`; `start` must name one of its steps. */
export type Workflow<N extends string = string> = {
  start: NoInfer<N>;
  steps: Record<N, { kind: StepKind }>;
};

export type CommissionEvent = { type: "commissioned" };

export type CommissionState<N extends string = string> =
  | { status: "ready"; step: { name: N; kind: "agent" | "command" } }
  | { status: "awaiting"; step: { name: N; kind: "approval" } };

/** Declares a workflow, so the compiler checks that every step name it uses exists. */
export function defineWorkflow<N extends string>(workflow: Workflow<N>): Workflow<N> {
  return workflow;
}

/** Rebuilds a commission's state from its workflow and its events. */
export function replay<N extends string>(
  workflow: Workflow<N>,
  _events: readonly CommissionEvent[],
): CommissionState<N> {
  const name = workflow.start;
  const { kind } = workflow.steps[name];

  if (kind === "approval") {
    return { status: "awaiting", step: { name, kind } };
  }

  return { status: "ready", step: { name, kind } };
}
