import { spawn } from "node:child_process";
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

        const attempt = events.filter((event) => event.type === "attempt-started").length + 1;
        const started = { type: "attempt-started", step: name, attempt } as const;

        write(commission, events, started);

        const outcome = await run(step.run);

        write(commission, [...events, started], {
          type: "attempt-completed",
          step: name,
          attempt,
          outcome,
          next: step.on[outcome],
        });
      }
    },
  };
}

// lazy: the exit code and output.json are trusted, and the step is not confined. Escalate on a
// failed exit or an invalid output, and run in the sandbox, before any step is not the owner's.
async function run([command, ...args]: readonly [string, ...string[]]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-attempt-"));
  const workspace = join(directory, "workspace");
  const output = join(directory, "output");

  try {
    await mkdir(workspace);
    await mkdir(output);

    const child = spawn(command, args, {
      cwd: workspace,
      env: { PATH: process.env.PATH, MEDRENGARD_OUT: output },
      stdio: "ignore",
    });

    await once(child, "exit");

    const { outcome } = JSON.parse(await readFile(join(output, "output.json"), "utf8"));

    return outcome;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
