import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  replay,
  type Commissioned,
  type CommissionEvent,
  type CommissionState,
  type Workflow,
} from "./replay.ts";

type Options = { log: string; workflows: Record<string, Workflow> };

type Log = [Commissioned, ...Exclude<CommissionEvent, Commissioned>[]];

/** Runs commissions through the owner's workflows, keeping every event in the SQLite log at `log`. */
export function createEngine({ log, workflows }: Options) {
  const database = new DatabaseSync(log);

  // The primary key refuses a second event at the same position, so a concurrent writer fails
  // instead of interleaving.
  database.exec(`CREATE TABLE IF NOT EXISTS events (
    commission TEXT NOT NULL, position INTEGER NOT NULL, event TEXT NOT NULL,
    PRIMARY KEY (commission, position)) STRICT`);

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
    /** Starts a commission under the workflow named `workflow`. */
    commission(workflow: string, commission: string): void {
      const event: Commissioned = { type: "commissioned", workflow };

      replay(workflows[workflow], [event]);
      insert.run(commission, 0, JSON.stringify(event));
    },

    /** Attempts ready steps until the commission is awaiting, escalated or finished. */
    async advance(commission: string): Promise<CommissionState> {
      for (;;) {
        const events = read(commission);
        const workflow = workflows[events[0].workflow];
        const state = replay(workflow, events);

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
        const started = { type: "attempt-started", step: name, attempt } as const;

        write(commission, events, started);

        write(commission, [...events, started], await run(step, name, attempt));
      }
    },
  };
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
async function run(step: Command, name: string, attempt: number): Promise<Ending> {
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

    const stopFor = (reason: string) => {
      stopped ??= reason;
      stop(child);
    };

    const idle = setTimeout(
      () => stopFor(`Step ${name} was idle for ${step.limits.idle} s.`),
      step.limits.idle * 1000,
    );

    const overall = setTimeout(
      () => stopFor(`Step ${name} reached its attempt limit of ${step.limits.attempt} s.`),
      step.limits.attempt * 1000,
    );

    // lazy: output is read only to see activity. Keep it as the transcript, under its
    // size limit, once the store exists.
    child.stdout.on("data", () => idle.refresh());
    child.stderr.on("data", () => idle.refresh());

    const [code, signal] = await once(child, "close").finally(() => {
      clearTimeout(idle);
      clearTimeout(overall);
    });

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
