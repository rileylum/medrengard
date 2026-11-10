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
  | Recorded<N>
  // The latest session an attempt of the step N left, if any: a harness's conversation, opaque to
  // the engine, which a later attempt's adapter may continue.
  | {
      session: N;
      kind?: never;
      take?: never;
      from?: never;
      about?: never;
      children?: never;
      across?: never;
    }
  // The artifacts of `kind` the children of the children step N claimed, from its latest attempt:
  // each child that reached its end, in the order they were commissioned, its latest artifact of
  // the kind, or all of them. It says which: a record's query takes all unless told, and each
  // child's latest is what a parent most often wants, so neither is left to a default here.
  | {
      children: N;
      kind: string;
      take: "latest" | "all";
      from?: never;
      about?: never;
      session?: never;
      across?: never;
    }
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
      about?: never;
      session?: never;
      children?: never;
    };

// A query over the commission's own record. It is no other form, so it holds none of their keys.
type Recorded<N extends string> = {
  from?: readonly N[];
  kind?: string;
  about?: "subject" | "earlier" | "any";
  take?: "latest" | "all";
  session?: never;
  children?: never;
  across?: never;
};

// A query that names documents: the request each child or started commission is about. A query
// over a record, a children step's children or related commissions, of the kind document.
type Documents<N extends string = string> = Extract<
  Query<N>,
  { kind?: string; session?: never }
> & { kind: "document" };

// A query whose artifacts a child or a started commission is given: any but a session, which is
// no artifact.
type Givable<N extends string = string> = Exclude<Query<N>, { session: N }>;

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
 *
 * `cgroups` gives the step its own control group to divide, at /sys/fs/cgroup, so it can bound
 * the memory and processes of programs it runs, as an engine inside it does. The step sees no
 * group but its own, and what it makes there stays within its own limits.
 *
 * `users`, as "range", gives the step the owner's range of users, from /etc/subuid, with the step
 * the first of them, user 0, which is the owner outside: what a container tool needs to unpack an
 * image and run its programs as their own users. It needs `sandboxes`. Without it a step has one
 * user, the owner.
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
  cgroups?: boolean;
  users?: "range";
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

/**
 * Where a step sends an escalation of one of its attempts, by its cause, in place of the owner:
 * to a step of its workflow. `any` is every cause here without a route of its own. Only these
 * causes may be routed; any other, and every escalation before an attempt starts, is the owner's.
 * The attempt spent a unit of the step's budget, and a route renews none, so routes are bounded
 * as every loop is.
 */
export type Routes<
  N extends string = string,
  Cause extends string = "limit" | "claim" | "exit" | "kind" | "broker" | "interrupted" | "unmet",
> = Partial<Record<Cause | "any", N>>;

// The causes an attempt that runs a program can escalate with: every one a step may route but
// unmet, which is a children step's wait alone.
type Ran = "limit" | "claim" | "exit" | "kind" | "broker" | "interrupted";

// A step's limits with its time bounded, as every step's but an attended one's must be.
type Timed = Omit<Limits, "idle" | "attempt"> & { idle: number; attempt: number };

// The limits a step holds. A factory states those it changes from its defaults, or none: an
// attended step may leave its time unbounded and has no money limit, reporting no cost; any
// other bounds its time and may have one. A commission's definition holds every step's whole.
type Bounds<Held extends "stated" | "whole", Attended extends boolean> = Held extends "whole"
  ? { limits: Limits & Money }
  : Attended extends true
    ? { limits?: Partial<Limits> }
    : { limits?: Partial<Timed> & Money };

// What every step that starts a program declares: its inputs, the artifact kinds it may claim,
// whether its workspace is built from the subject, from the one artifact an input names, with the
// artifacts another input names added as branches, or starts empty, its outcomes' edges, the attempts it may start between the owner's decisions, its access,
// and its limits, which its kind of step adds.
type Program<N extends string> = {
  inputs: Readonly<Record<string, Query<N>>>;
  claims: readonly string[];
  workspace: "subject" | "empty" | { input: string; branches?: string };
  on: Record<string, N | "end">;
  escalate?: Routes<N, Ran>;
  budget: number;
  access: Access;
};

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
 * at most `limits.wait` seconds, until what `until` says. A wait without an outcome follows `done`
 * once met; one with an outcome follows `met`, or `unmet` once it can no longer be met.
 */
export type Children<N extends string> = {
  kind: "children";
  workflow: string;
  given?: Readonly<Record<string, Givable<N>>>;
  width: number;
  concurrent: number;
  until: Wait;
  on: Record<string, N | "end">;
  // Its attempt runs no program: it escalates only past its wait limit or over its width, or
  // once its wait cannot be met.
  escalate?: Routes<N, "limit" | "unmet">;
  budget: number;
  limits: { wait: number };
} & (
  | { each: Documents<N>; count?: never; request?: never }
  // The request each is about: the parent's, or the latest document a query names.
  | { count: number; request?: "request" | (Documents<N> & { take: "latest" }); each?: never }
);

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
  each: "request" | Documents<N>;
  given?: Readonly<Record<string, Givable<N>>>;
  on: { done: N | "end" };
  budget: number;
};

/**
 * A step: an agent step runs its agent's harness adapter, with the owner in their terminal when
 * `attended`, a command step runs `run`, once or, watching, as checks, an approval step waits for the owner's decision,
 * following the edge its outcome names in `on`, a children step waits on child commissions, and a
 * commission step starts commissions of their own.
 */
type Step<N extends string, Held extends "stated" | "whole"> =
  | ({ kind: "agent"; agent: Agent; attended: true } & Program<N> & Bounds<Held, true>)
  | ({ kind: "agent"; agent: Agent; attended?: false } & Program<N> & Bounds<Held, false>)
  | ({ kind: "command"; run: readonly [string, ...string[]]; watch?: undefined } & Program<N> &
      Bounds<Held, false>)
  // A watching step's checks each run in an empty workspace.
  | ({ kind: "command"; run: readonly [string, ...string[]]; watch: Watch } & Omit<
      Program<N>,
      "workspace"
    > & { workspace: "empty" } & Bounds<Held, false>)
  | { kind: "approval"; on: Record<string, N | "end"> }
  | Children<N>
  | Commissioning<N>;

/**
 * A workflow over its step names `N`; `start` must name one of its steps, and `end` is reserved.
 * Each step states the limits it changes from the factory's defaults; a commission's definition
 * holds every step's limits whole. `usd`, optional, is the most its commission's attempts may cost
 * between the owner's decisions, in US dollars, as their steps report it.
 */
export type Workflow<N extends string = string, Held extends "stated" | "whole" = "stated"> = {
  start: NoInfer<N>;
  usd?: number;
  steps: { [K in N]: K extends "end" ? never : Step<NoInfer<N>, Held> };
};

/**
 * A factory, as its module exports it by default: where its log lives, the kinds of artifact its
 * steps claim, its workflows by name, the limits every step has unless it states its own, and
 * any triggers. Write `export default { ... } satisfies Factory`.
 */
export type Factory = {
  log: string;
  kinds: Kinds;
  workflows: Record<string, Workflow>;
  defaults: { limits: Limits };
  triggers?: Readonly<Record<string, Trigger>>;
};

/** A skill as the commission started with it: its name, and each file's hash by relative path. */
export type Skill = { name: string; files: Readonly<Record<string, string>> };

/**
 * What a commission runs on: its workflow, each step with its limits whole, the kinds of artifact
 * the factory defined, and the skills its agents declare, by path.
 */
export type Definition<N extends string = string> = {
  workflow: Workflow<N, "whole">;
  kinds: Kinds;
  skills: Readonly<Record<string, Skill>>;
};

/** Declares a workflow, so the compiler checks that every step name it uses exists. */
export function defineWorkflow<N extends string>(workflow: Workflow<N>): Workflow<N> {
  return workflow;
}
