/**
 * Reading a record as a client shows it: who each commission waits for, what happened to one in
 * order, the whole of it as a document, and when to look again. Every function here only reads,
 * through the engine's own methods, so an observer, a terminal UI and the owner's own programs
 * agree on what the record says.
 */
import type { createEngine } from "./engine.ts";
import type { CommissionState } from "./replay.ts";

type Engine = Pick<ReturnType<typeof createEngine>, "commissions" | "record" | "events" | "next">;

/**
 * `text` with each control character written as \uXXXX: visible to the owner, and in JSON, where
 * they can only stand inside a string, the same value. Every text a step wrote passes through it
 * before it reaches the owner's terminal.
 */
export function visible(text: string): string {
  return Array.from(text, (character) => {
    const code = character.charCodeAt(0);

    return isControl(code) ? `\\u${code.toString(16).padStart(4, "0")}` : character;
  }).join("");
}

// What a terminal acts on rather than shows: C0 controls but newline and tab, DEL, C1 controls and
// the bidi controls. A step's text can hold any of them, and could move the cursor, rewrite what
// the owner reads at a gate, set the clipboard or reorder a line.
function isControl(code: number): boolean {
  return (
    (code < 0x20 && code !== 0x0a && code !== 0x09) ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/**
 * How a commission stands: who it waits for, the owner to decide or attend, its step being
 * attempted, an engine that runs to attempt it, or nobody once it has finished.
 */
export type Standing = {
  commission: string;
  state: CommissionState;
  waits: "owner" | "step" | "run" | "nobody";
  /** The request's title, or the commission's name where it has none. */
  title: string;
  /** When its record last gained anything, in milliseconds since the epoch; 0 where the log kept no times. */
  since: number;
  /** What its attempts reported spending, in US dollars: a claim, as each report is. */
  usd: number;
  /** What a running attempt last noted. */
  note?: string;
};

/** How every commission the engine can read stands, in the order they were commissioned. */
export function standing(engine: Engine): Standing[] {
  return engine.commissions().flatMap((listed): Standing[] => {
    if (!("state" in listed)) {
      return [];
    }

    const { commission, state } = listed;
    const { request, entries } = engine.record(commission);

    // A step that waits for the owner to attend it waits on them as a decision does.
    const attend =
      state.status === "ready" && state.step.kind === "agent" && state.step.attended === true;

    const times = entries.map((entry) =>
      entry.entry === "attempt"
        ? "ended" in entry
          ? (entry.ended ?? 0)
          : (entry.started ?? 0)
        : (entry.at ?? 0),
    );

    const running = entries.findLast((entry) => entry.entry === "attempt" && "running" in entry);
    const note = running?.entry === "attempt" ? running.notes.at(-1)?.note : undefined;

    return [
      {
        commission,
        state,
        waits:
          state.status === "finished"
            ? "nobody"
            : state.status === "awaiting" || state.status === "escalated" || attend
              ? "owner"
              : state.status === "attempting"
                ? "step"
                : "run",
        title: request.artifact.fields.title ?? commission,
        since: Math.max(0, ...times),
        usd: entries.reduce(
          (sum, entry) =>
            sum + (entry.entry === "attempt" && "usage" in entry ? (entry.usage?.usd ?? 0) : 0),
          0,
        ),
        note,
      },
    ];
  });
}

/** One thing that happened to a commission: a step attempted, the owner's decision, a stop. */
export type Moment = {
  what: "attempt" | "decision" | "stop";
  step: string;
  /** How it stands or ended: `running`, the outcome claimed or decided, or `stopped`. */
  outcome: string;
  /** The attempt's number, by which its transcript is read. */
  attempt?: number;
  /** What a running attempt last noted, a decision's feedback, or why it stopped. */
  said?: string;
  /** When it started, and ended if it has, in milliseconds since the epoch. */
  started?: number;
  ended?: number;
  /** What the attempt reported spending, in US dollars; 0 where it reported none. */
  usd: number;
  /** What an attempt claimed: each artifact's hash and kind, and its title or summary where it has one. */
  claimed: { hash: string; kind: string; title: string }[];
};

/** Everything that has happened to `commission`, the oldest first. */
export function timeline(engine: Engine, commission: string): Moment[] {
  return engine.record(commission).entries.map((entry): Moment => {
    if (entry.entry === "decision") {
      return {
        what: "decision",
        step: entry.step,
        outcome: entry.outcome,
        said: entry.feedback,
        ended: entry.at,
        usd: 0,
        claimed: [],
      };
    }

    if (entry.entry !== "attempt") {
      return {
        what: "stop",
        step: entry.step,
        outcome: "stopped",
        said: entry.reason,
        ended: entry.at,
        usd: 0,
        claimed: [],
      };
    }

    const common = {
      what: "attempt" as const,
      step: entry.step,
      attempt: entry.attempt,
      started: entry.started,
    };

    if ("running" in entry) {
      return {
        ...common,
        outcome: "running",
        said: entry.notes.at(-1)?.note,
        usd: 0,
        claimed: [],
      };
    }

    const usd = entry.usage?.usd ?? 0;

    if ("escalated" in entry) {
      return {
        ...common,
        outcome: "stopped",
        said: entry.escalated,
        ended: entry.ended,
        usd,
        claimed: [],
      };
    }

    return {
      ...common,
      outcome: entry.outcome,
      ended: entry.ended,
      usd,
      claimed: entry.artifacts.map(({ hash, artifact }) => ({
        hash,
        kind: artifact.kind,
        title: artifact.fields.title ?? artifact.fields.summary ?? "",
      })),
    };
  });
}

/**
 * Each wait on the owner among `moments`: when their decision ended it, and how long it lasted,
 * from the end of what came before the decision. One the log kept no times for is left out.
 */
export function waits(moments: readonly Moment[]): { at: number; lasted: number }[] {
  return moments.flatMap((moment, index) => {
    const before = moments[index - 1]?.ended;

    return moment.what === "decision" && moment.ended !== undefined && before !== undefined
      ? [{ at: moment.ended, lasted: moment.ended - before }]
      : [];
  });
}

/**
 * What `things` come to on each of the seven days ending on the day of `now`, the oldest first, in
 * the machine's own days: the sum of `worth` over those that happened, `at`, on each.
 */
export function week<Thing>(
  things: readonly Thing[],
  now: number,
  at: (thing: Thing) => number,
  worth: (thing: Thing) => number,
): number[] {
  // When the day `back` days before today began.
  const began = (back: number) => {
    const date = new Date(now);

    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - back);

    return date.getTime();
  };

  return [6, 5, 4, 3, 2, 1, 0].map((back) =>
    things
      .filter((thing) => at(thing) >= began(back) && at(thing) < began(back - 1))
      .reduce((sum, thing) => sum + worth(thing), 0),
  );
}

/**
 * A commission's whole record as one document, oldest first: the request, everything each attempt
 * claimed, each escalation, and each decision with the owner's feedback. What an agent outside the
 * commission is given to answer from what happened. It is the steps' own text, so pass it through
 * `visible` before a terminal shows it.
 */
export function material(engine: Engine, commission: string): string {
  const { request, entries } = engine.record(commission);

  const sections = entries.flatMap((entry) => {
    if (entry.entry === "decision") {
      return [
        `## The owner decided \`${entry.outcome}\` at ${entry.step}\n\n${entry.feedback ?? "(no feedback)"}`,
      ];
    }

    if (entry.entry !== "attempt") {
      return [`## Stopped at ${entry.step}\n\n${entry.reason}`];
    }

    if ("escalated" in entry) {
      return [`## Stopped at ${entry.step}\n\n${entry.escalated}`];
    }

    if (!("artifacts" in entry)) {
      return [`## ${entry.step}: still running`];
    }

    return entry.artifacts.map(({ artifact: { kind, fields, body } }) => {
      // A judgement's subject is a hash, which tells a reader nothing.
      const stated = Object.entries(fields)
        .filter(([field]) => field !== "subject")
        .map(([field, value]) => `${field}: ${value}`)
        .join(", ");

      return `## ${entry.step}: ${kind} (${stated})${body === undefined ? "" : `\n\n${body.trim()}`}`;
    });
  });

  return [
    `# ${request.artifact.fields.title ?? commission}\n\n${(request.artifact.body ?? "").trim()}`,
    ...sections,
  ].join("\n\n");
}

/**
 * Yields the name of one of `engines` each time its record gains an event, any engine's writing
 * it, until `signal` aborts: when a client that shows several records should look again. It reads
 * nothing itself.
 */
export async function* changed(
  engines: Readonly<Record<string, Engine>>,
  signal: AbortSignal,
): AsyncGenerator<string, void, void> {
  type Seen = { name: string; position: number };

  // Each record is followed from where its log now ends.
  const follow = (name: string, position: number): Promise<Seen> =>
    engines[name].next(position, { signal }).then((events) => ({
      name,
      position: events.at(-1)?.position ?? position,
    }));

  const following = new Map(
    Object.entries(engines).map(([name, engine]) => [
      name,
      follow(name, engine.events(-1).at(-1)?.position ?? -1),
    ]),
  );

  while (!signal.aborted && following.size > 0) {
    const { name, position } = await Promise.race(following.values());

    if (signal.aborted) {
      return;
    }

    following.set(name, follow(name, position));

    yield name;
  }
}
