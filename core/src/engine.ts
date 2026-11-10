import { spawn, type ChildProcess } from "node:child_process";
import { isatty } from "node:tty";
import { inTerminal, keepTerminal, keysAt, underTerminal } from "./terminal.ts";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  closeSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  watch,
  writeFileSync,
  writeSync,
  fstatSync,
  readSync,
  realpathSync,
} from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rm, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve as resolvePath,
  sep,
} from "node:path";
import { hostname, tmpdir } from "node:os";
import { connect as connectTo, createServer as createNetServer, type Socket } from "node:net";
import { DatabaseSync } from "node:sqlite";
import {
  type Access,
  type Children,
  type Commissioning,
  type Definition,
  type Factory,
  type Query,
  type Skill,
  type Trigger,
  type Watch,
  type Workflow,
} from "./definition.ts";
import {
  replay,
  type Cause,
  type Commissioned,
  type CommissionEvent,
  type CommissionState,
  type Usage,
} from "./replay.ts";
import { parseDefinition } from "./parse-definition.ts";
import {
  admit,
  because,
  finishOf,
  outcomeOf,
  overMoney,
  repeats,
  routedBy,
  routeOf,
  sessionsOf,
  spentIn,
  waitOf,
  type Allowance,
  type Inputs,
  type Log,
  type Why,
} from "./progress.ts";
import { hasExactly, isRecord, isText } from "./json.ts";
import { confine, fullArea, inScope, overMemory, stop, type Bounds } from "./sandbox.ts";
import type { Kind, Kinds, Program } from "./kinds.ts";
import { createStore, type Artifact } from "./store.ts";

// The milliseconds a write waits for another process's write to the log.
const logWait = 5000;

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
      notes: Note[];
      started?: number;
      running: true;
    }
  | {
      entry: "attempt";
      attempt: number;
      step: string;
      notes: Note[];
      started?: number;
      ended?: number;
      outcome: string;
      // verifier is the command of the verifier that accepted the artifact, or null when its kind
      // has none, as the commission's definition holds it.
      artifacts: { hash: string; artifact: Artifact; verifier: Program["run"] | null }[];
      errors: boolean;
      // What its step reported it used, when it did.
      usage?: Usage;
    }
  | {
      entry: "attempt";
      attempt: number;
      step: string;
      notes: Note[];
      started?: number;
      ended?: number;
      escalated: string;
      // Absent for an escalation written before escalations carried a cause.
      cause?: Cause;
      // The step its step routed it to, when it did.
      next?: string;
      errors: boolean;
      usage?: Usage;
    }
  | { entry: "escalation"; step: string; reason: string; cause?: Cause; at?: number }
  // A child its parent no longer waited for, finished by the engine.
  | { entry: "withdrawal"; step: string; reason: string; at?: number }
  | {
      entry: "decision";
      step: string;
      outcome: string;
      subject: string;
      feedback?: string;
      at?: number;
    };

// A note for the owner while an attempt runs: one its step wrote, or the engine's, such as what an
// attended step's output holds.
type Note = { note: string; from: "step" | "engine" };

/** A commission's state, its request and its record, oldest first. */
export type CommissionRecord = {
  state: CommissionState;
  request: { hash: string; artifact: Artifact };
  origin?: Commissioned["origin"];
  entries: Entry[];
};

// How a commission is named and started: by the owner, under a name, or through a trigger, which
// names it after itself unless given one.
type Naming = { name: string; trigger?: string } | { name?: string; trigger: string };

// An event the engine writes: an escalation it writes always names its cause.
type Written = Exclude<Log[1], { type: "escalated" }> | Escalation;

type Started = Extract<CommissionEvent, { type: "attempt-started" }>;

type Escalation = Extract<CommissionEvent, { type: "escalated" }> & { cause: Cause };

// Which of a trigger's caps refuses more commissions, with what it counted.
type Refusal =
  | { cap: "missing" }
  | { cap: "workflow" }
  | { cap: "rate"; started: number; count: number; per: number }
  | { cap: "allowance"; started: number; allowance: number }
  | { cap: "unfinished"; open: number; unfinished: number }
  | { cap: "unknown"; commission: string; usd: number }
  | { cap: "usd"; spent: number; usd: number; period: string };

/**
 * Runs commissions through the owner's workflows, keeping every event in the SQLite log at `log`
 * and every artifact in the store beside it.
 */
export function createEngine({ log, workflows, kinds, defaults, triggers = {} }: Factory) {
  refuseTriggers(triggers, workflows);

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

  // The commissions the trigger named started, oldest first, by their first event.
  const startedBy = database.prepare(
    "SELECT commission FROM events WHERE position = 0 AND json_extract(event, '$.origin.trigger') = ? ORDER BY rowid",
  );

  // The owner's renewals of triggers' allowances: when each was renewed. A renewal belongs to no
  // commission, so it is kept beside the events, never changed.
  database.exec(`CREATE TABLE IF NOT EXISTS renewals (
    trigger TEXT NOT NULL, at INTEGER NOT NULL) STRICT`);

  const renewing = database.prepare("INSERT INTO renewals VALUES (?, ?)");
  const renewedAt = database.prepare("SELECT max(at) AS at FROM renewals WHERE trigger = ?");

  // When the trigger named was last renewed, or 0 if never.
  const lastRenewal = (name: string) => Number(renewedAt.get(name)?.at ?? 0);

  // Why the trigger named may not start `count` more commissions of `workflow` now, if it may not:
  // past its rate or allowance, with too many unfinished, or past its money limit.
  function refusalOf(name: string, workflow: string, count: number): Refusal | undefined {
    if (!Object.hasOwn(triggers, name)) {
      return { cap: "missing" };
    }

    const { workflows: allowed, rate, allowance, unfinished, usd } = triggers[name];

    if (!allowed.includes(workflow)) {
      return { cap: "workflow" };
    }

    // SAFETY: the query selects the commission column, which holds text.
    const started = startedBy.all(name).map(({ commission }) => ({
      commission: commission as string,
      events: read(commission as string),
    }));

    const renewed = lastRenewal(name);

    const startedSince = (moment: number) =>
      started.filter(({ events }) => (events[0].at ?? 0) >= moment);

    const recent = startedSince(rate === undefined ? renewed : Date.now() - rate.per * 1000);

    if (rate !== undefined && recent.length + count > rate.count) {
      return { cap: "rate", started: recent.length, ...rate };
    }

    const sinceRenewal = startedSince(renewed).length;

    if (allowance !== undefined && sinceRenewal + count > allowance) {
      return { cap: "allowance", started: sinceRenewal, allowance };
    }

    const open = started.filter(
      ({ events }) => replay(definitionOf(events), events).status !== "finished",
    ).length;

    if (open + count > unfinished) {
      return { cap: "unfinished", open, unfinished };
    }

    if (usd === undefined) {
      return undefined;
    }

    let spent = 0;

    for (const { commission, events } of recent) {
      const cost = spentIn(events, definitionOf(events).workflow);

      if ("unknown" in cost) {
        return { cap: "unknown", commission, usd };
      }

      spent += cost.spent;
    }

    const period = rate === undefined ? "since it was last renewed" : `in the last ${rate.per} s`;

    return spent >= usd ? { cap: "usd", spent, usd, period } : undefined;
  }

  // Refuses a commission of `workflow` that a program outside the engine asks the trigger named to
  // start now, saying which of its caps it is past.
  function refuseTriggered(name: string, workflow: string): void {
    const refusal = refusalOf(name, workflow, 1);
    const plural = (count: number) => `${count} commission${count === 1 ? "" : "s"}`;

    switch (refusal?.cap) {
      case undefined:
        return;
      case "missing":
        throw new Error(`There is no trigger named ${name}.`);
      case "workflow":
        throw new Error(`Trigger ${name} may not start workflow ${workflow}.`);
      case "rate":
        throw new Error(
          `Trigger ${name} started ${plural(refusal.started)} in the last ${refusal.per} s, its rate.`,
        );
      case "allowance":
        throw new Error(
          `Trigger ${name} has started ${plural(refusal.started)} since it was last renewed, its allowance.`,
        );
      case "unfinished":
        throw new Error(
          `Trigger ${name} has ${refusal.open} unfinished commission${refusal.open === 1 ? "" : "s"}, its limit.`,
        );
      case "unknown":
        throw new Error(
          `Trigger ${name}'s commission ${refusal.commission} reported no cost, so its spend counts as over its money limit of $${refusal.usd}.`,
        );
      case "usd":
        throw new Error(
          `Trigger ${name}'s commissions ${refusal.period} cost $${refusal.spent}, its money limit of $${refusal.usd}.`,
        );
      default:
        return assertNever(refusal);
    }
  }

  // Why the commission step `name` may not start `count` commissions through its trigger now, if it
  // may not, for the owner, who may renew the trigger and retry.
  function stepRefusal(name: string, step: Commissioning<string>, count: number): Why | undefined {
    const refusal = refusalOf(step.trigger, step.workflow, count);
    const would = `Step ${name} would start ${count} commission${count === 1 ? "" : "s"} through trigger ${step.trigger}`;

    const which = (() => {
      switch (refusal?.cap) {
        case undefined:
          return undefined;
        // An engine refuses a commission step whose trigger is not the factory's or may not
        // start its workflow, so another engine's factory must differ.
        case "missing":
          return `which this engine's factory lacks.`;
        case "workflow":
          return `which may not start workflow ${step.workflow}.`;
        case "rate":
          return `which started ${refusal.started} in the last ${refusal.per} s, of its rate of ${refusal.count}.`;
        case "allowance":
          return `which has ${refusal.allowance - refusal.started} of its allowance of ${refusal.allowance} left.`;
        case "unfinished":
          return `which has ${refusal.open} unfinished of its limit of ${refusal.unfinished}.`;
        case "unknown":
          return `whose commission ${refusal.commission} reported no cost, so its spend counts as over its money limit of $${refusal.usd}.`;
        case "usd":
          return `whose commissions ${refusal.period} cost $${refusal.spent}, its money limit of $${refusal.usd}.`;
        default:
          return assertNever(refusal);
      }
    })();

    return which === undefined ? undefined : because("trigger", `${would}, ${which}`);
  }

  // Starts a commission of the factory's workflow `workflow` about the document `request`, named
  // `commission`, or after its trigger and numbered, with its origin and the artifacts it is
  // given, by hash, whose kept files the record `events` holds. Returns its name.
  function begin(
    workflow: string,
    commission: string | undefined,
    request: string,
    {
      origin,
      given = [],
      events,
    }: { origin?: Commissioned["origin"]; given?: readonly string[]; events?: Log } = {},
  ): string {
    const name = commission ?? `${origin!.trigger}-${startedBy.all(origin!.trigger).length + 1}`;
    const text = pinned(workflow, checked(workflow), (bytes) => store.keep(bytes));
    const event = commissioning(workflow, text, request);

    if (origin !== undefined) {
      event.origin = origin;
    }

    if (given.length > 0) {
      event.given = givenOf(given, events);
    }

    insert.run(name, 0, JSON.stringify({ ...event, at: Date.now() }));

    return name;
  }

  // The event that commissions a commission of `workflow` on the definition `text`, about
  // `request`: kept, and replayed, so a definition it could not start on is refused here.
  function commissioning(workflow: string, text: string, request: string): Commissioned {
    const event: Commissioned = {
      type: "commissioned",
      workflow,
      engine: engineVersion(),
      definition: store.keep(text),
      request,
    };

    replay(parseDefinition(workflow, text), [event]);

    return event;
  }

  // The artifacts a commission is given, by hash, each with its kind and the files its verifier
  // kept, which the record `events` holds.
  const givenOf = (given: readonly string[], events: Log | undefined) =>
    given.map((hash) => ({
      hash,
      kind: store.get(hash).kind,
      kept: events === undefined ? {} : keptAnywhere(events, hash),
    }));

  // Runs `body` as one write to the log, which no other engine's write comes between.
  function atomically<T>(body: () => T): T {
    database.exec("BEGIN IMMEDIATE");

    try {
      const result = body();

      database.exec("COMMIT");

      return result;
    } catch (error) {
      database.exec("ROLLBACK");

      throw error;
    }
  }

  // Runs the commission step `name` of `commission`, ready with `state`: in one transaction, so
  // no other engine counts the trigger's commissions in between and no crash leaves some started,
  // either escalates, starting none, or starts one commission per request and completes.
  function dispatch(
    commission: string,
    events: Log,
    step: Commissioning<string>,
    started: Started,
  ): void {
    const { step: name, attempt, inputs } = started;

    database.exec("BEGIN IMMEDIATE");

    try {
      // Another engine may have moved the commission on since it was read: the caller reads again.
      if (read(commission).length !== events.length) {
        database.exec("ROLLBACK");

        return;
      }

      const [requests, ...given] = inputs;
      const problem = stepRefusal(name, step, requests!.hashes.length);

      if (problem !== undefined) {
        write(commission, events, { type: "escalated", ...problem });
        database.exec("COMMIT");

        return;
      }

      write(commission, events, started);

      for (const request of requests!.hashes) {
        begin(step.workflow, undefined, request, {
          origin: { trigger: step.trigger, from: { commission, step: name, attempt } },
          given: given.flatMap((input) => input.hashes),
          events,
        });
      }

      write(commission, read(commission), {
        type: "attempt-completed",
        step: name,
        attempt,
        outcome: "done",
        artifacts: [],
        transcript: store.keep(Buffer.alloc(0)),
        next: step.on.done!,
      });
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");

      throw error;
    }
  }

  function spoolOf(commission: string, attempt: number): Spool {
    const directory = join(
      attempts,
      `${createHash("sha256").update(commission).digest("hex")}-${attempt}`,
    );

    return {
      directory,
      record: dirname(log),
      work: join(directory, "work"),
      transcript: join(directory, "transcript"),
      usage: join(directory, "usage"),
      errors: join(directory, "errors"),
    };
  }

  // What an attempt no engine finished had spooled, in the store, for the escalation that ends
  // it: nothing for one spooled before there were spools.
  // What an attempt no engine finished left, for the escalation that ends it, with `reason`: its
  // transcript, errors and usage as spooled, and its session if within its step's transcript
  // limit, `limit`. One over it is not kept, and the reason says so.
  function ended(spool: Spool, limit: number, { cause, reason }: Why) {
    const left = sessionLeft(join(spool.work, "output"), limit);

    if (left === undefined) {
      return { cause, reason, ...spooled(spool) };
    }

    if ("over" in left) {
      return { cause, reason: `${reason}${unkept(left.over, limit)}`, ...spooled(spool) };
    }

    return { cause, reason, ...spooled(spool), session: store.keep(left.body) };
  }

  function spooled(spool: Spool) {
    if (!existsSync(spool.transcript)) {
      return {};
    }

    const errors = readFileSync(spool.errors);

    // SAFETY: the engine spools only a report it parsed as usage.
    const usage = existsSync(spool.usage)
      ? { usage: JSON.parse(readFileSync(spool.usage, "utf8")) as Usage }
      : {};

    return errors.length === 0
      ? { transcript: store.keep(readFileSync(spool.transcript)), ...usage }
      : {
          transcript: store.keep(readFileSync(spool.transcript)),
          errors: store.keep(errors),
          ...usage,
        };
  }

  function unspool(spool: Spool): void {
    opened(spool.directory);
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

  // A child commission its parent no longer waits for, with why: its attempt in flight is stopped
  // as a cancel stops it, and no other starts, until the parent records it withdrawn.
  database.exec(`CREATE TABLE IF NOT EXISTS withdrawals (
    commission TEXT NOT NULL PRIMARY KEY, reason TEXT NOT NULL) STRICT`);

  // A watching attempt's checks: when the latest ended, how many have failed in a row since one
  // did not, and until when an engine holds the right to run the next, so engines that look at
  // the same commission run one check at a time. Its events say nothing of a check that found
  // nothing.
  database.exec(`CREATE TABLE IF NOT EXISTS watches (
    commission TEXT NOT NULL, attempt INTEGER NOT NULL, checked REAL NOT NULL,
    failures INTEGER NOT NULL, until REAL NOT NULL,
    PRIMARY KEY (commission, attempt)) STRICT`);

  const watched = database.prepare("INSERT OR IGNORE INTO watches VALUES (?, ?, 0, 0, 0)");

  // Takes the right to run a check that is due, which no other engine holds; changes nothing
  // otherwise.
  const due = database.prepare(
    "UPDATE watches SET until = ? WHERE commission = ? AND attempt = ? AND until <= ? AND checked + ? <= ?",
  );

  const checkEnded = database.prepare(
    "UPDATE watches SET checked = ?, failures = ?, until = 0 WHERE commission = ? AND attempt = ?",
  );

  const failuresOf = database.prepare(
    "SELECT failures FROM watches WHERE commission = ? AND attempt = ?",
  );

  const unwatched = database.prepare("DELETE FROM watches WHERE commission = ? AND attempt = ?");

  const withdrawing = database.prepare("INSERT OR IGNORE INTO withdrawals VALUES (?, ?)");
  const withdrawal = database.prepare("SELECT reason FROM withdrawals WHERE commission = ?");

  const withdrawalOf = (commission: string): string | undefined => {
    const row = withdrawal.get(commission);

    return row === undefined ? undefined : String(row.reason);
  };

  // Why the commission's attempt at the step named is stopped on request: its parent withdrew the
  // commission, or the owner cancelled the attempt.
  const stoppedWhy = (commission: string, step: string): Why => {
    const withdrawn = withdrawalOf(commission);

    return withdrawn === undefined ? cancelledBy(step) : because("withdrawn", withdrawn);
  };

  // The engines registered as running on this log, such as the CLI's run. A registration is no
  // fact about a commission, and judging it reads /proc, so it stays out of the events and the fold.
  database.exec(`CREATE TABLE IF NOT EXISTS engines (
    machine TEXT NOT NULL, host TEXT NOT NULL, boot TEXT NOT NULL, pid INTEGER NOT NULL,
    start INTEGER NOT NULL, since INTEGER NOT NULL,
    PRIMARY KEY (machine, boot, pid, start)) STRICT`);

  const registered = database.prepare("SELECT * FROM engines ORDER BY since, rowid");

  const enrol = database.prepare("INSERT OR REPLACE INTO engines VALUES (?, ?, ?, ?, ?, ?)");

  const unenrol = database.prepare(
    "DELETE FROM engines WHERE machine = ? AND boot = ? AND pid = ? AND start = ?",
  );

  const machine = machineOf();

  // Each registration, as the table holds it.
  const registrations = () =>
    registered.all().map((row) => ({
      machine: String(row.machine),
      host: String(row.host),
      boot: String(row.boot),
      pid: Number(row.pid),
      start: Number(row.start),
      since: Number(row.since),
    }));

  // Whether a registered engine is running: judged exactly by its process on this machine; not at
  // all on another, which can only be asked there.
  // lazy: no heartbeat, as every engine writing a log runs on the log's machine. Add one, with a
  // bound past which an engine counts as dead, once an engine on another machine writes this log.
  function liveness(row: ReturnType<typeof registrations>[number]): "alive" | "dead" | "unknown" {
    if (row.machine !== machine) {
      return "unknown";
    }

    if (row.boot !== self.boot) {
      return "dead";
    }

    return startOf(row.pid) === row.start ? "alive" : "dead";
  }

  const insert = database.prepare("INSERT INTO events VALUES (?, ?, ?)");

  const select = database.prepare(
    "SELECT event FROM events WHERE commission = ? ORDER BY position",
  );

  // Every commission's events after a position in the log, in the order written: rowid follows
  // insertion, and no event is ever removed.
  const after = database.prepare(
    "SELECT rowid AS position, commission, position AS place, event FROM events WHERE rowid > ? ORDER BY rowid",
  );

  // Every commission's events after `position`, each with its own position in the log.
  function eventsAfter(position: number) {
    return after.all(position).map((row) => ({
      position: Number(row.position),
      commission: String(row.commission),
      // Its place among its commission's own events, which a decision names as since.
      index: Number(row.place),
      // SAFETY: only the engine writes events, each replayed against its commission first.
      event: JSON.parse(String(row.event)) as CommissionEvent,
    }));
  }

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

  // An escalation as written: its reason bounded, and the step its step routes it to, if it
  // routes it.
  function escalating(events: Log, given: Escalation): Escalation {
    const definition = definitionOf(events);
    const next = routeOf(definition, events, given);
    const state = replay(definition, events);

    // An escalation names the step the commission is at, which replay allows it only at one.
    const bound = {
      ...given,
      reason: bounded(given.reason),
      step: state.status === "finished" ? undefined : state.step.name,
    };

    return next === undefined ? bound : { ...bound, next };
  }

  function write(commission: string, events: Log, given: Written): void {
    // Every reason passes here, so one bound covers those quoting a step's own words.
    const event = given.type === "escalated" ? escalating(events, given) : given;

    replay(definitionOf(events), [...events, event]);
    insert.run(commission, events.length, JSON.stringify({ ...event, at: Date.now() }));
  }

  // The factory's workflows the workflow `workflow` reaches through its children steps, and
  // their children's, itself first, so a child runs on the definition its parent started with.
  function reached(workflow: string): Record<string, Workflow> {
    const found = [workflow];

    for (const name of found) {
      for (const step of Object.values(workflows[name]?.steps ?? {})) {
        if (
          step.kind === "children" &&
          Object.hasOwn(workflows, step.workflow) &&
          !found.includes(step.workflow)
        ) {
          found.push(step.workflow);
        }
      }
    }

    return Object.fromEntries(found.map((name) => [name, workflows[name]!]));
  }

  // The factory's workflow named `workflow`, parsed as it will be read back, so a definition that
  // could not run is refused before anything is recorded.
  function checked(workflow: string): Definition {
    if (!Object.hasOwn(workflows, workflow)) {
      throw new Error(`There is no workflow named ${workflow}.`);
    }

    return parseDefinition(
      workflow,
      JSON.stringify({
        workflow: workflows[workflow],
        kinds,
        defaults,
        workflows: reached(workflow),
      }),
    );
  }

  // The definition's text as a commission records it, its skills read now, so editing one later
  // changes no commission; `keep` names each skill file by hash, storing it or not. It holds every
  // workflow its children steps reach, with their agents' skills.
  function pinned(workflow: string, definition: Definition, keep: (bytes: Buffer) => string) {
    const held = reached(workflow);

    const skills = Object.assign(
      pin(workflow, definition.workflow, keep),
      ...Object.entries(held).map(([name, each]) => pin(name, each, keep)),
    );

    return JSON.stringify({
      workflow: workflows[workflow],
      kinds,
      skills,
      defaults,
      workflows: held,
    });
  }

  // The children the attempt `attempt` of the children step `step` commissioned, in order: they
  // are commissioned one after another, so the first name that is no commission ends them.
  function childrenOfAttempt(commission: string, step: string, attempt: number): Child[] {
    const found: Child[] = [];

    for (let n = 1; ; n += 1) {
      const name = childName(commission, step, attempt, n);

      if (select.all(name).length === 0) {
        return found;
      }

      found.push({ commission: name, events: read(name) });
    }
  }

  // The commissions a parent or commission step started, in the order started: those of the
  // commission named, or of the attempt `attempt` of its step `step`.
  const startedFrom = database.prepare(
    `SELECT commission FROM events WHERE position = 0 AND (
       (json_extract(event, '$.parent.commission') = :commission
        AND (:step IS NULL OR (json_extract(event, '$.parent.step') = :step
                               AND json_extract(event, '$.parent.attempt') = :attempt)))
       OR (json_extract(event, '$.origin.from.commission') = :commission
        AND (:step IS NULL OR (json_extract(event, '$.origin.from.step') = :step
                               AND json_extract(event, '$.origin.from.attempt') = :attempt))))
     ORDER BY rowid`,
  );

  // The commissions related to `commission` as an across query names them: the one that started
  // it, those it started, or those the same attempt started but it.
  function relatedTo(
    commission: string,
    events: Log,
    relation: "origin" | "started" | "siblings",
  ): Child[] {
    const [{ parent, origin }] = events;
    const starter = parent ?? origin?.from;

    const names = (step: string | null, attempt: number | null, of: string) =>
      startedFrom.all({ commission: of, step, attempt }).map((row) => String(row.commission));

    const found =
      relation === "origin"
        ? starter === undefined
          ? []
          : [starter.commission]
        : relation === "started"
          ? names(null, null, commission)
          : starter === undefined
            ? []
            : names(starter.step, starter.attempt, starter.commission).filter(
                (name) => name !== commission,
              );

    return found.map((name) => ({ commission: name, events: read(name) }));
  }

  // The children of the latest attempt of the children step `step`, which a children query reads.
  function childrenOf(commission: string, events: Log, step: string): Child[] {
    const started = events.findLast(
      (event) => event.type === "attempt-started" && event.step === step,
    );

    return started?.type === "attempt-started"
      ? childrenOfAttempt(commission, step, started.attempt)
      : [];
  }

  // The files a verifier kept for the artifact `hash`: claimed by or given to the commission, or,
  // such as a child's commit a children query named, by another in the log.
  // lazy: scans the whole log for another's. Index artifact hashes once a log is large enough to
  // notice.
  function keptAnywhere(events: Log, hash: string): Readonly<Record<string, string>> {
    const own = keptIn(events, hash);

    if (own !== undefined) {
      return own;
    }

    for (const { commission } of commissioned.all()) {
      const found = keptIn(read(String(commission)), hash);

      if (found !== undefined) {
        return found;
      }
    }

    return {};
  }

  // Commissions the `n`th child of the parent's children attempt `started`: of the step's workflow
  // as the parent pinned it, about `request`, given `given`. Another engine that commissioned it
  // first leaves it as it is.
  function commissionChild(
    parent: string,
    events: Log,
    step: Children<string>,
    started: Extract<CommissionEvent, { type: "attempt-started" }>,
    n: number,
    request: string,
    given: readonly string[],
  ): void {
    const stored = JSON.parse(store.read(events[0].definition).toString());
    const text = JSON.stringify({ ...stored, workflow: stored.workflows[step.workflow] });

    const event: Commissioned = {
      ...commissioning(step.workflow, text, request),
      parent: { commission: parent, step: started.step, attempt: started.attempt },
      given: givenOf(given, events),
    };

    try {
      insert.run(
        childName(parent, started.step, started.attempt, n),
        0,
        JSON.stringify({ ...event, at: Date.now() }),
      );
    } catch (error) {
      if (select.all(childName(parent, started.step, started.attempt, n)).length === 0) {
        throw error;
      }
    }
  }

  /**
   * Looks once at the children attempt `started` of the parent `commission`: commissions the
   * children now due, judges its wait, and once the wait is decided, its limit reached or the
   * owner cancelled it, withdraws the children still unfinished and ends the attempt. Whether the
   * attempt has ended; until then any engine looking at the commission looks again.
   */
  function tick(
    commission: string,
    events: Log,
    definition: Definition,
    started: Extract<CommissionEvent, { type: "attempt-started" }>,
  ): boolean {
    // SAFETY: the caller found the attempt's step to be a children step.
    const step = definition.workflow.steps[started.step] as Children<string>;
    const [requests, ...givenInputs] = started.inputs;
    const total = step.each === undefined ? step.count! : requests!.hashes.length;
    const children = childrenOfAttempt(commission, started.step, started.attempt);
    const finishes = children.map(({ events: child }) => finishOf(child));

    // Without an outcome, a wait met follows done and one that cannot be met escalates.
    const routed = outcomeOf(step.until) !== undefined;

    const { wait, failed } = waitOf(step, total, finishes, Date.now() - (started.at ?? Date.now()));

    const cancelled = requested.get(commission, started.attempt) !== undefined;
    const name = started.step;

    const completed = (result: string): Ending => ({
      type: "attempt-completed",
      step: name,
      attempt: started.attempt,
      outcome: result,
      artifacts: [],
      transcript: store.keep(Buffer.alloc(0)),
      next: step.on[result]!,
    });

    const escalated = (why: Why): Ending => ({
      type: "escalated",
      ...why,
      attempt: started.attempt,
    });

    const failedNames = failed.map((index) => children[index]!.commission).join(", ");

    const ending = cancelled
      ? escalated(cancelledBy(name))
      : wait === "met"
        ? completed(routed ? "met" : "done")
        : wait === "unmet"
          ? !routed
            ? escalated(
                because(
                  "unmet",
                  `Step ${name}'s wait can no longer be met: ${failedNames} did not reach the end.`,
                ),
              )
            : completed("unmet")
          : wait === "late"
            ? escalated(
                because(
                  "limit",
                  `Step ${name} waited ${step.limits.wait} s for its children, its wait limit.`,
                ),
              )
            : undefined;

    if (ending === undefined) {
      // At most `concurrent` unfinished at once, up to every child the attempt has.
      let unfinished = finishes.filter((finish) => finish === undefined).length;

      for (let n = children.length + 1; n <= total && unfinished < step.concurrent; n += 1) {
        const request = step.each === undefined ? requests!.hashes[0]! : requests!.hashes[n - 1]!;

        commissionChild(
          commission,
          events,
          step,
          started,
          n,
          request,
          givenInputs.flatMap((input) => input.hashes),
        );
        unfinished += 1;
      }

      return false;
    }

    // Children still unfinished are withdrawn: one in flight is stopped first, and recorded
    // withdrawn at a later look, so its transcript is kept.
    const reason = `Commission ${commission}'s step ${name} no longer waits for it.`;
    let settling = false;

    for (const child of children) {
      const state = replay(definitionOf(child.events), child.events);

      if (state.status === "finished") {
        continue;
      }

      withdrawing.run(child.commission, reason);

      if (state.status === "attempting") {
        const running = child.events.findLast((event) => event.type === "attempt-started");

        if (running?.type === "attempt-started") {
          request.run(child.commission, running.attempt);
        }

        settling = true;

        continue;
      }

      write(child.commission, child.events, { type: "withdrawn", reason });
    }

    if (settling) {
      return false;
    }

    write(commission, events, ending);

    return true;
  }

  /**
   * Looks once at the watching attempt `started` of `commission`: ends it once it is cancelled or
   * past its wait limit, and otherwise runs a check if one is due and no engine runs one. A check
   * that claims ends the attempt; one that found nothing leaves no event; one that failed is noted,
   * and the third in a row escalates. Whether the attempt has ended.
   */
  async function look(
    commission: string,
    definition: Definition,
    started: Extract<CommissionEvent, { type: "attempt-started" }>,
  ): Promise<boolean> {
    // SAFETY: the caller found the attempt's step to be a command step that watches.
    const step = definition.workflow.steps[started.step] as Runnable & { watch: Watch };
    const { attempt, step: name } = started;
    const now = Date.now();
    const why = stoppedWhy(commission, name);
    const cancelled = () => requested.get(commission, attempt) !== undefined;

    const end = (ending: Ending) => {
      write(commission, read(commission), ending);
      unwatched.run(commission, attempt);

      return true;
    };

    if (cancelled()) {
      return end({ type: "escalated", ...why, attempt });
    }

    if (now - (started.at ?? now) > step.watch.wait * 1000) {
      return end({
        type: "escalated",
        cause: "limit",
        reason: `Step ${name} waited ${step.watch.wait} s, its wait limit.`,
        attempt,
      });
    }

    watched.run(commission, attempt);

    // Held for as long as a check may run, and a minute more for its programs to be stopped.
    // SAFETY: only an attended step's attempt limit may be unbounded, and a watch is a command's.
    const lease = now + ((step.limits.attempt as number) + 60) * 1000;

    if (due.run(lease, commission, attempt, now, step.watch.interval * 1000, now).changes === 0) {
      return false;
    }

    const events = read(commission);
    const spool = spoolOf(commission, attempt);

    // Notes go after the events already written: positions count from 0.
    let position = events.length;

    const note = (text: string, from: "step" | "engine") => {
      const noted: Extract<CommissionEvent, { type: "noted" }> = {
        type: "noted",
        attempt,
        note: text,
        at: Date.now(),
      };

      if (from === "engine") {
        noted.from = from;
      }

      insert.run(commission, position, JSON.stringify(noted));
      position += 1;
    };

    const artifact = (hash: string) => ({
      hash,
      artifact: store.get(hash),
      kept: keptAnywhere(events, hash),
    });

    // lazy: a check is given its attempt's inputs by hash, without the child each came from. Name
    // it once a check reads a children query.
    const ending = await run(
      step,
      {
        commission,
        step: name,
        attempt,
        kinds: definition.kinds,
        subject: { ...artifact(started.subject), kept: keptOf(events, started.subject) },
        workspace: undefined,
        branches: undefined,
        inputs: started.inputs.map((input) => ({
          name: input.name,
          artifacts: input.hashes.map(artifact),
        })),
        skills: [],
        routed: undefined,
      },
      () => (cancelled() ? why : undefined),
      note,
      store,
      spool,
      { step: step.limits.usd },
      true,
    );

    unspool(spool);

    if (ending.type === "nothing") {
      checkEnded.run(Date.now(), 0, commission, attempt);

      return false;
    }

    if (ending.type === "attempt-completed" || cancelled()) {
      return end(ending);
    }

    // SAFETY: the row was made above and is removed only when the attempt ends.
    const failures = (failuresOf.get(commission, attempt) as { failures: number }).failures + 1;

    if (failures >= failuresInARow) {
      return end(ending);
    }

    note(`A check failed, and the wait goes on: ${ending.reason}`, "engine");
    checkEnded.run(Date.now(), failures, commission, attempt);

    return false;
  }

  return {
    /**
     * The definition the workflow named `workflow` would be commissioned with, as `definition`
     * gives a commission's; refused as commissioning would refuse it. Records nothing.
     */
    check(workflow: string): Definition {
      const text = pinned(workflow, checked(workflow), (bytes) =>
        createHash("sha256").update(bytes).digest("hex"),
      );

      return parseDefinition(workflow, text);
    },

    /** Starts a commission under the workflow named `workflow`, about the owner's request. */
    commission(
      workflow: string,
      request: { title: string; body: string },
      { name: commission, trigger }: Naming,
    ): string {
      // The type says so to a caller checked by the compiler; the CLI's is not.
      if (commission === undefined && trigger === undefined) {
        throw new Error("A commission needs a name unless a trigger starts it.");
      }

      const requested = () => {
        refuseRequest(checked(workflow).kinds.document, request);

        return store.put({
          kind: "document",
          fields: { title: request.title },
          body: request.body,
        });
      };

      if (trigger === undefined) {
        return begin(workflow, commission, requested());
      }

      // Its caps are judged and its commission written as one, so no other program asking the
      // trigger at the same moment is judged on a count this one is about to change.
      return atomically(() => {
        refuseTriggered(trigger, workflow);

        return begin(workflow, commission, requested(), { origin: { trigger } });
      });
    },

    /**
     * Renews the trigger named's allowance: the commissions it started before count no more
     * against it. The owner's act, recorded with when it was made.
     */
    renew(trigger: string): void {
      if (!Object.hasOwn(triggers, trigger)) {
        throw new Error(`There is no trigger named ${trigger}.`);
      }

      if (triggers[trigger].allowance === undefined) {
        throw new Error(`Trigger ${trigger} has no allowance to renew.`);
      }

      renewing.run(trigger, Date.now());
    },

    /**
     * Every commission's events after the log position `position`, oldest first, each with its
     * commission and its own position, which an observer passes back to read on from there.
     */
    events(position: number) {
      return eventsAfter(position);
    },

    /**
     * Waits for the events after the log position `position`, any engine's, and returns them, at
     * once if there are some already; or none once `signal` aborts.
     */
    async next(position: number, { signal }: { signal?: AbortSignal } = {}) {
      // Watched before the log is read, so an event written in between still wakes it.
      const changes = watch(dirname(log), { signal });
      const name = basename(log);

      try {
        for (;;) {
          const found = eventsAfter(position);

          if (found.length > 0 || signal?.aborted) {
            return found;
          }

          await new Promise<void>((resolve) => {
            const done = () => {
              changes.off("change", wake);
              signal?.removeEventListener("abort", done);
              resolve();
            };

            // The log, or its journal beside it: the store and attempts there are not events.
            const wake = (_: string, file: string | null) => {
              if (file === null || file.startsWith(name)) {
                done();
              }
            };

            changes.on("change", wake);
            signal?.addEventListener("abort", done);
          });
        }
      } finally {
        changes.close();
      }
    },

    /**
     * Records that this engine is running on the log, so `engines` lists it, until the function it
     * returns withdraws it. Registrations of this machine's engines that have ended are removed.
     */
    register(): () => void {
      for (const row of registrations()) {
        if (liveness(row) === "dead") {
          unenrol.run(row.machine, row.boot, row.pid, row.start);
        }
      }

      enrol.run(machine, hostname(), self.boot, self.pid, self.start, Date.now());

      return () => {
        unenrol.run(machine, self.boot, self.pid, self.start);
      };
    },

    /**
     * The engines registered on the log, oldest first: on which host, as which process, since
     * when, and whether it is alive or dead, or unknown when it runs on another machine.
     */
    engines(): {
      host: string;
      pid: number;
      since: number;
      status: "alive" | "dead" | "unknown";
    }[] {
      return registrations().map((row) => ({
        host: row.host,
        pid: row.pid,
        since: row.since,
        status: liveness(row),
      }));
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

    /**
     * The definition the commission was commissioned with and runs on, whatever the factory says
     * now: its workflow, each step's limits made whole from the factory's defaults it recorded,
     * its kinds, and its skills by file hash.
     */
    definition(commission: string): Definition {
      return definitionOf(read(commission));
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

      // The step an escalation is at: where the last edge led, followed as the events go by.
      let at: string = definition.workflow.start;

      // After the first event, commissioned, which holds the request.
      for (let position = 1; position < events.length; position += 1) {
        const event = events[position];

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

        // What an ended attempt's step reported it used, on its entry, when it reported any.
        const withUsage = (index: number, usage: Usage | undefined) => {
          const ended = entries[index];

          if (usage !== undefined && ended?.entry === "attempt" && !("running" in ended)) {
            ended.usage = usage;
          }
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
            notesOf(event.attempt).push({ note: event.note, from: event.from ?? "step" });
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
            withUsage(entryOf(event.attempt), event.usage);
            at = event.next;
            break;
          case "escalated":
            if (event.attempt === undefined) {
              entries.push({
                entry: "escalation",
                step: event.step ?? at,
                reason: event.reason,
                cause: event.cause,
                at: event.at,
              });
            } else {
              entries[entryOf(event.attempt)] = {
                entry: "attempt",
                attempt: event.attempt,
                step: at,
                notes: notesOf(event.attempt),
                started: startOf(event.attempt),
                ended: event.at,
                escalated: event.reason,
                cause: event.cause,
                next: event.next,
                errors: event.errors !== undefined,
              };
              withUsage(entryOf(event.attempt), event.usage);
            }

            break;
          case "withdrawn":
            entries.push({ entry: "withdrawal", step: at, reason: event.reason, at: event.at });
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
            at = event.next;

            break;
          }

          default:
            break;
        }
      }

      const { request, origin } = events[0];

      const recorded: CommissionRecord = {
        state: replay(definition, events),
        request: { hash: request, artifact: store.get(request) },
        entries,
      };

      // A trigger's commission says so; the owner's says nothing.
      if (origin !== undefined) {
        recorded.origin = origin;
      }

      return recorded;
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
     * the step declares, or abandon; on an escalation it is retry or abandon.
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

      if (!state.outcomes.includes(outcome)) {
        throw new Error(`Step ${name} does not declare outcome "${outcome}".`);
      }

      const on: Record<string, string> =
        step.kind === "approval" ? { ...step.on, abandon: "end" } : { retry: name, abandon: "end" };

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

      // A children or watching attempt holds no program: the next look ends it, stopping a check
      // that runs.
      if (waits(definitionOf(events).workflow.steps[started.step])) {
        request.run(commission, started.attempt);

        return;
      }

      // With no engine to stop it, the attempt is over already: the cancel is its end.
      if (!held(commission, started)) {
        const spool = spoolOf(commission, started.attempt);

        write(commission, events, {
          type: "escalated",
          attempt: started.attempt,
          ...ended(
            spool,
            transcriptOf(definitionOf(events).workflow.steps[started.step]),
            cancelledBy(started.step),
          ),
        });
        unspool(spool);

        return;
      }

      request.run(commission, started.attempt);
    },

    /**
     * Attempts ready steps until the commission is awaiting, escalated or finished, or ready at an
     * attended step, which waits for the owner to attend it. Once `signal` aborts, the running
     * attempt finishes and no other starts: the commission is left ready.
     */
    advance(
      commission: string,
      { signal }: { signal?: AbortSignal } = {},
    ): Promise<CommissionState> {
      return drive(commission, signal, false);
    },

    /**
     * Attempts the attended step the commission is ready at, in the owner's terminal, which is
     * this process's stdin and stdout, and returns once that attempt ends.
     */
    attend(commission: string): Promise<CommissionState> {
      if (!isatty(0) || !isatty(1)) {
        throw new Error("Attending a step needs the owner's terminal as stdin and stdout.");
      }

      const events = read(commission);
      const state = replay(definitionOf(events), events);

      if (state.status !== "ready" || state.step.kind !== "agent" || !state.step.attended) {
        throw new Error(`Commission ${commission} is not ready at an attended step.`);
      }

      return drive(commission, undefined, true);
    },
  };

  // Attempts ready steps, as advance does; or, `attending`, the one attended step the commission
  // is ready at, returning once it ends.
  async function drive(
    commission: string,
    signal: AbortSignal | undefined,
    attending: boolean,
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

        // A watching attempt holds no program, so no engine holds it: each look carries it on.
        if (
          waits(workflow.steps[started.step]) &&
          workflow.steps[started.step]?.kind === "command"
        ) {
          if (await look(commission, definition, started)) {
            continue;
          }

          return replay(definition, read(commission));
        }

        // A children attempt runs no program, so no engine holds it: each look carries it on.
        if (workflow.steps[started.step]?.kind === "children") {
          if (tick(commission, events, definition, started)) {
            continue;
          }

          return replay(definition, read(commission));
        }

        if (held(commission, started)) {
          return state;
        }

        const spool = spoolOf(commission, started.attempt);

        write(commission, events, {
          type: "escalated",
          attempt: started.attempt,
          ...ended(
            spool,
            transcriptOf(workflow.steps[state.step.name]),
            because("interrupted", `Step ${state.step.name} was interrupted.`),
          ),
        });
        unspool(spool);

        continue;
      }

      if (state.status !== "ready") {
        return state;
      }

      // A child its parent is withdrawing starts no attempt; its parent records it withdrawn.
      if (withdrawalOf(commission) !== undefined) {
        return state;
      }

      if (state.step.kind === "agent" && state.step.attended === true && !attending) {
        return state;
      }

      const name = state.step.name;
      const step = workflow.steps[name];

      // Replay arrives at an approval step as awaiting, never ready.
      if (step.kind === "approval") {
        throw new Error(`Step ${name} is an approval step, so it cannot be ready.`);
      }

      const admitted = admit(commission, definition, events, name, engineVersion());

      if ("cause" in admitted) {
        // An escalation over the engine names this one, which the owner's decision accepts.
        write(
          commission,
          events,
          admitted.cause === "upgrade"
            ? { type: "escalated", ...admitted, engine: engineVersion() }
            : { type: "escalated", ...admitted },
        );

        continue;
      }

      // The event that starts the attempt the commission is admitted to, given `inputs`.
      const starting = (inputs: Inputs): Started => ({
        type: "attempt-started",
        step: name,
        attempt: admitted.attempt,
        subject: state.subject,
        inputs,
        process: self,
        engine: engineVersion(),
      });

      const named = (query: Query) =>
        resolve(
          query,
          state,
          events,
          definition.kinds,
          (children) => childrenOf(commission, events, children),
          (relation) => relatedTo(commission, events, relation),
        );

      if (step.kind === "commission") {
        const inputs = [
          { name: "each", hashes: named(step.each).map(({ hash }) => hash) },
          ...Object.entries(step.given ?? {}).map(([input, query]) => ({
            name: input,
            hashes: named(query).map(({ hash }) => hash),
          })),
        ];

        const repeat = repeats(events, name, state.subject, inputs);

        if (repeat !== undefined) {
          write(commission, events, { type: "escalated", ...repeat });

          continue;
        }

        dispatch(commission, events, step, starting(inputs));

        continue;
      }

      if (step.kind === "children") {
        const requests =
          step.each === undefined
            ? { name: "request", hashes: named(step.request ?? "request").map(({ hash }) => hash) }
            : { name: "each", hashes: named(step.each).map(({ hash }) => hash) };

        const inputs = [
          requests,
          ...Object.entries(step.given ?? {}).map(([input, query]) => ({
            name: input,
            hashes: named(query).map(({ hash }) => hash),
          })),
        ];

        const problem =
          step.each === undefined && requests.hashes.length === 0
            ? because("inputs", `Step ${name}'s request names no document.`)
            : requests.hashes.length > step.width
              ? because(
                  "limit",
                  `Step ${name} has ${requests.hashes.length} children to start, over its width of ${step.width}.`,
                )
              : repeats(events, name, state.subject, inputs);

        write(
          commission,
          events,
          problem === undefined ? starting(inputs) : { type: "escalated", ...problem },
        );

        continue;
      }

      const resolved = Object.entries(step.inputs).map(([input, query]) => ({
        name: input,
        named: named(query),
      }));

      const given = resolved.map(({ name: input, named: each }) => ({
        name: input,
        hashes: each.map(({ hash }) => hash),
      }));

      // Read from the store before the attempt starts. The engine's failure here, such as a file
      // it cannot read, is nothing it can classify: the owner decides, and no budget is spent.
      const prepared = (() => {
        try {
          return {
            inputs: resolved.map(({ name: input, named: each }): Input => {
              const query = step.inputs[input];

              // A session is no artifact: its body is the bytes its program left.
              return isRecord(query) && query.session !== undefined
                ? {
                    name: input,
                    sessions: each.map(({ hash }) => ({ hash, body: store.read(hash) })),
                  }
                : {
                    name: input,
                    artifacts: each.map(({ hash, commission: child }) => {
                      const artifact = {
                        hash,
                        artifact: store.get(hash),
                        kept: keptAnywhere(events, hash),
                      };

                      return child === undefined ? artifact : { ...artifact, commission: child };
                    }),
                  };
            }),
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
        write(commission, events, { type: "escalated", cause: "engine", reason: prepared });

        continue;
      }

      const { skills } = prepared;

      // The artifact the workspace is built from, when it is an input's: one the record names.
      const source = step.workspace;
      const sourceInput = source === "subject" || source === "empty" ? undefined : source.input;
      const branchInput = source === "subject" || source === "empty" ? undefined : source.branches;

      // The artifacts the workspace adds as branches, each named for the step to find it.
      const inputs = prepared.inputs.map((input) =>
        input.name !== branchInput || !("artifacts" in input)
          ? input
          : {
              ...input,
              artifacts: input.artifacts.map((each, index) => ({
                ...each,
                branch: branchName(input.name, each.commission, index),
              })),
            },
      );

      // The definition refuses a workspace built from a session.
      const from = inputs.find((input) => input.name === sourceInput);
      const built = from !== undefined && "artifacts" in from ? from.artifacts[0] : undefined;

      if (sourceInput !== undefined && built === undefined) {
        write(commission, events, {
          type: "escalated",
          cause: "inputs",
          reason: `Step ${name}'s workspace input ${sourceInput} holds no artifact.`,
        });

        continue;
      }

      // None when the step adds no branches; possibly empty when it does.
      const adding = inputs.find((input) => input.name === branchInput);
      const branches = adding !== undefined && "artifacts" in adding ? adding.artifacts : undefined;

      // lazy: the materialiser of the base's kind adds every branch, so all must be of that kind.
      // Give each kind its own materialiser run once a workspace needs to mix them.
      const foreign = branches?.find(({ artifact }) => artifact.kind !== built?.artifact.kind);

      if (foreign !== undefined) {
        write(commission, events, {
          type: "escalated",
          cause: "inputs",
          reason: `Step ${name}'s workspace cannot add the ${foreign.artifact.kind} ${foreign.branch} as a branch of a ${built?.artifact.kind}.`,
        });

        continue;
      }

      // An agent's prompt goes to its harness with its inputs, so it counts with them.
      const prompt = step.kind === "agent" ? Buffer.byteLength(step.agent.prompt) : 0;

      const bytes =
        inputs
          .flatMap((input) =>
            "artifacts" in input
              ? input.artifacts.map(({ artifact }) => Buffer.byteLength(artifact.body ?? ""))
              : input.sessions.map(({ body }) => body.length),
          )
          .reduce((sum, size) => sum + size, 0) +
        skills
          .flatMap(({ files }) => files)
          .reduce((sum, { bytes: file }) => sum + file.length, 0) +
        prompt;

      if (bytes > step.limits.input) {
        const what =
          step.kind !== "agent"
            ? "inputs are"
            : skills.length === 0
              ? "inputs and prompt are"
              : "inputs, prompt and skills are";

        write(commission, events, {
          type: "escalated",
          cause: "limit",
          reason: `Step ${name}'s ${what} ${bytes} bytes, over its input limit of ${step.limits.input}.`,
        });

        continue;
      }

      const repeat = repeats(events, name, state.subject, given);

      if (repeat !== undefined) {
        write(commission, events, { type: "escalated", ...repeat });

        continue;
      }

      const { attempt } = admitted;

      write(commission, events, starting(given));

      // The attempt is the wait; each look runs its checks.
      if (step.kind === "command" && step.watch !== undefined) {
        continue;
      }

      const key = runningKey(log, commission, attempt);
      const spool = spoolOf(commission, attempt);

      running.add(key);

      const cancelled = () => requested.get(commission, attempt) !== undefined;

      // Why it must stop: the owner cancelled it, or its parent withdrew the commission.
      const stopping = () => (cancelled() ? stoppedWhy(commission, name) : undefined);

      // Each note the attempt writes is an event of its own, after attempt-started. A note
      // changes no state and this attempt is the commission's one writer, so it is appended at
      // the next position without replaying the log; another writer's event there refuses it.
      let position = events.length + 1;

      const note = (text: string, from: "step" | "engine") => {
        // A step's note says nothing of who wrote it, as every note did before the engine's.
        const noted: Extract<CommissionEvent, { type: "noted" }> = {
          type: "noted",
          attempt,
          note: text,
          at: Date.now(),
        };

        if (from === "engine") {
          noted.from = from;
        }

        insert.run(commission, position, JSON.stringify(noted));
        position += 1;
      };

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
            workspace: built !== undefined ? built : source === "subject" ? subject : undefined,
            branches,
            inputs,
            skills,
            routed: routedBy(events),
          },
          stopping,
          note,
          store,
          spool,
          { step: step.limits.usd, commission: admitted.commission },
        );

        // Only a check finds nothing.
        if (ending.type === "nothing") {
          throw new Error(`Step ${name}'s attempt, which is no check, ended finding nothing.`);
        }

        // A cancel that arrives before the attempt's end is written wins: nothing it claimed is
        // recorded.
        write(
          commission,
          read(commission),
          ending.type === "attempt-completed" && cancelled()
            ? cancelledEnding(ending, stopping()!)
            : ending,
        );
        unspool(spool);
      } catch (error) {
        // The engine's own failure, such as a full disk, is nothing it can classify: the owner
        // decides, with what the step's program wrote, if it ran and the store can keep it. If
        // this write fails too, the next advance finds the attempt interrupted, and keeps what
        // was spooled.
        const failed = failedIn(name, error instanceof Error ? error.message : String(error));

        const kept = (() => {
          try {
            return ended(spool, step.limits.transcript, failed);
          } catch (keeping) {
            return because(
              "engine",
              `${failed.reason}; its transcript could not be kept: ${keeping instanceof Error ? keeping.message : String(keeping)}`,
            );
          }
        })();

        write(commission, read(commission), { type: "escalated", attempt, ...kept });
        unspool(spool);
      } finally {
        running.delete(key);
      }

      if (attending) {
        const ended = read(commission);

        return replay(definitionOf(ended), ended);
      }
    }
  }
}

// Where a running attempt's transcript and errors are written as they arrive.
// An attempt's directory: its transcript and errors, written as they arrive, and the work area
// holding its workspace, input, output and kinds' programs' areas, which the disk limit bounds.
// An attempt's directories, and the record's: the log's directory, which its programs never see.
type Spool = {
  directory: string;
  record: string;
  work: string;
  transcript: string;
  errors: string;
  // The step's latest usage report, as it arrives.
  usage: string;
};

// The attempts this process is running, across its engines: one it holds but is not running was
// interrupted.
const running = new Set<string>();

function runningKey(log: string, commission: string, attempt: number): string {
  return JSON.stringify([resolvePath(log), commission, attempt]);
}

// Refuses a trigger that names a workflow the factory lacks, or caps nothing.
function refuseTriggers(
  triggers: Readonly<Record<string, Trigger>>,
  workflows: Record<string, Workflow>,
): void {
  for (const [name, trigger] of Object.entries(triggers)) {
    const { workflows: allowed, rate, allowance, unfinished, usd } = trigger;

    const valid =
      allowed.length > 0 &&
      allowed.every((workflow) => Object.hasOwn(workflows, workflow)) &&
      (rate !== undefined || allowance !== undefined) &&
      (rate === undefined ||
        (Number.isSafeInteger(rate.count) &&
          rate.count >= 1 &&
          Number.isFinite(rate.per) &&
          rate.per > 0)) &&
      (allowance === undefined || (Number.isSafeInteger(allowance) && allowance >= 1)) &&
      Number.isSafeInteger(unfinished) &&
      unfinished >= 1 &&
      (usd === undefined || (Number.isFinite(usd) && usd > 0));

    if (!valid) {
      throw new Error(
        `Trigger ${name} is invalid: it must name workflows of the factory, a rate of at least 1 commission per positive number of seconds or an allowance of at least 1 commission, or both, at least 1 unfinished commission, and any money limit above zero.`,
      );
    }
  }

  // Commissions that start commissions are an unattended loop: only an allowance the owner
  // renews bounds it, as a rate renews with time.
  for (const [workflowName, workflow] of Object.entries(workflows)) {
    for (const [stepName, step] of Object.entries(workflow.steps)) {
      if (step.kind !== "commission") {
        continue;
      }

      const at = `Step ${stepName} of workflow ${workflowName} starts commissions`;
      const trigger = Object.hasOwn(triggers, step.trigger) ? triggers[step.trigger] : undefined;

      if (trigger === undefined) {
        throw new Error(`${at} through trigger ${step.trigger}, which the factory lacks.`);
      }

      if (trigger.allowance === undefined) {
        throw new Error(
          `${at} through trigger ${step.trigger}, which has no allowance: only one the owner renews bounds commissions that start commissions.`,
        );
      }

      if (!trigger.workflows.includes(step.workflow)) {
        throw new Error(
          `${at} of workflow ${step.workflow}, which trigger ${step.trigger} may not start.`,
        );
      }
    }
  }
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

// The machine the engine runs on, by systemd's machine id, which outlives a change of host name;
// the host name where there is none.
function machineOf(): string {
  try {
    return readFileSync("/etc/machine-id", "utf8").trim();
  } catch {
    return hostname();
  }
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
  childrenOf: (step: string) => readonly Child[],
  related: (relation: "origin" | "started" | "siblings") => readonly Child[],
): Named[] {
  switch (query) {
    case "subject":
      return [{ hash: state.subject }];
    case "request":
      return [{ hash: events[0].request }];
    default: {
      if (query.session !== undefined) {
        return sessionsOf(events, query.session)
          .slice(-1)
          .map((hash) => ({ hash }));
      }

      // Each child that reached its end, its latest artifact of the kind or all of them.
      if (query.children !== undefined) {
        return childrenOf(query.children).flatMap(({ commission, events: child }) => {
          if (finishOf(child)?.outcome === undefined) {
            return [];
          }

          const named = recorded(child, kinds)
            .filter((artifact) => artifact.kind === query.kind)
            .map(({ hash }) => ({ hash, commission }));

          // One stored before a children query had to say took each child's latest.
          return query.take === "all" ? named : named.slice(-1);
        });
      }

      // Each related commission's artifacts as it has them now, finished or not.
      if (query.across !== undefined) {
        return related(query.across).flatMap(({ commission, events: other }) => {
          const named = recorded(other, kinds)
            .filter(
              (artifact) =>
                (query.from === undefined ||
                  (artifact.step !== undefined && query.from.includes(artifact.step))) &&
                (query.kind === undefined || artifact.kind === query.kind),
            )
            .map(({ hash }) => ({ hash, commission }));

          return query.take === "latest" ? named.slice(-1) : named;
        });
      }

      const { from, kind, about, take } = query;

      const named = recorded(events, kinds).flatMap((artifact) =>
        (from === undefined || (artifact.step !== undefined && from.includes(artifact.step))) &&
        (kind === undefined || artifact.kind === kind) &&
        (about === undefined ||
          (artifact.about !== undefined &&
            (about === "any" || (about === "subject") === (artifact.about === state.subject))))
          ? [{ hash: artifact.hash }]
          : [],
      );

      return take === "latest" ? named.slice(-1) : named;
    }
  }
}

// An artifact a query names, by hash, with the child that claimed it when a children query names it.
type Named = { hash: string; commission?: string };

// A child commission, by name, with its events.
type Child = { commission: string; events: Log };

/** The name of the `n`th child, from 1, that the attempt `attempt` of the step `step` commissioned. */
function childName(commission: string, step: string, attempt: number, n: number): string {
  return `${commission}.${step}.${attempt}.${n}`;
}

// The branch a workspace adds an artifact of the input `input` as: a child's by its number, any
// other's by its position, from 1.
function branchName(input: string, child: string | undefined, index: number): string {
  return `${input}-${child === undefined ? index + 1 : child.slice(child.lastIndexOf(".") + 1)}`;
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
        return [
          { hash: event.request, kind: "document" },
          ...(event.given ?? []).map(({ hash, kind }) => ({ hash, kind })),
        ];
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
  return keptIn(events, hash) ?? {};
}

// The files a verifier kept for the artifact `hash`, if the commission claimed or was given it.
function keptIn(events: Log, hash: string): Readonly<Record<string, string>> | undefined {
  for (const event of events) {
    const found =
      (event.type === "attempt-completed" &&
        event.artifacts.find((artifact) => artifact.hash === hash)) ||
      (event.type === "commissioned" && event.given?.find((artifact) => artifact.hash === hash));

    if (found) {
      return found.kept;
    }
  }

  return undefined;
}

// The transcript limit of a step: none for an approval or children step, which runs no program to
// leave a session.
function transcriptOf(step: Definition["workflow"]["steps"][string]): number {
  return step.kind === "approval" || step.kind === "children" || step.kind === "commission"
    ? 0
    : step.limits.transcript;
}

// What an escalation's reason adds when the attempt's session was over its limit.
function unkept(size: number, limit: number): string {
  return ` Its session of ${size} bytes, over its transcript limit of ${limit}, was not kept.`;
}

// The version of this engine: a hash of its package's source, every module and program it ships
// but their tests, so any change to the engine, an adapter or a kind's program is a different
// engine. Read once per process.
let version: string | undefined;

function engineVersion(): string {
  if (version === undefined) {
    const package_ = join(import.meta.dirname, "..");
    const hash = createHash("sha256");

    for (const file of readdirSync(package_, { recursive: true, encoding: "utf8" })
      .filter(
        (name) =>
          name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.includes("node_modules"),
      )
      .sort()) {
      hash
        .update(file)
        .update("\0")
        .update(readFileSync(join(package_, file)));
    }

    version = hash.digest("hex");
  }

  return version;
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
  branches: readonly Supplied[] | undefined;
  inputs: readonly Input[];
  skills: readonly { name: string; files: readonly { file: string; bytes: Buffer }[] }[];
  // The escalation that routed the commission to this step, if one did.
  routed: ReturnType<typeof routedBy>;
};

// An artifact an input names, with the child that claimed it, if any, and the branch the workspace
// adds it as, if it does.
type Supplied = Subject & { commission?: string; branch?: string };

// A declared input as given: the artifacts its query names, each with the files its verifier kept,
// from a children query, the child that claimed it, and when the workspace adds them, its branch;
// or the session a session query names.
type Input =
  | { name: string; artifacts: readonly Supplied[] }
  | { name: string; sessions: readonly { hash: string; body: Buffer }[] };

type Store = ReturnType<typeof createStore>;

type Ending = Extract<CommissionEvent, { type: "attempt-completed" }> | Escalation;

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
// nothing; so does what is under a directory that cannot be read, until its program ends and the
// engine opens it again.
async function bytesUnder(directory: string): Promise<number> {
  const stats = await lstat(directory).catch(() => undefined);
  let total = (stats?.blocks ?? 0) * 512;

  if (stats?.isDirectory()) {
    for (const entry of await readdir(directory).catch(() => [])) {
      total += await bytesUnder(join(directory, entry));
    }
  }

  return total;
}

// A step's programs may leave directories they made unreadable or unremovable, such as one at mode
// 000. Once they end, the work area is the engine's: each directory under `path` is opened again for
// its owner, without following links.
function opened(path: string): void {
  const stats = (() => {
    try {
      return lstatSync(path);
    } catch {
      return undefined;
    }
  })();

  if (!stats?.isDirectory()) return;

  if ((stats.mode & 0o700) !== 0o700) chmodSync(path, stats.mode | 0o700);

  for (const entry of readdirSync(path)) opened(join(path, entry));
}

// Removes `directory` and all under it, opening again what a step's programs locked.
async function removed(directory: string): Promise<void> {
  opened(directory);
  await rm(directory, { recursive: true, force: true });
}

// Why the step must stop if an empty area of its access is full, or undefined.
function filled(sandbox: number, access: Access, name: string): Why | undefined {
  const area = fullArea(sandbox, access);

  return area === undefined
    ? undefined
    : because("limit", `Step ${name} filled ${area.path}, its area of ${area.size} bytes.`);
}

// How often, in milliseconds, the engine running an attempt looks for the owner's cancel.
const cancelLook = 1000;

const cancelledBy = (step: string) =>
  because("cancelled", `Step ${step} was cancelled by the owner.`);

// Checks that fail in a row before a watch escalates: one or two may be a passing outage.
const failuresInARow = 3;

// Whether an attempt of `step` is a wait that holds no program: a children step's, or a watch's.
/** Fails at compile time when a switch misses a case, and at run time if one arrives anyway. */
function assertNever(value: never): never {
  throw new Error(`Unhandled ${JSON.stringify(value)}.`);
}

function waits(step: Definition["workflow"]["steps"][string] | undefined): boolean {
  return step?.kind === "children" || (step?.kind === "command" && step.watch !== undefined);
}

// The engine's own failure during a step's attempt, such as a full disk.
const failedIn = (step: string, message: string) =>
  because("engine", `Step ${step} failed in the engine: ${message}`);

// The end of a completed attempt stopped, for `reason`, before it was written: an escalation, with
// its transcript and errors.
function cancelledEnding(
  completed: Extract<Ending, { type: "attempt-completed" }>,
  why: Why,
): Ending {
  const ending: Ending = {
    type: "escalated",
    ...why,
    attempt: completed.attempt,
    transcript: completed.transcript,
  };

  if (completed.errors !== undefined) {
    ending.errors = completed.errors;
  }

  return ending;
}

// Keeps every file of each skill the workflow's agents declare, refusing a skill without a SKILL.md
// or an agent with two skills of one name, and returns the skills by path.
function pin(
  name: string,
  workflow: Workflow<string, "stated" | "whole">,
  keep: (bytes: Buffer) => string,
): Definition["skills"] {
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

        return entry.isDirectory() ? [] : [[relative(path, file), keep(readFileSync(file))]];
      });

      pinned[path] = { name: basename(path), files: Object.fromEntries(files) };
    }
  }

  return pinned;
}

// A session as input.json lists it.
type Listed = { hash: string; body: string };

// Writes input.json, listing each declared input's artifacts, and each body as <input>/<hash>.
// The sandbox binds the input read-only.
async function prepare(input_: string, step: Runnable, given: Given): Promise<void> {
  await mkdir(input_);

  const inputs = new Map<
    string,
    (
      | {
          hash: string;
          kind: string;
          fields: Artifact["fields"];
          body?: string;
          commission?: string;
          branch?: string;
        }
      | Listed
    )[]
  >();

  for (const input of given.inputs) {
    const { name } = input;
    const listed = [];

    // A session is listed by its hash and body alone: it has no kind or fields.
    if ("sessions" in input) {
      for (const { hash, body } of input.sessions) {
        await mkdir(join(input_, name), { recursive: true });
        await writeFile(join(input_, name, hash), body);
        listed.push({ hash, body: `${name}/${hash}` });
      }

      inputs.set(name, listed);
      continue;
    }

    for (const { hash, artifact, commission, branch } of input.artifacts) {
      const { kind, fields } = artifact;

      // A child's artifact names the child, so a step can tell whose it is, and one the workspace
      // adds names its branch.
      const from = { commission, branch };

      if (artifact.body === undefined) {
        listed.push({ hash, kind, fields, ...from });
      } else {
        await mkdir(join(input_, name), { recursive: true });
        await writeFile(join(input_, name, hash), artifact.body);
        listed.push({ hash, kind, fields, body: `${name}/${hash}`, ...from });
      }
    }

    inputs.set(name, listed);
  }

  // Under .skills, which no input name can be.
  for (const { name, files } of given.skills) {
    for (const { file, bytes } of files) {
      await mkdir(dirname(join(input_, ".skills", name, file)), { recursive: true });
      await writeFile(join(input_, ".skills", name, file), bytes);
    }
  }

  const encoded = {
    commission: given.commission,
    step: given.step,
    attempt: given.attempt,
    outcomes: Object.keys(step.on),
    // Left out unless an escalation routed the commission here: the step it left, and why.
    routed: given.routed,
    inputs: Object.fromEntries(inputs),
    // What a claim of each kind holds; the programs behind a kind are the engine's, not the step's.
    claims: Object.fromEntries(
      step.claims.map((kind) => {
        const { description, fields, body, outcome } = given.kinds[kind];

        return [kind, { description, fields, body, outcome }];
      }),
    ),
    // Whether the owner is in the agent's terminal; left out of a command step's input.json, as is
    // its agent, which it has not.
    attended: step.kind === "agent" ? step.attended === true : undefined,
    agent:
      step.kind === "agent"
        ? {
            model: step.agent.model,
            prompt: step.agent.prompt,
            skills: given.skills.map(({ name }) => ({ name, path: `.skills/${name}` })),
          }
        : undefined,
  };

  await writeFile(join(input_, "input.json"), JSON.stringify(encoded));
}

// The transcript and claimed artifacts go to the store before the event naming them is written.
async function run(
  step: Runnable,
  given: Given,
  stopping: () => Why | undefined,
  note: (text: string, from: "step" | "engine") => void,
  store: Store,
  spool: Spool,
  money: Allowance,
  checking = false,
): Promise<Ending | { type: "nothing" }> {
  const { step: name, attempt } = given;
  const directory = spool.work;

  // Attempt numbers are not reused, so anything already there is a removal that failed: start
  // clean.
  await removed(spool.directory);
  await mkdir(directory, { recursive: true });

  const workspace = join(directory, "workspace");
  const input = join(directory, "input");
  const output = join(directory, "output");

  // The spooled transcript and errors, opened just before the step's program starts: before, such
  // as while its workspace is built, the attempt has no transcript, rather than an empty one, and
  // an engine that finds the attempt ended finds no spool to keep.
  let spooling: { transcript: number; errors: number } | undefined;
  let erred = false;
  let written = 0;

  // The step's latest usage report, which every ending carries.
  let usage: Usage | undefined;

  // The proxy its network goes through, while it runs, when its access lists hosts, and its
  // brokers.
  let proxy: Proxy | undefined;
  let brokers: Brokers | undefined;

  // The session the program left, read once it has ended: kept with the ending, or over its limit.
  let left: ReturnType<typeof sessionLeft>;

  // Stores the transcript, and the errors when there are any, on the event that ends the attempt.
  const recorded = <E extends Ending>(event: Omit<E, "transcript">): E => {
    // SAFETY: E is the event given, with the transcript every ending event can carry.
    const ended = { ...event, transcript: store.keep(readFileSync(spool.transcript)) } as E;

    if (erred) {
      ended.errors = store.keep(readFileSync(spool.errors));
    }

    if (usage !== undefined) {
      ended.usage = usage;
    }

    if (left !== undefined && "body" in left) {
      ended.session = store.keep(left.body);
    }

    return ended;
  };

  // A session over its limit is not kept, and the reason says so.
  const escalate = ({ cause, reason }: Why): Ending =>
    spooling !== undefined
      ? recorded<Escalation>({
          type: "escalated",
          cause,
          reason:
            left !== undefined && "over" in left
              ? `${reason}${unkept(left.over, step.limits.transcript)}`
              : reason,
          attempt,
        })
      : { type: "escalated", cause, reason, attempt };

  const { disk } = step.limits;

  const overDisk = because("limit", `Step ${name} used more than its disk limit of ${disk} bytes.`);

  const overTranscript = because(
    "limit",
    `Step ${name} wrote more than its transcript limit of ${step.limits.transcript} bytes.`,
  );

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
  let fault: Why | undefined;

  // Why the attempt must stop now, if it must.
  const halt = () => {
    if (fault === undefined) {
      try {
        const why = stopping();

        if (why !== undefined) {
          return why;
        }
      } catch (error) {
        fault = failedIn(name, error instanceof Error ? error.message : String(error));
      }
    }

    return fault ?? (over ? overDisk : undefined);
  };

  const halted = () => halt() !== undefined;

  // Why the attempt must stop once a program has ended, measured afresh, with every directory
  // opened again so that none hides its bytes.
  const after = async () => {
    opened(directory);
    over ||= (await bytesUnder(directory)) > disk;

    return halt();
  };

  try {
    await mkdir(workspace);

    if (given.workspace !== undefined) {
      const failed = await materialise(
        spool,
        workspace,
        name,
        given.workspace,
        given.branches,
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
        return escalate(because("kind", failed));
      }
    }

    await prepare(input, step, given);
    await mkdir(output);

    // An agent step's program is its harness adapter, under the same contract.
    const bounds = { memory: step.limits.memory, processes: step.limits.processes };

    // The hosts it may reach, through a proxy of the engine's, when its access lists them.
    const { network } = step.access;

    proxy =
      network !== true && network !== false
        ? await openProxy(network.hosts, (target) =>
            note(`Step ${name} was refused network access to ${target}.`, "engine"),
          )
        : undefined;

    if (network !== true && network !== false) {
      const opened = await openBrokers(network.brokers ?? {}, bounds);

      if ("failed" in opened) {
        return escalate(because("broker", `Step ${name}'s ${opened.failed}`));
      }

      brokers = opened;
    }

    const confined = confine(
      step.access,
      { workspace, input, output, record: spool.record, scratch: join(directory, "scratch") },
      step.kind === "agent" ? step.agent.harness.run : step.run,
      bounds,
      proxy === undefined ? undefined : { proxy: proxy.socket, brokers: brokers!.sockets },
    );

    const { unit } = confined;

    // An attended step runs in a pseudo-terminal of its own, made from the owner's, which tells
    // the engine when they type; it is told what kind of terminal it is in.
    const attended = step.kind === "agent" && step.attended === true;
    const keys = join(spool.directory, "keys");

    const { command, args } = attended
      ? inTerminal([confined.command, ...confined.args], keys)
      : confined;

    const env =
      attended && process.env.TERM !== undefined
        ? { ...confined.env, TERM: process.env.TERM }
        : confined.env;

    // Made before script starts, which would otherwise create keys as a file and keep the
    // keystrokes; the owner's typing keeps an attended step from idling.
    const closeKeys = attended ? keysAt(keys, () => idle?.refresh()) : () => {};
    const restoreTerminal = attended ? keepTerminal() : () => {};

    // stdout and stderr together, in the order they arrive, up to the transcript limit; and the
    // stderr of it alone, as the attempt's errors.
    const transcript = openSync(spool.transcript, "w");
    const errors = openSync(spool.errors, "w");

    spooling = { transcript, errors };

    // Its own session and process group: stopping the step also stops what it started, and
    // without a controlling terminal, or with only the one script makes for it, the step cannot
    // push input into the owner's.
    const child = spawn(command, args, {
      cwd: workspace,
      env,
      // fd 3 is the step's notes for the owner, one per line, and fd 4 its usage reports. An
      // attended step's stdin is the owner's terminal, which only script reads.
      stdio: [attended ? "inherit" : "ignore", "pipe", "pipe", "pipe", "pipe"],
      detached: true,
    });

    // The window's size follows the owner's terminal, which signals this process.
    const resize = () => child.kill("SIGWINCH");

    if (attended) {
      process.on("SIGWINCH", resize);
    }

    // The sandbox's process: under script for an attended step, once script has started it.
    const sandbox = () => (attended ? underTerminal(child.pid!) : child.pid!);

    let stopped: Why | undefined;

    // The first reason to stop is the one recorded; stopping twice would signal a group that may be gone.
    // script would kill an attended step with no grace period, so the sandbox is stopped itself.
    const stopFor = (reason: Why) => {
      if (stopped === undefined) {
        stopped = reason;
        stop(child, sandbox() ?? child.pid!);
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

    // No timer for a limit an attended step declares unbounded.
    const timer = (seconds: number | "unbounded", reason: string) =>
      seconds === "unbounded"
        ? undefined
        : setTimeout(() => stopFor(because("limit", reason)), seconds * 1000);

    const idle = timer(step.limits.idle, `Step ${name} was idle for ${step.limits.idle} s.`);

    const overall = timer(
      step.limits.attempt,
      `Step ${name} reached its attempt limit of ${step.limits.attempt} s.`,
    );

    const cancel = setInterval(() => {
      const box = sandbox();
      const why = halt() ?? (box === undefined ? undefined : filled(box, step.access, name));

      if (why !== undefined) {
        stopFor(why);
      }
    }, cancelLook);

    // stdout and stderr go to the transcript, and stderr to the errors too.
    const record = (stderr: boolean) => (chunk: Buffer) => {
      idle?.refresh();

      const room = step.limits.transcript - written;
      const kept = chunk.subarray(0, Math.max(room, 0));

      writeSync(transcript, kept);
      written += chunk.length;

      // The owner sees what an attended step shows, as it shows it.
      if (attended) {
        (stderr ? process.stderr : process.stdout).write(chunk);
      }

      if (stderr && kept.length > 0) {
        writeSync(errors, kept);
        erred = true;
      }

      if (written > step.limits.transcript) {
        stopFor(overTranscript);
      }
    };

    child.stdout!.on("data", guarded(record(false)));
    child.stderr!.on("data", guarded(record(true)));

    // The part of a note whose line has not ended yet.
    let pending = Buffer.alloc(0);

    // Records each complete line as a note, unless it is empty. A note's bytes count toward the
    // transcript limit, so notes are bounded with everything else the step writes.
    const noteFrom = (chunk: Buffer) => {
      idle?.refresh();
      written += chunk.length;

      if (written > step.limits.transcript) {
        stopFor(overTranscript);

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
        stopFor(
          because("limit", `Step ${name} wrote a note over its limit of ${noteLimit} bytes.`),
        );

        return;
      }

      const text = line.toString().trimEnd();

      if (text !== "") {
        note(text, "step");
      }
    };

    child.stdio[3]!.on("data", guarded(noteFrom));

    // The part of a usage report whose line has not ended yet.
    let reporting = Buffer.alloc(0);

    // Keeps each complete line as the step's latest usage, spooled so an engine that finds the
    // attempt interrupted records it too. Bounded like notes, and counted with them.
    const usageFrom = (chunk: Buffer) => {
      idle?.refresh();
      written += chunk.length;

      if (written > step.limits.transcript) {
        stopFor(overTranscript);

        return;
      }

      reporting = Buffer.concat([reporting, chunk]);

      for (let end = reporting.indexOf(10); end !== -1; end = reporting.indexOf(10)) {
        usageLine(reporting.subarray(0, end));
        reporting = reporting.subarray(end + 1);
      }

      if (reporting.length > noteLimit) {
        usageLine(reporting);
      }
    };

    const usageLine = (line: Buffer) => {
      if (stopped !== undefined) {
        return;
      }

      if (line.length > noteLimit) {
        stopFor(
          because(
            "limit",
            `Step ${name} wrote a usage report over its limit of ${noteLimit} bytes.`,
          ),
        );

        return;
      }

      const text = line.toString().trim();

      if (text === "") {
        return;
      }

      const report = usageIn(text);

      if (report === undefined) {
        stopFor(because("claim", `Step ${name} wrote a usage report that is not one: ${text}.`));

        return;
      }

      usage = report;
      writeFileSync(spool.usage, JSON.stringify(report));

      const over = report.usd === undefined ? undefined : overMoney(name, report.usd, money);

      if (over !== undefined) {
        stopFor(over);
      }
    };

    child.stdio[4]!.on("data", guarded(usageFrom));

    // While the owner and an attended step's agent go back and forth, the engine reads each
    // output.json the agent writes and notes what it holds, so the owner knows when the result
    // is in and whether it would be accepted; it is judged as any claim once the session ends.
    const reading = attended ? readEachOutput(step, given, output, note) : undefined;

    const closed = await once(child, "close")
      .catch((error: NodeJS.ErrnoException) => error)
      .finally(() => {
        clearTimeout(idle);
        clearTimeout(overall);
        clearInterval(cancel);
        process.off("SIGWINCH", resize);
        closeKeys();
        restoreTerminal();
      });

    // A note after the attempt's end would not replay, so the last reading finishes first.
    await reading?.close();

    // A last note or report need not end its line.
    noteLine(pending);
    usageLine(reporting);

    left = sessionLeft(output, step.limits.transcript);

    if (closed instanceof Error) {
      return escalate(because("exit", `Step ${name} could not start: ${closed.code}.`));
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
        return escalate(
          because("limit", `Step ${name} reached its memory limit of ${bounds.memory} bytes.`),
        );
      }

      return escalate(
        because(
          "exit",
          signal
            ? `Step ${name} was ended by ${signal}.`
            : `Step ${name} exited with code ${code}.`,
        ),
      );
    }

    // A check that exits 0 without a claim found nothing yet.
    if (checking && !existsSync(join(output, "output.json"))) {
      return { type: "nothing" };
    }

    // A claim cannot complete an attempt whose session the record could not keep.
    if (left !== undefined && "over" in left) {
      const over = left.over;

      left = undefined;

      return escalate(
        because(
          "limit",
          `Step ${name} left a session of ${over} bytes, over its transcript limit of ${step.limits.transcript}.`,
        ),
      );
    }

    // Unknown cost is not zero.
    if (money.step !== undefined && usage?.usd === undefined) {
      return escalate(
        because(
          "money",
          `Step ${name} reported no cost, so it counts as over its money limit of $${money.step}.`,
        ),
      );
    }

    const claim = await parse(step, name, output, given);

    if ("reason" in claim) {
      return escalate(because("claim", claim.reason));
    }

    // Each artifact whose kind has a verifier is accepted by it, which may keep files. A new one
    // goes to the store only once every one is accepted.
    const verified: (
      | { hash: string; kind: string; kept: Readonly<Record<string, string>> }
      | { artifact: Artifact; kept: Readonly<Record<string, string>> }
    )[] = [];

    for (const artifact of claim.artifacts) {
      // An adopted artifact was verified when it was first claimed.
      if ("adopt" in artifact) {
        verified.push({ hash: artifact.adopt, kind: artifact.artifact.kind, kept: artifact.kept });

        continue;
      }

      const { verifier } = given.kinds[artifact.kind];

      if (verifier !== undefined) {
        const result = await verify(
          spool,
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
          return escalate(result);
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
      artifacts: verified.map((each) =>
        "hash" in each
          ? each
          : { hash: store.put(each.artifact), kind: each.artifact.kind, kept: each.kept },
      ),
      next: step.on[claim.outcome],
    });
  } finally {
    clearInterval(watching);
    await brokers?.close();
    await proxy?.close();

    if (spooling !== undefined) {
      closeSync(spooling.transcript);
      closeSync(spooling.errors);
    }

    await removed(directory);
  }
}

// A usage report parsed from its line, or undefined if it is not one: an object of at most money,
// a number of dollars, and tokens, each count a whole number; none below zero, nothing else.
function usageIn(text: string): Usage | undefined {
  let report: unknown;

  try {
    report = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (!isRecord(report) || !Object.keys(report).every((key) => key === "usd" || key === "tokens")) {
    return undefined;
  }

  const fields = new Map(Object.entries(report));
  const usd = fields.get("usd");
  const tokens = fields.get("tokens");

  const dollars = usd === undefined || (Number.isFinite(usd) && Number(usd) >= 0);

  const counted =
    tokens === undefined ||
    (hasExactly(tokens, ["input", "output", "cacheRead", "cacheWrite"]) &&
      Object.values(tokens).every((count) => Number.isSafeInteger(count) && count >= 0));

  // SAFETY: checked above to hold only the fields a Usage defines, each of its type.
  return dollars && counted ? (report as Usage) : undefined;
}

// The engine's proxy for a step that may reach only some hosts: where its socket is, and how to
// close it.
type Proxy = { socket: string; close: () => Promise<void> };

// The most a request's head may hold before the proxy refuses it.
const headLimit = 8192;

// Opens a proxy that tunnels a CONNECT to one of `hosts`, and refuses anything else, calling
// `refused` once for each target it refuses. It listens on a socket in a short directory of its
// own: a socket's path is bounded, and an attempt's directory is deep. It runs in the engine, so
// it reaches the network the engine reaches; the step reaches only it.
async function openProxy(
  hosts: readonly string[],
  refused: (target: string) => void,
): Promise<Proxy> {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-proxy-"));
  const socket = join(directory, "socket");
  const told = new Set<string>();
  const open = new Set<Socket>();

  const server = createNetServer((client) => {
    open.add(client);
    client.on("close", () => open.delete(client));
    client.on("error", () => client.destroy());

    let head = Buffer.alloc(0);

    const reading = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);

      const end = head.indexOf("\r\n\r\n");

      if (end === -1) {
        if (head.length > headLimit) {
          client.end("HTTP/1.1 431 Request Header Fields Too Large\r\n\r\n");
        }

        return;
      }

      client.off("data", reading);

      const [method, target] = head.subarray(0, end).toString("latin1").split(" ");
      const rest = head.subarray(end + 4);

      if (method !== "CONNECT" || target === undefined || !reachable(target, hosts)) {
        const named = method === "CONNECT" && target !== undefined ? target : `${method} ${target}`;

        if (!told.has(named)) {
          told.add(named);
          refused(named);
        }

        client.end("HTTP/1.1 403 Forbidden\r\n\r\nRefused by the step's access.\n");

        return;
      }

      const separator = target.lastIndexOf(":");
      const upstream = connectTo(Number(target.slice(separator + 1)), target.slice(0, separator));

      open.add(upstream);
      upstream.on("close", () => open.delete(upstream));

      upstream.on("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        upstream.write(rest);
        upstream.pipe(client);
        client.pipe(upstream);
      });

      upstream.on("error", () => {
        client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        upstream.destroy();
      });

      client.on("close", () => upstream.destroy());
    };

    client.on("data", reading);
  });

  await new Promise<void>((resolve) => server.listen(socket, resolve));

  return {
    socket,
    async close() {
      for (const each of open) {
        each.destroy();
      }

      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

// A step's brokers while its attempt runs: each one's socket by name, and how to stop them.
type Brokers = { sockets: ReadonlyMap<string, string>; close: () => Promise<void> };

// How long a broker has to listen once started, in milliseconds, and how often it is looked for.
const brokerStart = 10_000;
const brokerLook = 20;

// How long a broker has to end once told to, in milliseconds.
const brokerGrace = 5000;

// The most of a broker's stderr kept to say why it did not start.
const brokerSaid = 1024;

// Starts each broker outside the sandbox, in a scope of its own within the step's `bounds`, with
// MEDRENGARD_SOCKET naming the socket it is to listen on, and waits until each listens. One that
// ends or does not listen in time fails them all, and says why.
async function openBrokers(
  programs: Readonly<Record<string, readonly [string, ...string[]]>>,
  bounds: Bounds,
): Promise<Brokers | { failed: string }> {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-brokers-"));
  const sockets = new Map<string, string>();
  const started: ChildProcess[] = [];

  const close = async () => {
    await Promise.all(started.map((broker) => ended(broker)));
    await rm(directory, { recursive: true, force: true });
  };

  for (const [name, run] of Object.entries(programs)) {
    const socket = join(directory, name);

    const { command, args, env } = inScope(run, bounds, {
      ...process.env,
      MEDRENGARD_SOCKET: socket,
    });

    const broker = spawn(command, args, {
      env,
      stdio: ["ignore", "ignore", "pipe"],
      detached: true,
    });

    started.push(broker);

    let said = "";

    broker.stderr!.on("data", (chunk: Buffer) => {
      said = (said + chunk.toString()).slice(0, brokerSaid);
    });

    const why = await listening(broker, socket, () => said.trim());

    if (why !== undefined) {
      await close();

      return { failed: `broker ${name} ${why}` };
    }

    sockets.set(name, socket);
  }

  return { sockets, close };
}

// Why `broker` is not listening on `socket`, once it is or cannot be: undefined when it is.
async function listening(
  broker: ChildProcess,
  socket: string,
  said: () => string,
): Promise<string | undefined> {
  const deadline = Date.now() + brokerStart;

  while (Date.now() < deadline) {
    if (broker.exitCode !== null || broker.signalCode !== null) {
      return `ended before it listened: ${said()}`;
    }

    if (await connects(socket)) {
      return undefined;
    }

    await new Promise((resolve) => setTimeout(resolve, brokerLook));
  }

  return `did not listen within ${brokerStart / 1000} s: ${said()}`;
}

// Whether something listens on the unix socket `socket`.
function connects(socket: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connectTo(socket);

    probe.on("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.on("error", () => resolve(false));
  });
}

// Stops `broker` and all it started, and waits until it has ended.
async function ended(broker: ChildProcess): Promise<void> {
  if (broker.exitCode !== null || broker.signalCode !== null) {
    return;
  }

  const exited = once(broker, "exit");
  const group = -broker.pid!;

  process.kill(group, "SIGTERM");

  // One that ignores the signal is killed.
  const killing = setTimeout(() => process.kill(group, "SIGKILL"), brokerGrace);

  await exited;
  clearTimeout(killing);
}

// Whether a CONNECT target, host:port, is one of `hosts`: `host` is port 443, `host:port` that
// port, and `*.domain` any of its subdomains.
function reachable(target: string, hosts: readonly string[]): boolean {
  const separator = target.lastIndexOf(":");
  const name = target.slice(0, separator).toLowerCase();
  const port = target.slice(separator + 1);

  return (
    separator > 0 &&
    /^[0-9]+$/.test(port) &&
    hosts.some((entry) => {
      const [listed, listedPort = "443"] = entry.toLowerCase().split(":");

      return (
        port === listedPort &&
        (listed!.startsWith("*.") ? name.endsWith(listed!.slice(1)) : name === listed)
      );
    })
  );
}

// An artifact a claim adopted: one of the attempt's inputs, named by hash, recorded as it is with
// the files its verifier kept.
type Adopted = { adopt: string; artifact: Artifact; kept: Readonly<Record<string, string>> };

type Claim = { outcome: string; artifacts: (Artifact | Adopted)[] };

// The kind of a claimed or adopted artifact.
const kindOf = (claimed: Artifact | Adopted) =>
  "adopt" in claimed ? claimed.artifact.kind : claimed.kind;

// How long output.json is left unread after a write, so a file written in parts is read whole.
const settle = 100;

/**
 * Watches the attempt's output for each output.json its step writes, and notes what it would
 * amount to: its outcome and artifacts, or why it would escalate, when that changes. Returns what
 * stops watching once any reading in progress has noted.
 */
function readEachOutput(
  step: Runnable,
  given: Given,
  output: string,
  note: (text: string, from: "engine") => void,
) {
  const name = given.step;
  let last: string | undefined;
  let waiting: NodeJS.Timeout | undefined;
  let reading = Promise.resolve();

  const read = async () => {
    const claim = await parse(step, name, output, given);

    const kinds = "reason" in claim ? [] : claim.artifacts.map(kindOf);

    const holds =
      kinds.length === 0
        ? "with no artifacts"
        : `with ${kinds.length} artifact${kinds.length === 1 ? "" : "s"}: ${kinds.join(", ")}`;

    const text =
      "reason" in claim
        ? `Step ${name}'s output would escalate: ${claim.reason}`
        : `Step ${name}'s output is ready: outcome ${claim.outcome}, ${holds}. It is verified once the session ends.`;

    if (text !== last) {
      last = text;
      note(bounded(text), "engine");
    }
  };

  const watcher = watch(output, (_, file) => {
    if (file === "output.json") {
      clearTimeout(waiting);
      waiting = setTimeout(() => {
        reading = reading.then(read);
      }, settle);
    }
  });

  return {
    close: async () => {
      watcher.close();
      clearTimeout(waiting);
      await reading;
    },
  };
}

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
  { subject: { hash: subject }, kinds, inputs }: Given,
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

  const artifacts: (Artifact | Adopted)[] = [];

  // The artifacts the attempt was given, which it may adopt by hash.
  const offered = new Map(
    inputs.flatMap((input) =>
      "artifacts" in input ? input.artifacts.map((each) => [each.hash, each] as const) : [],
    ),
  );

  for (const artifact of claimed) {
    // An artifact adopted, by its hash: one the attempt was given, of a kind it may claim.
    if (isRecord(artifact) && Object.hasOwn(artifact, "adopt")) {
      const hash = new Map<string, unknown>(Object.entries(artifact)).get("adopt");
      const found = isText(hash) ? offered.get(hash) : undefined;

      if (!hasExactly(artifact, ["adopt"]) || found === undefined) {
        return {
          reason: `Step ${name} adopted an artifact it was not given: ${JSON.stringify(hash)}.`,
        };
      }

      if (!step.claims.includes(found.artifact.kind)) {
        return {
          reason: `Step ${name} adopted an artifact of undeclared kind: ${JSON.stringify(found.artifact.kind)}.`,
        };
      }

      if (found.hash === subject) {
        return { reason: `Step ${name} adopted the commission's subject, which it already is.` };
      }

      artifacts.push({ adopt: found.hash, artifact: found.artifact, kept: found.kept });

      continue;
    }

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

  // A judgement that routes is about the subject the attempt was given, which a new subject in
  // the same claim would make history at once: the edge would follow a judgement of nothing current.
  const routing = artifacts
    .map(kindOf)
    .find((kind) => kinds[kind].role === "judgement" && kinds[kind].outcome !== undefined);

  if (
    routing !== undefined &&
    artifacts.map(kindOf).some((kind) => kinds[kind].role === "subject")
  ) {
    const kind = routing;

    return {
      reason: `Step ${name} claimed a ${kind}, whose ${kinds[kind].outcome} routes its outcome, with a new subject: the ${kind} would be about the subject its claim replaces.`,
    };
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
  // Joined to the output, an absolute path would read as a relative one.
  if (isAbsolute(body)) {
    return {
      reason: `Step ${name} claimed a body path that is not relative to its output: ${JSON.stringify(body)}.`,
    };
  }

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

  // lazy: bodies are UTF-8 text only. Give a kind's body a binary form once a kind needs one,
  // such as a screenshot; until then bytes travel as a verifier's kept files.
  try {
    text = utf8.decode(read);
  } catch {
    return { reason: `Step ${name} claimed a body that is not UTF-8: ${JSON.stringify(body)}.` };
  }

  return { text };
}

// The session a program left in its output, at `output/session`: its bytes within `limit`, its size
// when over it, or nothing when it left no regular file there. Resolved first, as a claimed body
// is, so a symbolic link cannot make the engine read outside the output; read at most one byte past
// the limit, so a file still growing is never read whole.
function sessionLeft(
  output: string,
  limit: number,
): { body: Buffer } | { over: number } | undefined {
  let real;

  try {
    real = realpathSync(join(output, "session"));

    if (relative(realpathSync(output), real).split(sep)[0] === "..") {
      return undefined;
    }
  } catch {
    return undefined;
  }

  let file;

  try {
    file = openSync(real, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    return undefined;
  }

  try {
    const stats = fstatSync(file);

    if (!stats.isFile()) {
      return undefined;
    }

    if (stats.size > limit) {
      return { over: stats.size };
    }

    const body = Buffer.alloc(limit + 1);
    const read = readSync(file, body, 0, body.length, 0);

    return read > limit ? { over: read } : { body: body.subarray(0, read) };
  } finally {
    closeSync(file);
  }
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

// Runs a kind's program in its areas' workspace under its access, with their input and output as
// its directories and the record hidden, stopped after its limit or once the attempt is cancelled.
// Returns why it failed, or undefined when it exited 0.
async function runProgram(
  program: Program,
  areas: Parameters<typeof confine>[1],
  cancelled: () => boolean,
): Promise<string | undefined> {
  const { workspace } = areas;

  const { command, args, env, unit } = confine(program.access, areas, program.run, {
    memory: program.limits.memory,
    processes: program.limits.processes,
  });

  // lazy: no notes, stdout dropped, stderr kept only as a failure's tail. Give kind programs a
  // transcript of their own once a successful run needs inspecting, such as from the UI.
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
    stop(child, child.pid!);
  }, program.limits.attempt * 1000);

  const cancel = setInterval(() => {
    if (cancelled()) {
      stop(child, child.pid!);
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
    return `it reached its limit of ${program.limits.attempt} s.${stderr}`;
  }

  if (closed[0] !== 0 && overMemory(unit)) {
    return `it reached its memory limit of ${program.limits.memory} bytes.${stderr}`;
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

  return { input, output, scratch: join(area, "scratch") };
}

// Runs the claim's kind's verifier in the attempt's workspace, and stores the files it keeps.
// lazy: the workspace is not read-only to the verifier; the sandbox makes it so.
async function verify(
  spool: Spool,
  workspace: string,
  name: string,
  claim: Artifact,
  verifier: NonNullable<Kind["verifier"]>,
  subject: Subject,
  store: Store,
  cancelled: () => boolean,
): Promise<{ kept: Record<string, string> } | Why> {
  const { input, output, scratch } = await areaFor(spool.work, "verifier");
  const { kind } = claim;

  const failed = (why: string) =>
    because("kind", `The ${kind} verifier failed on step ${name}'s claim: ${why}`);

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

  const why = await runProgram(
    verifier,
    { workspace, input, output, record: spool.record, scratch },
    cancelled,
  );

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
    return because(
      "claim",
      `Step ${name} claimed a ${kind} its verifier rejected: ${verdict.reason}`,
    );
  }

  if (
    verdict?.accepted !== true ||
    !Array.isArray(verdict.keep) ||
    !exactly(["accepted", "keep"])
  ) {
    return failed("it wrote no valid output.json.");
  }

  const read = new Map<string, Buffer>();
  let room = verifier.limits.kept;

  for (const file of verdict.keep) {
    if (!isText(file) || !plainName.test(file)) {
      return failed(`it kept a file without a plain name: ${JSON.stringify(file)}.`);
    }

    const bytes = await readUnder(output, file, room);

    if (bytes === undefined || bytes === "outside") {
      return failed(`it kept ${file}, which is missing.`);
    }

    if (bytes.length > room) {
      return failed(
        `the files it kept total more than its limit of ${verifier.limits.kept} bytes.`,
      );
    }

    room -= bytes.length;
    read.set(file, bytes);
  }

  // Into the store only once all of them are within the limit.
  return { kept: Object.fromEntries([...read].map(([file, bytes]) => [file, store.keep(bytes)])) };
}

// Builds the workspace from an artifact, the subject or an input's, with its kind's materialiser,
// which adds `branches`, of the same kind, beside it, when the step adds any. Returns why it
// failed, or undefined.
async function materialise(
  spool: Spool,
  workspace: string,
  name: string,
  from: Subject,
  branches: readonly Supplied[] | undefined,
  kinds: Kinds,
  store: Store,
  cancelled: () => boolean,
): Promise<string | undefined> {
  const { artifact } = from;

  const materialiser = kinds[artifact.kind]?.materialiser;

  if (materialiser === undefined) {
    return `Step ${name}'s workspace cannot be built from a ${artifact.kind}, whose kind has no materialiser.`;
  }

  const { input, output, scratch } = await areaFor(spool.work, "materialiser");

  // Writes `each` under `under` in the input, as artifact.json describes it, relative to the input.
  const describe = async (each: Subject, under: string) => {
    await mkdir(join(input, under, "kept"), { recursive: true });

    for (const [file, hash] of Object.entries(each.kept)) {
      await writeFile(join(input, under, "kept", file), store.read(hash));
    }

    if (each.artifact.body !== undefined) {
      await writeFile(join(input, under, "body"), each.artifact.body);
    }

    return {
      hash: each.hash,
      kind: each.artifact.kind,
      fields: each.artifact.fields,
      body: each.artifact.body === undefined ? undefined : join(under, "body"),
      kept: Object.fromEntries(
        Object.keys(each.kept).map((file) => [file, join(under, "kept", file)]),
      ),
    };
  };

  await writeFile(join(input, "artifact.json"), JSON.stringify(await describe(from, "")));

  // Only a step that adds branches gives its materialiser branches.json, even an empty one.
  if (branches !== undefined) {
    const described = [];

    for (const each of branches) {
      // SAFETY: the engine names every artifact a workspace adds as a branch.
      const branch = each.branch as string;

      described.push({ branch, ...(await describe(each, join("branches", branch))) });
    }

    await writeFile(join(input, "branches.json"), JSON.stringify(described));
  }

  const why = await runProgram(
    materialiser,
    { workspace, input, output, record: spool.record, scratch },
    cancelled,
  );

  return why === undefined
    ? undefined
    : `The ${artifact.kind} materialiser failed for step ${name}: ${why}`;
}
