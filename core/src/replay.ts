import type { Kinds } from "./kinds.ts";

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
    }
  // The latest session an attempt of the step N left, if any: a harness's conversation, opaque to
  // the engine, which a later attempt's adapter may continue.
  | { session: N }
  // The artifacts of `kind` the children of the children step N claimed, from its latest attempt:
  // each child that reached its end, in the order they were commissioned, its latest artifact of
  // the kind, or all of them.
  | { children: N; kind: string; take?: "latest" | "all" }
  // The artifacts of related commissions, as each has them when the attempt starts, finished or
  // not: the commission that started this one, as its parent or through a commission step; those
  // it started; or those the same attempt started, but this one. `from` names steps of their
  // workflows, and `take` applies to each. lazy: one hop, and no `about`, which another
  // commission's subject would decide; widen once a workflow needs either.
  | {
      across: "origin" | "started" | "siblings";
      from?: readonly string[];
      kind?: string;
      take?: "latest" | "all";
    };

/**
 * A reusable agent: the harness adapter program that runs it, the model and prompt it is given,
 * and its skills: paths to skill directories, each holding a SKILL.md, named by the directory.
 */
export type Agent = {
  // costs: false says the harness reports no cost, so no money limit can be kept over its steps.
  harness: { run: readonly [string, ...string[]]; costs?: false };
  model: string;
  prompt: string;
  skills?: readonly string[];
};

/**
 * What a step's process may read, write and reach, enforced by its sandbox.
 *
 * A path not covered by `paths` is invisible. Where declared paths nest, the deeper one decides;
 * on the same path, read wins. An empty path is a fresh directory of at most `size` bytes over
 * whatever is there, held in memory. A scratch path is a fresh directory there too, on disk in the
 * attempt's work area, so the step's disk limit bounds it; it is gone when the attempt ends. The workspace, the input (read-only) and the output are always there, the
 * workspace in the mode `workspace` gives.
 *
 * `environment` names the variables passed through from the engine's own environment, or "all";
 * PATH among them, or a step finds commands only by the system's default search path.
 * `values` sets variables to text the definition holds, over the engine's own: they are recorded
 * with the commission and shown by its definition, so never a secret. A name cannot be both
 * passed through and set. `MEDRENGARD_IN` and `MEDRENGARD_OUT` are always set, over any other.
 *
 * `sandboxes` lets the step's processes make namespaces of their own, as a sandbox inside the
 * step's does; without it the kernel refuses them, which keeps more of it out of reach.
 */
export type Access = {
  paths: readonly (
    | { path: string; mode: "read" | "write" | "scratch" }
    | { path: string; mode: "empty"; size: number }
  )[];
  // All of it, none, or only these hosts, through a proxy the engine runs: `host` on port 443,
  // `host:port`, or `*.domain` for its subdomains. Each broker is a program the engine runs outside
  // the sandbox while an attempt runs, which the step reaches on loopback: one that holds a
  // credential and adds it to what it forwards, so the credential never enters the sandbox.
  network:
    | boolean
    | {
        hosts: readonly string[];
        brokers?: Readonly<Record<string, readonly [string, ...string[]]>>;
      };
  environment: readonly string[] | "all";
  values?: Readonly<Record<string, string>>;
  workspace: "read" | "write";
  sandboxes: boolean;
};

/**
 * The bounds of a step's attempt. It is stopped after `idle` seconds without output, or without
 * the owner typing at an attended step, `attempt` seconds in all, or `transcript` bytes of output,
 * or once its processes use more
 * than `memory` bytes; it never starts if the bodies of its inputs total more than `input` bytes,
 * and cannot run more than `processes` processes and threads at once. Its attempt's directory,
 * workspace, input, output and kinds' areas, may hold `disk` bytes. Only an attended step's `idle`
 * and `attempt` may be unbounded.
 */
export type Limits = {
  idle: number | "unbounded";
  attempt: number | "unbounded";
  transcript: number;
  input: number;
  memory: number;
  processes: number;
  disk: number;
};

/**
 * A step's money limit: the most an attempt may cost, in US dollars, as its step reports it on
 * fd 4. Optional, and never a factory default: an attempt that reports no cost counts as over it.
 */
export type Money = { usd?: number };

// The limits a step states: those it changes from the factory's defaults, or none, and any money
// limit.
type Stated = { limits?: Partial<Limits> & Money };

// What every step that starts a program declares: its inputs, the artifact kinds it may claim,
// whether its workspace is built from the subject, from the one artifact an input names, with the
// artifacts another input names added as branches, or starts empty, its outcomes' edges, the attempts it may start between the owner's decisions, its access,
// and, as `Bounded` holds them, its limits.
type Program<N extends string, Bounded> = {
  inputs: Readonly<Record<string, Query<N>>>;
  claims: readonly string[];
  workspace: "subject" | "empty" | { input: string; branches?: string };
  on: Record<string, N | "end">;
  budget: number;
  access: Access;
} & Bounded;

/**
 * What a program outside the engine, such as a timer, or a commission step may start through a
 * trigger: commissions of `workflows`, at most `rate.count` in any `rate.per` seconds, at most
 * `allowance` until the owner renews it, or both, and `unfinished` not finished at once; and, given
 * `usd`, only while those it started in the last `rate.per` seconds, or without a rate since it
 * was last renewed, cost less. Only a trigger with an allowance may serve a commission step.
 */
export type Trigger = {
  workflows: readonly string[];
  rate?: { count: number; per: number };
  allowance?: number;
  unfinished: number;
  usd?: number;
};

/**
 * A command step that watches: its attempt is a wait of at most `wait` seconds, in which its
 * program runs every `interval` seconds as a check, in an empty workspace, until one claims. A
 * check that exits 0 without a claim found nothing yet; three that fail in a row escalate.
 */
export type Watch = { interval: number; wait: number };

/**
 * What a children step waits for: every child, the first, or at least some, to reach its end; or,
 * naming an outcome, that every child, or at least some, ended on it.
 */
export type Wait = "all" | "first" | { atLeast: number; outcome?: string } | { all: string };

/**
 * A children step: it commissions child commissions of `workflow`, one per document `each` names,
 * or `count` on the parent's request or the document `request` names, each starting with the
 * artifacts `given` names; at most `width` in all and `concurrent` unfinished at once; and waits,
 * at most `limits.wait` seconds, for what `wait` says. A wait without an outcome follows `done`
 * once met; one with an outcome follows `met`, or `unmet` once it can no longer be met.
 */
export type Children<N extends string> = {
  kind: "children";
  workflow: string;
  each?: Query<N>;
  count?: number;
  request?: Query<N>;
  given?: Readonly<Record<string, Query<N>>>;
  width: number;
  concurrent: number;
  wait: Wait;
  on: Record<string, N | "end">;
  budget: number;
  limits: { wait: number };
};

/**
 * A commission step: it starts top-level commissions of `workflow` through `trigger`, one per
 * document `each` names, each its request, each starting with the artifacts `given` names, all
 * or none, and goes on at once, following `done`. Each runs on the factory's definitions as they
 * are when it starts; it is no child, so nothing here waits on it or withdraws it.
 */
export type Commissioning<N extends string> = {
  kind: "commission";
  trigger: string;
  workflow: string;
  each: Query<N>;
  given?: Readonly<Record<string, Query<N>>>;
  on: Record<string, N | "end">;
  budget: number;
};

/**
 * A step: an agent step runs its agent's harness adapter, with the owner in their terminal when
 * `attended`, a command step runs `run`, once or, watching, as checks, an approval step waits for the owner's decision,
 * following the edge its outcome names in `on`, a children step waits on child commissions, and a
 * commission step starts commissions of their own.
 */
type Step<N extends string, Bounded> =
  | ({ kind: "agent"; agent: Agent; attended?: boolean } & Program<N, Bounded>)
  | ({ kind: "command"; run: readonly [string, ...string[]]; watch?: Watch } & Program<N, Bounded>)
  | { kind: "approval"; on: Record<string, N | "end"> }
  | Children<N>
  | Commissioning<N>;

/**
 * A workflow over its step names `N`; `start` must name one of its steps, and `end` is reserved.
 * Each step states the limits it changes from the factory's defaults; a commission's definition
 * holds every step's limits whole. `usd`, optional, is the most its commission's attempts may cost
 * between the owner's decisions, in US dollars, as their steps report it.
 */
export type Workflow<N extends string = string, Bounded = Stated> = {
  start: NoInfer<N>;
  usd?: number;
  steps: { [K in N]: K extends "end" ? never : Step<NoInfer<N>, Bounded> };
};

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

/** A skill as the commission started with it: its name, and each file's hash by relative path. */
export type Skill = { name: string; files: Readonly<Record<string, string>> };

/**
 * What a commission runs on: its workflow, each step with its limits whole, the kinds of artifact
 * the factory defined, and the skills its agents declare, by path.
 */
export type Definition<N extends string = string> = {
  workflow: Workflow<N, { limits: Limits & Money }>;
  kinds: Kinds;
  skills: Readonly<Record<string, Skill>>;
};

/** Declares a workflow, so the compiler checks that every step name it uses exists. */
export function defineWorkflow<N extends string>(workflow: Workflow<N>): Workflow<N> {
  return workflow;
}

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
