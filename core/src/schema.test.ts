import { test } from "node:test";
import type { createEngine } from "./engine.ts";
import type { Kind, Program } from "./kinds.ts";
import type {
  Access,
  Agent,
  Factory as Declared,
  Limits,
  Query,
  Routes,
  Trigger,
  Wait,
  Watch,
  Workflow,
} from "./definition.ts";

// Constraint 7: the definition's schema is pinned here, at compile time: a field added to or
// removed from any type a factory writes fails the type check until this list changes on purpose.

// True only when A and B are the same type.
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Step = Workflow["steps"][string];

type Agentic = Extract<Step, { kind: "agent" }>;

type Command = Extract<Step, { kind: "command" }>;

type Watching = Extract<Command, { watch: Watch }>;

type Attended = Extract<Agentic, { attended: true }>;

// The keys of T that can hold a value: one a union member only forbids is not among them.
type Keys<T> = { [K in keyof T]-?: [T[K]] extends [undefined] ? never : K }[keyof T];

type Approval = Extract<Step, { kind: "approval" }>;

type Path = Access["paths"][number];

type Narrowing = Exclude<
  Query,
  string | { session: string } | { children: string } | { across: string }
>;

type Across = Extract<Exclude<Query, string>, { across: string }>;

type Waiting = Extract<Step, { kind: "children" }>;

type Starting = Extract<Step, { kind: "commission" }>;

type Reading = Extract<Exclude<Query, string>, { children: string }>;

type Continuing = Extract<Exclude<Query, string>, { session: string }>;

type Rule = Kind["fields"][string];

type Factory = Parameters<typeof createEngine>[0];

// Each entry must be true, or the file does not compile.
type Expect<T extends true> = T;

type Pinned = {
  factory: Expect<Same<keyof Factory, "log" | "workflows" | "kinds" | "defaults" | "triggers">>;
  trigger: Expect<Same<keyof Trigger, "workflows" | "rate" | "allowance" | "unfinished" | "usd">>;
  rate: Expect<Same<Trigger["rate"], { count: number; per: number } | undefined>>;
  allowance: Expect<Same<Trigger["allowance"], number | undefined>>;
  defaults: Expect<Same<Factory["defaults"], { limits: Limits }>>;
  workflow: Expect<Same<keyof Workflow, "start" | "steps" | "usd">>;
  stepKinds: Expect<
    Same<Step["kind"], "agent" | "command" | "approval" | "children" | "commission">
  >;
  commissionStep: Expect<
    Same<keyof Starting, "kind" | "trigger" | "workflow" | "each" | "given" | "on" | "budget">
  >;
  childrenStep: Expect<
    Same<
      keyof Waiting,
      | "kind"
      | "workflow"
      | "each"
      | "count"
      | "request"
      | "given"
      | "width"
      | "concurrent"
      | "until"
      | "on"
      | "escalate"
      | "budget"
      | "limits"
    >
  >;
  routes: Expect<
    Same<
      keyof Routes,
      "limit" | "claim" | "exit" | "kind" | "broker" | "interrupted" | "unmet" | "any"
    >
  >;
  childrenLimits: Expect<Same<keyof Waiting["limits"], "wait">>;
  watch: Expect<Same<Watch, { interval: number; wait: number }>>;
  wait: Expect<
    Same<Wait, "all" | "first" | { atLeast: number; outcome?: string } | { all: string }>
  >;
  children: Expect<Same<Keys<Reading>, "children" | "kind" | "take">>;
  agentStep: Expect<
    Same<
      keyof Agentic,
      | "kind"
      | "agent"
      | "attended"
      | "inputs"
      | "claims"
      | "workspace"
      | "on"
      | "escalate"
      | "budget"
      | "access"
      | "limits"
    >
  >;
  commandStep: Expect<
    Same<
      keyof Command,
      | "kind"
      | "run"
      | "watch"
      | "inputs"
      | "claims"
      | "workspace"
      | "on"
      | "escalate"
      | "budget"
      | "access"
      | "limits"
    >
  >;
  approvalStep: Expect<Same<keyof Approval, "kind" | "on">>;
  workspace: Expect<
    Same<Agentic["workspace"], "subject" | "empty" | { input: string; branches?: string }>
  >;
  // A watching step's checks run in an empty workspace.
  watching: Expect<Same<Watching["workspace"], "empty">>;
  // Every step but an attended one bounds its time and may have a money limit.
  stated: Expect<Same<keyof NonNullable<Command["limits"]>, keyof Limits | "usd">>;
  timed: Expect<Same<NonNullable<Command["limits"]>["idle"], number | undefined>>;
  attendedLimits: Expect<Same<keyof NonNullable<Attended["limits"]>, keyof Limits>>;
  untimed: Expect<Same<NonNullable<Attended["limits"]>["idle"], number | "unbounded" | undefined>>;
  // A children step makes one child per document, or a count of them; never both.
  each: Expect<Same<Extract<Waiting, { each: object }>["count"], undefined>>;
  counted: Expect<Same<Extract<Waiting, { count: number }>["each"], undefined>>;
  childrenRoutes: Expect<Same<keyof NonNullable<Waiting["escalate"]>, "limit" | "unmet" | "any">>;
  programRoutes: Expect<
    Same<
      keyof NonNullable<Command["escalate"]>,
      "limit" | "claim" | "exit" | "kind" | "broker" | "interrupted" | "any"
    >
  >;
  commissionEdges: Expect<Same<keyof Starting["on"], "done">>;
  // What the engine is made with is the factory a module exports.
  declared: Expect<Same<Factory, Declared>>;
  limits: Expect<
    Same<
      keyof Limits,
      "idle" | "attempt" | "transcript" | "input" | "memory" | "processes" | "disk"
    >
  >;
  attended: Expect<Same<Agentic["attended"], boolean | undefined>>;
  time: Expect<Same<Limits["idle"] | Limits["attempt"], number | "unbounded">>;
  agent: Expect<Same<keyof Agent, "harness" | "model" | "prompt" | "skills">>;
  harness: Expect<Same<keyof Agent["harness"], "run" | "costs">>;
  costs: Expect<Same<Agent["harness"]["costs"], false | undefined>>;
  access: Expect<
    Same<keyof Access, "paths" | "network" | "environment" | "values" | "workspace" | "sandboxes">
  >;
  network: Expect<
    Same<
      Access["network"],
      | boolean
      | {
          hosts: readonly string[];
          brokers?: Readonly<Record<string, readonly [string, ...string[]]>>;
        }
    >
  >;
  path: Expect<
    Same<
      Path,
      | { path: string; mode: "read" | "write" | "scratch" }
      | { path: string; mode: "empty"; size: number }
    >
  >;
  query: Expect<Same<Extract<Query, string>, "subject" | "request">>;
  narrowing: Expect<Same<Keys<Narrowing>, "from" | "kind" | "about" | "take">>;
  session: Expect<Same<Keys<Continuing>, "session">>;
  across: Expect<Same<Keys<Across>, "across" | "from" | "kind" | "take">>;
  relations: Expect<Same<Across["across"], "origin" | "started" | "siblings">>;
  kind: Expect<
    Same<
      keyof Kind,
      "role" | "description" | "fields" | "body" | "outcome" | "verifier" | "materialiser"
    >
  >;
  rule: Expect<Same<keyof Rule, "limit" | "required" | "values">>;
  body: Expect<Same<keyof Kind["body"], "required" | "limit">>;
  program: Expect<Same<keyof Program, "run" | "access" | "limits">>;
  programLimits: Expect<Same<keyof Program["limits"], "attempt" | "memory" | "processes">>;
  verifier: Expect<
    Same<keyof NonNullable<Kind["verifier"]>["limits"], "attempt" | "memory" | "processes" | "kept">
  >;
  materialiser: Expect<
    Same<Exclude<keyof NonNullable<Kind["materialiser"]>, keyof Program>, "branches">
  >;
};

test("the definition's schema is pinned at compile time", () => {
  const pinned: Pinned | undefined = undefined;

  void pinned;
});
