import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const cli = join(import.meta.dirname, "medrengard.ts");
const repository = join(import.meta.dirname, "..");

/**
 * Writes a factory in a new directory, with the workflow `build`, whose command step prints hello,
 * claims `done` and awaits the owner at `review`; the workflow `failing`, whose step exits 3; and
 * the workflow `slow`, whose step appends start, then end half a second later, to the directory's
 * `steps` file and leads to `review`; and the workflow `twice`, whose two such steps lead to
 * `review`. Its log is in the directory's `state`.
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
       kinds: builtIn,
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
         failing: defineWorkflow({
           start: "build",
           steps: { build: { ...step("exit 3"), on: { done: "end" } } },
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
  assert.deepEqual(json(["decide", "first", "approve", "--subject", awaiting.subject]), {
    status: "finished",
    by: "end",
  });
  assert.ok(existsSync(join(directory, "state", "log.sqlite")));
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
    ["decide", "first", "approve", "--subject", "stale", "--json"],
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
    stdio: ["ignore", "pipe", "inherit"],
  });

  t.after(() => child.kill("SIGKILL"));

  const lines: Line[] = [];
  let partial = "";

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

  return { child, lines, until, exited };
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
