import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { builtIn } from "../defaults/kinds.ts";
import { limits } from "../defaults/limits.ts";
import { createEngine } from "./engine.ts";

const engineModule = join(import.meta.dirname, "engine.ts");
const kindsModule = join(import.meta.dirname, "..", "defaults", "kinds.ts");
const limitsModule = join(import.meta.dirname, "..", "defaults", "limits.ts");

/** An engine on a new log, and the log's path. */
async function engineOn(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const log = join(directory, "log.sqlite");

  return {
    engine: createEngine({ log, workflows: {}, kinds: builtIn, defaults: { limits } }),
    log,
  };
}

/** Registers an engine on `log` in a process of its own, which then ends without withdrawing. */
function crashedRegistration(log: string): number {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { createEngine } from ${JSON.stringify(engineModule)};
       import { builtIn } from ${JSON.stringify(kindsModule)};
       import { limits } from ${JSON.stringify(limitsModule)};
       const engine = createEngine({ log: ${JSON.stringify(log)}, workflows: {}, kinds: builtIn, defaults: { limits } });
       engine.register();
       console.log(process.pid);
       process.exit(0);`,
    ],
    { encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);

  return Number(child.stdout.trim());
}

test("an engine that registers is listed alive, on its host and since when, until it withdraws", async (t) => {
  const { engine } = await engineOn(t);

  const before = Date.now();
  const withdraw = engine.register();

  const [listed, ...rest] = engine.engines();

  assert.deepEqual(rest, []);
  assert.partialDeepStrictEqual(listed, { host: hostname(), pid: process.pid, status: "alive" });
  assert.ok(listed!.since >= before && listed!.since <= Date.now());

  withdraw();

  assert.deepEqual(engine.engines(), []);
});

test("an engine whose process ended without withdrawing is listed dead, until the next registers", async (t) => {
  const { engine, log } = await engineOn(t);

  const pid = crashedRegistration(log);

  assert.partialDeepStrictEqual(engine.engines(), [{ pid, status: "dead" }]);

  const withdraw = engine.register();

  assert.partialDeepStrictEqual(engine.engines(), [{ pid: process.pid, status: "alive" }]);
  assert.equal(engine.engines().length, 1);
  withdraw();
});

test("an engine registered on another machine is listed unknown, and never removed as dead", async (t) => {
  const { engine, log } = await engineOn(t);

  // As an engine on another machine reading this log would have written it.
  engine.register()();

  const database = new DatabaseSync(log);

  database
    .prepare("INSERT INTO engines VALUES (?, ?, ?, ?, ?, ?)")
    .run("another-machine", "elsewhere", "another-boot", 4242, 1, 1_700_000_000_000);
  database.close();

  assert.deepEqual(engine.engines(), [
    { host: "elsewhere", pid: 4242, since: 1_700_000_000_000, status: "unknown" },
  ]);

  const withdraw = engine.register();

  assert.partialDeepStrictEqual(engine.engines(), [
    { host: "elsewhere", status: "unknown" },
    { pid: process.pid, status: "alive" },
  ]);
  withdraw();
});
