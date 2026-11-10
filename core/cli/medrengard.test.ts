import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isRecord, isText } from "../src/json.ts";
import { factoryIn, run } from "./fixture.ts";
import { setTimeout as sleep } from "node:timers/promises";

const cli = join(import.meta.dirname, "medrengard.ts");

/**
 * Runs the CLI with `args` in a terminal of 30 rows and 90 columns, as the owner would, typing each
 * of `typed`'s texts once the terminal shows what it waits for and `wait` ms more. Returns what
 * the terminal showed.
 */
async function inTerminal(
  args: readonly string[],
  factory: string,
  typed: readonly { after: string; text: string; wait?: number }[] = [],
) {
  const command = [process.execPath, cli, ...args].map(
    (arg) => `'${arg.replaceAll("'", "'\\''")}'`,
  );

  const terminal = spawn(
    "script",
    ["-q", "-e", "-c", `stty rows 30 cols 90; exec ${command.join(" ")}`, "/dev/null"],
    { cwd: tmpdir(), env: { ...process.env, MEDRENGARD_FACTORY: factory } },
  );

  let shown = "";

  terminal.stdout.on("data", (chunk: Buffer) => {
    shown += chunk.toString();
  });

  const closed = once(terminal, "close");

  for (const { after, text, wait = 0 } of typed) {
    while (!shown.includes(after)) {
      await sleep(20);
    }

    await sleep(wait);
    terminal.stdin.write(text);
  }

  const [status] = await closed;

  return { status, shown };
}

test("the CLI takes a commission through the engine's calls, printing their results as JSON", async (t) => {
  const { directory, factory } = await factoryIn(t);

  const json = (args: readonly string[]) => {
    const { status, stdout, stderr } = run([...args, "--json"], factory);

    assert.equal(status, 0, stderr);

    return JSON.parse(stdout);
  };

  await writeFile(join(directory, "request.md"), "Say hello.");

  assert.deepEqual(
    json([
      "commission",
      "build",
      "first",
      "--title",
      "Greet",
      "--body-file",
      join(directory, "request.md"),
    ]),
    { commission: "first" },
  );

  const awaiting = json(["advance", "first"]);

  assert.partialDeepStrictEqual(awaiting, { status: "awaiting", step: { name: "review" } });
  assert.deepEqual(json(["state", "first"]), awaiting);
  assert.deepEqual(json(["artifact", awaiting.subject]), {
    kind: "document",
    fields: { title: "Greet" },
    body: "Say hello.",
  });
  assert.equal(awaiting.since, 2);
  assert.deepEqual(
    json(["decide", "first", "approve", "--subject", awaiting.subject, "--since", "2"]),
    {
      status: "finished",
      by: "end",
    },
  );
  assert.ok(existsSync(join(directory, "state", "log.sqlite")));
});

test(
  "the owner attends an attended step in their terminal, and the commission moves on",
  { timeout: 20_000 },
  async (t) => {
    const { directory, factory } = await factoryIn(t);

    run(["commission", "attended", "first", "--title", "Greet", "--body", "Say hello."], factory);

    // run and advance leave it for the owner.
    assert.match(
      run(["advance", "first"], factory).stdout,
      /^ready at greet, to attend, about \w+\n$/,
    );

    const { status, shown } = await inTerminal(["attend", "first"], factory, [
      { after: "Your name? ", text: "Riley\r" },
    ]);

    assert.equal(status, 0, shown);
    assert.match(shown, /terminal: 30 90/);
    assert.match(shown, /hello Riley/);
    assert.match(shown, /awaiting at review since event \d+, about \w+\r?\n$/);

    const transcript = run(["transcript", "first", "1"], factory).stdout;

    assert.match(transcript, /terminal: 30 90/);
    assert.match(transcript, /Your name\? Riley/);

    const input = JSON.parse(await readFile(join(directory, "input.json"), "utf8"));

    assert.equal(input.attended, true);
  },
);

test(
  "attending needs a terminal, and a commission ready at an attended step",
  { timeout: 20_000 },
  async (t) => {
    const { factory } = await factoryIn(t);

    run(["commission", "attended", "first", "--title", "Greet", "--body", "Say hello."], factory);
    run(["commission", "build", "second", "--title", "Greet", "--body", "Say hello."], factory);

    assert.deepEqual(run(["attend", "first"], factory), {
      status: 1,
      stdout: "",
      stderr: "Attending a step needs the owner's terminal as stdin and stdout.\n",
    });

    const { status, shown } = await inTerminal(["attend", "second"], factory);

    assert.equal(status, 1);
    assert.match(shown, /Commission second is not ready at an attended step\./);
  },
);

test("the owner typing keeps an attended step from idling", { timeout: 20_000 }, async (t) => {
  const { factory } = await factoryIn(t);

  run(["commission", "typing", "first", "--title", "Greet", "--body", "Say hello."], factory);

  // Five lines, 0.6 s apart: three seconds without output, against an idle limit of one.
  const lines = Array.from({ length: 5 }, () => ({ after: "ready", text: "a line\r", wait: 600 }));
  const { status, shown } = await inTerminal(["attend", "first"], factory, lines);

  assert.equal(status, 0, shown);
  assert.match(shown, /awaiting at review/);
});

test(
  "an attended step whose time limits are unbounded is not stopped by them",
  { timeout: 20_000 },
  async (t) => {
    const { factory } = await factoryIn(t);

    run(["commission", "unbounded", "first", "--title", "Greet", "--body", "Say hello."], factory);

    const { status, shown } = await inTerminal(["attend", "first"], factory);

    assert.equal(status, 0, shown);
    assert.match(shown, /awaiting at review/);
  },
);

test(
  "the engine notes what an attended step's output holds each time the step writes it",
  { timeout: 20_000 },
  async (t) => {
    const { factory } = await factoryIn(t);

    run(["commission", "revising", "first", "--title", "Greet", "--body", "Say hello."], factory);

    const { status, shown } = await inTerminal(["attend", "first"], factory);

    assert.equal(status, 0, shown);

    const record = JSON.parse(run(["show", "first", "--json"], factory).stdout);

    assert.deepEqual(record.entries[0].notes, [
      {
        note: "Step greet's output is ready: outcome done, with no artifacts. It is verified once the session ends.",
        from: "engine",
      },
      {
        note: 'Step greet\'s output would escalate: Step greet claimed an outcome it does not declare: "nope".',
        from: "engine",
      },
      {
        note: "Step greet's output is ready: outcome done, with 1 artifact: document. It is verified once the session ends.",
        from: "engine",
      },
    ]);
    assert.match(
      run(["watch", "first"], factory).stdout,
      /engine: Step greet's output would escalate/,
    );

    // Constraint 7: the engine's note is the one event variant only an attended step makes, so
    // its fields are pinned here.
    const [line] = run(["events", "--after", "2", "--json"], factory).stdout.split("\n");
    const { event } = JSON.parse(line);

    assert.deepEqual(Object.keys(event), ["type", "attempt", "note", "at", "from"]);
  },
);

test(
  "events prints every commission's events after a position, and follows the log",
  { timeout: 10_000 },
  async (t) => {
    const { factory } = await factoryIn(t);

    commissionAll(factory, "build", ["first"]);
    run(["advance", "first"], factory);

    assert.deepEqual(run(["events"], factory), {
      status: 0,
      stdout:
        "1 first commissioned\n2 first attempt-started build\n3 first attempt-completed build: done\n",
      stderr: "",
    });

    const lines = run(["events", "--after", "2", "--json"], factory).stdout.trim().split("\n");

    assert.partialDeepStrictEqual(
      lines.map((line) => JSON.parse(line)),
      [{ position: 3, commission: "first", event: { type: "attempt-completed", outcome: "done" } }],
    );

    const follower = spawn(process.execPath, [cli, "events", "--after", "3", "--follow"], {
      cwd: tmpdir(),
      env: { ...process.env, MEDRENGARD_FACTORY: factory },
    });

    t.after(() => follower.kill("SIGKILL"));

    let followed = "";

    follower.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      followed += chunk;
    });

    await sleep(300);
    commissionAll(factory, "build", ["second"]);

    while (!followed.includes("\n")) {
      await sleep(20);
    }

    follower.kill("SIGTERM");

    const [code] = await once(follower, "exit");

    assert.equal(followed, "4 second commissioned\n");
    assert.equal(code, 0);
    assert.equal(run(["events", "--after", "x"], factory).status, 2);
  },
);

test(
  "the owner cancelling an attended step stops it in its sandbox, with its grace period",
  { timeout: 20_000 },
  async (t) => {
    const { directory, factory } = await factoryIn(t);

    run(["commission", "lingering", "first", "--title", "Greet", "--body", "Say hello."], factory);

    const attending = inTerminal(["attend", "first"], factory);

    while (run(["state", "first", "--json"], factory).stdout.includes('"ready"')) {
      await sleep(50);
    }

    await sleep(300);
    assert.equal(run(["cancel", "first"], factory).status, 0);

    const { status, shown } = await attending;

    assert.equal(status, 0, shown);
    assert.match(shown, /reason: Step greet was cancelled by the owner\./);

    // The step itself got SIGTERM, not only script, which would have killed it outright.
    assert.equal(await readFile(join(directory, "signals"), "utf8"), "terminated\n");
  },
);

// Each string or number replaced by its type, keeping the values that tell variants apart, so a
// result is pinned to every depth.
function typesIn(text: string) {
  return JSON.parse(text, (key, value) => {
    if (
      ["status", "entry", "by", "kind"].includes(key) ||
      isRecord(value) ||
      Array.isArray(value)
    ) {
      return value;
    }

    if (isText(value)) {
      return "string";
    }

    return Number.isFinite(value) ? "number" : value;
  });
}

// Constraint 7: the commands are pinned, from the usage the CLI prints.
test("the CLI's commands are exactly the pinned ones", () => {
  const { stderr } = run([], undefined);

  const commands = stderr.split("\n").flatMap((line) => /^ {2}([a-z]+)\b/.exec(line)?.[1] ?? []);

  assert.deepEqual(commands, [
    "commission",
    "check",
    "advance",
    "attend",
    "state",
    "show",
    "watch",
    "events",
    "commissions",
    "engines",
    "run",
    "decide",
    "cancel",
    "renew",
    "transcript",
    "errors",
    "artifact",
    "definition",
  ]);
});

// Constraint 7: what a client parses is pinned: every --json result, each state and record entry
// in each of its forms, to every depth.
test("every --json result has its pinned shape", { timeout: 20_000 }, async (t) => {
  const { directory, factory } = await factoryIn(t);

  const json = (...args: string[]) => {
    const { status, stdout } = run([...args, "--json"], factory);

    assert.equal(status, 0);

    return typesIn(stdout);
  };

  const step = (kind: string) => ({ name: "string", kind });
  const ready = { status: "ready", step: step("command"), subject: "string" };

  const awaiting = {
    status: "awaiting",
    step: step("approval"),
    subject: "string",
    since: "number",
  };

  const escalated = {
    status: "escalated",
    step: step("command"),
    subject: "string",
    reason: "string",
    since: "number",
  };

  const timed = {
    attempt: "number",
    step: "string",
    notes: [],
    started: "number",
    ended: "number",
  };

  // At an approval step, and finished by a decision with feedback.
  assert.deepEqual(
    json("commission", "judged", "first", "--title", "Greet", "--body", "Say hello."),
    { commission: "string" },
  );
  assert.deepEqual(json("state", "first"), ready);
  assert.deepEqual(json("advance", "first"), awaiting);

  const { subject, since } = JSON.parse(run(["state", "first", "--json"], factory).stdout);
  const { request } = JSON.parse(run(["show", "first", "--json"], factory).stdout);

  // The recorded definition is the definition's own schema, pinned apart; here its parts.
  assert.deepEqual(Object.keys(json("definition", "first")), ["workflow", "kinds", "skills"]);
  assert.deepEqual(json("artifact", request.hash), {
    kind: "document",
    fields: { title: "string" },
    body: "string",
  });
  assert.deepEqual(json("show", "first"), {
    state: awaiting,
    request: {
      hash: "string",
      artifact: { kind: "document", fields: { title: "string" }, body: "string" },
    },
    entries: [
      {
        entry: "attempt",
        ...timed,
        outcome: "string",
        artifacts: [
          {
            hash: "string",
            artifact: { kind: "memo", fields: { note: "string", subject: "string" } },
            verifier: ["string", "string", "string"],
          },
          {
            hash: "string",
            artifact: { kind: "verdict", fields: { verdict: "string", subject: "string" } },
            verifier: null,
          },
        ],
        errors: false,
      },
    ],
  });
  assert.deepEqual(
    json(
      "decide",
      "first",
      "approve",
      "--subject",
      subject,
      "--since",
      String(since),
      "--feedback",
      "Fine.",
    ),
    { status: "finished", by: "end" },
  );
  assert.deepEqual(json("show", "first").entries[1], {
    entry: "decision",
    step: "string",
    outcome: "string",
    subject: "string",
    feedback: "string",
    at: "number",
  });

  // An attempt that escalates, and the state a retry leaves, with its decision.
  json("commission", "failing", "second", "--title", "Greet", "--body", "Say hello.");
  assert.deepEqual(json("advance", "second"), escalated);
  assert.deepEqual(json("show", "second").entries, [
    { entry: "attempt", ...timed, escalated: "string", errors: true },
  ]);

  const failed = JSON.parse(run(["state", "second", "--json"], factory).stdout);

  assert.deepEqual(
    json("decide", "second", "retry", "--subject", failed.subject, "--since", String(failed.since)),
    { ...ready, decision: "string" },
  );

  // An escalation without an attempt: the step's budget is spent.
  json("commission", "looping", "third", "--title", "Greet", "--body", "Say hello.");
  assert.deepEqual(json("advance", "third"), escalated);
  assert.deepEqual(json("show", "third").entries[1], {
    entry: "escalation",
    step: "string",
    reason: "string",
    at: "number",
  });

  // An attempt in flight.
  json("commission", "held", "fourth", "--title", "Greet", "--body", "Say hello.");

  const advancing = spawn(process.execPath, [cli, "advance", "fourth"], {
    cwd: tmpdir(),
    env: { ...process.env, MEDRENGARD_FACTORY: factory },
  });

  while (!(await readFile(join(directory, "held"), "utf8").catch(() => "")).includes("start")) {
    await sleep(20);
  }

  assert.deepEqual(json("state", "fourth"), {
    status: "attempting",
    step: step("command"),
    subject: "string",
  });
  assert.deepEqual(json("show", "fourth").entries, [
    {
      entry: "attempt",
      attempt: "number",
      step: "string",
      notes: [],
      started: "number",
      running: true,
    },
  ]);
  await writeFile(join(directory, "held.go"), "");
  await once(advancing, "exit");

  // A commission the engine cannot read, beside one it can.
  json("commission", "build", "broken", "--title", "Greet", "--body", "Say hello.");

  const database = new DatabaseSync(join(directory, "state", "log.sqlite"));

  database
    .prepare("INSERT INTO events VALUES (?, 1, ?)")
    .run("broken", JSON.stringify({ type: "decided", step: "build", outcome: "done" }));
  database.close();

  const names = JSON.parse(run(["commissions", "--json"], factory).stdout).map(
    ({ commission }: { commission: string }) => commission,
  );

  const listed = json("commissions");

  assert.deepEqual(listed[names.indexOf("broken")], { commission: "string", error: "string" });
  assert.deepEqual(listed[names.indexOf("first")], {
    commission: "string",
    state: { status: "finished", by: "end" },
  });
});

test("the CLI prints an attempt's transcript unchanged", async (t) => {
  const { factory } = await factoryIn(t);

  run(["commission", "build", "first", "--title", "Greet", "--body", "Say hello."], factory);
  run(["advance", "first"], factory);

  assert.deepEqual(run(["transcript", "first", "1"], factory), {
    status: 0,
    stdout: "hello\n",
    stderr: "",
  });
});

test("the CLI exits 0 when a commission escalates, since the call succeeded", async (t) => {
  const { factory } = await factoryIn(t);

  run(["commission", "failing", "first", "--title", "Greet", "--body", "Say hello."], factory);

  // --factory names the factory as MEDRENGARD_FACTORY does.
  const { status, stdout } = run(["advance", "first", "--json", "--factory", factory], undefined);

  assert.equal(status, 0);
  assert.partialDeepStrictEqual(JSON.parse(stdout), {
    status: "escalated",
    reason: "Step build exited with code 3.",
  });
});

test("the CLI exits 1 with the engine's message as JSON when the engine refuses a call", async (t) => {
  const { factory } = await factoryIn(t);

  run(["commission", "build", "first", "--title", "Greet", "--body", "Say hello."], factory);
  run(["advance", "first"], factory);

  const { status, stdout, stderr } = run(
    ["decide", "first", "approve", "--subject", "stale", "--since", "1", "--json"],
    factory,
  );

  const { subject } = JSON.parse(run(["state", "first", "--json"], factory).stdout);

  assert.deepEqual(
    { status, stdout, stderr: JSON.parse(stderr) },
    {
      status: 1,
      stdout: "",
      stderr: { error: `Commission first is about ${subject}, not stale.` },
    },
  );
});

test("the CLI commissions through a trigger, naming the commission, and refuses one past its caps", async (t) => {
  const { factory } = await factoryIn(t);
  const commission = ["commission", "build", "--trigger", "nightly", "--title", "T", "--body", "B"];

  assert.deepEqual(run(commission, factory), { status: 0, stdout: "nightly-1\n", stderr: "" });
  assert.deepEqual(run(commission, factory), {
    status: 1,
    stdout: "",
    stderr: "Trigger nightly started 1 commission in the last 3600 s, its rate.\n",
  });
  assert.match(run(["show", "nightly-1"], factory).stdout, /Started by trigger nightly\./);
});

test("the CLI renews a trigger's allowance, and shows the commission that started one through it", async (t) => {
  const { factory } = await factoryIn(t);

  const spawn = (name: string) =>
    run(["commission", "spawning", name, "--title", "T", "--body", "B"], factory);

  spawn("first");
  run(["advance", "first"], factory);
  assert.match(
    run(["show", "workers-1"], factory).stdout,
    /Started by trigger workers, from commission first's step spawn, attempt 1\./,
  );

  spawn("second");
  assert.match(run(["advance", "second"], factory).stdout, /escalated/);
  assert.deepEqual(run(["renew", "workers"], factory), { status: 0, stdout: "", stderr: "" });
  assert.deepEqual(run(["renew", "nightly"], factory), {
    status: 1,
    stdout: "",
    stderr: "Trigger nightly has no allowance to renew.\n",
  });
});

test("the CLI without a factory exits 2 naming both ways to give one", () => {
  const { status, stdout, stderr } = run(["state", "first"], undefined);

  assert.equal(status, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /--factory/);
  assert.match(stderr, /MEDRENGARD_FACTORY/);
});

test("the CLI refuses a factory whose default export is not exactly { log, kinds, workflows, defaults } and any triggers", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const factory = join(directory, "factory.ts");

  await writeFile(factory, `export default { log: "log.sqlite", kinds: {}, workflow: {} };`);

  assert.deepEqual(run(["state", "first"], factory), {
    status: 1,
    stdout: "",
    stderr: `Factory ${factory} must default-export { log, kinds, workflows, defaults } and any triggers: missing workflows, defaults, not allowed workflow.\n`,
  });
  assert.ok(!existsSync(join(directory, "log.sqlite")));
});

// A line the runner prints with --json, as far as the tests read it.
type Line = {
  parallel?: number;
  commission?: string;
  state?: { status: string };
  stopping?: { commission: string; step: string }[];
};

/**
 * Starts `medrengard run --json` with `args` on `factory`. `until` waits for a line of its stdout
 * that matches; `lines` holds every line so far, parsed.
 */
function runner(t: TestContext, factory: string, args: readonly string[] = []) {
  const child = spawn(process.execPath, [cli, "run", "--json", ...args], {
    cwd: tmpdir(),
    env: { ...process.env, MEDRENGARD_FACTORY: factory },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(() => child.kill("SIGKILL"));

  const lines: Line[] = [];
  let partial = "";
  const errors: string[] = [];

  child.stderr.setEncoding("utf8").on("data", (chunk: string) => errors.push(chunk));

  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    const parts = (partial + chunk).split("\n");

    partial = parts.pop()!;
    lines.push(...parts.map((line) => JSON.parse(line)));
  });

  const exited = once(child, "exit");

  const until = async (match: Line) => {
    for (;;) {
      if (lines.some((line) => isMatch(line, match))) {
        return;
      }

      await sleep(20);
    }
  };

  return { child, lines, until, exited, errors };
}

function isMatch(actual: Line, expected: Line): boolean {
  try {
    assert.partialDeepStrictEqual(actual, expected);

    return true;
  } catch {
    return false;
  }
}

/** Waits until a slow step has started. */
async function untilStarted(directory: string) {
  while ((await readFile(join(directory, "steps"), "utf8").catch(() => "")) === "") {
    await sleep(20);
  }
}

/** Commissions each of `commissions` under the workflow `workflow`. */
function commissionAll(factory: string, workflow: string, commissions: readonly string[]) {
  for (const commission of commissions) {
    run(["commission", workflow, commission, "--title", "Greet", "--body", "Say hello."], factory);
  }
}

const repository = join(import.meta.dirname, "..");

/**
 * Writes a factory whose workflows are `good`, one command step; `skilled`, an agent step with the
 * skill `tdd`; `broken`, whose step's edge leads to a step it lacks; and `unskilled`, whose
 * agent's skill has no SKILL.md. Returns its path and its store's directory.
 */
async function checkedFactory(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  await mkdir(join(directory, "skills", "tdd"), { recursive: true });
  await writeFile(join(directory, "skills", "tdd", "SKILL.md"), "Test first.\n");
  await mkdir(join(directory, "skills", "empty"));

  const factory = join(directory, "factory.ts");

  await writeFile(
    factory,
    `import { contract } from ${JSON.stringify(join(repository, "defaults/access.ts"))};
     import { builtIn } from ${JSON.stringify(join(repository, "defaults/kinds.ts"))};
     import { limits } from ${JSON.stringify(join(repository, "defaults/limits.ts"))};

     const command = {
       kind: "command", workspace: "empty", inputs: {}, claims: [], access: contract,
       run: ["true"], budget: 1, on: { done: "end" },
     } as const;

     const { run: _, ...shared } = command;

     const agent = (skill: string) => ({
       ...shared,
       kind: "agent",
       agent: { harness: { run: ["true"] }, model: "a-model", prompt: "Plan.", skills: [${JSON.stringify(join(directory, "skills"))} + "/" + skill] },
     }) as const;

     export default {
       log: "state/log.sqlite",
       kinds: builtIn,
       defaults: { limits },
       workflows: {
         good: { start: "only", steps: { only: command } },
         skilled: { start: "only", steps: { only: agent("tdd") } },
         broken: { start: "only", steps: { only: { ...command, on: { done: "nowhere" } } } },
         unskilled: { start: "only", steps: { only: agent("empty") } },
       },
     };`,
  );

  return { factory, store: join(directory, "state", "store") };
}

/** The files in the store, wherever it is not yet. */
async function storedIn(store: string): Promise<string[]> {
  return readdir(store, { recursive: true }).catch(() => []);
}

test("check checks every workflow as commissioning would, recording nothing", async (t) => {
  const { factory, store } = await checkedFactory(t);

  const refusal = (workflow: string) =>
    JSON.parse(
      run(["commission", workflow, "x", "--title", "T", "--body", "B", "--json"], factory).stderr,
    ).error;

  const broken = refusal("broken");
  const unskilled = refusal("unskilled");

  assert.match(broken, /edges must each lead to a step or the end/);
  assert.match(unskilled, /has no SKILL\.md/);

  const stored = await storedIn(store);
  const all = run(["check"], factory);

  assert.equal(all.status, 1);
  assert.equal(all.stdout, `good: ok\nskilled: ok\nbroken: ${broken}\nunskilled: ${unskilled}\n`);
  assert.deepEqual(run(["check", "good"], factory), {
    status: 0,
    stdout: "good: ok\n",
    stderr: "",
  });
  assert.equal(run(["check", "broken"], factory).status, 1);
  assert.deepEqual(JSON.parse(run(["check", "--json"], factory).stdout), [
    { workflow: "good" },
    { workflow: "skilled" },
    { workflow: "broken", error: broken },
    { workflow: "unskilled", error: unskilled },
  ]);
  assert.deepEqual(await storedIn(store), stored);
});

test("check prints the definition a workflow would be commissioned with, as definition prints a commission's", async (t) => {
  const { factory, store } = await checkedFactory(t);

  const checked = run(["check", "skilled", "--json"], factory);
  const stored = await storedIn(store);

  assert.equal(checked.status, 0, checked.stderr);
  assert.deepEqual(await storedIn(store), stored);

  run(["commission", "skilled", "first", "--title", "Plan", "--body", "Plan it."], factory);

  assert.deepEqual(
    JSON.parse(checked.stdout),
    JSON.parse(run(["definition", "first", "--json"], factory).stdout),
  );
  assert.equal(run(["check", "nothing"], factory).status, 1);
});

test("show says what each attempt's step reported it used", async (t) => {
  const { factory } = await factoryIn(t);

  run(["commission", "spending", "first", "--title", "Spend", "--body", "Spend."], factory);
  run(["advance", "first"], factory);

  assert.match(
    run(["show", "first"], factory).stdout,
    /^1 +build +done \(\d+\.\d s\) \(\$0\.25, 1\.2k tokens\)$/m,
  );
  assert.deepEqual(typesIn(run(["show", "first", "--json"], factory).stdout).entries[0].usage, {
    usd: "number",
    tokens: { input: "number", output: "number", cacheRead: "number", cacheWrite: "number" },
  });
});

test("the runner is listed as a running engine until it stops", { timeout: 10_000 }, async (t) => {
  const { factory } = await factoryIn(t);

  const { child, until, exited } = runner(t, factory);

  await until({ parallel: 1 });

  const engines = () => JSON.parse(run(["engines", "--json"], factory).stdout);

  assert.deepEqual(typesIn(run(["engines", "--json"], factory).stdout), [
    { host: "string", pid: "number", since: "number", status: "alive" },
  ]);
  assert.partialDeepStrictEqual(engines(), [{ host: hostname(), pid: child.pid, status: "alive" }]);
  assert.match(
    run(["engines"], factory).stdout,
    new RegExp(
      `^alive +${RegExp.escape(hostname())} +pid ${child.pid} +since \\d{4}-\\d\\d-\\d\\dT`,
    ),
  );

  child.kill("SIGTERM");
  await exited;

  assert.deepEqual(engines(), []);
  assert.equal(run(["engines"], factory).stdout, "no engine is running\n");
});

test("a runner that was killed is listed as dead", { timeout: 10_000 }, async (t) => {
  const { factory } = await factoryIn(t);

  const { child, until, exited } = runner(t, factory);

  await until({ parallel: 1 });
  child.kill("SIGKILL");
  await exited;

  assert.partialDeepStrictEqual(JSON.parse(run(["engines", "--json"], factory).stdout), [
    { pid: child.pid, status: "dead" },
  ]);
});

test(
  "the runner advances every ready commission, which the commissions command lists",
  { timeout: 10_000 },
  async (t) => {
    const { factory } = await factoryIn(t);

    commissionAll(factory, "build", ["first", "second"]);

    const { child, lines, until, exited } = runner(t, factory);

    await until({ commission: "second", state: { status: "awaiting" } });
    child.kill("SIGTERM");

    const [code] = await exited;

    assert.equal(code, 0);
    assert.deepEqual(lines[0], { parallel: 1 });
    assert.partialDeepStrictEqual(JSON.parse(run(["commissions", "--json"], factory).stdout), [
      { commission: "first", state: { status: "awaiting" } },
      { commission: "second", state: { status: "awaiting" } },
    ]);
  },
);

test(
  "the runner runs at most one step at once by default, oldest commission first",
  { timeout: 10_000 },
  async (t) => {
    const { directory, factory } = await factoryIn(t);

    commissionAll(factory, "slow", ["first", "second"]);

    const { child, lines, until } = runner(t, factory);

    await until({ commission: "second", state: { status: "awaiting" } });
    child.kill("SIGTERM");

    assert.equal(await readFile(join(directory, "steps"), "utf8"), "start\nend\nstart\nend\n");
    assert.deepEqual(
      lines.filter((line) => "state" in line).map((line) => line.commission),
      ["first", "second"],
    );
  },
);

test(
  "the runner goes on past a commission it cannot read, saying so once",
  { timeout: 10_000 },
  async (t) => {
    const { directory, factory } = await factoryIn(t);

    commissionAll(factory, "build", ["broken", "second"]);

    // An event replay refuses, as in a log damaged or written by another engine.
    const database = new DatabaseSync(join(directory, "state", "log.sqlite"));

    database
      .prepare("INSERT INTO events VALUES (?, 1, ?)")
      .run("broken", JSON.stringify({ type: "decided", step: "build", outcome: "done" }));
    database.close();

    const { child, until, exited, errors } = runner(t, factory);

    await until({ commission: "second", state: { status: "awaiting" } });

    // Long enough for the runner to look again.
    await sleep(1500);
    child.kill("SIGTERM");

    const [code] = await exited;

    const unreadable = JSON.stringify({
      commission: "broken",
      error: "A decision cannot arrive while the commission is ready.",
    });

    assert.equal(code, 0);
    assert.equal(errors.join(""), `${unreadable}\n`);

    const [first, second] = run(["commissions"], factory).stdout.split("\n");

    assert.equal(
      first,
      "broken: unreadable: A decision cannot arrive while the commission is ready.",
    );
    assert.match(second, /^second: awaiting at review/);
  },
);

test(
  "the runner leaves an attended step for the owner, saying so once, and runs the rest",
  { timeout: 10_000 },
  async (t) => {
    const { factory } = await factoryIn(t);

    commissionAll(factory, "attended", ["first"]);
    commissionAll(factory, "build", ["second"]);

    const { child, lines, until } = runner(t, factory);

    await until({ commission: "second", state: { status: "awaiting" } });

    // Long enough for the runner to look again.
    await sleep(1500);
    child.kill("SIGTERM");

    assert.deepEqual(
      lines.filter((line) => line.commission === "first").map((line) => line.state?.status),
      ["ready"],
    );
    assert.partialDeepStrictEqual(JSON.parse(run(["state", "first", "--json"], factory).stdout), {
      status: "ready",
      step: { attended: true },
    });
  },
);

test("the runner runs steps in parallel up to --parallel", { timeout: 10_000 }, async (t) => {
  const { directory, factory } = await factoryIn(t);

  commissionAll(factory, "slow", ["first", "second"]);

  const { child, until } = runner(t, factory, ["--parallel", "2"]);

  await until({ commission: "first", state: { status: "awaiting" } });
  await until({ commission: "second", state: { status: "awaiting" } });
  child.kill("SIGTERM");

  assert.equal(await readFile(join(directory, "steps"), "utf8"), "start\nstart\nend\nend\n");
});

test(
  "a stopped runner lets its running step finish before it exits",
  { timeout: 10_000 },
  async (t) => {
    const { directory, factory } = await factoryIn(t);

    commissionAll(factory, "slow", ["first"]);

    const { child, exited } = runner(t, factory);

    await untilStarted(directory);

    child.kill("SIGTERM");

    const [code] = await exited;

    assert.equal(code, 0);
    assert.partialDeepStrictEqual(JSON.parse(run(["state", "first", "--json"], factory).stdout), {
      status: "awaiting",
    });
  },
);

test(
  "a runner stopped twice exits at once, and its step escalates as interrupted",
  { timeout: 10_000 },
  async (t) => {
    const { directory, factory } = await factoryIn(t);

    commissionAll(factory, "slow", ["first"]);

    const { child, until, exited } = runner(t, factory);

    await untilStarted(directory);

    child.kill("SIGTERM");
    await until({ stopping: [{ commission: "first", step: "build" }] });
    child.kill("SIGTERM");

    const [code] = await exited;

    assert.notEqual(code, 0);
    assert.partialDeepStrictEqual(JSON.parse(run(["advance", "first", "--json"], factory).stdout), {
      status: "escalated",
      reason: "Step build was interrupted.",
    });
    assert.equal(await readFile(join(directory, "steps"), "utf8"), "start\n");
  },
);

test(
  "a stopped runner starts no further step of the commission it is running",
  { timeout: 10_000 },
  async (t) => {
    const { directory, factory } = await factoryIn(t);

    commissionAll(factory, "twice", ["first"]);

    const { child, exited } = runner(t, factory);

    await untilStarted(directory);

    child.kill("SIGTERM");

    const [code] = await exited;

    assert.equal(code, 0);
    assert.partialDeepStrictEqual(JSON.parse(run(["state", "first", "--json"], factory).stdout), {
      status: "ready",
      step: { name: "again" },
    });
    assert.equal(await readFile(join(directory, "steps"), "utf8"), "start\nend\n");
  },
);

test("the CLI refuses an unknown artifact by its hash", async (t) => {
  const { factory } = await factoryIn(t);

  const { status, stderr } = run(["artifact", "missing", "--json"], factory);

  assert.deepEqual(
    { status, stderr: JSON.parse(stderr) },
    {
      status: 1,
      stderr: { error: "There is no artifact missing." },
    },
  );
});

test("the CLI shows a commission's record for people, and as the engine's record with --json", async (t) => {
  const { factory } = await factoryIn(t);

  run(["commission", "build", "first", "--title", "Greet", "--body", "Say hello."], factory);
  run(["advance", "first"], factory);

  const { status, stdout } = run(["show", "first"], factory);

  assert.equal(status, 0);
  assert.match(stdout, /^first: awaiting at review since event 2\n/);
  assert.match(stdout, /^request +[0-9a-f]{8} +Greet$/m);
  assert.match(stdout, /^1 build +done \(\d+\.\d s\)$/m);

  const record = JSON.parse(run(["show", "first", "--json"], factory).stdout);

  assert.partialDeepStrictEqual(record, {
    state: { status: "awaiting" },
    entries: [{ entry: "attempt", attempt: 1, step: "build", outcome: "done" }],
  });
});

test("show says which artifacts a verifier accepted and which kinds have none", async (t) => {
  const { factory } = await factoryIn(t);

  run(["commission", "judged", "first", "--title", "Greet", "--body", "Say hello."], factory);
  run(["advance", "first"], factory);

  const { stdout } = run(["show", "first"], factory);

  assert.match(stdout, /^ {4}memo +[0-9a-f]{8} +Checked\. +\(verified\)$/m);
  assert.match(stdout, /^ {4}verdict +[0-9a-f]{8} +pass +\(no verifier\)$/m);
  // At the gate, each judgement in full names its verifier, or that it has none.
  assert.match(stdout, /^memo [0-9a-f]{64}\nverifier: sh -c echo .*\nnote: Checked\.$/m);
  assert.match(stdout, /^verdict [0-9a-f]{64}\nverifier: none\nverdict: pass$/m);
});

test("the CLI prints an attempt's errors", async (t) => {
  const { factory } = await factoryIn(t);

  run(["commission", "failing", "first", "--title", "Greet", "--body", "Say hello."], factory);
  run(["advance", "first"], factory);

  assert.deepEqual(run(["errors", "first", "1"], factory), {
    status: 0,
    stdout: "broke\n",
    stderr: "",
  });
});

// Whether `text` holds a control character a terminal acts on: C0 but newline and tab, DEL, C1,
// and the bidi controls.
function hasControl(text: string): boolean {
  return Array.from(text).some((character) => {
    const code = character.charCodeAt(0);

    return (
      (code < 0x20 && code !== 0x0a && code !== 0x09) ||
      (code >= 0x7f && code <= 0x9f) ||
      [0x061c, 0x200e, 0x200f].includes(code) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    );
  });
}

test("show, artifact and watch print an agent's control characters as visible escapes", async (t) => {
  const { factory } = await factoryIn(t);

  run(["commission", "hostile", "first", "--title", "Greet", "--body", "Say hello."], factory);

  const watching = spawn(process.execPath, [cli, "watch", "first"], {
    cwd: tmpdir(),
    env: { ...process.env, MEDRENGARD_FACTORY: factory },
  });

  let watched = "";

  watching.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    watched += chunk;
  });

  run(["advance", "first"], factory);
  await once(watching, "exit");

  const shown = run(["show", "first"], factory).stdout;
  const document = JSON.parse(run(["show", "first", "--json"], factory).stdout).state.subject;
  const artifact = run(["artifact", document], factory).stdout;

  for (const printed of [watched, shown, artifact]) {
    assert.ok(!hasControl(printed), printed);
  }

  assert.match(watched, /^ {5}\\u001b\[1A\\u001b\[2KNote\\u000d\\u009b2K\\u202e$/m);
  assert.match(shown, /^title: Title\\u001b\[1A\\u009b\\u202e$/m);
  assert.match(artifact, /^\\u001b\[1A\\u001b\[2KBody\\u009b\\u202e$/m);
});

test("--json writes C1 and bidi controls as escapes, which parse to the same text", async (t) => {
  const { factory } = await factoryIn(t);

  run(["commission", "hostile", "first", "--title", "Greet", "--body", "Say hello."], factory);
  run(["advance", "first"], factory);

  const document = JSON.parse(run(["show", "first", "--json"], factory).stdout).state.subject;
  const { stdout } = run(["artifact", document, "--json"], factory);

  assert.ok(!hasControl(stdout.trimEnd()), stdout);
  assert.equal(JSON.parse(stdout).body, "\x1b[1A\x1b[2KBody\u009b\u202e");
});

test("transcript and errors print raw bytes to a pipe and visible escapes to a terminal", async (t) => {
  const { factory } = await factoryIn(t);

  run(["commission", "hostile", "first", "--title", "Greet", "--body", "Say hello."], factory);
  run(["advance", "first"], factory);

  assert.equal(
    run(["transcript", "first", "1"], factory).stdout,
    "\x1b]52;c;eA==\x07Out\n\x1b[1AErr\n",
  );
  assert.equal(run(["errors", "first", "1"], factory).stdout, "\x1b[1AErr\n");

  // script gives the CLI a pseudo-terminal as stdout, and copies what it printed.
  const terminal = (command: string) =>
    spawnSync(
      "script",
      [
        "--quiet",
        "--return",
        "--command",
        `"${process.execPath}" "${cli}" ${command}`,
        "/dev/null",
      ],
      { cwd: tmpdir(), env: { ...process.env, MEDRENGARD_FACTORY: factory }, encoding: "utf8" },
    ).stdout;

  // The terminal turns each newline into a carriage return and a newline.
  assert.equal(terminal("transcript first 1"), "\\u001b]52;c;eA==\\u0007Out\r\n\\u001b[1AErr\r\n");
  assert.equal(terminal("errors first 1"), "\\u001b[1AErr\r\n");
});

test("watch prints a commission's attempts and notes, and stops once it awaits the owner", async (t) => {
  const { factory } = await factoryIn(t);

  run(["commission", "noting", "first", "--title", "Greet", "--body", "Say hello."], factory);

  const watching = spawn(process.execPath, [cli, "watch", "first"], {
    cwd: tmpdir(),
    env: { ...process.env, MEDRENGARD_FACTORY: factory },
  });

  let printed = "";

  watching.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    printed += chunk;
  });

  run(["advance", "first"], factory);

  const [code] = await once(watching, "exit");

  assert.equal(code, 0);
  assert.match(
    printed,
    /^1 build {8}started\n {5}Reading the request\.\n {5}Writing the reply\.\n1 build {8}done \(\d+\.\d s\)\nfirst: awaiting at review\n$/,
  );
});
