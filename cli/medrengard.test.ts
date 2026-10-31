import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dirname, "medrengard.ts");
const repository = join(import.meta.dirname, "..");

/**
 * Writes a factory in a new directory, with the workflow `build`, whose command step prints hello,
 * claims `done` and awaits the owner at `review`, and the workflow `failing`, whose step exits 3.
 * Its log is in the directory's `state`.
 */
async function factoryIn(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const factory = join(directory, "factory.ts");

  await writeFile(
    factory,
    `import { defineWorkflow } from ${JSON.stringify(join(repository, "src/replay.ts"))};
     import { contract } from ${JSON.stringify(join(repository, "defaults/access.ts"))};

     const step = (script: string) => ({
       kind: "command", workspace: "empty", inputs: [], access: contract,
       run: ["sh", "-c", script], budget: 1,
       limits: { idle: 5, attempt: 10, transcript: 65536 },
     }) as const;

     export default {
       log: "state/log.sqlite",
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
