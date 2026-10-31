/**
 * What the engine gives a step under one of its input names: the commission's current subject;
 * the owner's request; or a query over every artifact in the commission's record, oldest first:
 * the request, the artifacts steps claimed and the owner's decisions. A query's fields each narrow
 * what it names: `from` to the steps it lists, `kind` to one artifact kind, `about` to judgements
 * about the current subject, earlier subjects or any, and `take` to the latest or all of them,
 * all if left out.
 */
export type Query<N extends string = string> =
  | "subject"
  | "request"
  | {
      from?: readonly N[];
      kind?: string;
      about?: "subject" | "earlier" | "any";
      take?: "latest" | "all";
    };

/**
 * A reusable agent: the harness adapter program that runs it, and the model and prompt it is
 * given.
 */
export type Agent = {
  harness: { run: readonly [string, ...string[]] };
  model: string;
  prompt: string;
};

/**
 * What a step's process may read, write and reach, enforced by its sandbox.
 *
 * A path not covered by `paths` is invisible. Where declared paths nest, the deeper one decides;
 * on the same path, read wins. An empty path is a fresh directory of at most `size` bytes over
 * whatever is there. The workspace, the input (read-only) and the output are always there, the
 * workspace in the mode `workspace` gives.
 *
 * `environment` names the variables passed through from the engine's own environment, or "all".
 * `PATH`, `MEDRENGARD_IN` and `MEDRENGARD_OUT` are always set, over any passed through.
 */
export type Access = {
  paths: readonly (
    | { path: string; mode: "read" | "write" }
    | { path: string; mode: "empty"; size: number }
  )[];
  network: boolean;
  environment: readonly string[] | "all";
  workspace: "read" | "write";
};

// What every step that starts a program declares: its inputs, whether its workspace is built from
// the subject or starts empty, its outcomes' edges, the attempts it may start between the owner's
// decisions, its access, and its limits. An attempt is stopped after `idle`
// seconds without stdout or stderr output, `attempt` seconds in all, or `transcript` bytes of it,
// and never starts if the bodies of its inputs total more than `input` bytes.
type Program<N extends string> = {
  inputs: Readonly<Record<string, Query<N>>>;
  workspace: "subject" | "empty";
  on: Record<string, N | "end">;
  budget: number;
  access: Access;
  limits: { idle: number; attempt: number; transcript: number; input: number };
};

/**
 * A step: an agent step runs its agent's harness adapter, a command step runs `run`, and an
 * approval step waits for the owner's decision, following the edge its outcome names in `on`.
 */
type Step<N extends string> =
  | ({ kind: "agent"; agent: Agent } & Program<N>)
  | ({ kind: "command"; run: readonly [string, ...string[]] } & Program<N>)
  | { kind: "approval"; on: Record<string, N | "end"> };

/** A workflow over its step names `N`; `start` must name one of its steps, and `end` is reserved. */
export type Workflow<N extends string = string> = {
  start: NoInfer<N>;
  steps: { [K in N]: K extends "end" ? never : Step<NoInfer<N>> };
};

// workflow is the definition's name; definition is the hash of the definition as it was when the
// commission started, which the commission runs on. request is the hash of the owner's request,
// the commission's first subject.
export type Commissioned = {
  type: "commissioned";
  workflow: string;
  definition: string;
  request: string;
};

// subject and inputs name what the attempt was given, by hash: each input's artifacts, oldest
// first, inputs in the order declared.
// process names the engine process running the attempt, so another engine can tell a live
// attempt from an interrupted one.
type AttemptStarted<N extends string> = {
  type: "attempt-started";
  step: N;
  attempt: number;
  subject: string;
  inputs: readonly { name: string; hashes: readonly string[] }[];
  process: { pid: number; start: number };
};

// artifacts are the artifacts the attempt claimed, in the order claimed, each with its kind, so a
// query can select by kind without the store, and the files its verifier kept, by name; transcript
// is the hash of its stdout and stderr.
type AttemptCompleted<N extends string> = {
  type: "attempt-completed";
  step: N;
  attempt: number;
  outcome: string;
  artifacts: readonly { hash: string; kind: string; kept: Readonly<Record<string, string>> }[];
  transcript: string;
  next: N | "end";
};

// lazy: reason is free text for the owner. When an observer needs to group escalations,
// add a closed set of causes beside it; the text stays, as the why.
// transcript is there when the attempt's program ran; an interrupted attempt's is lost.
type Escalated = { type: "escalated"; reason: string; attempt?: number; transcript?: string };

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

// decision is the owner's latest decision about the current subject; one about an earlier
// subject is history.
export type CommissionState<N extends string = string> =
  | {
      status: "ready";
      step: { name: N; kind: "agent" | "command" };
      subject: string;
      decision?: string;
    }
  | { status: "awaiting"; step: { name: N; kind: "approval" }; subject: string; decision?: string }
  | {
      status: "attempting";
      step: { name: N; kind: "agent" | "command" };
      subject: string;
      decision?: string;
    }
  | {
      status: "escalated";
      step: { name: N; kind: "agent" | "command" };
      subject: string;
      decision?: string;
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
  let state = arrive(workflow, workflow.start, request, undefined);

  for (const event of rest) {
    state = apply(workflow, state, event);
  }

  return state;
}

function arrive<N extends string>(
  workflow: Workflow<N>,
  name: N,
  subject: string,
  decision: string | undefined,
): CommissionState<N> {
  const { kind } = workflow.steps[name];

  if (kind === "approval") {
    return { status: "awaiting", step: { name, kind }, subject, decision };
  }

  return { status: "ready", step: { name, kind }, subject, decision };
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

      return { ...state, status: "attempting" };
    case "attempt-completed":
      if (state.status !== "attempting") {
        throw new Error(`An attempt cannot complete while the commission is ${state.status}.`);
      }

      if (event.next === "end") {
        return { status: "finished", by: "end" };
      }

      // lazy: every kind a step can claim is a subject, so the last artifact claimed is the
      // subject. Record each artifact's role once a step can claim a judgement.
      if (event.artifacts.length > 0) {
        return arrive(workflow, event.next, event.artifacts.at(-1)!.hash, undefined);
      }

      return arrive(workflow, event.next, state.subject, state.decision);
    case "escalated":
      if (state.status !== "ready" && state.status !== "attempting") {
        throw new Error(`A commission cannot escalate while it is ${state.status}.`);
      }

      return { ...state, status: "escalated", reason: event.reason };
    case "decided":
      if (state.status !== "awaiting" && state.status !== "escalated") {
        throw new Error(`A decision cannot arrive while the commission is ${state.status}.`);
      }

      if (event.next === "end") {
        return { status: "finished", by: state.status === "escalated" ? "abandoned" : "end" };
      }

      return arrive(workflow, event.next, state.subject, event.decision);
    default:
      return assertNever(event);
  }
}

/** Fails at compile time when a switch misses a case, and at run time if one arrives anyway. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled ${JSON.stringify(value)}.`);
}
