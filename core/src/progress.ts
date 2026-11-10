/**
 * How far a commission has come, judged from its log alone: whether it may start its next attempt
 * and what stands in the way, what it has spent, how it finished. Nothing here does I/O or reads
 * a clock, so the engine's rules can be read, and tested, without running a step.
 */
import type { Children, Definition, Routes, Wait } from "./definition.ts";
import type { Cause, Commissioned, CommissionEvent } from "./replay.ts";

/** A commission's events, oldest first: the one that commissioned it, then the rest. */
export type Log = [Commissioned & { at?: number }, ...Exclude<CommissionEvent, Commissioned>[]];

/** Why a commission escalates: its cause and, for the owner, the reason. */
export type Why = { cause: Cause; reason: string };

export const because = (cause: Cause, reason: string): Why => ({ cause, reason });

type Started = Extract<CommissionEvent, { type: "attempt-started" }>;

/** What an attempt is given, by hash: each input's artifacts, inputs in the order declared. */
export type Inputs = Started["inputs"];

/** The number the commission's next attempt has, and what its money limit leaves it, if it has one. */
export type Admitted = { attempt: number; commission?: { limit: number; spent: number } };

/**
 * Whether the commission, ready at `step`, may start an attempt of it on the engine `engine`: why
 * not, in the order the owner answers them, its engine, its budget, then its money; or the
 * attempt's number and what its commission's money limit leaves it.
 */
export function admit(
  commission: string,
  { workflow }: Definition,
  events: Log,
  step: string,
  engine: string,
): Why | Admitted {
  // Upgrading Medrengard could change how the commission goes on: the owner decides first.
  const upgraded = unacceptedEngine(commission, events, engine);

  if (upgraded !== undefined) {
    return because("upgrade", upgraded);
  }

  const at = workflow.steps[step];
  const attempts = attemptsOf(events, step);

  if (at !== undefined && at.kind !== "approval" && attempts.length >= at.budget) {
    return because("budget", `Step ${step} has spent its budget of ${at.budget} attempts.`);
  }

  const attempt = events.filter((event) => event.type === "attempt-started").length + 1;

  if (workflow.usd === undefined) {
    return { attempt };
  }

  const left = moneyLeft(spentSince(events, workflow), workflow.usd);

  return "reason" in left ? left : { attempt, commission: left };
}

/**
 * Why an attempt of `step` on `subject` and `inputs` would repeat one since the owner's latest
 * decision and the latest route, if it would: it would see what the earlier one saw, so only a
 * decision, or a route the workflow declares, justifies it.
 */
export function repeats(
  events: Log,
  step: string,
  subject: string,
  inputs: Inputs,
): Why | undefined {
  const same = (given: Inputs) =>
    given.length === inputs.length &&
    given.every(
      (input, index) =>
        input.name === inputs[index]!.name &&
        input.hashes.length === inputs[index]!.hashes.length &&
        input.hashes.every((hash, position) => hash === inputs[index]!.hashes[position]),
    );

  // A route between is the workflow's own reason to attempt it again, as a decision is the
  // owner's.
  const since = events.slice(
    events.findLastIndex((event) => event.type === "escalated" && event.next !== undefined) + 1,
  );

  return attemptsOf(events, step).some(
    (event) => since.includes(event) && event.subject === subject && same(event.inputs),
  )
    ? because("repeat", `Step ${step} was already attempted on this subject and these inputs.`)
    : undefined;
}

/**
 * The step the escalation `escalated` goes on at, if its step routes it: only an attempt's
 * escalation is routed, by its cause or else by any, and never a cause that is the owner's alone.
 */
export function routeOf(
  { workflow }: Definition,
  events: Log,
  escalated: { cause: Cause; attempt?: number },
): string | undefined {
  const started = events.find(
    (event) => event.type === "attempt-started" && event.attempt === escalated.attempt,
  );

  const step = started?.type === "attempt-started" ? workflow.steps[started.step] : undefined;

  if (step === undefined || step.kind === "approval" || step.kind === "commission") {
    return undefined;
  }

  // A program step's routes and a children step's, read as one: each holds only its own causes.
  const routes: Routes | undefined = step.escalate;

  switch (escalated.cause) {
    case "limit":
    case "claim":
    case "exit":
    case "kind":
    case "broker":
    case "interrupted":
    case "unmet":
      return routes?.[escalated.cause] ?? routes?.any;
    default:
      return undefined;
  }
}

/**
 * The escalation that routed the commission to the step it is ready at, if one did: the step it
 * left, its attempt, and why.
 */
export function routedBy(
  events: Log,
): { step: string; attempt: number; cause: Cause; reason: string } | undefined {
  const last = events.at(-1)!;

  if (
    last.type !== "escalated" ||
    last.next === undefined ||
    last.attempt === undefined ||
    last.cause === undefined
  ) {
    return undefined;
  }

  const started = events.find(
    (event) => event.type === "attempt-started" && event.attempt === last.attempt,
  );

  return started?.type === "attempt-started"
    ? { step: started.step, attempt: last.attempt, cause: last.cause, reason: last.reason }
    : undefined;
}

// The attempts of `step` since the owner's latest decision: what its budget counts.
function attemptsOf(events: Log, step: string): Started[] {
  return sinceDecision(events).flatMap((event) =>
    event.type === "attempt-started" && event.step === step ? [event] : [],
  );
}

/** A children step's wait as it stands, and the children, by position, that will not count toward it. */
export type Waited = { wait: "met" | "unmet" | "late" | "on"; failed: number[] };

/**
 * How a children step's wait stands, with `total` children in all, each finished as `finishes`
 * says or not yet, `waited` milliseconds in: met; unmet, when it can no longer be met; late, past
 * its wait limit; or going on. `failed` are the children, by position, that finished without
 * counting toward it.
 */
export function waitOf(
  step: Children<string>,
  total: number,
  finishes: readonly ({ outcome?: string } | undefined)[],
  waited: number,
): Waited {
  const outcome = outcomeOf(step.until);

  // A child succeeds by reaching its end, on the wait's outcome when it names one.
  const counts = (finish: { outcome?: string }) =>
    finish.outcome !== undefined && (outcome === undefined || finish.outcome === outcome);

  const succeeded = finishes.filter((finish) => finish !== undefined && counts(finish)).length;

  const failed = finishes.flatMap((finish, index) =>
    finish !== undefined && !counts(finish) ? [index] : [],
  );

  const need =
    step.until === "first"
      ? 1
      : step.until === "all" || "all" in step.until
        ? total
        : step.until.atLeast;

  const wait =
    succeeded >= need
      ? "met"
      : total - failed.length < need
        ? "unmet"
        : waited > step.limits.wait * 1000
          ? "late"
          : "on";

  return { wait, failed };
}

/**
 * The outcome a children step's wait counts, if it names one: such a wait follows met or unmet,
 * and one without follows done or escalates.
 */
export function outcomeOf(wait: Wait): string | undefined {
  return wait === "all" || wait === "first" ? undefined : "all" in wait ? wait.all : wait.outcome;
}

/**
 * How a commission finished, if it did: on the outcome that took its workflow to its end, or
 * abandoned or withdrawn, with none.
 */
export function finishOf(events: Log): { outcome?: string } | undefined {
  const last = events.at(-1)!;

  if (last.type === "attempt-completed" && last.next === "end") {
    return { outcome: last.outcome };
  }

  if (last.type === "decided" && last.next === "end") {
    return last.outcome === "abandon" ? {} : { outcome: last.outcome };
  }

  return last.type === "withdrawn" ? {} : undefined;
}

// The sessions attempts of `step` left, oldest first, by hash, however each attempt ended.
export function sessionsOf(events: Log, step: string): string[] {
  const steps = new Map<number, string>();

  return events.flatMap((event) => {
    if (event.type === "attempt-started") {
      steps.set(event.attempt, event.step);
    }

    const ended =
      event.type === "attempt-completed" ||
      (event.type === "escalated" && event.attempt !== undefined);

    return ended && event.session !== undefined && steps.get(event.attempt!) === step
      ? [event.session]
      : [];
  });
}

// What an attempt may cost: its step's money limit, and what its commission's leaves, if it has
// each.
export type Allowance = { step?: number; commission?: { limit: number; spent: number } };

// Why an attempt that has reported costing `usd` must stop, if it must: over its step's money
// limit, or with what its commission spent before it, over the commission's.
export function overMoney(name: string, usd: number, money: Allowance): Why | undefined {
  if (money.step !== undefined && usd > money.step) {
    return because("money", `Step ${name} reached its money limit of $${money.step}.`);
  }

  if (money.commission !== undefined && money.commission.spent + usd > money.commission.limit) {
    return because(
      "money",
      `The commission reached its money limit of $${money.commission.limit}.`,
    );
  }

  return undefined;
}

// What the commission has spent since the owner's latest decision, as its attempts' steps
// reported it; unknown, naming the attempt, once one whose program ran reported no cost.
function spentSince(
  events: Log,
  workflow: Definition["workflow"],
): { spent: number } | { unknown: number } {
  return spentIn(sinceDecision(events), workflow);
}

// What the attempts among `events` spent, as their steps reported it; unknown, naming the attempt,
// once one whose program ran reported no cost.
export function spentIn(
  events: readonly Log[number][],
  workflow: Definition["workflow"],
): { spent: number } | { unknown: number } {
  let spent = 0;

  for (const event of events) {
    // A children or commission step runs no program: it costs nothing itself.
    const kind = event.type === "attempt-completed" ? workflow.steps[event.step]?.kind : undefined;

    const ran =
      (event.type === "attempt-completed" && kind !== "children" && kind !== "commission") ||
      (event.type === "escalated" && event.attempt !== undefined && event.transcript !== undefined);

    if (!ran) {
      continue;
    }

    const usd = event.usage?.usd;

    if (usd === undefined) {
      return { unknown: event.attempt! };
    }

    spent += usd;
  }

  return { spent };
}

// What the commission's money limit leaves its next attempt, or why it may start none: its spend
// unknown, or the limit spent. Renewed, like a budget, by the owner's decision.
function moneyLeft(
  spent: ReturnType<typeof spentSince>,
  limit: number,
): { limit: number; spent: number } | Why {
  if ("unknown" in spent) {
    return because(
      "money",
      `The commission's spend is unknown: attempt ${spent.unknown} reported no cost, so it counts as over its money limit of $${limit}.`,
    );
  }

  if (spent.spent >= limit) {
    return because(
      "money",
      `The commission has spent $${spent.spent.toFixed(2)} of its money limit of $${limit}.`,
    );
  }

  return { limit, spent: spent.spent };
}

// Why the commission must not go on with this engine, if it must not: it last ran on another,
// by its latest attempt or its commissioning, and the owner has not decided on an escalation
// that named this engine since.
function unacceptedEngine(commission: string, events: Log, current: string): string | undefined {
  const last = events.findLastIndex(
    (event) => event.type === "attempt-started" || event.type === "commissioned",
  );

  // The commissioned event is first, so one is always found.
  const latest = events[last]!;

  const ran =
    latest.type === "attempt-started" || latest.type === "commissioned" ? latest.engine : undefined;

  if (ran === current) {
    return undefined;
  }

  const since = events.slice(last + 1);

  const named = since.findLastIndex(
    (event) => event.type === "escalated" && event.engine === current,
  );

  if (named !== -1 && since.slice(named + 1).some((event) => event.type === "decided")) {
    return undefined;
  }

  const was =
    ran === undefined ? "an engine that recorded no version" : `engine ${ran.slice(0, 8)}`;

  return `Commission ${commission} last ran on ${was}; this engine is ${current.slice(0, 8)}.`;
}

// Only the owner renews a budget or permits a repeat: both count from the latest decision.
function sinceDecision(events: Log): Log[number][] {
  return events.slice(events.findLastIndex((event) => event.type === "decided") + 1);
}
