import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statfsSync,
  writeSync,
} from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve as resolvePath, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import {
  replay,
  type Access,
  type Commissioned,
  type CommissionEvent,
  type CommissionState,
  type Definition,
  type Limits,
  type Query,
  type Skill,
  type Workflow,
} from "./replay.ts";
import { parseDefinition } from "./definition.ts";
import { hasExactly, isRecord, isText } from "./json.ts";
import { confine, overMemory } from "./sandbox.ts";
import type { Kind, Kinds, Program } from "./kinds.ts";
import { createStore, type Artifact } from "./store.ts";

// The milliseconds a write waits for another process's write to the log.
const logWait = 5000;

type Options = {
  log: string;
  workflows: Record<string, Workflow>;
  kinds: Kinds;
  defaults: { limits: Limits };
};

/**
 * One entry in a commission's record: an attempt, with its notes so far, and once it ends the
 * outcome it claimed and its artifacts, or the reason it escalated; an escalation before any
 * attempt started, such as a spent budget; or the owner's decision, with any feedback. Times are
 * milliseconds since the epoch, absent for events written before the log kept them.
 */
export type Entry =
  | {
      entry: "attempt";
      attempt: number;
      step: string;
      notes: string[];
      started?: number;
      running: true;
    }
  | {
      entry: "attempt";
      attempt: number;
      step: string;
      notes: string[];
      started?: number;
      ended?: number;
      outcome: string;
      // verifier is the command of the verifier that accepted the artifact, or null when its kind
      // has none, as the commission's definition holds it.
      artifacts: { hash: string; artifact: Artifact; verifier: Program["run"] | null }[];
      errors: boolean;
    }
  | {
      entry: "attempt";
      attempt: number;
      step: string;
      notes: string[];
      started?: number;
      ended?: number;
      escalated: string;
      errors: boolean;
    }
  | { entry: "escalation"; step: string; reason: string; at?: number }
  | {
      entry: "decision";
      step: string;
      outcome: string;
      subject: string;
      feedback?: string;
      at?: number;
    };

/** A commission's state, its request and its record, oldest first. */
export type CommissionRecord = {
  state: CommissionState;
  request: { hash: string; artifact: Artifact };
  entries: Entry[];
};

type Log = [Commissioned & { at?: number }, ...Exclude<CommissionEvent, Commissioned>[]];

/**
 * Runs commissions through the owner's workflows, keeping every event in the SQLite log at `log`
 * and every artifact in the store beside it.
 */
export function createEngine({ log, workflows, kinds, defaults }: Options) {
  // Another engine or CLI call may be writing to the same log; waiting for it is bounded, and past
  // the bound the call fails as "database is locked". Writes are single events, so 5 s is ample.
  const database = new DatabaseSync(log, { timeout: logWait });
  const store = createStore(join(dirname(log), "store"));

  // The primary key refuses a second event at the same position, so a concurrent writer fails
  // instead of interleaving.
  database.exec(`CREATE TABLE IF NOT EXISTS events (
    commission TEXT NOT NULL, position INTEGER NOT NULL, event TEXT NOT NULL,
    PRIMARY KEY (commission, position)) STRICT`);

  const self = identity();

  // Each running attempt's directory, named by its commission and attempt, so the engine that
  // finds an attempt interrupted can take what it spooled and remove what it left.
  const attempts = join(dirname(log), "attempts");

  mkdirSync(attempts, { recursive: true });

  function spoolOf(commission: string, attempt: number): Spool {
    const directory = join(
      attempts,
      `${createHash("sha256").update(commission).digest("hex")}-${attempt}`,
    );

    return {
      directory,
      work: join(directory, "work"),
      transcript: join(directory, "transcript"),
      errors: join(directory, "errors"),
    };
  }

  // What an attempt no engine finished had spooled, in the store, for the escalation that ends
  // it: nothing for one spooled before there were spools.
  function spooled(spool: Spool) {
    if (!existsSync(spool.transcript)) {
      return {};
    }

    const errors = readFileSync(spool.errors);

    return errors.length === 0
      ? { transcript: store.keep(readFileSync(spool.transcript)) }
      : { transcript: store.keep(readFileSync(spool.transcript)), errors: store.keep(errors) };
  }

  function unspool(spool: Spool): void {
    rmSync(spool.directory, { recursive: true, force: true });
  }

  // A cancel is a request to the engine running the attempt, not commission state: the
  // escalation that engine writes is the record.
  database.exec(`CREATE TABLE IF NOT EXISTS cancellations (
    commission TEXT NOT NULL, attempt INTEGER NOT NULL,
    PRIMARY KEY (commission, attempt)) STRICT`);

  const request = database.prepare("INSERT OR IGNORE INTO cancellations VALUES (?, ?)");

  const requested = database.prepare(
    "SELECT 1 FROM cancellations WHERE commission = ? AND attempt = ?",
  );

  const insert = database.prepare("INSERT INTO events VALUES (?, ?, ?)");

  const select = database.prepare(
    "SELECT event FROM events WHERE commission = ? ORDER BY position",
  );

  // In the order they were commissioned: rowid follows insertion.
  const commissioned = database.prepare(
    "SELECT commission FROM events WHERE position = 0 ORDER BY rowid",
  );

  // Whether a live engine is running the attempt. This process holds it only while it is running
  // it: one whose end it failed to record is interrupted, though the process lives on.
  function held(
    commission: string,
    {
      process: { pid, start, boot },
      attempt,
    }: Extract<CommissionEvent, { type: "attempt-started" }>,
  ): boolean {
    // A pid and start time name a process only within one boot. Events written before the boot
    // was recorded are judged on pid and start time alone.
    if (boot !== undefined && boot !== self.boot) {
      return false;
    }

    return pid === self.pid && start === self.start
      ? running.has(runningKey(log, commission, attempt))
      : startOf(pid) === start;
  }

  function read(commission: string): Log {
    const events = select.all(commission).map(({ event }) => JSON.parse(String(event)));

    if (events.length === 0) {
      throw new Error(`There is no commission named ${commission}.`);
    }

    // SAFETY: only commission and write insert here, and commission writes the first event.
    return events as Log;
  }

  // Parsed once per definition; a definition never changes under its hash.
  const definitions = new Map<string, Definition>();

  // The workflow and kinds the commission started with, as stored then.
  function definitionOf(events: Log): Definition {
    const { workflow, definition } = events[0];

    if (!definitions.has(definition)) {
      definitions.set(definition, parseDefinition(workflow, store.read(definition).toString()));
    }

    return definitions.get(definition)!;
  }

  // The event that ended the commission's attempt numbered `attempt`, with its transcript.
  function endingOf(commission: string, attempt: number) {
    for (const event of read(commission)) {
      if (
        (event.type === "attempt-completed" || event.type === "escalated") &&
        event.attempt === attempt &&
        event.transcript !== undefined
      ) {
        return event;
      }
    }

    throw new Error(`Commission ${commission} has no transcript for attempt ${attempt}.`);
  }

  function write(commission: string, events: Log, given: Log[1]): void {
    // Every reason passes here, so one bound covers those quoting a step's own words.
    const event = given.type === "escalated" ? { ...given, reason: bounded(given.reason) } : given;

    replay(definitionOf(events), [...events, event]);
    insert.run(commission, events.length, JSON.stringify({ ...event, at: Date.now() }));
  }

  return {
    /** Starts a commission under the workflow named `workflow`, about the owner's request. */
    commission(
      workflow: string,
      commission: string,
      request: { title: string; body: string },
    ): void {
      if (!Object.hasOwn(workflows, workflow)) {
        throw new Error(`There is no workflow named ${workflow}.`);
      }

      // Parsed as it will be read back, so a definition that could not run is refused now; its
      // skills are read once it has passed, so editing one later changes no commission.
      const checked = parseDefinition(
        workflow,
        JSON.stringify({ workflow: workflows[workflow], kinds, defaults }),
      );

      refuseRequest(checked.kinds.document, request);

      const skills = pin(workflow, checked.workflow, store);
      const text = JSON.stringify({ workflow: workflows[workflow], kinds, skills, defaults });
      const parsed = parseDefinition(workflow, text);

      const event: Commissioned = {
        type: "commissioned",
        workflow,
        definition: store.keep(text),
        request: store.put({
          kind: "document",
          fields: { title: request.title },
          body: request.body,
        }),
      };

      replay(parsed, [event]);
      insert.run(commission, 0, JSON.stringify({ ...event, at: Date.now() }));
    },

    /** Replays the commission's state from the log. */
    state(commission: string): CommissionState {
      const events = read(commission);

      return replay(definitionOf(events), events);
    },

    /** Lists every commission in the log with its state, or why it cannot be read, oldest first. */
    commissions(): (
      | { commission: string; state: CommissionState }
      | { commission: string; error: string }
    )[] {
      // One commission the engine cannot read, such as one damaged or written by another engine,
      // is listed with why, so it does not hide the others.
      return commissioned.all().map(({ commission }) => {
        try {
          return { commission: String(commission), state: this.state(String(commission)) };
        } catch (error) {
          return {
            commission: String(commission),
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });
    },

    /** Reads the transcript of the commission's attempt numbered `attempt`. */
    transcript(commission: string, attempt: number): Buffer {
      return store.read(endingOf(commission, attempt).transcript!);
    },

    /** Reads what the commission's attempt numbered `attempt` wrote to stderr: empty for none. */
    errors(commission: string, attempt: number): Buffer {
      const { errors } = endingOf(commission, attempt);

      return errors === undefined ? Buffer.alloc(0) : store.read(errors);
    },

    /**
     * The commission's record, oldest first: each attempt with what it claimed or why it
     * escalated, each escalation before an attempt, and each decision with its feedback.
     */
    record(commission: string): CommissionRecord {
      const events = read(commission);
      const definition = definitionOf(events);
      const entries: Entry[] = [];

      // After the first event, commissioned, which holds the request.
      for (let position = 1; position < events.length; position += 1) {
        const event = events[position];

        // The step an escalation is at: where the commission was just before it.
        // SAFETY: position is at least 1, so the slice starts with the commissioned event.
        const before = replay(definition, events.slice(0, position) as Log);
        const at = before.status === "finished" ? "" : before.step.name;

        // An attempt's entry, by its number, so its notes and its ending join it.
        const entryOf = (number: number) =>
          entries.findIndex((each) => each.entry === "attempt" && each.attempt === number);

        const notesOf = (number: number) => {
          const found = entries[entryOf(number)];

          return found?.entry === "attempt" ? found.notes : [];
        };

        // When the attempt started, as far as the log has it.
        const startOf = (number: number) => {
          const found = entries[entryOf(number)];

          return found?.entry === "attempt" ? found.started : undefined;
        };

        switch (event.type) {
          case "attempt-started":
            entries.push({
              entry: "attempt",
              attempt: event.attempt,
              step: event.step,
              notes: [],
              started: event.at,
              running: true,
            });
            break;
          case "noted":
            notesOf(event.attempt).push(event.note);
            break;
          case "attempt-completed":
            entries[entryOf(event.attempt)] = {
              entry: "attempt",
              attempt: event.attempt,
              step: event.step,
              notes: notesOf(event.attempt),
              started: startOf(event.attempt),
              ended: event.at,
              outcome: event.outcome,
              // The engine records an artifact only once its kind's verifier, if any, accepted it,
              // and the kind is the commission's own.
              artifacts: event.artifacts.map(({ hash, kind }) => ({
                hash,
                artifact: store.get(hash),
                verifier: definition.kinds[kind].verifier?.run ?? null,
              })),
              errors: event.errors !== undefined,
            };
            break;
          case "escalated":
            if (event.attempt === undefined) {
              entries.push({ entry: "escalation", step: at, reason: event.reason, at: event.at });
            } else {
              entries[entryOf(event.attempt)] = {
                entry: "attempt",
                attempt: event.attempt,
                step: at,
                notes: notesOf(event.attempt),
                started: startOf(event.attempt),
                ended: event.at,
                escalated: event.reason,
                errors: event.errors !== undefined,
              };
            }

            break;
          case "decided": {
            const decision: Entry = {
              entry: "decision",
              step: event.step,
              outcome: event.outcome,
              subject: event.subject,
              at: event.at,
            };

            const { body } = store.get(event.decision);

            if (body !== undefined) {
              decision.feedback = body;
            }

            entries.push(decision);

            break;
          }

          default:
            break;
        }
      }

      const { request } = events[0];

      return {
        state: replay(definition, events),
        request: { hash: request, artifact: store.get(request) },
        entries,
      };
    },

    /**
     * Reads the artifact kept under `hash`. Only a hash the log names as an artifact is read: the
     * store also keeps bodies, transcripts and definitions, which are not artifacts, and a hash is
     * a file name, so an unchecked one could read outside the store.
     */
    artifact(hash: string): Artifact {
      // lazy: scans the whole log. Index artifact hashes once a log is large enough to notice.
      const named = new Set(
        commissioned.all().flatMap(({ commission }) => {
          const events = read(String(commission));

          return recorded(events, definitionOf(events).kinds).map((artifact) => artifact.hash);
        }),
      );

      // A prefix as short as the 8 characters `show` prints is unique in any one owner's log.
      const matches = [...named].filter(
        (each) => each === hash || (hash.length >= 8 && each.startsWith(hash)),
      );

      if (matches.length === 0) {
        throw new Error(`There is no artifact ${hash}.`);
      }

      if (matches.length > 1) {
        throw new Error(`The prefix ${hash} names more than one artifact.`);
      }

      return store.get(matches[0]);
    },

    /**
     * Records the owner's decision about the commission's current subject, made while it waited
     * since the event at `since`, with any feedback. At an approval step the outcome must be one
     * the step declares; on an escalation it is retry or abandon.
     */
    decide(
      commission: string,
      {
        subject,
        since,
        outcome,
        feedback,
      }: { subject: string; since: number; outcome: string; feedback?: string },
    ) {
      const events = read(commission);
      const definition = definitionOf(events);
      const { workflow } = definition;
      const state = replay(definition, events);

      if (state.status !== "awaiting" && state.status !== "escalated") {
        throw new Error(`Commission ${commission} is ${state.status}, so no decision can be made.`);
      }

      if (subject !== state.subject) {
        throw new Error(`Commission ${commission} is about ${state.subject}, not ${subject}.`);
      }

      // The same subject can wait again, at a later gate or escalation, with other evidence: a
      // decision made at an earlier wait is stale.
      if (since !== state.since) {
        throw new Error(
          `Commission ${commission} has waited since event ${state.since}, not ${since}.`,
        );
      }

      const name = state.step.name;
      const step = workflow.steps[name];
      const on = step.kind === "approval" ? step.on : { retry: name, abandon: "end" };

      if (!Object.hasOwn(on, outcome)) {
        throw new Error(`Step ${name} does not declare outcome "${outcome}".`);
      }

      const feedbackBytes = Buffer.byteLength(feedback ?? "");

      if (feedbackBytes > feedbackLimit) {
        throw new Error(
          `The feedback is ${feedbackBytes} bytes, over its limit of ${feedbackLimit}.`,
        );
      }

      const event = {
        type: "decided",
        step: name,
        decision: store.put(
          feedback === undefined
            ? { kind: "decision", fields: { outcome, subject } }
            : { kind: "decision", fields: { outcome, subject }, body: feedback },
        ),
        outcome,
        subject,
        next: on[outcome],
      } as const;

      write(commission, events, event);

      return replay(definition, [...events, event]);
    },

    /** Asks the engine running the commission's attempt to stop it; that engine escalates. */
    cancel(commission: string): void {
      const events = read(commission);
      const state = replay(definitionOf(events), events);

      if (state.status !== "attempting") {
        throw new Error(
          `Commission ${commission} is ${state.status}, so no attempt can be cancelled.`,
        );
      }

      const started = events.findLast((event) => event.type === "attempt-started")!;

      // With no engine to stop it, the attempt is over already: the cancel is its end.
      if (!held(commission, started)) {
        const spool = spoolOf(commission, started.attempt);

        write(commission, events, {
          type: "escalated",
          reason: cancelledReason(started.step),
          attempt: started.attempt,
          ...spooled(spool),
        });
        unspool(spool);

        return;
      }

      request.run(commission, started.attempt);
    },

    /**
     * Attempts ready steps until the commission is awaiting, escalated or finished. Once `signal`
     * aborts, the running attempt finishes and no other starts: the commission is left ready.
     */
    async advance(
      commission: string,
      { signal }: { signal?: AbortSignal } = {},
    ): Promise<CommissionState> {
      for (;;) {
        const events = read(commission);
        const definition = definitionOf(events);
        const { workflow } = definition;
        const state = replay(definition, events);

        if (state.status === "ready" && signal?.aborted) {
          return state;
        }

        if (state.status === "attempting") {
          const started = events.findLast((event) => event.type === "attempt-started")!;

          if (held(commission, started)) {
            return state;
          }

          const spool = spoolOf(commission, started.attempt);

          write(commission, events, {
            type: "escalated",
            reason: `Step ${state.step.name} was interrupted.`,
            attempt: started.attempt,
            ...spooled(spool),
          });
          unspool(spool);

          continue;
        }

        if (state.status !== "ready") {
          return state;
        }

        const name = state.step.name;
        const step = workflow.steps[name];

        // Replay arrives at an approval step as awaiting, never ready.
        if (step.kind === "approval") {
          throw new Error(`Step ${name} is an approval step, so it cannot be ready.`);
        }

        const attempts = sinceDecision(events).filter(
          (event) => event.type === "attempt-started" && event.step === name,
        );

        if (attempts.length >= step.budget) {
          write(commission, events, {
            type: "escalated",
            reason: `Step ${name} has spent its budget of ${step.budget} attempts.`,
          });

          continue;
        }

        const given = Object.entries(step.inputs).map(([input, query]) => ({
          name: input,
          hashes: resolve(query, state, events, definition.kinds),
        }));

        // Read from the store before the attempt starts. The engine's failure here, such as a file
        // it cannot read, is nothing it can classify: the owner decides, and no budget is spent.
        const prepared = (() => {
          try {
            return {
              inputs: given.map(({ name, hashes }) => ({
                name,
                artifacts: hashes.map((hash) => ({ hash, artifact: store.get(hash) })),
              })),
              skills: (step.kind === "agent" ? (step.agent.skills ?? []) : []).map((path) => {
                const { name: skill, files } = definition.skills[path];

                return {
                  name: skill,
                  files: Object.entries(files).map(([file, hash]) => ({
                    file,
                    bytes: store.read(hash),
                  })),
                };
              }),
            };
          } catch (error) {
            return `The engine could not prepare step ${name}: ${error instanceof Error ? error.message : String(error)}`;
          }
        })();

        if (isText(prepared)) {
          write(commission, events, { type: "escalated", reason: prepared });

          continue;
        }

        const { inputs, skills } = prepared;

        // The artifact the workspace is built from, when it is an input's: one the record names.
        const source = step.workspace;
        const named = source === "subject" || source === "empty" ? undefined : source.input;

        const built =
          named === undefined
            ? undefined
            : inputs.find((input) => input.name === named)?.artifacts[0];

        if (named !== undefined && built === undefined) {
          write(commission, events, {
            type: "escalated",
            reason: `Step ${name}'s workspace input ${named} holds no artifact.`,
          });

          continue;
        }

        const bytes =
          inputs
            .flatMap(({ artifacts }) => artifacts)
            .reduce((sum, { artifact }) => sum + Buffer.byteLength(artifact.body ?? ""), 0) +
          skills
            .flatMap(({ files }) => files)
            .reduce((sum, { bytes: file }) => sum + file.length, 0);

        if (bytes > step.limits.input) {
          const what = skills.length === 0 ? "inputs are" : "inputs and skills are";

          write(commission, events, {
            type: "escalated",
            reason: `Step ${name}'s ${what} ${bytes} bytes, over its input limit of ${step.limits.input}.`,
          });

          continue;
        }

        // A repeat would see what the earlier attempt saw, so only a decision can justify it.
        const repeated = attempts.some(
          (event) =>
            event.type === "attempt-started" &&
            event.subject === state.subject &&
            isDeepStrictEqual(event.inputs, given),
        );

        if (repeated) {
          write(commission, events, {
            type: "escalated",
            reason: `Step ${name} was already attempted on this subject and these inputs.`,
          });

          continue;
        }

        const attempt = events.filter((event) => event.type === "attempt-started").length + 1;

        const started = {
          type: "attempt-started",
          step: name,
          attempt,
          subject: state.subject,
          inputs: given,
          process: self,
        } as const;

        write(commission, events, started);

        const key = runningKey(log, commission, attempt);
        const spool = spoolOf(commission, attempt);

        running.add(key);

        const cancelled = () => requested.get(commission, attempt) !== undefined;

        // Each note the attempt writes is an event of its own, after attempt-started.
        const note = (text: string) =>
          write(commission, read(commission), { type: "noted", attempt, note: text });

        try {
          const subject = {
            hash: state.subject,
            artifact: store.get(state.subject),
            kept: keptOf(events, state.subject),
          };

          const ending = await run(
            step,
            {
              commission,
              step: name,
              attempt,
              kinds: definition.kinds,
              subject,
              workspace:
                built !== undefined
                  ? { ...built, kept: keptOf(events, built.hash) }
                  : source === "subject"
                    ? subject
                    : undefined,
              inputs,
              skills,
            },
            cancelled,
            note,
            store,
            spool,
          );

          // A cancel that arrives before the attempt's end is written wins: nothing it claimed is
          // recorded.
          write(
            commission,
            read(commission),
            ending.type === "attempt-completed" && cancelled() ? cancelledEnding(ending) : ending,
          );
          unspool(spool);
        } catch (error) {
          // The engine's own failure, such as a full disk, is nothing it can classify: the owner
          // decides. If this write fails too, the next advance finds the attempt interrupted, and
          // keeps what was spooled.
          write(commission, read(commission), {
            type: "escalated",
            reason: failedIn(name, error instanceof Error ? error.message : String(error)),
            attempt,
          });
          unspool(spool);
        } finally {
          running.delete(key);
        }
      }
    },
  };
}

// Where a running attempt's transcript and errors are written as they arrive.
// An attempt's directory: its transcript and errors, written as they arrive, and the work area
// holding its workspace, input, output and kinds' programs' areas, which the disk limit bounds.
type Spool = { directory: string; work: string; transcript: string; errors: string };

// The attempts this process is running, across its engines: one it holds but is not running was
// interrupted.
const running = new Set<string>();

function runningKey(log: string, commission: string, attempt: number): string {
  return JSON.stringify([resolvePath(log), commission, attempt]);
}

// Throws why the owner's request breaks the rules of the factory's document kind, which the
// definition has made a subject with a title and no other required field.
function refuseRequest(document: Kind, { title, body }: { title: string; body: string }): void {
  const rule = document.fields.title;

  if (rule.values !== undefined && !rule.values.includes(title)) {
    throw new Error(`The request's title is not one of ${rule.values.join(", ")}.`);
  }

  if (Buffer.byteLength(title) > rule.limit) {
    throw new Error(`The request's title is over its limit of ${rule.limit} bytes.`);
  }

  if (Buffer.byteLength(body) > document.body.limit) {
    throw new Error(`The request's body is over its limit of ${document.body.limit} bytes.`);
  }
}

// A pid is reused once its process ends; with its start time from /proc it names one process.
// This process as attempt-started records it. Without it, every other engine's attempt would look
// interrupted, so the engine refuses to start rather than misjudge them.
function identity() {
  const start = startOf(process.pid);

  const boot = (() => {
    try {
      return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    } catch {
      return undefined;
    }
  })();

  if (start === undefined || boot === undefined) {
    throw new Error(
      `The engine cannot identify its own process: it needs /proc/${process.pid}/stat and /proc/sys/kernel/random/boot_id.`,
    );
  }

  return { pid: process.pid, start, boot };
}

function startOf(pid: number): number | undefined {
  let stat;

  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return undefined;
  }

  // Fields follow the command name in parentheses; the start time is the 20th after it.
  return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]);
}

// The artifacts a query names in the commission's events and current state, oldest first: none
// when there is nothing to name, such as a decision not yet made.
function resolve(
  query: Query,
  state: Extract<CommissionState, { status: "ready" }>,
  events: Log,
  kinds: Kinds,
): string[] {
  switch (query) {
    case "subject":
      return [state.subject];
    case "request":
      return [events[0].request];
    default: {
      const { from, kind, about, take } = query;

      const named = recorded(events, kinds).flatMap((artifact) =>
        (from === undefined || (artifact.step !== undefined && from.includes(artifact.step))) &&
        (kind === undefined || artifact.kind === kind) &&
        (about === undefined ||
          (artifact.about !== undefined &&
            (about === "any" || (about === "subject") === (artifact.about === state.subject))))
          ? [artifact.hash]
          : [],
      );

      return take === "latest" ? named.slice(-1) : named;
    }
  }
}

// Every artifact in the commission's record, oldest first, with the step that claimed or decided
// it and, for a judgement, the subject it is about. The request has no step.
function recorded(
  events: Log,
  kinds: Kinds,
): { hash: string; kind: string; step?: string; about?: string }[] {
  // The subject of the attempt in flight, which every judgement it claims is about.
  let judged = events[0].request;

  return events.flatMap((event) => {
    switch (event.type) {
      case "commissioned":
        return [{ hash: event.request, kind: "document" }];
      case "attempt-started":
        judged = event.subject;

        return [];
      case "attempt-completed":
        return event.artifacts.map(({ hash, kind }) =>
          kinds[kind]?.role === "subject"
            ? { hash, kind, step: event.step }
            : { hash, kind, step: event.step, about: judged },
        );
      case "decided":
        return [{ hash: event.decision, kind: "decision", step: event.step, about: event.subject }];
      default:
        return [];
    }
  });
}

// The files a verifier kept for the artifact `hash`; none for the request, which no verifier saw.
function keptOf(events: Log, hash: string): Readonly<Record<string, string>> {
  for (const event of events) {
    const found =
      event.type === "attempt-completed" &&
      event.artifacts.find((artifact) => artifact.hash === hash);

    if (found) {
      return found.kept;
    }
  }

  return {};
}

// Only the owner renews a budget or permits a repeat: both count from the latest decision.
function sinceDecision(events: Log): Log[number][] {
  return events.slice(events.findLastIndex((event) => event.type === "decided") + 1);
}

type Runnable = Extract<Definition["workflow"]["steps"][string], { kind: "agent" | "command" }>;

// An artifact, such as the commission's subject, with the files its verifier kept.
type Subject = { hash: string; artifact: Artifact; kept: Readonly<Record<string, string>> };

// What an attempt is given: the domain values its input.json encodes, the commission's subject,
// which verifiers judge a claim against, the artifact its workspace is built from, if any, and the
// kinds its claims are judged by.
type Given = {
  commission: string;
  step: string;
  attempt: number;
  kinds: Kinds;
  subject: Subject;
  workspace: Subject | undefined;
  inputs: readonly {
    name: string;
    artifacts: readonly { hash: string; artifact: Artifact }[];
  }[];
  skills: readonly { name: string; files: readonly { file: string; bytes: Buffer }[] }[];
};

type Store = ReturnType<typeof createStore>;

type Ending = Extract<CommissionEvent, { type: "attempt-completed" | "escalated" }>;

// The bytes one note may hold: a line for the owner to read, not a log.
const noteLimit = 4096;

// lazy: the bounds on an escalation's reason and the owner's feedback are constants. Make them
// limits once a factory needs others.
const reasonLimit = 4096;
const feedbackLimit = 1024 * 1024;

// The reason itself if it is within its limit; else as much of it as fits on a character
// boundary, saying it was cut, so nothing is cut silently.
function bounded(reason: string): string {
  const bytes = Buffer.byteLength(reason);

  if (bytes <= reasonLimit) {
    return reason;
  }

  const marker = ` … (cut to ${reasonLimit} of ${bytes} bytes)`;
  const room = new Uint8Array(reasonLimit - Buffer.byteLength(marker));
  const { written } = new TextEncoder().encodeInto(reason, room);

  return `${Buffer.from(room.subarray(0, written)).toString()}${marker}`;
}

// The bytes the files under `directory` take on disk. What vanishes as it is walked counts for
// nothing; what cannot be read, too, so a step could hide bytes under a directory it locks.
async function bytesUnder(directory: string): Promise<number> {
  let total = 0;

  const entries = await readdir(directory, { recursive: true }).catch(() => []);

  for (const entry of entries) {
    const stats = await lstat(join(directory, entry)).catch(() => undefined);

    total += (stats?.blocks ?? 0) * 512;
  }

  return total;
}

// Why the step must stop if an empty area of its access is full, seen through its sandbox's root,
// or undefined. The sandbox is bwrap's child, in its own mount namespace.
function filled(sandbox: number, access: Access, name: string): string | undefined {
  let root;

  try {
    const [inner] = readFileSync(`/proc/${sandbox}/task/${sandbox}/children`, "utf8").split(" ");

    root = `/proc/${inner}/root`;
  } catch {
    // Not started yet, or ended: there is nothing to look at.
    return undefined;
  }

  for (const area of access.paths) {
    if (area.mode === "empty") {
      const free = (() => {
        try {
          return statfsSync(join(root, area.path)).bavail;
        } catch {
          return undefined;
        }
      })();

      if (free === 0) {
        return `Step ${name} filled ${area.path}, its area of ${area.size} bytes.`;
      }
    }
  }

  return undefined;
}

// How often, in milliseconds, the engine running an attempt looks for the owner's cancel.
const cancelLook = 1000;

const cancelledReason = (step: string) => `Step ${step} was cancelled by the owner.`;

// The engine's own failure during a step's attempt, such as a full disk.
const failedIn = (step: string, message: string) => `Step ${step} failed in the engine: ${message}`;

// The end of a completed attempt the owner cancelled before it was written: an escalation, with
// its transcript and errors.
function cancelledEnding(completed: Extract<Ending, { type: "attempt-completed" }>): Ending {
  const ending: Ending = {
    type: "escalated",
    reason: cancelledReason(completed.step),
    attempt: completed.attempt,
    transcript: completed.transcript,
  };

  if (completed.errors !== undefined) {
    ending.errors = completed.errors;
  }

  return ending;
}

// The time a stopped step has to exit after SIGTERM before it gets SIGKILL.
const grace = 5000;

// Sends SIGTERM to the child's process group, then SIGKILL after the grace period. The group's
// leader is bwrap, which dies at once on SIGTERM and takes the program with it, so it is spared
// the SIGTERM and the program has its grace period.
function stop(child: ChildProcess): void {
  const group = child.pid!;

  for (const pid of membersOf(group)) {
    if (pid !== group) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // It exited since the group was listed.
      }
    }
  }

  const kill = setTimeout(() => process.kill(-group, "SIGKILL"), grace);

  child.once("close", () => clearTimeout(kill));
}

// The processes in process group `group`, by their pid in the engine's namespace, read from
// /proc/<pid>/stat: the group is the third field after the command name, which is in parentheses
// and may itself hold spaces or parentheses.
function membersOf(group: number): number[] {
  return readdirSync("/proc")
    .filter((entry) => /^\d+$/.test(entry))
    .filter((pid) => {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");

        return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]) === group;
      } catch {
        return false;
      }
    })
    .map(Number);
}

// Keeps every file of each skill the workflow's agents declare, refusing a skill without a SKILL.md
// or an agent with two skills of one name, and returns the skills by path.
function pin(name: string, workflow: Workflow, store: Store): Definition["skills"] {
  const invalid = (problem: string) => new Error(`Workflow ${name} is invalid: ${problem}.`);
  const pinned: Record<string, Skill> = {};

  for (const [step, declared] of Object.entries(workflow.steps)) {
    const paths = declared.kind === "agent" ? (declared.agent.skills ?? []) : [];
    const names = paths.map((path) => basename(path));
    const twice = names.find((skill, index) => names.indexOf(skill) !== index);

    if (twice !== undefined) {
      throw invalid(`step ${step}'s agent has two skills named ${twice}`);
    }

    for (const path of paths) {
      if (!existsSync(join(path, "SKILL.md"))) {
        throw invalid(`step ${step}'s agent's skill ${path} has no SKILL.md`);
      }

      const files = readdirSync(path, { recursive: true, withFileTypes: true }).flatMap((entry) => {
        const file = join(entry.parentPath, entry.name);

        return entry.isDirectory() ? [] : [[relative(path, file), store.keep(readFileSync(file))]];
      });

      pinned[path] = { name: basename(path), files: Object.fromEntries(files) };
    }
  }

  return pinned;
}

// Writes input.json, listing each declared input's artifacts, and each body as <input>/<hash>.
// The sandbox binds the input read-only.
async function prepare(input: string, step: Runnable, given: Given): Promise<void> {
  await mkdir(input);

  const inputs = new Map<
    string,
    { hash: string; kind: string; fields: Artifact["fields"]; body?: string }[]
  >();

  for (const { name, artifacts } of given.inputs) {
    const listed = [];

    for (const { hash, artifact } of artifacts) {
      const { kind, fields } = artifact;

      if (artifact.body === undefined) {
        listed.push({ hash, kind, fields });
      } else {
        await mkdir(join(input, name), { recursive: true });
        await writeFile(join(input, name, hash), artifact.body);
        listed.push({ hash, kind, fields, body: `${name}/${hash}` });
      }
    }

    inputs.set(name, listed);
  }

  // Under .skills, which no input name can be.
  for (const { name, files } of given.skills) {
    for (const { file, bytes } of files) {
      await mkdir(dirname(join(input, ".skills", name, file)), { recursive: true });
      await writeFile(join(input, ".skills", name, file), bytes);
    }
  }

  const encoded = {
    commission: given.commission,
    step: given.step,
    attempt: given.attempt,
    outcomes: Object.keys(step.on),
    inputs: Object.fromEntries(inputs),
    // What a claim of each kind holds; the programs behind a kind are the engine's, not the step's.
    claims: Object.fromEntries(
      step.claims.map((kind) => {
        const { description, fields, body, outcome } = given.kinds[kind];

        return [kind, { description, fields, body, outcome }];
      }),
    ),
    // Left out of a command step's input.json, which has no agent.
    agent:
      step.kind === "agent"
        ? {
            model: step.agent.model,
            prompt: step.agent.prompt,
            skills: given.skills.map(({ name }) => ({ name, path: `.skills/${name}` })),
          }
        : undefined,
  };

  await writeFile(join(input, "input.json"), JSON.stringify(encoded));
}

// The transcript and claimed artifacts go to the store before the event naming them is written.
async function run(
  step: Runnable,
  given: Given,
  cancelled: () => boolean,
  note: (text: string) => void,
  store: Store,
  spool: Spool,
): Promise<Ending> {
  const { step: name, attempt } = given;
  const directory = spool.work;

  // Attempt numbers are not reused, so anything already there is a removal that failed: start
  // clean.
  await rm(spool.directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });

  const workspace = join(directory, "workspace");
  const input = join(directory, "input");
  const output = join(directory, "output");

  // stdout and stderr together, in the order they arrive, up to the transcript limit; and the
  // stderr of it alone, as the attempt's errors.
  const transcript = openSync(spool.transcript, "w");
  const errors = openSync(spool.errors, "w");
  let erred = false;
  let written = 0;

  // Stores the transcript, and the errors when there are any, on the event that ends the attempt.
  const recorded = <E extends Ending>(event: Omit<E, "transcript">): E => {
    // SAFETY: E is the event given, with the transcript every ending event can carry.
    const ended = { ...event, transcript: store.keep(readFileSync(spool.transcript)) } as E;

    if (erred) {
      ended.errors = store.keep(readFileSync(spool.errors));
    }

    return ended;
  };

  const escalate = (reason: string): Ending =>
    recorded<Extract<Ending, { type: "escalated" }>>({ type: "escalated", reason, attempt });

  const { disk } = step.limits;
  const overDisk = `Step ${name} used more than its disk limit of ${disk} bytes.`;

  // Measured while the attempt's programs run, so a runaway is stopped within a look; and after
  // each, so one that wrote and exited at once is caught.
  let over = false;
  let measuring = false;

  const measure = async () => {
    if (!measuring) {
      measuring = true;
      over ||= (await bytesUnder(directory)) > disk;
      measuring = false;
    }
  };

  const watching = setInterval(() => void measure(), cancelLook);

  // The engine's own failure while a program ran, such as a note it could not write. It is caught
  // where it happens, since a throw from an event handler or timer would end the engine's process.
  let fault: string | undefined;

  // Why the attempt must stop now, if it must.
  const halt = () => {
    if (fault === undefined) {
      try {
        if (cancelled()) {
          return cancelledReason(name);
        }
      } catch (error) {
        fault = failedIn(name, error instanceof Error ? error.message : String(error));
      }
    }

    return fault ?? (over ? overDisk : undefined);
  };

  const halted = () => halt() !== undefined;

  // Why the attempt must stop once a program has ended, measured afresh.
  const after = async () => {
    over ||= (await bytesUnder(directory)) > disk;

    return halt();
  };

  try {
    await mkdir(workspace);

    if (given.workspace !== undefined) {
      const failed = await materialise(
        directory,
        workspace,
        name,
        given.workspace,
        given.kinds,
        store,
        halted,
      );

      // A materialiser stopped by a cancel or the disk limit fails; that is the reason.
      const halting = await after();

      if (halting !== undefined) {
        return escalate(halting);
      }

      if (failed !== undefined) {
        return escalate(failed);
      }
    }

    await prepare(input, step, given);
    await mkdir(output);

    // An agent step's program is its harness adapter, under the same contract.
    const bounds = { memory: step.limits.memory, processes: step.limits.processes };

    const { command, args, env, unit } = confine(
      step.access,
      { workspace, input, output },
      step.kind === "agent" ? step.agent.harness.run : step.run,
      bounds,
    );

    // Its own session and process group: stopping the step also stops what it started, and
    // without a controlling terminal the step cannot push input into the owner's.
    const child = spawn(command, args, {
      cwd: workspace,
      env,
      // fd 3 is the step's notes for the owner, one per line.
      stdio: ["ignore", "pipe", "pipe", "pipe"],
      detached: true,
    });

    let stopped: string | undefined;

    // The first reason to stop is the one recorded; stopping twice would signal a group that may be gone.
    const stopFor = (reason: string) => {
      if (stopped === undefined) {
        stopped = reason;
        stop(child);
      }
    };

    // Runs a handler of the step's output; the engine's failure in it stops the step.
    const guarded =
      (handler: (chunk: Buffer) => void) =>
      (chunk: Buffer): void => {
        try {
          handler(chunk);
        } catch (error) {
          fault ??= failedIn(name, error instanceof Error ? error.message : String(error));
          stopFor(fault);
        }
      };

    const idle = setTimeout(
      () => stopFor(`Step ${name} was idle for ${step.limits.idle} s.`),
      step.limits.idle * 1000,
    );

    const overall = setTimeout(
      () => stopFor(`Step ${name} reached its attempt limit of ${step.limits.attempt} s.`),
      step.limits.attempt * 1000,
    );

    const cancel = setInterval(() => {
      const why = halt() ?? filled(child.pid!, step.access, name);

      if (why !== undefined) {
        stopFor(why);
      }
    }, cancelLook);

    // stdout and stderr go to the transcript, and stderr to the errors too.
    const record = (stderr: boolean) => (chunk: Buffer) => {
      idle.refresh();

      const room = step.limits.transcript - written;
      const kept = chunk.subarray(0, Math.max(room, 0));

      writeSync(transcript, kept);
      written += chunk.length;

      if (stderr && kept.length > 0) {
        writeSync(errors, kept);
        erred = true;
      }

      if (written > step.limits.transcript) {
        stopFor(
          `Step ${name} wrote more than its transcript limit of ${step.limits.transcript} bytes.`,
        );
      }
    };

    child.stdout!.on("data", guarded(record(false)));
    child.stderr!.on("data", guarded(record(true)));

    // The part of a note whose line has not ended yet.
    let pending = Buffer.alloc(0);

    // Records each complete line as a note, unless it is empty. A note's bytes count toward the
    // transcript limit, so notes are bounded with everything else the step writes.
    const noteFrom = (chunk: Buffer) => {
      idle.refresh();
      written += chunk.length;

      if (written > step.limits.transcript) {
        stopFor(
          `Step ${name} wrote more than its transcript limit of ${step.limits.transcript} bytes.`,
        );

        return;
      }

      pending = Buffer.concat([pending, chunk]);

      for (let end = pending.indexOf(10); end !== -1; end = pending.indexOf(10)) {
        noteLine(pending.subarray(0, end));
        pending = pending.subarray(end + 1);
      }

      if (pending.length > noteLimit) {
        noteLine(pending);
      }
    };

    const noteLine = (line: Buffer) => {
      if (stopped !== undefined) {
        return;
      }

      if (line.length > noteLimit) {
        stopFor(`Step ${name} wrote a note over its limit of ${noteLimit} bytes.`);

        return;
      }

      const text = line.toString().trimEnd();

      if (text !== "") {
        note(text);
      }
    };

    child.stdio[3]!.on("data", guarded(noteFrom));

    const closed = await once(child, "close")
      .catch((error: NodeJS.ErrnoException) => error)
      .finally(() => {
        clearTimeout(idle);
        clearTimeout(overall);
        clearInterval(cancel);
      });

    // A last note need not end its line.
    noteLine(pending);

    if (closed instanceof Error) {
      return escalate(`Step ${name} could not start: ${closed.code}.`);
    }

    const [code, signal] = closed;

    if (stopped !== undefined) {
      return escalate(stopped);
    }

    const halting = await after();

    if (halting !== undefined) {
      return escalate(halting);
    }

    if (code !== 0) {
      // systemd stops the whole scope; only it knows why.
      if (overMemory(unit)) {
        return escalate(`Step ${name} reached its memory limit of ${bounds.memory} bytes.`);
      }

      return escalate(
        signal ? `Step ${name} was ended by ${signal}.` : `Step ${name} exited with code ${code}.`,
      );
    }

    const claim = await parse(step, name, output, given.subject.hash, given.kinds);

    if ("reason" in claim) {
      return escalate(claim.reason);
    }

    // Each artifact whose kind has a verifier is accepted by it, which may keep files.
    const verified = [];

    for (const artifact of claim.artifacts) {
      const { verifier } = given.kinds[artifact.kind];

      if (verifier !== undefined) {
        const result = await verify(
          directory,
          workspace,
          name,
          artifact,
          verifier,
          given.subject,
          store,
          halted,
        );

        const stopped = await after();

        if (stopped !== undefined) {
          return escalate(stopped);
        }

        if ("reason" in result) {
          return escalate(result.reason);
        }

        verified.push({ artifact, kept: result.kept });
      } else {
        verified.push({ artifact, kept: {} });
      }
    }

    return recorded<Extract<Ending, { type: "attempt-completed" }>>({
      type: "attempt-completed",
      step: name,
      attempt,
      outcome: claim.outcome,
      artifacts: verified.map(({ artifact, kept }) => ({
        hash: store.put(artifact),
        kind: artifact.kind,
        kept,
      })),
      next: step.on[claim.outcome],
    });
  } finally {
    clearInterval(watching);
    closeSync(transcript);
    closeSync(errors);
    await rm(directory, { recursive: true, force: true });
  }
}

type Claim = { outcome: string; artifacts: Artifact[] };

// The largest output.json the engine reads, in bytes. It holds fields only; bodies are files.
// lazy: a constant. Make it a limit once a kind's fields need more room than this.
const claimLimit = 64 * 1024;

// Fatal, so invalid bytes are refused rather than replaced; the byte order mark is kept as written.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// Parses the claim a step wrote to `output`, or gives the reason it is invalid. Everything in the
// output directory is the step's doing, so any failure to read it is the step's.
async function parse(
  step: Runnable,
  name: string,
  output: string,
  subject: string,
  kinds: Kinds,
): Promise<Claim | { reason: string }> {
  const bytes = await readAtMost(join(output, "output.json"), claimLimit);

  if (bytes === undefined) {
    return { reason: `Step ${name} exited 0 without a readable output.json.` };
  }

  if (bytes.length > claimLimit) {
    return { reason: `Step ${name} wrote an output.json over its limit of ${claimLimit} bytes.` };
  }

  let claim;

  try {
    claim = JSON.parse(utf8.decode(bytes));
  } catch {
    return { reason: `Step ${name} wrote an output.json that is not JSON.` };
  }

  // Strict equality with a declared key also refuses an outcome that is not a string.
  const outcome = Object.keys(step.on).find((declared) => declared === claim?.outcome);

  if (outcome === undefined) {
    return {
      reason: `Step ${name} claimed an outcome it does not declare: ${JSON.stringify(claim?.outcome)}.`,
    };
  }

  // A misspelt field would otherwise drop the claim it was meant to carry.
  const undefinedFields = Object.keys(claim).filter(
    (field) => field !== "outcome" && field !== "artifacts",
  );

  if (undefinedFields.length > 0) {
    return {
      reason: `Step ${name} wrote an output.json with fields it does not define: ${JSON.stringify(undefinedFields)}.`,
    };
  }

  const claimed = Object.hasOwn(claim, "artifacts") ? claim.artifacts : [];

  if (!Array.isArray(claimed)) {
    return { reason: `Step ${name} claimed artifacts that are not a list.` };
  }

  const artifacts: Artifact[] = [];

  for (const artifact of claimed) {
    // Every property read below is checked before it is used.
    const { kind, fields, body } = artifact ?? {};

    if (kind === "decision") {
      return { reason: `Step ${name} claimed a decision, which only the owner makes.` };
    }

    if (!isText(kind) || !step.claims.includes(kind)) {
      return {
        reason: `Step ${name} claimed an artifact of undeclared kind: ${JSON.stringify(kind)}.`,
      };
    }

    // The definition allows only kinds in the table, so the step's claims name one.
    const definition: Kind = kinds[kind];

    if (
      !isRecord(fields) ||
      !hasExactly(artifact, body === undefined ? ["kind", "fields"] : ["kind", "fields", "body"])
    ) {
      return {
        reason: `Step ${name} claimed a ${kind} that is not a kind, its fields and a body path.`,
      };
    }

    // The engine names a judgement's subject, so a claimed subject is refused here as undefined.
    const undefinedFields = Object.keys(fields).filter(
      (field) => !Object.hasOwn(definition.fields, field),
    );

    if (undefinedFields.length > 0) {
      return {
        reason: `Step ${name} claimed a ${kind} with fields its kind does not define: ${JSON.stringify(undefinedFields)}.`,
      };
    }

    const given = new Map(Object.entries(fields));
    const parsed: Record<string, string> = {};

    for (const [field, rule] of Object.entries(definition.fields)) {
      const value = given.get(field);

      if (value === undefined) {
        if (rule.required) {
          return { reason: `Step ${name} claimed a ${kind} without its ${field}.` };
        }

        continue;
      }

      if (!isText(value)) {
        return { reason: `Step ${name} claimed a ${kind} ${field} that is not text.` };
      }

      if (rule.values !== undefined && !rule.values.includes(value)) {
        return {
          reason: `Step ${name} claimed a ${kind} ${field} that is not one of ${rule.values.join(", ")}.`,
        };
      }

      if (Buffer.byteLength(value) > rule.limit) {
        return {
          reason: `Step ${name} claimed a ${kind} ${field} over its limit of ${rule.limit} bytes.`,
        };
      }

      parsed[field] = value;
    }

    // The kind's outcome field, such as a verdict's, so the edge followed is the judgement given.
    if (definition.outcome !== undefined && parsed[definition.outcome] !== outcome) {
      return {
        reason: `Step ${name} claimed a ${kind} whose ${definition.outcome} is ${parsed[definition.outcome]}, not its outcome ${outcome}.`,
      };
    }

    // The engine names a judgement's subject: the one the attempt was given, which the step judged.
    if (definition.role === "judgement") {
      parsed.subject = subject;
    }

    if (body === undefined) {
      if (definition.body.required) {
        return { reason: `Step ${name} claimed a ${kind} without its body.` };
      }

      artifacts.push({ kind, fields: parsed });

      continue;
    }

    if (!isText(body)) {
      return { reason: `Step ${name} claimed a ${kind} body that is not a path.` };
    }

    const read = await readBody(name, output, body, definition.body.limit);

    if ("reason" in read) {
      return read;
    }

    artifacts.push({ kind, fields: parsed, body: read.text });
  }

  return { outcome, artifacts };
}

// Reads the body a claim names under `output` as UTF-8 text of at most `limit` bytes, or gives the
// reason it cannot.
async function readBody(
  name: string,
  output: string,
  body: string,
  limit: number,
): Promise<{ text: string } | { reason: string }> {
  const read = await readUnder(output, body, limit);

  if (read === "outside") {
    return { reason: `Step ${name} claimed a body outside its output: ${JSON.stringify(body)}.` };
  }

  if (read === undefined) {
    return { reason: `Step ${name} claimed a body it did not write: ${JSON.stringify(body)}.` };
  }

  if (read.length > limit) {
    return {
      reason: `Step ${name} claimed a body over its limit of ${limit} bytes: ${JSON.stringify(body)}.`,
    };
  }

  let text;

  try {
    text = utf8.decode(read);
  } catch {
    return { reason: `Step ${name} claimed a body that is not UTF-8: ${JSON.stringify(body)}.` };
  }

  return { text };
}

// Reads the file `path` names under `root`, as readAtMost does. Resolved first, so neither .. nor a
// symbolic link can reach outside root.
async function readUnder(
  root: string,
  path: string,
  limit: number,
): Promise<Buffer | "outside" | undefined> {
  const real = await realpath(join(root, path)).catch(() => undefined);

  if (real === undefined) {
    return undefined;
  }

  if (relative(await realpath(root), real).split(sep)[0] === "..") {
    return "outside";
  }

  return readAtMost(real, limit);
}

// Reads a regular file, stopping one byte past `limit`, so a file over its limit, or still growing,
// is never read whole; undefined when there is no regular file. Non-blocking, so a FIFO cannot hang
// the engine.
async function readAtMost(path: string, limit: number): Promise<Buffer | undefined> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK).catch(() => undefined);

  if (file === undefined) {
    return undefined;
  }

  try {
    if (!(await file.stat()).isFile()) {
      return undefined;
    }

    // In chunks, so memory follows the file's size rather than the limit.
    const chunks: Buffer[] = [];
    let length = 0;

    for (;;) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, limit + 1 - length));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, length);

      if (bytesRead === 0) {
        return Buffer.concat(chunks);
      }

      chunks.push(chunk.subarray(0, bytesRead));
      length += bytesRead;

      if (length > limit) {
        return Buffer.concat(chunks);
      }
    }
  } catch {
    return undefined;
  } finally {
    await file.close();
  }
}

// The seconds a verifier or materialiser may run before it is stopped.

// A kept file is named by a plain file name, so it can be written anywhere without a path.
const plainName = /^(?!\.\.?$)[A-Za-z0-9._-]+$/;

// Runs a kind's program in `workspace` under its access, with `input` and `output` as its
// directories, stopped after its limit or once the attempt is cancelled. Returns why it failed, or
// undefined when it exited 0.
async function runProgram(
  program: Program,
  workspace: string,
  input: string,
  output: string,
  cancelled: () => boolean,
): Promise<string | undefined> {
  const { command, args, env, unit } = confine(
    program.access,
    { workspace, input, output },
    program.run,
    { memory: program.memory, processes: program.processes },
  );

  const child = spawn(command, args, {
    cwd: workspace,
    env,
    stdio: ["ignore", "ignore", "pipe"],
    detached: true,
  });

  // Only the end of its stderr is kept, which is where a failing program says why.
  let tail = Buffer.alloc(0);
  let written = 0;

  child.stderr.on("data", (chunk: Buffer) => {
    tail = Buffer.concat([tail, chunk]).subarray(-stderrTail);
    written += chunk.length;
  });

  let late = false;

  const limit = setTimeout(() => {
    late = true;
    stop(child);
  }, program.limit * 1000);

  const cancel = setInterval(() => {
    if (cancelled()) {
      stop(child);
    }
  }, cancelLook);

  const closed = await once(child, "close")
    .catch((error: NodeJS.ErrnoException) => error)
    .finally(() => {
      clearTimeout(limit);
      clearInterval(cancel);
    });

  if (closed instanceof Error) {
    return `it could not start: ${closed.code}.`;
  }

  const stderr =
    written === 0
      ? ""
      : written > stderrTail
        ? ` The last ${stderrTail} bytes of its stderr: ${JSON.stringify(tail.toString())}.`
        : ` Its stderr: ${JSON.stringify(tail.toString())}.`;

  if (late) {
    return `it reached its limit of ${program.limit} s.${stderr}`;
  }

  if (closed[0] !== 0 && overMemory(unit)) {
    return `it reached its memory limit of ${program.memory} bytes.${stderr}`;
  }

  const [code, signal] = closed;

  if (code === 0) {
    return undefined;
  }

  return signal ? `it was ended by ${signal}.${stderr}` : `it exited with code ${code}.${stderr}`;
}

// The bytes of a failing kind program's stderr its escalation reason ends with.
const stderrTail = 1024;

// Makes an input and an output directory for a built-in program, inside the attempt's directory.
async function areaFor(directory: string, program: string) {
  const area = await mkdtemp(join(directory, `${program}-`));
  const input = join(area, "input");
  const output = join(area, "output");

  await mkdir(input);
  await mkdir(output);

  return { input, output };
}

// Runs the claim's kind's verifier in the attempt's workspace, and stores the files it keeps.
// lazy: the workspace is not read-only to the verifier; the sandbox makes it so.
async function verify(
  directory: string,
  workspace: string,
  name: string,
  claim: Artifact,
  verifier: NonNullable<Kind["verifier"]>,
  subject: Subject,
  store: Store,
  cancelled: () => boolean,
): Promise<{ kept: Record<string, string> } | { reason: string }> {
  const { input, output } = await areaFor(directory, "verifier");
  const { kind } = claim;

  const failed = (why: string) => ({
    reason: `The ${kind} verifier failed on step ${name}'s claim: ${why}`,
  });

  if (claim.body !== undefined) {
    await writeFile(join(input, "body"), claim.body);
  }

  await writeFile(
    join(input, "claim.json"),
    JSON.stringify({
      fields: claim.fields,
      body: claim.body === undefined ? undefined : "body",
      subject: { hash: subject.hash, kind: subject.artifact.kind, fields: subject.artifact.fields },
    }),
  );

  const why = await runProgram(verifier, workspace, input, output, cancelled);

  if (why !== undefined) {
    return failed(why);
  }

  const bytes = await readAtMost(join(output, "output.json"), claimLimit);
  let verdict;

  try {
    verdict = bytes === undefined ? undefined : JSON.parse(utf8.decode(bytes));
  } catch {
    verdict = undefined;
  }

  // Exactly an acceptance with the files to keep, or a rejection with its reason: a field the
  // contract does not define is nothing the engine can classify.
  const exactly = (fields: readonly string[]) => hasExactly(verdict, fields);

  if (verdict?.accepted === false && isText(verdict.reason) && exactly(["accepted", "reason"])) {
    return { reason: `Step ${name} claimed a ${kind} its verifier rejected: ${verdict.reason}` };
  }

  if (
    verdict?.accepted !== true ||
    !Array.isArray(verdict.keep) ||
    !exactly(["accepted", "keep"])
  ) {
    return failed("it wrote no valid output.json.");
  }

  const read = new Map<string, Buffer>();
  let room = verifier.kept;

  for (const file of verdict.keep) {
    if (!isText(file) || !plainName.test(file)) {
      return failed(`it kept a file without a plain name: ${JSON.stringify(file)}.`);
    }

    const bytes = await readUnder(output, file, room);

    if (bytes === undefined || bytes === "outside") {
      return failed(`it kept ${file}, which is missing.`);
    }

    if (bytes.length > room) {
      return failed(`the files it kept total more than its limit of ${verifier.kept} bytes.`);
    }

    room -= bytes.length;
    read.set(file, bytes);
  }

  // Into the store only once all of them are within the limit.
  return { kept: Object.fromEntries([...read].map(([file, bytes]) => [file, store.keep(bytes)])) };
}

// Builds the workspace from an artifact, the subject or an input's, with its kind's materialiser.
// Returns why it failed, or undefined.
async function materialise(
  directory: string,
  workspace: string,
  name: string,
  from: Subject,
  kinds: Kinds,
  store: Store,
  cancelled: () => boolean,
): Promise<string | undefined> {
  const { artifact } = from;

  const materialiser = kinds[artifact.kind]?.materialiser;

  if (materialiser === undefined) {
    return `Step ${name}'s workspace cannot be built from a ${artifact.kind}, whose kind has no materialiser.`;
  }

  const { input, output } = await areaFor(directory, "materialiser");

  await mkdir(join(input, "kept"));

  for (const [file, hash] of Object.entries(from.kept)) {
    await writeFile(join(input, "kept", file), store.read(hash));
  }

  if (artifact.body !== undefined) {
    await writeFile(join(input, "body"), artifact.body);
  }

  await writeFile(
    join(input, "artifact.json"),
    JSON.stringify({
      hash: from.hash,
      kind: artifact.kind,
      fields: artifact.fields,
      body: artifact.body === undefined ? undefined : "body",
      kept: Object.fromEntries(Object.keys(from.kept).map((file) => [file, `kept/${file}`])),
    }),
  );

  const why = await runProgram(materialiser, workspace, input, output, cancelled);

  return why === undefined
    ? undefined
    : `The ${artifact.kind} materialiser failed for step ${name}: ${why}`;
}
