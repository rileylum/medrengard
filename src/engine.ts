import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { constants, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import {
  replay,
  subjects,
  type Commissioned,
  type CommissionEvent,
  type CommissionState,
  type Query,
  type Workflow,
} from "./replay.ts";
import { parseWorkflow } from "./definition.ts";
import { hasExactly, isText } from "./json.ts";
import { confine } from "./sandbox.ts";
import { createStore, type Artifact, type Commit, type Document, type Verdict } from "./store.ts";

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

  // In the order they were commissioned: rowid follows insertion.
  const commissioned = database.prepare(
    "SELECT commission FROM events WHERE position = 0 ORDER BY rowid",
  );

  function read(commission: string): Log {
    const events = select.all(commission).map(({ event }) => JSON.parse(String(event)));

    if (events.length === 0) {
      throw new Error(`There is no commission named ${commission}.`);
    }

    // SAFETY: only commission and write insert here, and commission writes the first event.
    return events as Log;
  }

  // Parsed once per definition; a definition never changes under its hash.
  const definitions = new Map<string, Workflow>();

  // The workflow definition the commission started with, as stored then.
  function definitionOf(events: Log): Workflow {
    const { workflow, definition } = events[0];

    if (!definitions.has(definition)) {
      definitions.set(definition, parseWorkflow(workflow, store.read(definition).toString()));
    }

    return definitions.get(definition)!;
  }

  function write(commission: string, events: Log, event: Log[1]): void {
    replay(definitionOf(events), [...events, event]);
    insert.run(commission, events.length, JSON.stringify(event));
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

      // Parsed as it will be read back, so a definition that could not run is refused now.
      const text = JSON.stringify(workflows[workflow]);
      const parsed = parseWorkflow(workflow, text);

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
      insert.run(commission, 0, JSON.stringify(event));
    },

    /** Replays the commission's state from the log. */
    state(commission: string): CommissionState {
      const events = read(commission);

      return replay(definitionOf(events), events);
    },

    /** Lists every commission in the log with its state, oldest first. */
    commissions(): { commission: string; state: CommissionState }[] {
      return commissioned.all().map(({ commission }) => ({
        commission: String(commission),
        state: this.state(String(commission)),
      }));
    },

    /** Reads the transcript of the commission's attempt numbered `attempt`. */
    transcript(commission: string, attempt: number): Buffer {
      for (const event of read(commission)) {
        if (
          (event.type === "attempt-completed" || event.type === "escalated") &&
          event.attempt === attempt &&
          event.transcript !== undefined
        ) {
          return store.read(event.transcript);
        }
      }

      throw new Error(`Commission ${commission} has no transcript for attempt ${attempt}.`);
    },

    /** Reads the artifact kept under `hash`. */
    artifact(hash: string): Artifact {
      return store.get(hash);
    },

    /**
     * Records the owner's decision about the commission's current subject, with any feedback. At
     * an approval step the outcome must be one the step declares; on an escalation it is retry or
     * abandon.
     */
    decide(
      commission: string,
      { subject, outcome, feedback }: { subject: string; outcome: string; feedback?: string },
    ) {
      const events = read(commission);
      const workflow = definitionOf(events);
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

      return replay(workflow, [...events, event]);
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

      request.run(
        commission,
        events.findLast((event) => event.type === "attempt-started")!.attempt,
      );
    },

    /** Attempts ready steps until the commission is awaiting, escalated or finished. */
    async advance(commission: string): Promise<CommissionState> {
      for (;;) {
        const events = read(commission);
        const workflow = definitionOf(events);
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
          hashes: resolve(query, state, events),
        }));

        const inputs = given.map(({ name, hashes }) => ({
          name,
          artifacts: hashes.map((hash) => ({ hash, artifact: store.get(hash) })),
        }));

        const bytes = inputs
          .flatMap(({ artifacts }) => artifacts)
          .reduce((sum, { artifact }) => sum + Buffer.byteLength(artifact.body ?? ""), 0);

        if (bytes > step.limits.input) {
          write(commission, events, {
            type: "escalated",
            reason: `Step ${name}'s inputs are ${bytes} bytes, over its input limit of ${step.limits.input}.`,
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

        const cancelled = () => requested.get(commission, attempt) !== undefined;

        write(
          commission,
          [...events, started],
          await run(
            step,
            {
              commission,
              step: name,
              attempt,
              subject: {
                hash: state.subject,
                artifact: store.get(state.subject),
                kept: keptOf(events, state.subject),
              },
              inputs,
            },
            cancelled,
            store,
          ),
        );
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

// The artifacts a query names in the commission's events and current state, oldest first: none
// when there is nothing to name, such as a decision not yet made.
function resolve(
  query: Query,
  state: Extract<CommissionState, { status: "ready" }>,
  events: Log,
): string[] {
  switch (query) {
    case "subject":
      return [state.subject];
    case "request":
      return [events[0].request];
    default: {
      const { from, kind, about, take } = query;

      const named = recorded(events).flatMap((artifact) =>
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
function recorded(events: Log): { hash: string; kind: string; step?: string; about?: string }[] {
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
          subjects.includes(kind)
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

type Runnable = Extract<Workflow["steps"][string], { kind: "agent" | "command" }>;

// The commission's subject, with the files its verifier kept.
type Subject = { hash: string; artifact: Artifact; kept: Readonly<Record<string, string>> };

// What an attempt is given: the domain values its input.json encodes, and the commission's
// subject, which verifiers judge a claim against.
type Given = {
  commission: string;
  step: string;
  attempt: number;
  subject: Subject;
  inputs: readonly {
    name: string;
    artifacts: readonly { hash: string; artifact: Artifact }[];
  }[];
};

type Store = ReturnType<typeof createStore>;

type Ending = Extract<CommissionEvent, { type: "attempt-completed" | "escalated" }>;

// The time a stopped step has to exit after SIGTERM before it gets SIGKILL.
const grace = 5000;

// Sends SIGTERM to the child's process group, then SIGKILL after the grace period. A sandboxed
// step's group leader is bwrap, which dies at once on SIGTERM and takes the step with it, so it
// is spared the SIGTERM and the step has its grace period.
function stop(child: ChildProcess, leader: "bwrap" | "program"): void {
  const group = child.pid!;

  for (const pid of membersOf(group)) {
    if (leader === "program" || pid !== group) {
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

  const encoded = {
    commission: given.commission,
    step: given.step,
    attempt: given.attempt,
    outcomes: Object.keys(step.on),
    inputs: Object.fromEntries(inputs),
    // Left out of a command step's input.json, which has no agent.
    agent:
      step.kind === "agent" ? { model: step.agent.model, prompt: step.agent.prompt } : undefined,
  };

  await writeFile(join(input, "input.json"), JSON.stringify(encoded));
}

// The transcript and claimed artifacts go to the store before the event naming them is written.
async function run(
  step: Runnable,
  given: Given,
  cancelled: () => boolean,
  store: Store,
): Promise<Ending> {
  const { step: name, attempt } = given;
  const directory = await mkdtemp(join(tmpdir(), "medrengard-attempt-"));
  const workspace = join(directory, "workspace");
  const input = join(directory, "input");
  const output = join(directory, "output");

  // stdout and stderr together, in the order they arrive, up to the transcript limit.
  const transcript: Buffer[] = [];
  let written = 0;

  const kept = () => store.keep(Buffer.concat(transcript));

  const escalate = (reason: string): Ending => ({
    type: "escalated",
    reason,
    attempt,
    transcript: kept(),
  });

  try {
    await mkdir(workspace);

    if (step.workspace === "subject") {
      const failed = await materialise(directory, workspace, name, given.subject, store);

      if (failed !== undefined) {
        return escalate(failed);
      }
    }

    await prepare(input, step, given);
    await mkdir(output);

    // An agent step's program is its harness adapter, under the same contract.
    const { command, args, env } = confine(
      step.access,
      { workspace, input, output },
      step.kind === "agent" ? step.agent.harness.run : step.run,
    );

    // Its own session and process group: stopping the step also stops what it started, and
    // without a controlling terminal the step cannot push input into the owner's.
    const child = spawn(command, args, {
      cwd: workspace,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    let stopped: string | undefined;

    // The first reason to stop is the one recorded; stopping twice would signal a group that may be gone.
    const stopFor = (reason: string) => {
      if (stopped === undefined) {
        stopped = reason;
        stop(child, "bwrap");
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

    const record = (chunk: Buffer) => {
      idle.refresh();

      const room = step.limits.transcript - written;

      transcript.push(chunk.subarray(0, Math.max(room, 0)));
      written += chunk.length;

      if (written > step.limits.transcript) {
        stopFor(
          `Step ${name} wrote more than its transcript limit of ${step.limits.transcript} bytes.`,
        );
      }
    };

    child.stdout.on("data", record);
    child.stderr.on("data", record);

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

    const claim = await parse(step, name, output, given.subject.hash);

    if ("reason" in claim) {
      return escalate(claim.reason);
    }

    // A document's kind has no verifier; a commit's does, and keeps files.
    const verified = [];

    for (const artifact of claim.artifacts) {
      if (artifact.kind === "commit") {
        const result = await verify(directory, workspace, name, artifact, given.subject, store);

        if ("reason" in result) {
          return escalate(result.reason);
        }

        verified.push({ artifact, kept: result.kept });
      } else {
        verified.push({ artifact, kept: {} });
      }
    }

    return {
      type: "attempt-completed",
      step: name,
      attempt,
      outcome: claim.outcome,
      artifacts: verified.map(({ artifact, kept }) => ({
        hash: store.put(artifact),
        kind: artifact.kind,
        kept,
      })),
      transcript: kept(),
      next: step.on[claim.outcome],
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

type Claim = { outcome: string; artifacts: (Document | Commit | Verdict)[] };

// The largest output.json the engine reads, in bytes.
const claimLimit = 64 * 1024;

// lazy: the built-in document kind is a constant, its limits in bytes. Make kinds definitions,
// recorded by hash, with definitions by hash.
const documentKind = { title: 200, body: 1024 * 1024 };

// lazy: the built-in verdict kind, as the document kind.
const verdictKind = { summary: 200, body: 1024 * 1024 };

// Fatal, so invalid bytes are refused rather than replaced; the byte order mark is kept as written.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// Parses the claim a step wrote to `output`, or gives the reason it is invalid. Everything in the
// output directory is the step's doing, so any failure to read it is the step's.
async function parse(
  step: Runnable,
  name: string,
  output: string,
  subject: string,
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

  const artifacts: (Document | Commit | Verdict)[] = [];

  for (const artifact of claimed) {
    if (artifact?.kind === "decision") {
      return { reason: `Step ${name} claimed a decision, which only the owner makes.` };
    }

    if (artifact?.kind === "commit") {
      const { fields } = artifact;
      const sha = fields?.sha;

      if (
        !hasExactly(artifact, ["kind", "fields"]) ||
        !hasExactly(fields, ["sha"]) ||
        !isText(sha) ||
        !/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)
      ) {
        return { reason: `Step ${name} claimed a commit that is not a SHA.` };
      }

      artifacts.push({ kind: "commit", fields: { sha } });

      continue;
    }

    if (artifact?.kind === "verdict") {
      const { fields, body } = artifact;
      const verdict = fields?.verdict;
      const summary = fields?.summary;

      if (
        !(
          hasExactly(artifact, ["kind", "fields"]) ||
          hasExactly(artifact, ["kind", "fields", "body"])
        ) ||
        !(hasExactly(fields, ["verdict"]) || hasExactly(fields, ["verdict", "summary"])) ||
        (verdict !== "pass" && verdict !== "fail") ||
        (summary !== undefined && !isText(summary)) ||
        (body !== undefined && !isText(body))
      ) {
        return {
          reason: `Step ${name} claimed a verdict that is not pass or fail, an optional summary and an optional body path.`,
        };
      }

      // The verdict is the kind's outcome field, so the edge followed is the verdict given.
      if (verdict !== outcome) {
        return { reason: `Step ${name} claimed a ${verdict} verdict with the outcome ${outcome}.` };
      }

      if (summary !== undefined && Buffer.byteLength(summary) > verdictKind.summary) {
        return {
          reason: `Step ${name} claimed a verdict summary over its limit of ${verdictKind.summary} bytes.`,
        };
      }

      const findings =
        body === undefined ? undefined : await readBody(name, output, body, verdictKind.body);

      if (findings !== undefined && "reason" in findings) {
        return findings;
      }

      // The engine names the subject: the one the attempt was given, which the step judged.
      const judged: Verdict = {
        kind: "verdict",
        fields: summary === undefined ? { verdict, subject } : { verdict, subject, summary },
      };

      if (findings !== undefined) {
        judged.body = findings.text;
      }

      artifacts.push(judged);

      continue;
    }

    if (artifact?.kind !== "document") {
      return {
        reason: `Step ${name} claimed an artifact of undeclared kind: ${JSON.stringify(artifact?.kind)}.`,
      };
    }

    const { fields, body } = artifact;
    const title = fields?.title;

    if (
      !hasExactly(artifact, ["kind", "fields", "body"]) ||
      !hasExactly(fields, ["title"]) ||
      !isText(title) ||
      !isText(body)
    ) {
      return { reason: `Step ${name} claimed a document that is not a title and a body path.` };
    }

    if (Buffer.byteLength(title) > documentKind.title) {
      return {
        reason: `Step ${name} claimed a document title over its limit of ${documentKind.title} bytes.`,
      };
    }

    const read = await readBody(name, output, body, documentKind.body);

    if ("reason" in read) {
      return read;
    }

    artifacts.push({ kind: "document", fields: { title }, body: read.text });
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

// lazy: the built-in kinds' verifier and materialisers are found beside the engine. Name them in
// the kinds' definitions, by hash, with definitions by hash.
const builtIn = (path: string) =>
  [process.execPath, join(import.meta.dirname, "..", path)] as const;

const commitVerifier = builtIn("verifiers/commit.ts");

const materialisers = {
  document: builtIn("materialisers/document.ts"),
  commit: builtIn("materialisers/commit.ts"),
};

// The seconds a verifier or materialiser may run before it is stopped.
const builtInLimit = 60;

// lazy: a constant, in bytes. Make it the kind's, with definitions by hash.
const keptLimit = 64 * 1024 * 1024;

// A kept file is named by a plain file name, so it can be written anywhere without a path.
const plainName = /^(?!\.\.?$)[A-Za-z0-9._-]+$/;

// Runs a built-in program in `cwd` with `input` and `output` as its directories, stopped after
// builtInLimit. Returns why it failed, or undefined when it exited 0.
async function runBuiltIn(
  argv: readonly [string, ...string[]],
  cwd: string,
  input: string,
  output: string,
): Promise<string | undefined> {
  const [command, ...args] = argv;

  const child = spawn(command, args, {
    cwd,
    env: { PATH: process.env.PATH, MEDRENGARD_IN: input, MEDRENGARD_OUT: output },
    stdio: "ignore",
    detached: true,
  });

  let late = false;

  const limit = setTimeout(() => {
    late = true;
    stop(child, "program");
  }, builtInLimit * 1000);

  const closed = await once(child, "close")
    .catch((error: NodeJS.ErrnoException) => error)
    .finally(() => clearTimeout(limit));

  if (closed instanceof Error) {
    return `it could not start: ${closed.code}.`;
  }

  if (late) {
    return `it reached its limit of ${builtInLimit} s.`;
  }

  return closed[0] === 0 ? undefined : `it exited with code ${closed[0]}.`;
}

// Makes an input and an output directory for a built-in program, inside the attempt's directory.
async function areaFor(directory: string, program: string) {
  const area = await mkdtemp(join(directory, `${program}-`));
  const input = join(area, "input");
  const output = join(area, "output");

  await mkdir(input);
  await mkdir(output);

  return { input, output };
}

// Runs the commit verifier on a claim in the attempt's workspace, and stores the files it keeps.
// lazy: the workspace is not read-only to the verifier; the sandbox makes it so.
async function verify(
  directory: string,
  workspace: string,
  name: string,
  claim: Commit,
  subject: Subject,
  store: Store,
): Promise<{ kept: Record<string, string> } | { reason: string }> {
  const { input, output } = await areaFor(directory, "verifier");

  const failed = (why: string) => ({
    reason: `The commit verifier failed on step ${name}'s claim: ${why}`,
  });

  await writeFile(
    join(input, "claim.json"),
    JSON.stringify({
      fields: claim.fields,
      subject: { hash: subject.hash, kind: subject.artifact.kind, fields: subject.artifact.fields },
    }),
  );

  const why = await runBuiltIn(commitVerifier, workspace, input, output);

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

  if (verdict?.accepted === false && isText(verdict.reason)) {
    return { reason: `Step ${name} claimed a commit its verifier rejected: ${verdict.reason}` };
  }

  if (verdict?.accepted !== true || !Array.isArray(verdict.keep)) {
    return failed("it wrote no valid output.json.");
  }

  const kept: Record<string, string> = {};

  for (const file of verdict.keep) {
    if (!isText(file) || !plainName.test(file)) {
      return failed(`it kept a file without a plain name: ${JSON.stringify(file)}.`);
    }

    const read = await readUnder(output, file, keptLimit);

    if (read === undefined || read === "outside" || read.length > keptLimit) {
      return failed(`it kept ${file}, which is missing or over its limit of ${keptLimit} bytes.`);
    }

    kept[file] = store.keep(read);
  }

  return { kept };
}

// Builds the workspace from the subject with its kind's materialiser. Returns why it failed, or
// undefined.
async function materialise(
  directory: string,
  workspace: string,
  name: string,
  subject: Subject,
  store: Store,
): Promise<string | undefined> {
  const { artifact } = subject;

  if (artifact.kind === "decision" || artifact.kind === "verdict") {
    throw new Error(`A ${artifact.kind} is a judgement, never the subject.`);
  }

  const { input, output } = await areaFor(directory, "materialiser");

  await mkdir(join(input, "kept"));

  for (const [file, hash] of Object.entries(subject.kept)) {
    await writeFile(join(input, "kept", file), store.read(hash));
  }

  if (artifact.body !== undefined) {
    await writeFile(join(input, "body"), artifact.body);
  }

  await writeFile(
    join(input, "artifact.json"),
    JSON.stringify({
      hash: subject.hash,
      kind: artifact.kind,
      fields: artifact.fields,
      body: artifact.body === undefined ? undefined : "body",
      kept: Object.fromEntries(Object.keys(subject.kept).map((file) => [file, `kept/${file}`])),
    }),
  );

  const why = await runBuiltIn(materialisers[artifact.kind], workspace, input, output);

  return why === undefined
    ? undefined
    : `The ${artifact.kind} materialiser failed for step ${name}: ${why}`;
}
