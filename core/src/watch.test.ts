import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { builtIn } from "../defaults/kinds.ts";
import { limits } from "../defaults/limits.ts";
import { createEngine } from "./engine.ts";
import type { Access } from "./definition.ts";
import type { CommissionState } from "./replay.ts";

// The system's programs, read-only, and the temp directory, where each test's directory is.
const access: Access = {
  paths: [
    ...["/usr", "/etc", "/bin", "/lib", "/lib64"].map((path) => ({ path, mode: "read" as const })),
    { path: tmpdir(), mode: "write" },
  ],
  network: false,
  environment: [],
  workspace: "write",
  sandboxes: false,
};

/**
 * A script for a check: it counts its runs in `$1/checks` and does what `script` says, which can
 * read the count as `$n`.
 */
const counting = (script: string) =>
  `n=$(( $(cat "$1/checks" 2>/dev/null || echo 0) + 1 )); echo $n > "$1/checks"; ${script}`;

// The claim of the outcome done, nothing else.
const claimDone = `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`;

/**
 * Commissions `first` on a workflow whose one step watches with `check`, every second, for at
 * most `wait` seconds, and ends on done. Returns the engine, its options for another engine on the
 * same log, and the test's directory.
 */
async function watching(t: TestContext, check: string, wait = 60, inputs = {}) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "record"));

  const options = {
    log: join(directory, "record", "log.sqlite"),
    kinds: builtIn,
    defaults: { limits },
    workflows: {
      build: {
        start: "watch",
        steps: {
          watch: {
            kind: "command",
            run: ["sh", "-c", counting(check), "sh", directory],
            watch: { interval: 1, wait },
            workspace: "empty",
            inputs,
            claims: [],
            on: { done: "end" },
            budget: 1,
            access,
          },
        },
      },
    },
  } as const;

  const engine = createEngine(options);

  engine.commission("build", { title: "T", body: "B" }, { name: "first" });

  return { engine, options, directory };
}

type Engine = ReturnType<typeof createEngine>;

/** Advances `first` until it is no longer attempting or ready, as `run` does, and returns it. */
async function settle(engine: Engine, limit = 30_000): Promise<CommissionState> {
  const deadline = Date.now() + limit;

  while (Date.now() < deadline) {
    const state = await engine.advance("first");

    if (state.status !== "attempting" && state.status !== "ready") {
      return state;
    }

    await sleep(50);
  }

  throw new Error(`first did not settle within ${limit} ms.`);
}

const checks = async (directory: string) =>
  Number(await readFile(join(directory, "checks"), "utf8"));

test("a watch step runs its check every interval until the check claims, recording only the claim", async (t) => {
  const { engine, directory } = await watching(t, `[ $n -lt 3 ] || ${claimDone}`);
  const started = Date.now();

  assert.partialDeepStrictEqual(await settle(engine), { status: "finished", by: "end" });
  assert.equal(await checks(directory), 3);
  // A check a second, the first at once.
  assert.ok(Date.now() - started >= 2000);

  // One attempt, the wait, and nothing recorded of the checks that found nothing.
  const { entries } = engine.record("first");

  assert.deepEqual(
    entries.map((entry) => entry.entry),
    ["attempt"],
  );
  assert.partialDeepStrictEqual(entries[0], { step: "watch", outcome: "done", notes: [] });
});

test("a watch step whose check claims nothing within its wait limit escalates", async (t) => {
  const { engine } = await watching(t, "true", 2);

  assert.partialDeepStrictEqual(await settle(engine), {
    status: "escalated",
    cause: "limit",
    reason: "Step watch waited 2 s, its wait limit.",
  });
});

test("a watch step's failed check is noted and the wait goes on, until three fail in a row", async (t) => {
  // Fails, finds nothing, fails twice, then fails a third time in a row.
  const { engine, directory } = await watching(t, `[ $n -eq 2 ] || exit 1`);

  assert.partialDeepStrictEqual(await settle(engine), {
    status: "escalated",
    cause: "exit",
    reason: "Step watch exited with code 1.",
  });
  assert.equal(await checks(directory), 5);

  const [attempt] = engine.record("first").entries;

  assert.ok(attempt?.entry === "attempt");
  assert.deepEqual(
    attempt.notes.map(({ note }) => note),
    [
      "A check failed, and the wait goes on: Step watch exited with code 1.",
      "A check failed, and the wait goes on: Step watch exited with code 1.",
      "A check failed, and the wait goes on: Step watch exited with code 1.",
    ],
  );
});

test("a watch step the owner cancels escalates", async (t) => {
  const { engine } = await watching(t, "true");

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "attempting" });
  engine.cancel("first");

  assert.partialDeepStrictEqual(await settle(engine), {
    status: "escalated",
    cause: "cancelled",
    reason: "Step watch was cancelled by the owner.",
  });
});

test("another engine carries a watch on where the first left it", async (t) => {
  const { engine, options, directory } = await watching(t, `[ $n -lt 3 ] || ${claimDone}`);

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "attempting" });
  assert.equal(await checks(directory), 1);

  assert.partialDeepStrictEqual(await settle(createEngine(options)), {
    status: "finished",
    by: "end",
  });
  assert.equal(await checks(directory), 3);
});

test("engines looking at a watch at once run one check between them", async (t) => {
  const { engine, options, directory } = await watching(t, "sleep 0.3");
  const other = createEngine(options);

  await Promise.all([engine.advance("first"), other.advance("first")]);
  assert.equal(await checks(directory), 1);
});

test("a check is given its attempt's inputs", async (t) => {
  const { engine, directory } = await watching(
    t,
    `cp "$MEDRENGARD_IN/input.json" "$1/given"; ${claimDone}`,
    60,
    { request: "request" },
  );

  assert.partialDeepStrictEqual(await settle(engine), { status: "finished", by: "end" });

  const given = JSON.parse(await readFile(join(directory, "given"), "utf8"));

  assert.partialDeepStrictEqual(given.inputs.request[0], {
    kind: "document",
    fields: { title: "T" },
  });
});

for (const [what, watch, problem] of [
  [
    "an interval under a second",
    { interval: 0.5, wait: 60 },
    "watch must be an interval of at least 1 s and a wait limit of at most 2147483 s",
  ],
  [
    "no wait limit",
    { interval: 1 },
    "watch must be an interval of at least 1 s and a wait limit of at most 2147483 s",
  ],
] as const) {
  test(`a watch step with ${what} cannot be commissioned`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

    t.after(() => rm(directory, { recursive: true, force: true }));

    const engine = createEngine({
      log: join(directory, "log.sqlite"),
      kinds: builtIn,
      defaults: { limits },
      // As a factory written in JavaScript could give it.
      workflows: JSON.parse(
        JSON.stringify({
          build: {
            start: "watch",
            steps: {
              watch: {
                kind: "command",
                run: ["true"],
                watch,
                workspace: "empty",
                inputs: {},
                claims: [],
                on: { done: "end" },
                budget: 1,
                access,
              },
            },
          },
        }),
      ),
    });

    assert.throws(() => engine.commission("build", { title: "T", body: "B" }, { name: "first" }), {
      message: `Workflow build is invalid: step watch's ${problem}.`,
    });
  });
}

test("a watch step builds no workspace", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const engine = createEngine({
    log: join(directory, "log.sqlite"),
    kinds: builtIn,
    defaults: { limits },
    workflows: {
      build: {
        start: "watch",
        steps: {
          watch: {
            kind: "command",
            run: ["true"],
            watch: { interval: 1, wait: 60 },
            workspace: "subject",
            inputs: {},
            claims: [],
            on: { done: "end" },
            budget: 1,
            access,
          },
        },
      },
    },
  });

  assert.throws(() => engine.commission("build", { title: "T", body: "B" }, { name: "first" }), {
    message: "Workflow build is invalid: step watch's workspace must be empty, since it watches.",
  });
});
