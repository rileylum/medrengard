import { test } from "node:test";
import type { createEngine } from "./engine.ts";
import type { Kind, Program } from "./kinds.ts";
import type { Access, Agent, Limits, Money, Query, Workflow } from "./replay.ts";

// Constraint 7: the definition's schema is pinned here, at compile time: a field added to or
// removed from any type a factory writes fails the type check until this list changes on purpose.

// True only when A and B are the same type.
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Step = Workflow["steps"][string];

type Agentic = Extract<Step, { kind: "agent" }>;

type Command = Extract<Step, { kind: "command" }>;

type Approval = Extract<Step, { kind: "approval" }>;

type Path = Access["paths"][number];

type Narrowing = Exclude<Query, string>;

type Rule = Kind["fields"][string];

type Factory = Parameters<typeof createEngine>[0];

// Each entry must be true, or the file does not compile.
type Expect<T extends true> = T;

type Pinned = {
  factory: Expect<Same<keyof Factory, "log" | "workflows" | "kinds" | "defaults">>;
  defaults: Expect<Same<Factory["defaults"], { limits: Limits }>>;
  workflow: Expect<Same<keyof Workflow, "start" | "steps" | "usd">>;
  stepKinds: Expect<Same<Step["kind"], "agent" | "command" | "approval">>;
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
      | "budget"
      | "access"
      | "limits"
    >
  >;
  commandStep: Expect<
    Same<
      keyof Command,
      "kind" | "run" | "inputs" | "claims" | "workspace" | "on" | "budget" | "access" | "limits"
    >
  >;
  approvalStep: Expect<Same<keyof Approval, "kind" | "on">>;
  workspace: Expect<Same<Command["workspace"], "subject" | "empty" | { input: string }>>;
  stated: Expect<Same<Command["limits"], (Partial<Limits> & Money) | undefined>>;
  limits: Expect<
    Same<
      keyof Limits,
      "idle" | "attempt" | "transcript" | "input" | "memory" | "processes" | "disk"
    >
  >;
  attended: Expect<Same<Agentic["attended"], boolean | undefined>>;
  time: Expect<Same<Limits["idle"] | Limits["attempt"], number | "unbounded">>;
  agent: Expect<Same<keyof Agent, "harness" | "model" | "prompt" | "skills">>;
  harness: Expect<Same<keyof Agent["harness"], "run">>;
  access: Expect<
    Same<keyof Access, "paths" | "network" | "environment" | "values" | "workspace" | "sandboxes">
  >;
  path: Expect<
    Same<
      Path,
      | { path: string; mode: "read" | "write" | "scratch" }
      | { path: string; mode: "empty"; size: number }
    >
  >;
  query: Expect<Same<Extract<Query, string>, "subject" | "request">>;
  narrowing: Expect<Same<keyof Narrowing, "from" | "kind" | "about" | "take">>;
  kind: Expect<
    Same<
      keyof Kind,
      "role" | "description" | "fields" | "body" | "outcome" | "verifier" | "materialiser"
    >
  >;
  rule: Expect<Same<keyof Rule, "limit" | "required" | "values">>;
  body: Expect<Same<keyof Kind["body"], "required" | "limit">>;
  program: Expect<Same<keyof Program, "run" | "access" | "limit" | "memory" | "processes">>;
  verifier: Expect<Same<Exclude<keyof NonNullable<Kind["verifier"]>, keyof Program>, "kept">>;
};

test("the definition's schema is pinned at compile time", () => {
  const pinned: Pinned | undefined = undefined;

  void pinned;
});
