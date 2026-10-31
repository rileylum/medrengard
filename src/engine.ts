import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  replay,
  type Commissioned,
  type CommissionEvent,
  type CommissionState,
  type Workflow,
} from "./replay.ts";
import { createStore, type Artifact } from "./store.ts";

type Options = { log: string; workflows: Record<string, Workflow> };

type Log = [Commissioned, ...Exclude<CommissionEvent, Commissioned>[]];

/**
 * Runs commissions through the owner's workflows, keeping every event in the SQLite log at `log`
 * and every artifact in the store beside it.
 */
export function createEngine({ log, workflows }: Options) {
  const database = new DatabaseSync(log);
  const store = createStore(join(dirname(log), "store"));

  // The primary key refuses a second event at the same position, so a concurrent writer fails
  // instead of interleaving.
  database.exec(`CREATE TABLE IF NOT EXISTS events (
    commission TEXT NOT NULL, position INTEGER NOT NULL, event TEXT NOT NULL,
    PRIMARY KEY (commission, position)) STRICT`);

  const self = { pid: process.pid, start: startOf(process.pid)! };

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

  function read(commission: string): Log {
    const events = select.all(commission).map(({ event }) => JSON.parse(String(event)));

    // SAFETY: only commission and write insert here, and commission writes the first event.
    return events as Log;
  }

  function write(commission: string, events: Log, event: Log[1]): void {
    replay(workflows[events[0].workflow], [...events, event]);
    insert.run(commission, events.length, JSON.stringify(event));
  }

  return {
    /** Starts a commission under the workflow named `workflow`, about the owner's request. */
    commission(
      workflow: string,
      commission: string,
      request: { title: string; body: string },
    ): void {
      const event: Commissioned = {
        type: "commissioned",
        workflow,
        request: store.put({
          kind: "document",
          fields: { title: request.title },
          body: request.body,
        }),
      };

      replay(workflows[workflow], [event]);
      insert.run(commission, 0, JSON.stringify(event));
    },

    /** Replays the commission's state from the log. */
    state(commission: string): CommissionState {
      const events = read(commission);

      return replay(workflows[events[0].workflow], events);
    },

    /** Reads the artifact kept under `hash`. */
    artifact(hash: string): Artifact {
      return store.get(hash);
    },

    /**
     * Records the owner's decision about the commission's current subject. At an approval step
     * the outcome must be one the step declares; on an escalation it is retry or abandon.
     */
    decide(commission: string, { subject, outcome }: { subject: string; outcome: string }) {
      const events = read(commission);
      const workflow = workflows[events[0].workflow];
      const state = replay(workflow, events);

      if (state.status !== "awaiting" && state.status !== "escalated") {
        throw new Error(`Commission ${commission} is ${state.status}, so no decision can be made.`);
      }

      if (subject !== state.subject) {
        throw new Error(`Commission ${commission} is about ${state.subject}, not ${subject}.`);
      }

      const name = state.step.name;
      const step = workflow.steps[name];
      const on = step.kind === "approval" ? step.on : { retry: name, abandon: "end" };

      if (!Object.hasOwn(on, outcome)) {
        throw new Error(`Step ${name} does not declare outcome "${outcome}".`);
      }

      const event = {
        type: "decided",
        step: name,
        decision: store.put({ kind: "decision", fields: { outcome, subject } }),
        outcome,
        subject,
        next: on[outcome],
      } as const;

      write(commission, events, event);

      return replay(workflow, [...events, event]);
    },

    /** Asks the engine running the commission's attempt to stop it; that engine escalates. */
    cancel(commission: string): void {
      const events = read(commission);
      const state = replay(workflows[events[0].workflow], events);

      if (state.status !== "attempting") {
        throw new Error(
          `Commission ${commission} is ${state.status}, so no attempt can be cancelled.`,
        );
      }

      request.run(
        commission,
        events.findLast((event) => event.type === "attempt-started")!.attempt,
      );
    },

    /** Attempts ready steps until the commission is awaiting, escalated or finished. */
    async advance(commission: string): Promise<CommissionState> {
      for (;;) {
        const events = read(commission);
        const workflow = workflows[events[0].workflow];
        const state = replay(workflow, events);

        if (state.status === "attempting") {
          const started = events.findLast((event) => event.type === "attempt-started")!;

          if (startOf(started.process.pid) === started.process.start) {
            return state;
          }

          write(commission, events, {
            type: "escalated",
            reason: `Step ${state.step.name} was interrupted.`,
            attempt: started.attempt,
          });

          continue;
        }

        if (state.status !== "ready") {
          return state;
        }

        const name = state.step.name;
        const step = workflow.steps[name];

        // lazy: only command steps run. Agent steps run once a harness adapter exists.
        if (step.kind !== "command") {
          throw new Error(`Step ${name} is an agent step, which cannot run yet.`);
        }

        if (spent(events, name) >= step.budget) {
          write(commission, events, {
            type: "escalated",
            reason: `Step ${name} has spent its budget of ${step.budget} attempts.`,
          });

          continue;
        }

        const attempt = events.filter((event) => event.type === "attempt-started").length + 1;
        const started = { type: "attempt-started", step: name, attempt, process: self } as const;

        write(commission, events, started);

        const cancelled = () => requested.get(commission, attempt) !== undefined;

        write(commission, [...events, started], await run(step, name, attempt, cancelled));
      }
    },
  };
}

// A pid is reused once its process ends; with its start time from /proc it names one process.
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

// Only the owner renews a budget: it counts the step's attempts since the latest decision.
function spent(events: Log, name: string): number {
  const since = events.findLastIndex((event) => event.type === "decided") + 1;

  return events
    .slice(since)
    .filter((event) => event.type === "attempt-started" && event.step === name).length;
}

type Command = Extract<Workflow["steps"][string], { kind: "command" }>;

type Ending = Extract<CommissionEvent, { type: "attempt-completed" | "escalated" }>;

// The time a stopped step has to exit after SIGTERM before it gets SIGKILL.
const grace = 5000;

function stop(child: ChildProcess): void {
  process.kill(-child.pid!, "SIGTERM");

  const kill = setTimeout(() => process.kill(-child.pid!, "SIGKILL"), grace);

  child.once("close", () => clearTimeout(kill));
}

// lazy: the step is not confined. Run it in the sandbox before any step is not the owner's.
async function run(
  step: Command,
  name: string,
  attempt: number,
  cancelled: () => boolean,
): Promise<Ending> {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-attempt-"));
  const workspace = join(directory, "workspace");
  const output = join(directory, "output");
  const escalate = (reason: string): Ending => ({ type: "escalated", reason, attempt });

  try {
    await mkdir(workspace);
    await mkdir(output);

    const [command, ...args] = step.run;

    // Its own process group, so stopping the step also stops what it started.
    const child = spawn(command, args, {
      cwd: workspace,
      env: { PATH: process.env.PATH, MEDRENGARD_OUT: output },
      stdio: ["ignore", "pipe", "pipe"],
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

    const idle = setTimeout(
      () => stopFor(`Step ${name} was idle for ${step.limits.idle} s.`),
      step.limits.idle * 1000,
    );

    const overall = setTimeout(
      () => stopFor(`Step ${name} reached its attempt limit of ${step.limits.attempt} s.`),
      step.limits.attempt * 1000,
    );

    const cancel = setInterval(() => {
      if (cancelled()) {
        stopFor(`Step ${name} was cancelled by the owner.`);
      }
    }, 1000);

    // lazy: output is read only to see activity. Keep it as the transcript, under its
    // size limit, once the store exists.
    child.stdout.on("data", () => idle.refresh());
    child.stderr.on("data", () => idle.refresh());

    const closed = await once(child, "close")
      .catch((error: NodeJS.ErrnoException) => error)
      .finally(() => {
        clearTimeout(idle);
        clearTimeout(overall);
        clearInterval(cancel);
      });

    if (closed instanceof Error) {
      return escalate(`Step ${name} could not start: ${closed.code}.`);
    }

    const [code, signal] = closed;

    if (stopped !== undefined) {
      return escalate(stopped);
    }

    if (code !== 0) {
      return escalate(
        signal ? `Step ${name} was ended by ${signal}.` : `Step ${name} exited with code ${code}.`,
      );
    }

    // Everything in the output directory is the step's doing, so any failure to read it is the step's.
    const text = await readFile(join(output, "output.json"), "utf8").catch(() => undefined);

    if (text === undefined) {
      return escalate(`Step ${name} exited 0 without a readable output.json.`);
    }

    let claim;

    try {
      claim = JSON.parse(text);
    } catch {
      return escalate(`Step ${name} wrote an output.json that is not JSON.`);
    }

    // Strict equality with a declared key also refuses an outcome that is not a string.
    const outcome = Object.keys(step.on).find((declared) => declared === claim?.outcome);

    if (outcome === undefined) {
      return escalate(
        `Step ${name} claimed an outcome it does not declare: ${JSON.stringify(claim?.outcome)}.`,
      );
    }

    return { type: "attempt-completed", step: name, attempt, outcome, next: step.on[outcome] };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
