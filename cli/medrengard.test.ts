import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isRecord, isText } from "../src/json.ts";
import { setTimeout as sleep } from "node:timers/promises";

const cli = join(import.meta.dirname, "medrengard.ts");
const repository = join(import.meta.dirname, "..");

/**
 * Writes a factory in a new directory, with the workflow `build`, whose command step prints hello,
 * claims `done` and awaits the owner at `review`; the workflow `failing`, whose step exits 3; and
 * the workflow `slow`, whose step appends start, then end half a second later, to the directory's
 * `steps` file and leads to `review`; the workflow `twice`, whose two such steps lead to `review`; and the workflow
 * `noting`, whose step writes two notes and leads to `review`. Its log is in the directory's `state`.
 */
async function factoryIn(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const factory = join(directory, "factory.ts");

  await writeFile(
    factory,
    `import { defineWorkflow } from ${JSON.stringify(join(repository, "src/replay.ts"))};
     import { contract } from ${JSON.stringify(join(repository, "defaults/access.ts"))};
     import { builtIn } from ${JSON.stringify(join(repository, "defaults/kinds.ts"))};
     import { limits } from ${JSON.stringify(join(repository, "defaults/limits.ts"))};

     const step = (script: string) => ({
       kind: "command", workspace: "empty", inputs: {}, claims: ["document"], access: contract,
       run: ["sh", "-c", script], budget: 1,
       limits: { idle: 5, attempt: 10, transcript: 65536, input: 65536 },
     }) as const;

     const slow = {
       ...step(""),
       run: [
         "sh", "-c",
         \`echo start >> "$1"; sleep 0.5; echo end >> "$1"
          echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"\`,
         "sh", ${JSON.stringify(join(directory, "steps"))},
       ],
       access: {
         ...contract,
         paths: [...contract.paths, { path: ${JSON.stringify(directory)}, mode: "write" }],
       },
     } as const;

     export default {
       log: "state/log.sqlite",
       defaults: { limits },
       kinds: {
         ...builtIn,
         memo: {
           role: "judgement", description: "A memo.", fields: { note: { limit: 20 } },
           body: { required: false, limit: 100 },
           verifier: {
             run: ["sh", "-c", \`echo '{"accepted":true,"keep":[]}' > "$MEDRENGARD_OUT/output.json"\`],
             access: contract, limit: 5, memory: 4 * 1024 * 1024 * 1024, processes: 1024, kept: 1024,
           },
         },
       },
       workflows: {
         build: defineWorkflow({
           start: "build",
           steps: {
             build: {
               ...step(\`echo hello; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"\`),
               on: { done: "review" },
             },
             review: { kind: "approval", on: { approve: "end" } },
           },
         }),
         slow: defineWorkflow({
           start: "build",
           steps: {
             build: { ...slow, on: { done: "review" } },
             review: { kind: "approval", on: { approve: "end" } },
           },
         }),
         twice: defineWorkflow({
           start: "build",
           steps: {
             build: { ...slow, on: { done: "again" } },
             again: { ...slow, on: { done: "review" } },
             review: { kind: "approval", on: { approve: "end" } },
           },
         }),
         noting: defineWorkflow({
           start: "build",
           steps: {
             build: {
               ...step(\`echo 'Reading the request.' >&3; echo 'Writing the reply.' >&3
                 echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"\`),
               on: { done: "review" },
             },
             review: { kind: "approval", on: { approve: "end" } },
           },
         }),
         judged: defineWorkflow({
           start: "build",
           steps: {
             build: {
               ...step(\`echo '{"outcome":"pass","artifacts":[{"kind":"memo","fields":{"note":"Checked."}},{"kind":"verdict","fields":{"verdict":"pass"}}]}' > "$MEDRENGARD_OUT/output.json"\`),
               claims: ["memo", "verdict"],
               on: { pass: "review", fail: "review" },
             },
             review: { kind: "approval", on: { approve: "end" } },
           },
         }),
         // Writes control sequences everywhere an agent's text reaches the owner: cursor up and
         // erase line, a clipboard write (OSC 52), a carriage return, an 8-bit CSI and a
         // right-to-left override.
         hostile: defineWorkflow({
           start: "build",
           steps: {
             build: {
               ...step(\`printf '\\\\033[1A\\\\033[2KNote\\\\r\\\\302\\\\2332K\\\\342\\\\200\\\\256\\\\n' >&3
                 printf '\\\\033]52;c;eA==\\\\007Out\\\\n'
                 printf '\\\\033[1AErr\\\\n' >&2
                 printf '\\\\033[1A\\\\033[2KBody\\\\302\\\\233\\\\342\\\\200\\\\256' > "$MEDRENGARD_OUT/body.md"
                 echo '{"outcome":"done","artifacts":[{"kind":"document","fields":{"title":"Title\\\\u001b[1A\\\\u009b\\\\u202e"},"body":"body.md"}]}' > "$MEDRENGARD_OUT/output.json"\`),
               on: { done: "review" },
             },
             review: { kind: "approval", on: { approve: "end" } },
           },
         }),
         // Leads back to itself, so its second start finds its budget spent.
         looping: defineWorkflow({
           start: "build",
           steps: {
             build: {
               ...step(\`echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"\`),
               on: { done: "build" },
             },
           },
         }),
         failing: defineWorkflow({
           start: "build",
           steps: { build: { ...step("echo broke >&2; exit 3"), on: { done: "end" } } },
         }),
       },
     };`,
  );

  return { directory, factory };
}

/**
 * Runs the CLI with `args` from the temp directory, not the factory's, with `factory` as
 * MEDRENGARD_FACTORY unless it is undefined.
 */
function run(args: readonly string[], factory: string | undefined) {
  const env = { ...process.env, MEDRENGARD_FACTORY: factory };

  if (factory === undefined) {
    delete env.MEDRENGARD_FACTORY;
  }

  const { status, stdout, stderr } = spawnSync(process.execPath, [cli, ...args], {
    cwd: tmpdir(),
    env,
    encoding: "utf8",
  });

  return { status, stdout, stderr };
}

test("the CLI takes a commission through the engine's calls, printing their results as JSON", async (t) => {
  const { directory, factory } = await factoryIn(t);

  const json = (args: readonly string[]) => {
    const { status, stdout, stderr } = run([...args, "--json"], factory);

    assert.equal(status, 0, stderr);

    return JSON.parse(stdout);
  };

  await writeFile(join(directory, "request.md"), "Say hello.");

  assert.equal(
    json([
      "commission",
      "build",
      "first",
      "--title",
      "Greet",
      "--body-file",
      join(directory, "request.md"),
    ]),
    null,
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
    "advance",
    "state",
    "show",
    "watch",
    "commissions",
    "run",
    "decide",
    "cancel",
    "transcript",
    "errors",
    "artifact",
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
  assert.equal(
    json("commission", "judged", "first", "--title", "Greet", "--body", "Say hello."),
    null,
  );
  assert.deepEqual(json("state", "first"), ready);
  assert.deepEqual(json("advance", "first"), awaiting);

  const { subject, since } = JSON.parse(run(["state", "first", "--json"], factory).stdout);
  const { request } = JSON.parse(run(["show", "first", "--json"], factory).stdout);

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
  json("commission", "slow", "fourth", "--title", "Greet", "--body", "Say hello.");

  const advancing = spawn(process.execPath, [cli, "advance", "fourth"], {
    cwd: tmpdir(),
    env: { ...process.env, MEDRENGARD_FACTORY: factory },
  });

  while (!(await readFile(join(directory, "steps"), "utf8").catch(() => "")).includes("start")) {
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

test("the CLI without a factory exits 2 naming both ways to give one", () => {
  const { status, stdout, stderr } = run(["state", "first"], undefined);

  assert.equal(status, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /--factory/);
  assert.match(stderr, /MEDRENGARD_FACTORY/);
});

test("the CLI refuses a factory whose default export is not exactly { log, kinds, workflows, defaults }", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const factory = join(directory, "factory.ts");

  await writeFile(factory, `export default { log: "log.sqlite", kinds: {}, workflow: {} };`);

  assert.deepEqual(run(["state", "first"], factory), {
    status: 1,
    stdout: "",
    stderr: `Factory ${factory} must default-export { log, kinds, workflows, defaults }: missing workflows, defaults, not allowed workflow.\n`,
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
