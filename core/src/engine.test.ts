import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdirSync, readlinkSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { builtIn } from "../defaults/kinds.ts";
import { limits as defaultLimits } from "../defaults/limits.ts";
import { createEngine } from "./engine.ts";
import { isRecord, isText } from "./json.ts";
import type { Kind, Kinds } from "./kinds.ts";
import {
  defineWorkflow,
  type Access,
  type Limits,
  type Money,
  type Query,
  type Workflow,
} from "./definition.ts";
import type { CommissionEvent } from "./replay.ts";

// The system's programs, read-only.
const system = ["/usr", "/etc", "/bin", "/lib", "/lib64"].map((path) => ({
  path,
  mode: "read" as const,
}));

// Every test's directory is under the temp directory, so a step can reach its own; nothing of the
// owner's is visible.
const access: Access = {
  paths: [...system, { path: tmpdir(), mode: "write" }],
  network: false,
  environment: [],
  workspace: "write",
  sandboxes: false,
};

// The subject kinds a step may claim, so a test step is refused only by the claim it tests. A
// verdict is claimed only by steps that route pass and fail.
const claims = ["document", "commit"];

/**
 * Starts an engine whose one workflow, `build`, is made by `workflow` from the test's directory,
 * with the kinds `kinds` makes from it, the built-ins unless given, and the factory's default
 * `limits`, and commissions `first` under it. Returns the options too, so a test can start a
 * second engine on the same log.
 */
async function engineWith<N extends string>(
  t: TestContext,
  workflow: (directory: string) => Workflow<N>,
  kinds: (directory: string) => Kinds = () => builtIn,
  limits: Limits = defaultLimits,
) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  // Writable again first: a test that failed after making part of it read-only, such as the log's
  // directory, never restored it, and rm cannot remove what is under it.
  t.after(async () => {
    spawnSync("chmod", ["-R", "u+rwx", directory]);
    await rm(directory, { recursive: true, force: true });
  });

  // The log's own directory, apart from the test's, which every step is kept out of.
  const record = join(directory, "record");

  await mkdir(record);

  const options = {
    log: join(record, "log.sqlite"),
    kinds: kinds(directory),
    workflows: { build: workflow(directory) },
    defaults: { limits },
  };

  const engine = createEngine(options);

  engine.commission("build", "first", { title: "Greet", body: "Say hello." });

  return { engine, directory, record, options };
}

/**
 * Starts an engine with a single command step that runs `script`, ends on `done`, repeats on
 * `again`, has a budget of 2 and the given limits. The script's `$1` is a file it may append to,
 * named `started` in the returned directory.
 */
function engineRunning(
  t: TestContext,
  script: string,
  limits: {
    idle: number;
    attempt: number;
    transcript: number;
    input: number;
    memory?: number;
    processes?: number;
    disk?: number;
  } = { idle: 1, attempt: 5, transcript: 65536, input: 65536 },
) {
  return engineWith(t, (directory) =>
    defineWorkflow({
      start: "build",
      steps: {
        build: {
          kind: "command",
          claims,
          workspace: "empty",
          inputs: {},
          run: ["sh", "-c", script, "sh", join(directory, "started")],
          on: { done: "end", again: "build" },
          access,
          budget: 2,
          limits,
        },
      },
    }),
  );
}

/** Starts an engine whose commission awaits the owner at `review`, before a command step. */
function engineAwaiting(t: TestContext) {
  return engineWith(t, () =>
    defineWorkflow({
      start: "review",
      steps: {
        review: { kind: "approval", on: { approve: "build", reject: "end" } },
        build: {
          kind: "command",
          claims,
          workspace: "empty",
          inputs: {},
          run: ["true"],
          on: { done: "end" },
          access,
          budget: 1,
          limits: { idle: 1, attempt: 5, transcript: 65536, input: 65536 },
        },
      },
    }),
  );
}

/**
 * Starts an engine with a single command step that declares `inputs`, runs `script` and ends on
 * `done`. The script's `$1` is the directory `received` in the returned directory, empty at start.
 */
async function engineReceiving(
  t: TestContext,
  inputs: Readonly<Record<string, Query<"build">>>,
  script: string,
) {
  const started = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "build",
      steps: {
        build: {
          kind: "command",
          claims,
          workspace: "empty",
          inputs,
          run: ["sh", "-c", script, "sh", join(directory, "received")],
          on: { done: "end" },
          access,
          budget: 1,
          limits: { idle: 1, attempt: 5, transcript: 65536, input: 65536 },
        },
      },
    }),
  );

  await mkdir(join(started.directory, "received"));

  return started;
}

/** What a test step writes as its output.json, including fields output.json does not define. */
type Claim = {
  outcome: string;
  artifact?: readonly never[];
  artifacts?: readonly { kind: string; fields: Record<string, string>; body?: string }[];
};

/**
 * Starts an engine whose `build` step runs `setup`, then writes `claim` as its output.json, and
 * leads on `done` to `read`, which receives the subject into the directory `received` and leads to
 * the approval step `review`.
 */
async function engineClaiming(t: TestContext, setup: string, claim: Claim) {
  const limits = { idle: 1, attempt: 5, transcript: 65536, input: 65536 };

  const started = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "build",
      steps: {
        build: {
          kind: "command",
          claims,
          workspace: "empty",
          inputs: {},
          run: [
            "sh",
            "-c",
            `${setup}
             echo '${JSON.stringify(claim)}' > "$MEDRENGARD_OUT/output.json"`,
          ],
          on: { done: "read" },
          access,
          budget: 1,
          limits,
        },
        read: {
          kind: "command",
          claims,
          workspace: "empty",
          inputs: { subject: "subject" },
          run: [
            "sh",
            "-c",
            `cp -r "$MEDRENGARD_IN"/* "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            "sh",
            join(directory, "received"),
          ],
          on: { done: "review" },
          access,
          budget: 1,
          limits,
        },
        review: { kind: "approval", on: { approve: "end" } },
      },
    }),
  );

  await mkdir(join(started.directory, "received"));

  return started;
}

/**
 * A script that commits plan.txt in a new repository in its workspace and claims `done` with that
 * commit, or with `$claimed` if set. Its dates are fixed, so every run makes the same commit.
 */
const committing = `git init -q
  printf 'Do it.\\n' > plan.txt
  git add plan.txt
  GIT_AUTHOR_DATE=2026-01-01T00:00:00Z GIT_COMMITTER_DATE=2026-01-01T00:00:00Z \\
    git -c user.name=Test -c user.email=test@example.com -c commit.gpgsign=false \\
    commit -q --no-verify -m Plan
  sha=\${claimed:-$(git rev-parse HEAD)}
  echo "{\\"outcome\\":\\"done\\",\\"artifacts\\":[{\\"kind\\":\\"commit\\",\\"fields\\":{\\"sha\\":\\"$sha\\"}}]}" \\
    > "$MEDRENGARD_OUT/output.json"`;

/**
 * What follows `committing` to claim its commit again, with a report whose bytes `writer` prints.
 */
function reporting(writer: string) {
  return `
  ${writer} > "$MEDRENGARD_OUT/report.md"
  echo "{\\"outcome\\":\\"done\\",\\"artifacts\\":[{\\"kind\\":\\"commit\\",\\"fields\\":{\\"sha\\":\\"$sha\\"},\\"body\\":\\"report.md\\"}]}" \\
    > "$MEDRENGARD_OUT/output.json"`;
}

/** A command step that runs `script`, with `args` as its `$1` on, and leads on `done` to `next`. */
function stepRunning<N extends string>(script: string, next: N, args: readonly string[] = []) {
  return {
    kind: "command",
    claims,
    workspace: "empty",
    inputs: {},
    run: ["sh", "-c", script, "sh", ...args],
    on: { done: next },
    access,
    budget: 1,
    limits: { idle: 5, attempt: 10, transcript: 65536, input: 65536 },
  } as const;
}

/** A claim of the outcome `done` with one document, titled Plan, whose body is at `body`. */
function planAt(body: string) {
  return {
    outcome: "done",
    artifacts: [{ kind: "document", fields: { title: "Plan" }, body }],
  };
}

/**
 * A script that appends to `$1` and claims `again` with a new document, numbered by the attempt,
 * so each attempt is about a new subject.
 */
const claimingAgain = `echo started >> "$1"; wc -l < "$1" > "$MEDRENGARD_OUT/plan.md"
  echo '${JSON.stringify({ ...planAt("plan.md"), outcome: "again" })}' > "$MEDRENGARD_OUT/output.json"`;

/** The commission's current subject, which a decision must name. */
function subjectOf(engine: ReturnType<typeof createEngine>): string {
  const state = engine.state("first");

  if (state.status === "finished") {
    throw new Error("A finished commission has no subject.");
  }

  return state.subject;
}

/** The event the commission has waited since, at an approval step or an escalation. */
function sinceOf(engine: ReturnType<typeof createEngine>): number {
  const state = engine.state("first");

  if (state.status !== "awaiting" && state.status !== "escalated") {
    throw new Error(`A ${state.status} commission is not waiting.`);
  }

  return state.since;
}

/** Waits until the step has written to its `started` file. */
async function untilStarted(directory: string): Promise<string> {
  for (;;) {
    const started = await readFile(join(directory, "started"), "utf8").catch(() => "");

    if (started.endsWith("\n")) {
      return started;
    }

    await sleep(20);
  }
}

test("a commission whose command step leads to the end finishes", async (t) => {
  const { engine } = await engineRunning(
    t,
    `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
});

test("a commission's request is its first subject, kept in the store", async (t) => {
  const { engine } = await engineRunning(t, "true");
  const state = engine.state("first");

  assert.equal(state.status, "ready");
  assert.deepEqual(engine.artifact(state.subject), {
    kind: "document",
    fields: { title: "Greet" },
    body: "Say hello.",
  });
});

test("a step that declares the subject receives it in its input", async (t) => {
  const { engine, directory } = await engineReceiving(
    t,
    { subject: "subject" },
    `cp -r "$MEDRENGARD_IN"/* "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  const subject = subjectOf(engine);

  await engine.advance("first");

  const received = join(directory, "received");

  // The kinds the step may claim are the next test's.
  assert.partialDeepStrictEqual(JSON.parse(await readFile(join(received, "input.json"), "utf8")), {
    commission: "first",
    step: "build",
    attempt: 1,
    outcomes: ["done"],
    inputs: {
      subject: [
        { hash: subject, kind: "document", fields: { title: "Greet" }, body: `subject/${subject}` },
      ],
    },
  });

  assert.equal(await readFile(join(received, "subject", subject), "utf8"), "Say hello.");
});

test("a step's input.json lists the kinds it may claim, with their fields and body", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "build",
      steps: {
        build: {
          ...stepRunning(
            `cp "$MEDRENGARD_IN/input.json" "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            "end",
            [directory],
          ),
          claims: ["verdict"],
          on: { done: "end", pass: "end", fail: "end" },
        },
      },
    }),
  );

  await engine.advance("first");

  assert.deepEqual(JSON.parse(await readFile(join(directory, "input.json"), "utf8")).claims, {
    verdict: {
      description:
        "Your verdict on what the workflow is about. Its optional summary is one line, and its optional body your findings.",
      fields: {
        verdict: { limit: 4, required: true, values: ["pass", "fail"] },
        summary: { limit: 200 },
      },
      body: { required: false, limit: 1048576 },
      outcome: "verdict",
    },
  });
});

test("a step that declares no inputs receives only input.json", async (t) => {
  const { engine, directory } = await engineReceiving(
    t,
    {},
    `ls -A "$MEDRENGARD_IN" > "$1/listing"; cp "$MEDRENGARD_IN/input.json" "$1"
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  await engine.advance("first");

  const received = join(directory, "received");

  assert.equal(await readFile(join(received, "listing"), "utf8"), "input.json\n");
  assert.deepEqual(JSON.parse(await readFile(join(received, "input.json"), "utf8")).inputs, {});
});

test("a step cannot write to its input", async (t) => {
  const { engine } = await engineReceiving(
    t,
    { subject: "subject" },
    `body=$(ls -d "$MEDRENGARD_IN"/subject/*) && test -f "$body" &&
     ! touch "$MEDRENGARD_IN/note" 2> /dev/null &&
     ! (echo changed > "$body") 2> /dev/null &&
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
});

/**
 * Starts an engine with a single command step that runs `script` under the access `confined`
 * makes from the test's directory, and claims `done` once it ends. The script's `$1` is that
 * directory; what the script prints is the attempt's transcript.
 */
function engineConfined(
  t: TestContext,
  confined: (directory: string) => Access,
  script: string,
  limits: Partial<Limits> = {},
) {
  return engineWith(t, (directory) =>
    defineWorkflow({
      start: "build",
      steps: {
        build: {
          kind: "command",
          claims,
          workspace: "empty",
          inputs: {},
          run: [
            "sh",
            "-c",
            `${script}
             echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            "sh",
            directory,
          ],
          on: { done: "end" },
          budget: 1,
          access: confined(directory),
          limits: { idle: 5, attempt: 10, transcript: 65536, input: 65536, ...limits },
        },
      },
    }),
  );
}

test("a step sees its workspace, input and output at /workspace, /input and /output, not where the engine keeps them", async (t) => {
  const { engine } = await engineConfined(
    t,
    () => access,
    `pwd; echo "$PWD $MEDRENGARD_IN $MEDRENGARD_OUT"; ls /input
     # The attempt's own directory beside the log is not where the step is, nor visible.
     ls -A "$1/record/attempts" 2>/dev/null | wc -l`,
  );

  assert.equal((await engine.advance("first")).status, "finished");
  assert.equal(
    engine.transcript("first", 1).toString(),
    "/workspace\n/workspace /input /output\ninput.json\n0\n",
  );
});

test("an access that names /workspace, /input or /output, or a path under one, is refused", async (t) => {
  for (const path of ["/workspace", "/input", "/output/notes"]) {
    await assert.rejects(
      engineWith(t, () =>
        defineWorkflow({
          start: "build",
          steps: {
            build: {
              ...stepRunning("true", "end"),
              access: { ...access, paths: [...access.paths, { path, mode: "read" }] },
            },
          },
        }),
      ),
      {
        message:
          "Workflow build is invalid: step build's paths cannot name /workspace, /input, /output or /network, " +
          "where the step contract's directories and its network's proxy are.",
      },
      path,
    );
  }
});

test("a step sees only the paths its access declares, in their modes", async (t) => {
  const { engine, directory } = await engineConfined(
    t,
    (directory) => ({
      ...access,
      paths: [...system, { path: join(directory, "shown"), mode: "read" }],
    }),
    `test -e "$1/hidden/secret" && echo hidden is visible
     cat "$1/shown/note"
     (echo changed > "$1/shown/note") 2> /dev/null && echo shown is writable`,
  );

  await mkdir(join(directory, "hidden"));
  await mkdir(join(directory, "shown"));
  await writeFile(join(directory, "hidden", "secret"), "secret\n");
  await writeFile(join(directory, "shown", "note"), "note\n");

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
  assert.equal(engine.transcript("first", 1).toString(), "note\n");
});

test("a path declared empty hides what is there and holds at most its size", async (t) => {
  const { engine, directory } = await engineConfined(
    t,
    (directory) => ({
      ...access,
      paths: [...access.paths, { path: join(directory, "hidden"), mode: "empty", size: 4096 }],
    }),
    `ls "$1/hidden"
     head -c 8192 /dev/zero > "$1/hidden/large" 2> /dev/null || echo full`,
  );

  await mkdir(join(directory, "hidden"));
  await writeFile(join(directory, "hidden", "secret"), "secret\n");

  // A step that fills the area and ends within the engine's look is not seen to; one that carries
  // on is, below.
  await engine.advance("first");

  assert.equal(engine.transcript("first", 1).toString(), "full\n");
  assert.deepEqual(await readdir(join(directory, "hidden")), ["secret"]);
});

test("a step whose access makes its workspace read-only cannot write to it", async (t) => {
  const { engine } = await engineConfined(
    t,
    () => ({ ...access, workspace: "read" }),
    `touch note 2> /dev/null || echo read-only`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
  assert.equal(engine.transcript("first", 1).toString(), "read-only\n");
});

test("a step's /dev is read-only but for its shared memory", async (t) => {
  const { engine } = await engineConfined(
    t,
    () => access,
    `touch /dev/note 2> /dev/null || echo read-only
     echo small > /dev/shm/small && echo shared`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
  assert.equal(engine.transcript("first", 1).toString(), "read-only\nshared\n");
});

test("a step's shared memory is bounded by its memory limit alone", async (t) => {
  const { engine } = await engineRunning(
    t,
    `head -c $((96 * 1024 * 1024)) /dev/zero > /dev/shm/big &&
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    { idle: 10, attempt: 10, transcript: 65536, input: 65536, memory: 256 * 1024 * 1024 },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
});

test("a step that fills its shared memory past its memory limit escalates, naming the limit", async (t) => {
  const { engine } = await engineRunning(
    t,
    `head -c $((64 * 1024 * 1024)) /dev/zero > /dev/shm/big
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    { idle: 10, attempt: 10, transcript: 65536, input: 65536, memory: 32 * 1024 * 1024 },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "limit",
    reason: "Step build reached its memory limit of 33554432 bytes.",
  });
});

test("a step over its memory limit is stopped and escalates, naming the limit", async (t) => {
  // tail holds its whole input, which has no newline, in memory.
  const { engine } = await engineRunning(t, "head -c 200000000 /dev/zero | tail > /dev/null", {
    idle: 10,
    attempt: 10,
    transcript: 65536,
    input: 65536,
    memory: 32 * 1024 * 1024,
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "limit",
    reason: "Step build reached its memory limit of 33554432 bytes.",
  });
});

test("a step cannot run more processes than its limit", async (t) => {
  // Forks until refused, each child waiting, and says how many it started.
  const { engine } = await engineRunning(
    t,
    `python3 -c '
import os, time
started = 0
try:
    for _ in range(100):
        if os.fork() == 0:
            time.sleep(2)
            os._exit(0)
        started += 1
except OSError:
    pass
print(started)'
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    { idle: 10, attempt: 10, transcript: 65536, input: 65536, processes: 16 },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });

  const started = Number(engine.transcript("first", 1).toString());

  assert.ok(started > 0 && started < 16, `started ${started}`);
});

test(
  "a step that keeps running past its disk limit is stopped and escalates",
  { timeout: 10_000 },
  async (t) => {
    const { engine } = await engineRunning(t, "head -c 5000000 /dev/zero > big; sleep 30", {
      idle: 60,
      attempt: 60,
      transcript: 65536,
      input: 65536,
      disk: 1024 * 1024,
    });

    assert.partialDeepStrictEqual(await engine.advance("first"), {
      status: "escalated",
      cause: "limit",
      reason: "Step build used more than its disk limit of 1048576 bytes.",
    });
  },
);

test("a step that exits at once past its disk limit escalates", async (t) => {
  const { engine } = await engineRunning(
    t,
    `head -c 5000000 /dev/zero > big; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    { idle: 5, attempt: 5, transcript: 65536, input: 65536, disk: 1024 * 1024 },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "limit",
    reason: "Step build used more than its disk limit of 1048576 bytes.",
  });
});

test("a step that locks directories in its work area completes, and its work area is still removed", async (t) => {
  // Mode 000 below a mode 000 directory: nothing can be listed or removed until it is opened again.
  const { engine, directory } = await engineRunning(
    t,
    `mkdir -p locked/inner && touch locked/inner/file && chmod 000 locked/inner locked
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
  assert.deepEqual(await readdir(join(directory, "record", "attempts")), []);
});

test("a step that hides its bytes under a locked directory past its disk limit escalates", async (t) => {
  const { engine } = await engineRunning(
    t,
    `mkdir hidden && head -c 5000000 /dev/zero > hidden/big && chmod 000 hidden
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    { idle: 5, attempt: 5, transcript: 65536, input: 65536, disk: 1024 * 1024 },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "limit",
    reason: "Step build used more than its disk limit of 1048576 bytes.",
  });
});

test("a step that fills an empty area of its access escalates", async (t) => {
  // The write fails once the area is full; the step carries on, long enough to be seen.
  const { engine } = await engineConfined(
    t,
    () => ({
      ...access,
      paths: [...access.paths, { path: "/scratch", mode: "empty", size: 1024 * 1024 }],
    }),
    "head -c 2000000 /dev/zero > /scratch/big 2> /dev/null; sleep 1.5",
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "limit",
    reason: "Step build filled /scratch, its area of 1048576 bytes.",
  });
});

test("a scratch area of a step's access is a fresh directory at its path, on the disk of the attempt's work area", async (t) => {
  // The same device as /workspace, which is in the attempt's work area: not a memory-backed mount.
  const { engine, directory } = await engineConfined(
    t,
    () => ({ ...access, paths: [...access.paths, { path: "/scratch", mode: "scratch" }] }),
    `ls -A /scratch | wc -l > "$1/before"
     head -c 2000000 /dev/zero > /scratch/big && echo written > "$1/written"
     test "$(stat -c %d /scratch)" = "$(stat -c %d /workspace)" && echo same > "$1/device"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
  assert.equal((await readFile(join(directory, "before"), "utf8")).trim(), "0");
  assert.equal(await readFile(join(directory, "written"), "utf8"), "written\n");
  assert.equal(await readFile(join(directory, "device"), "utf8"), "same\n");
});

test(
  "a step that writes past its disk limit in a scratch area escalates",
  { timeout: 10_000 },
  async (t) => {
    const { engine } = await engineConfined(
      t,
      () => ({ ...access, paths: [...access.paths, { path: "/scratch", mode: "scratch" }] }),
      "head -c 5000000 /dev/zero > /scratch/big; sleep 30",
      { attempt: 60, disk: 1024 * 1024 },
    );

    assert.partialDeepStrictEqual(await engine.advance("first"), {
      status: "escalated",
      cause: "limit",
      reason: "Step build used more than its disk limit of 1048576 bytes.",
    });
  },
);

test("a scratch area with a size of its own is refused, as the disk limit bounds it", async (t) => {
  await assert.rejects(
    engineWith(t, () =>
      defineWorkflow({
        start: "build",
        steps: {
          build: {
            ...stepRunning("true", "end"),
            // SAFETY: the workflow module is the owner's JavaScript, which the type cannot hold to.
            access: {
              ...access,
              paths: [...access.paths, { path: "/scratch", mode: "scratch", size: 1 } as never],
            },
          },
        },
      }),
    ),
    {
      message:
        "Workflow build is invalid: step build's paths must each be an absolute path and a mode: " +
        "read, write, scratch, or empty with a size.",
    },
  );
});

test("a step gets only the environment its access names, PATH included", async (t) => {
  process.env.MEDRENGARD_TEST_SHOWN = "shown";
  process.env.MEDRENGARD_TEST_HIDDEN = "hidden";
  t.after(() => {
    delete process.env.MEDRENGARD_TEST_SHOWN;
    delete process.env.MEDRENGARD_TEST_HIDDEN;
  });

  const { engine } = await engineConfined(
    t,
    () => ({ ...access, environment: ["MEDRENGARD_TEST_SHOWN"] }),
    // The environment sh was started with, before it sets a PATH of its own.
    `echo "$MEDRENGARD_TEST_SHOWN" "$MEDRENGARD_TEST_HIDDEN"
     tr '\\0' '\\n' < /proc/$$/environ | grep -c '^PATH='`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
  assert.equal(engine.transcript("first", 1).toString(), "shown \n0\n");
});

test("a step gets the values its access sets, over the engine's own", async (t) => {
  process.env.MEDRENGARD_TEST_SET = "the engine's";
  t.after(() => delete process.env.MEDRENGARD_TEST_SET);

  const { engine } = await engineConfined(
    t,
    () => ({ ...access, environment: [], values: { MEDRENGARD_TEST_SET: "the definition's" } }),
    `echo "$MEDRENGARD_TEST_SET"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
  assert.equal(engine.transcript("first", 1).toString(), "the definition's\n");
});

test("with the whole environment passed through, a value still sets its variable", async (t) => {
  process.env.MEDRENGARD_TEST_SET = "the engine's";
  t.after(() => delete process.env.MEDRENGARD_TEST_SET);

  const { engine } = await engineConfined(
    t,
    () => ({ ...access, environment: "all", values: { MEDRENGARD_TEST_SET: "the definition's" } }),
    `echo "$MEDRENGARD_TEST_SET"`,
  );

  await engine.advance("first");
  assert.equal(engine.transcript("first", 1).toString(), "the definition's\n");
});

test("values an access cannot set are refused before the commission starts", async (t) => {
  const refused = [
    [{ GIT_AUTHOR_NAME: "A" }, ["GIT_AUTHOR_NAME"]],
    [{ MEDRENGARD_IN: "/elsewhere" }, []],
    [{ "NOT A NAME": "A" }, []],
    [{ GIT_AUTHOR_NAME: 1 }, []],
  ] as const;

  for (const [values, environment] of refused) {
    await assert.rejects(
      engineWith(t, () =>
        defineWorkflow({
          start: "build",
          steps: {
            build: {
              ...stepRunning("true", "end"),
              // SAFETY: the workflow module is the owner's JavaScript, which the type cannot hold to.
              access: { ...access, environment, values: values as Record<string, string> },
            },
          },
        }),
      ),
      {
        message:
          "Workflow build is invalid: step build's values must each set a variable by name to text, " +
          "neither MEDRENGARD_IN nor MEDRENGARD_OUT nor one its environment passes through.",
      },
      JSON.stringify(values),
    );
  }
});

test("a step has namespaces of its own, the network's only without network access", async (t) => {
  const kinds = ["user", "cgroup", "ipc", "uts", "pid", "net"];

  const script = `for ns in ${kinds.join(" ")}; do readlink /proc/self/ns/$ns; done`;
  const engine = (network: boolean) => engineConfined(t, () => ({ ...access, network }), script);
  const own = kinds.map((kind) => readlinkSync(`/proc/self/ns/${kind}`));

  const shared = async (network: boolean) => {
    const { engine: confined } = await engine(network);

    await confined.advance("first");

    const seen = confined.transcript("first", 1).toString().trim().split("\n");

    return kinds.filter((_, index) => seen[index] === own[index]);
  };

  assert.deepEqual(await shared(false), []);
  assert.deepEqual(await shared(true), ["net"]);
});

test("a step whose access does not grant sandboxes cannot make namespaces of its own", async (t) => {
  const { engine } = await engineConfined(
    t,
    () => access,
    `unshare -Ur true 2> /dev/null && echo made || echo refused`,
  );

  await engine.advance("first");

  assert.equal(engine.transcript("first", 1).toString(), "refused\n");
});

test("a step whose access grants sandboxes can start one of its own", async (t) => {
  // bwrap prepares a new sandbox's root under /tmp, so a step that starts one needs a /tmp of its own.
  const { engine } = await engineConfined(
    t,
    () => ({
      ...access,
      sandboxes: true,
      paths: [...access.paths, { path: "/tmp", mode: "scratch" }],
    }),
    `bwrap --ro-bind / / --unshare-pid -- true && echo started`,
  );

  await engine.advance("first");

  assert.equal(engine.transcript("first", 1).toString(), "started\n");
});

test("a namespace a step makes uncovers nothing its access hides and writes nothing it made read-only", async (t) => {
  const { engine } = await engineConfined(
    t,
    (directory) => {
      mkdirSync(join(directory, "kept", "hidden"), { recursive: true });
      writeFileSync(join(directory, "kept", "hidden", "secret"), "secret\n");

      return {
        ...access,
        sandboxes: true,
        paths: [
          ...system,
          { path: "/tmp", mode: "scratch" },
          { path: join(directory, "kept"), mode: "read" },
          { path: join(directory, "kept", "hidden"), mode: "empty", size: 4096 },
        ],
      };
    },
    `unshare -Urm sh -c '
       echo made
       umount "$1/kept/hidden" 2> /dev/null
       cat "$1/kept/hidden/secret" 2> /dev/null || echo hidden
       mkdir /tmp/kept; mount --bind "$1/kept" /tmp/kept 2> /dev/null
       cat /tmp/kept/hidden/secret 2> /dev/null || echo hidden
       mount -o remount,bind,rw "$1/kept" 2> /dev/null
       touch "$1/kept/written" 2> /dev/null && echo written || echo read-only
     ' sh "$1"`,
  );

  await engine.advance("first");

  assert.equal(engine.transcript("first", 1).toString(), "made\nhidden\nhidden\nread-only\n");
});

test("a step without network access has only a loopback interface", async (t) => {
  // /proc/net/dev lists one interface per line, each with a colon; its headers have none.
  const { engine } = await engineConfined(t, () => access, `grep -c : /proc/net/dev`);

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
  assert.equal(engine.transcript("first", 1).toString(), "1\n");
});

test("a claimed document becomes the subject the next step receives", async (t) => {
  const { engine, directory } = await engineClaiming(
    t,
    `printf 'Do it.' > "$MEDRENGARD_OUT/plan.md"`,
    planAt("plan.md"),
  );

  const request = subjectOf(engine);

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "awaiting",
    step: { name: "review" },
  });

  const subject = subjectOf(engine);
  const received = join(directory, "received");

  assert.notEqual(subject, request);

  assert.deepEqual(engine.artifact(subject), {
    kind: "document",
    fields: { title: "Plan" },
    body: "Do it.",
  });

  assert.equal(
    JSON.parse(await readFile(join(received, "input.json"), "utf8")).inputs.subject[0].hash,
    subject,
  );

  assert.equal(await readFile(join(received, "subject", subject), "utf8"), "Do it.");
});

test("a claim with a field output.json does not define escalates", async (t) => {
  const { engine } = await engineClaiming(t, "true", { outcome: "done", artifact: [] });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "claim",
    reason: 'Step build wrote an output.json with fields it does not define: ["artifact"].',
  });
});

test("a claimed artifact of an undeclared kind escalates", async (t) => {
  const { engine } = await engineClaiming(t, "true", {
    outcome: "done",
    artifacts: [{ kind: "memo", fields: {} }],
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "claim",
    reason: 'Step build claimed an artifact of undeclared kind: "memo".',
  });
});

test("a claimed artifact of a kind its step does not declare escalates", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({
      start: "build",
      steps: {
        build: {
          ...stepRunning(
            `echo '{"outcome":"done","artifacts":[{"kind":"verdict","fields":{"verdict":"pass"}}]}' > "$MEDRENGARD_OUT/output.json"`,
            "end",
          ),
          claims: ["document"],
        },
      },
    }),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "claim",
    reason: 'Step build claimed an artifact of undeclared kind: "verdict".',
  });
});

test("a claimed decision escalates, since only the owner decides", async (t) => {
  const { engine } = await engineClaiming(t, "true", {
    outcome: "done",
    artifacts: [{ kind: "decision", fields: { outcome: "approve", subject: "any" } }],
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "claim",
    reason: "Step build claimed a decision, which only the owner makes.",
  });
});

test("a claimed document without a title escalates", async (t) => {
  const { engine } = await engineClaiming(t, `printf 'Do it.' > "$MEDRENGARD_OUT/plan.md"`, {
    outcome: "done",
    artifacts: [{ kind: "document", fields: {}, body: "plan.md" }],
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "claim",
    reason: "Step build claimed a document without its title.",
  });
});

test("a claimed body the step did not write escalates", async (t) => {
  const { engine } = await engineClaiming(t, "true", planAt("plan.md"));

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "claim",
    reason: 'Step build claimed a body it did not write: "plan.md".',
  });
});

test("a claimed body named by an absolute path escalates, though the step wrote that file", async (t) => {
  const { engine } = await engineClaiming(
    t,
    `echo plan > "$MEDRENGARD_OUT/plan.md"`,
    planAt("/plan.md"),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "claim",
    reason: 'Step build claimed a body path that is not relative to its output: "/plan.md".',
  });
});

test("a claimed body outside the step's output escalates", async (t) => {
  const { engine } = await engineClaiming(
    t,
    // Relative, so it names the input both where the step sees it and where the engine keeps it.
    `ln -s ../input/input.json "$MEDRENGARD_OUT/plan.md"`,
    planAt("plan.md"),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "claim",
    reason: 'Step build claimed a body outside its output: "plan.md".',
  });
});

test("an output.json over its size limit escalates", async (t) => {
  const { engine } = await engineRunning(
    t,
    `{ printf '{"outcome":"done","padding":"'; head -c 65536 /dev/zero | tr '\\0' a; printf '"}'; } \\
       > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "claim",
    reason: "Step build wrote an output.json over its limit of 65536 bytes.",
  });
});

test("a claimed document title over its size limit escalates", async (t) => {
  const { engine } = await engineClaiming(t, `printf 'Do it.' > "$MEDRENGARD_OUT/plan.md"`, {
    outcome: "done",
    artifacts: [{ kind: "document", fields: { title: "a".repeat(201) }, body: "plan.md" }],
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "claim",
    reason: "Step build claimed a document title over its limit of 200 bytes.",
  });
});

test("a claimed body over its size limit escalates", async (t) => {
  const { engine } = await engineClaiming(
    t,
    `head -c 1048577 /dev/zero | tr '\\0' a > "$MEDRENGARD_OUT/plan.md"`,
    planAt("plan.md"),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "claim",
    reason: 'Step build claimed a body over its limit of 1048576 bytes: "plan.md".',
  });
});

test("a claimed body that is not UTF-8 escalates", async (t) => {
  const { engine } = await engineClaiming(
    t,
    `printf 'Do \\377.' > "$MEDRENGARD_OUT/plan.md"`,
    planAt("plan.md"),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "claim",
    reason: 'Step build claimed a body that is not UTF-8: "plan.md".',
  });
});

test("a step that declares the decision receives the owner's feedback", async (t) => {
  const { engine, directory } = await engineReceiving(
    t,
    { decision: { kind: "decision", about: "subject", take: "latest" } },
    // -f, since the first attempt's copies are read-only.
    `cp -rf "$MEDRENGARD_IN"/* "$1"; exit 3`,
  );

  await engine.advance("first");

  const subject = subjectOf(engine);

  engine.decide("first", {
    subject,
    since: sinceOf(engine),
    outcome: "retry",
    feedback: "Use fewer words.",
  });
  await engine.advance("first");

  const received = join(directory, "received");
  const input = JSON.parse(await readFile(join(received, "input.json"), "utf8"));

  const [decision] = input.inputs.decision;

  assert.equal(input.inputs.decision.length, 1);
  assert.partialDeepStrictEqual(decision, { kind: "decision", body: `decision/${decision.hash}` });

  assert.deepEqual(engine.artifact(decision.hash), {
    kind: "decision",
    fields: { outcome: "retry", subject },
    body: "Use fewer words.",
  });

  assert.equal(
    await readFile(join(received, "decision", decision.hash), "utf8"),
    "Use fewer words.",
  );
});

test("a step that declares the decision receives none before the owner decides", async (t) => {
  const { engine, directory } = await engineReceiving(
    t,
    { decision: { kind: "decision", about: "subject", take: "latest" } },
    `cp "$MEDRENGARD_IN"/* "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  await engine.advance("first");

  const input = JSON.parse(await readFile(join(directory, "received", "input.json"), "utf8"));

  assert.deepEqual(input.inputs, { decision: [] });
});

test("a decision about an earlier subject is history, not about the current one", async (t) => {
  const limits = { idle: 1, attempt: 5, transcript: 65536, input: 65536 };

  const { engine, directory } = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "review",
      steps: {
        review: { kind: "approval", on: { approve: "build" } },
        build: {
          kind: "command",
          claims,
          workspace: "empty",
          inputs: {},
          run: [
            "sh",
            "-c",
            `printf 'Do it.' > "$MEDRENGARD_OUT/plan.md"
             echo '${JSON.stringify(planAt("plan.md"))}' > "$MEDRENGARD_OUT/output.json"`,
          ],
          on: { done: "read" },
          access,
          budget: 1,
          limits,
        },
        read: {
          kind: "command",
          claims,
          workspace: "empty",
          inputs: {
            current: { kind: "decision", about: "subject" },
            history: { kind: "decision", about: "earlier" },
          },
          run: [
            "sh",
            "-c",
            `cp "$MEDRENGARD_IN/input.json" "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            "sh",
            directory,
          ],
          on: { done: "end" },
          access,
          budget: 1,
          limits,
        },
      },
    }),
  );

  engine.decide("first", {
    subject: subjectOf(engine),
    since: sinceOf(engine),
    outcome: "approve",
    feedback: "Plan it.",
  });
  await engine.advance("first");

  const input = JSON.parse(await readFile(join(directory, "input.json"), "utf8"));

  assert.deepEqual(input.inputs.current, []);
  assert.equal(input.inputs.history.length, 1);

  assert.partialDeepStrictEqual(engine.artifact(input.inputs.history[0].hash), {
    kind: "decision",
    fields: { outcome: "approve" },
    body: "Plan it.",
  });
});

test("a step that queries a step's latest artifact receives it after the subject moved on", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "design",
      steps: {
        design: stepRunning(
          `printf 'Do it.' > "$MEDRENGARD_OUT/plan.md"
           echo '${JSON.stringify(planAt("plan.md"))}' > "$MEDRENGARD_OUT/output.json"`,
          "develop",
        ),
        develop: stepRunning(committing, "review"),
        review: {
          ...stepRunning(
            `cp -r "$MEDRENGARD_IN"/* "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            "end",
            [directory],
          ),
          inputs: { plan: { from: ["design"], take: "latest" } },
        },
      },
    }),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });

  const input = JSON.parse(await readFile(join(directory, "input.json"), "utf8"));

  const [plan] = input.inputs.plan;

  assert.equal(input.inputs.plan.length, 1);

  assert.deepEqual(engine.artifact(plan.hash), {
    kind: "document",
    fields: { title: "Plan" },
    body: "Do it.",
  });

  assert.equal(await readFile(join(directory, "plan", plan.hash), "utf8"), "Do it.");
});

test("a step that declares the request receives it after the subject moved on", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "design",
      steps: {
        design: stepRunning(
          `printf 'Do it.' > "$MEDRENGARD_OUT/plan.md"
           echo '${JSON.stringify(planAt("plan.md"))}' > "$MEDRENGARD_OUT/output.json"`,
          "develop",
        ),
        develop: {
          ...stepRunning(
            `cp -r "$MEDRENGARD_IN"/* "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            "end",
            [directory],
          ),
          inputs: { request: "request" },
        },
      },
    }),
  );

  const request = subjectOf(engine);

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });

  const input = JSON.parse(await readFile(join(directory, "input.json"), "utf8"));

  assert.deepEqual(
    input.inputs.request.map(({ hash }: { hash: string }) => hash),
    [request],
  );

  assert.equal(await readFile(join(directory, "request", request), "utf8"), "Say hello.");
});

test("a step that queries all of a step's artifacts receives each, oldest first", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "design",
      steps: {
        design: stepRunning(
          `echo started >> "$1"; wc -l < "$1" > "$MEDRENGARD_OUT/plan.md"
           echo '${JSON.stringify(planAt("plan.md"))}' > "$MEDRENGARD_OUT/output.json"`,
          "review",
          [join(directory, "started")],
        ),
        review: { kind: "approval", on: { changes: "design", approve: "read" } },
        read: {
          ...stepRunning(
            `cp -r "$MEDRENGARD_IN"/* "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            "end",
            [join(directory, "received")],
          ),
          inputs: { plans: { from: ["design"], take: "all" } },
        },
      },
    }),
  );

  await mkdir(join(directory, "received"));
  await engine.advance("first");
  const first = subjectOf(engine);
  engine.decide("first", { subject: first, since: sinceOf(engine), outcome: "changes" });
  await engine.advance("first");
  const second = subjectOf(engine);
  engine.decide("first", { subject: second, since: sinceOf(engine), outcome: "approve" });
  await engine.advance("first");

  const received = join(directory, "received");
  const input = JSON.parse(await readFile(join(received, "input.json"), "utf8"));

  assert.deepEqual(input.inputs, {
    plans: [
      { hash: first, kind: "document", fields: { title: "Plan" }, body: `plans/${first}` },
      { hash: second, kind: "document", fields: { title: "Plan" }, body: `plans/${second}` },
    ],
  });

  assert.equal(await readFile(join(received, "plans", first), "utf8"), "1\n");
  assert.equal(await readFile(join(received, "plans", second), "utf8"), "2\n");
});

test("a step that queries a kind receives only artifacts of that kind", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "design",
      steps: {
        design: stepRunning(
          `printf 'Do it.' > "$MEDRENGARD_OUT/plan.md"
           echo '${JSON.stringify(planAt("plan.md"))}' > "$MEDRENGARD_OUT/output.json"`,
          "develop",
        ),
        develop: stepRunning(committing, "read"),
        read: {
          ...stepRunning(
            `cp "$MEDRENGARD_IN/input.json" "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            "review",
            [directory],
          ),
          inputs: { commits: { kind: "commit" } },
        },
        review: { kind: "approval", on: { approve: "end" } },
      },
    }),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "awaiting" });

  const input = JSON.parse(await readFile(join(directory, "input.json"), "utf8"));

  assert.deepEqual(
    input.inputs.commits.map(({ hash }: { hash: string }) => hash),
    [subjectOf(engine)],
  );
});

test("an agent step runs its harness adapter, which is given the agent", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "plan",
      steps: {
        plan: {
          kind: "agent",
          claims,
          workspace: "empty",
          agent: {
            harness: {
              run: [
                "sh",
                "-c",
                `cp "$MEDRENGARD_IN/input.json" "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
                "sh",
                directory,
              ],
            },
            model: "a-model",
            prompt: "Plan the change.",
          },
          inputs: {},
          on: { done: "end" },
          access,
          budget: 1,
          limits: { idle: 1, attempt: 5, transcript: 65536, input: 65536 },
        },
      },
    }),
  );

  assert.equal(engine.state("first").status, "ready");

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });

  assert.partialDeepStrictEqual(JSON.parse(await readFile(join(directory, "input.json"), "utf8")), {
    step: "plan",
    agent: { model: "a-model", prompt: "Plan the change." },
  });
});

/**
 * An agent step, attended unless `attended` says otherwise, whose harness runs `script` and that
 * ends on `done`, with the given limits.
 */
function agentStep(
  script: string,
  attended = true,
  limits: Partial<Record<"idle" | "attempt", number | "unbounded">> = {},
) {
  return {
    kind: "agent",
    attended,
    claims,
    workspace: "empty",
    agent: { harness: { run: ["sh", "-c", script] }, model: "a-model", prompt: "Plan with me." },
    inputs: {},
    on: { done: "end" },
    access,
    budget: 1,
    limits: { idle: 1, attempt: 5, transcript: 65536, input: 65536, ...limits },
  } as const;
}

test("an attended step is left ready for the owner to attend: advance starts nothing", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({ start: "plan", steps: { plan: agentStep("exit 3") } }),
  );

  const ready = await engine.advance("first");

  assert.partialDeepStrictEqual(ready, {
    status: "ready",
    step: { name: "plan", kind: "agent", attended: true },
  });
  assert.deepEqual(engine.state("first"), ready);
  assert.deepEqual(
    engine.record("first").entries.map(({ entry }) => entry),
    [],
  );
});

test("an unattended agent step's state does not say it is attended", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({ start: "plan", steps: { plan: agentStep("exit 3", false) } }),
  );

  const state = engine.state("first");

  assert.deepEqual(state.status === "ready" ? state.step : undefined, {
    name: "plan",
    kind: "agent",
  });
});

test("a command step cannot be attended", async (t) => {
  await assert.rejects(
    engineWith(t, () =>
      defineWorkflow({
        start: "build",
        // SAFETY: the workflow module is the owner's JavaScript, which the type cannot hold to.
        steps: { build: { ...stepRunning("true", "end"), attended: true } as never },
      }),
    ),
    {
      message:
        "Workflow build is invalid: step build does not have exactly the fields a command step defines.",
    },
  );
});

for (const limit of ["idle", "attempt"] as const) {
  test(`only an attended step's ${limit} limit may be unbounded`, async (t) => {
    await assert.rejects(
      engineWith(t, () =>
        defineWorkflow({
          start: "plan",
          steps: { plan: agentStep("true", false, { [limit]: "unbounded" }) },
        }),
      ),
      {
        message: `Workflow build is invalid: step plan's ${limit} limit may be unbounded only for an attended step.`,
      },
    );

    const { engine } = await engineWith(t, () =>
      defineWorkflow({
        start: "plan",
        steps: { plan: agentStep("true", true, { [limit]: "unbounded" }) },
      }),
    );

    assert.equal(engine.state("first").status, "ready");
  });
}

test("the factory's default idle limit cannot be unbounded", async (t) => {
  await assert.rejects(
    engineWith(
      t,
      () => defineWorkflow({ start: "plan", steps: { plan: agentStep("true") } }),
      undefined,
      { ...defaultLimits, idle: "unbounded" },
    ),
    {
      message:
        "The factory's default limits are invalid: idle limit may be unbounded only for an attended step.",
    },
  );
});

test("an observer reads every commission's events after a position, in the order written", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({
      start: "build",
      steps: {
        build: stepRunning(`echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`, "end"),
      },
    }),
  );

  engine.commission("build", "second", { title: "Greet", body: "Say hello." });
  await engine.advance("first");

  const all = engine.events(0);

  assert.deepEqual(
    all.map(({ commission, event }) => [commission, event.type]),
    [
      ["first", "commissioned"],
      ["second", "commissioned"],
      ["first", "attempt-started"],
      ["first", "attempt-completed"],
    ],
  );
  assert.deepEqual(
    all.map(({ position }) => position),
    [1, 2, 3, 4],
  );
  assert.deepEqual(engine.events(2), all.slice(2));
  assert.deepEqual(engine.events(4), []);
});

test("an observer is woken by the next event any engine on the log writes", async (t) => {
  const { engine, options } = await engineWith(t, () =>
    defineWorkflow({ start: "build", steps: { build: stepRunning("true", "end") } }),
  );

  const woken = engine.next(1);
  let early = false;

  void woken.then(() => {
    early = true;
  });

  await sleep(200);
  assert.equal(early, false);

  createEngine(options).commission("build", "second", { title: "Greet", body: "Say hello." });

  assert.deepEqual(
    (await woken).map(({ commission, event }) => [commission, event.type]),
    [["second", "commissioned"]],
  );

  // An event already after the position wakes it at once; an abort, with none.
  assert.equal((await engine.next(0)).length, 2);

  const aborting = new AbortController();
  const waiting = engine.next(2, { signal: aborting.signal });

  aborting.abort();
  assert.deepEqual(await waiting, []);
});

/** Writes a skill named `name` in `directory`, each of `files` at its relative path. */
function skillAt(directory: string, name: string, files: Readonly<Record<string, string>>) {
  const skill = join(directory, "skills", name);

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(skill, path)), { recursive: true });
    writeFileSync(join(skill, path), text);
  }

  return skill;
}

/**
 * An agent step whose harness copies its whole input to `$1`, the directory `received`, and
 * claims `done`; its agent declares `skills`, and its input limit is `input` bytes.
 */
function agentWithSkills(
  directory: string,
  skills: readonly string[],
  input = 65536,
  prompt = "Plan the change.",
) {
  return defineWorkflow({
    start: "plan",
    steps: {
      plan: {
        kind: "agent",
        claims,
        workspace: "empty",
        agent: {
          harness: {
            run: [
              "sh",
              "-c",
              `cp -r "$MEDRENGARD_IN/." "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
              "sh",
              join(directory, "received"),
            ],
          },
          model: "a-model",
          prompt,
          skills,
        },
        inputs: {},
        on: { done: "end" },
        access,
        budget: 1,
        limits: { idle: 5, attempt: 10, transcript: 65536, input },
      },
    },
  });
}

test("an agent step is given its agent's skills as they were when the commission started", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) =>
    agentWithSkills(directory, [
      skillAt(directory, "tdd", { "SKILL.md": "Test first.\n", "scripts/red.sh": "exit 1\n" }),
    ]),
  );

  await writeFile(join(directory, "skills", "tdd", "SKILL.md"), "Edited after the commission.\n");

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });

  const received = join(directory, "received");
  const input = JSON.parse(await readFile(join(received, "input.json"), "utf8"));

  assert.deepEqual(input.agent.skills, [{ name: "tdd", path: ".skills/tdd" }]);
  assert.equal(await readFile(join(received, ".skills/tdd/SKILL.md"), "utf8"), "Test first.\n");
  assert.equal(await readFile(join(received, ".skills/tdd/scripts/red.sh"), "utf8"), "exit 1\n");
});

test("an agent whose skill has no SKILL.md cannot be commissioned", async (t) => {
  let skill = "";

  await assert.rejects(
    engineWith(t, (directory) => {
      skill = skillAt(directory, "tdd", { "README.md": "Test first.\n" });

      return agentWithSkills(directory, [skill]);
    }),
    (error: Error) => {
      assert.equal(
        error.message,
        `Workflow build is invalid: step plan's agent's skill ${skill} has no SKILL.md.`,
      );

      return true;
    },
  );
});

test("an agent with two skills of the same name cannot be commissioned", async (t) => {
  await assert.rejects(
    engineWith(t, (directory) =>
      agentWithSkills(directory, [
        skillAt(directory, "tdd", { "SKILL.md": "Test first.\n" }),
        skillAt(join(directory, "other"), "tdd", { "SKILL.md": "Test last.\n" }),
      ]),
    ),
    { message: "Workflow build is invalid: step plan's agent has two skills named tdd." },
  );
});

test("an agent step whose skills are over its input limit escalates without starting", async (t) => {
  const { engine } = await engineWith(t, (directory) =>
    agentWithSkills(directory, [skillAt(directory, "tdd", { "SKILL.md": "x".repeat(100) })], 64),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "limit",
    reason: "Step plan's inputs, prompt and skills are 116 bytes, over its input limit of 64.",
  });
});

test("an agent step whose prompt is over its input limit escalates without starting", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) =>
    agentWithSkills(directory, [], 64, "x".repeat(100)),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "limit",
    reason: "Step plan's inputs and prompt are 100 bytes, over its input limit of 64.",
  });
  await assert.rejects(readFile(join(directory, "received", "input.json")), { code: "ENOENT" });
});

test("a claimed commit at the workspace HEAD becomes the subject", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({
      start: "build",
      steps: {
        build: stepRunning(committing, "review"),
        review: { kind: "approval", on: { approve: "end" } },
      },
    }),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "awaiting" });

  const commit = engine.artifact(subjectOf(engine));

  assert.equal(commit.kind, "commit");
  assert.match(commit.fields.sha, /^[0-9a-f]{40}$/);
});

test("a claimed commit with a report keeps the report as its body", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({
      start: "build",
      steps: {
        build: stepRunning(`${committing}${reporting("printf 'Ran the tests.'")}`, "review"),
        review: { kind: "approval", on: { approve: "end" } },
      },
    }),
  );

  await engine.advance("first");

  const commit = engine.artifact(subjectOf(engine));

  assert.deepEqual(commit, {
    kind: "commit",
    fields: { sha: commit.fields.sha },
    body: "Ran the tests.",
  });
});

test("a claimed commit report over its size limit escalates", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({
      start: "build",
      steps: {
        build: stepRunning(`${committing}${reporting("head -c 1048577 /dev/zero")}`, "end"),
      },
    }),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "claim",
    reason: 'Step build claimed a body over its limit of 1048576 bytes: "report.md".',
  });
});

test("a claimed commit that is not the workspace HEAD escalates", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({
      start: "build",
      steps: {
        build: stepRunning(`claimed=${"0".repeat(40)}; ${committing}`, "end"),
      },
    }),
  );

  const state = await engine.advance("first");

  assert.equal(state.status, "escalated");
  assert.match(
    state.reason,
    /^Step build claimed a commit its verifier rejected: HEAD is [0-9a-f]{40}, not 0{40}\.$/,
  );
});

test("a claimed commit that is already the subject escalates", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({
      start: "build",
      steps: {
        build: stepRunning(committing, "rebuild"),
        rebuild: stepRunning(committing, "end"),
      },
    }),
  );

  const state = await engine.advance("first");

  assert.partialDeepStrictEqual(state, { status: "escalated", step: { name: "rebuild" } });
  assert.match(
    state.status === "escalated" ? state.reason : "",
    /^Step rebuild claimed a commit its verifier rejected: [0-9a-f]{40} is already the subject\.$/,
  );
});

test("a claimed commit that changes nothing from its parent escalates", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({
      start: "build",
      steps: {
        build: stepRunning(
          `${committing}
           git -c user.name=Test -c user.email=test@example.com -c commit.gpgsign=false \\
             commit -q --no-verify --allow-empty -m Nothing
           sha=$(git rev-parse HEAD)
           echo "{\\"outcome\\":\\"done\\",\\"artifacts\\":[{\\"kind\\":\\"commit\\",\\"fields\\":{\\"sha\\":\\"$sha\\"}}]}" \\
             > "$MEDRENGARD_OUT/output.json"`,
          "end",
        ),
      },
    }),
  );

  const state = await engine.advance("first");

  assert.equal(state.status, "escalated");
  assert.match(
    state.reason,
    /^Step build claimed a commit its verifier rejected: [0-9a-f]{40} changes nothing: its tree is its parent's\.$/,
  );
});

test("a claimed commit with the same tree as the subject escalates", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({
      start: "build",
      steps: {
        build: stepRunning(committing, "fix"),
        // Rewords the subject: a new SHA for the same files.
        fix: {
          ...stepRunning(
            `git -c user.name=Test -c user.email=test@example.com -c commit.gpgsign=false \\
               commit -q --no-verify --amend -m Reworded
             sha=$(git rev-parse HEAD)
             echo "{\\"outcome\\":\\"done\\",\\"artifacts\\":[{\\"kind\\":\\"commit\\",\\"fields\\":{\\"sha\\":\\"$sha\\"}}]}" \\
               > "$MEDRENGARD_OUT/output.json"`,
            "end",
          ),
          workspace: "subject",
        },
      },
    }),
  );

  const state = await engine.advance("first");

  assert.partialDeepStrictEqual(state, {
    status: "escalated",
    step: { name: "fix" },
  });
  assert.match(
    state.status === "escalated" ? state.reason : "",
    /^Step fix claimed a commit its verifier rejected: [0-9a-f]{40} changes nothing: its tree is the subject's\.$/,
  );
});

// A subject kind of a factory's own that names a commit by its sha, as a start a workflow is given
// can: the verifier compares a claimed commit with it as with a commit subject.
const starting = () =>
  ({
    ...builtIn,
    start: { ...builtIn.commit, description: "The commit a workflow starts from." },
  }) satisfies Kinds;

const claimingStart = committing.replace('\\"kind\\":\\"commit\\"', '\\"kind\\":\\"start\\"');

test("a claimed commit that is already the subject escalates when the subject is another kind naming a sha", async (t) => {
  const { engine } = await engineWith(
    t,
    () =>
      defineWorkflow({
        start: "seed",
        steps: {
          seed: { ...stepRunning(claimingStart, "build"), claims: ["start"] },
          // Claims the start it was given as its own work.
          build: {
            ...stepRunning(
              `sha=$(git rev-parse HEAD)
               echo "{\\"outcome\\":\\"done\\",\\"artifacts\\":[{\\"kind\\":\\"commit\\",\\"fields\\":{\\"sha\\":\\"$sha\\"}}]}" \\
                 > "$MEDRENGARD_OUT/output.json"`,
              "end",
            ),
            workspace: "subject",
          },
        },
      }),
    starting,
  );

  const state = await engine.advance("first");

  assert.partialDeepStrictEqual(state, { status: "escalated", step: { name: "build" } });
  assert.match(
    state.status === "escalated" ? state.reason : "",
    /^Step build claimed a commit its verifier rejected: [0-9a-f]{40} is already the subject\.$/,
  );
});

test("a claimed commit with the same tree as a subject of another kind naming a sha escalates", async (t) => {
  const { engine } = await engineWith(
    t,
    () =>
      defineWorkflow({
        start: "seed",
        steps: {
          seed: { ...stepRunning(claimingStart, "build"), claims: ["start"] },
          // Rewords the start: a new SHA for the same files.
          build: {
            ...stepRunning(
              `git -c user.name=Test -c user.email=test@example.com -c commit.gpgsign=false \\
                 commit -q --no-verify --amend -m Reworded
               sha=$(git rev-parse HEAD)
               echo "{\\"outcome\\":\\"done\\",\\"artifacts\\":[{\\"kind\\":\\"commit\\",\\"fields\\":{\\"sha\\":\\"$sha\\"}}]}" \\
                 > "$MEDRENGARD_OUT/output.json"`,
              "end",
            ),
            workspace: "subject",
          },
        },
      }),
    starting,
  );

  const state = await engine.advance("first");

  assert.partialDeepStrictEqual(state, { status: "escalated", step: { name: "build" } });
  assert.match(
    state.status === "escalated" ? state.reason : "",
    /^Step build claimed a commit its verifier rejected: [0-9a-f]{40} changes nothing: its tree is the subject's\.$/,
  );
});

for (const [planted, plant] of [
  ["a graft", 'mkdir -p .git/info; echo "$sha $changed" > .git/info/grafts'],
  ["a replace ref", 'git replace "$sha" "$changed"'],
] as const) {
  test(`a claimed commit that changes nothing escalates when ${planted} disguises it`, async (t) => {
    const { engine } = await engineWith(t, () =>
      defineWorkflow({
        start: "build",
        steps: {
          // An empty commit on Plan, whose planted view has a changed commit as its parent or
          // stands in for it.
          build: stepRunning(
            `${committing}
             printf 'Do it well.\\n' > plan.txt
             git -c user.name=Test -c user.email=test@example.com -c commit.gpgsign=false \\
               commit -q --no-verify -am Again
             changed=$(git rev-parse HEAD)
             git checkout -q --detach HEAD~1
             git -c user.name=Test -c user.email=test@example.com -c commit.gpgsign=false \\
               commit -q --no-verify --allow-empty -m Nothing
             sha=$(git rev-parse HEAD)
             ${plant}
             echo "{\\"outcome\\":\\"done\\",\\"artifacts\\":[{\\"kind\\":\\"commit\\",\\"fields\\":{\\"sha\\":\\"$sha\\"}}]}" \\
               > "$MEDRENGARD_OUT/output.json"`,
            "end",
          ),
        },
      }),
    );

    const state = await engine.advance("first");

    assert.equal(state.status, "escalated");
    assert.match(
      state.reason,
      /^Step build claimed a commit its verifier rejected: [0-9a-f]{40} changes nothing: its tree is its parent's\.$/,
    );
  });
}

test("a claimed commit whose history a shallow boundary cuts escalates", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({
      start: "build",
      steps: {
        build: stepRunning(
          `${committing}
           printf 'Do it well.\\n' > plan.txt
           git -c user.name=Test -c user.email=test@example.com -c commit.gpgsign=false \\
             commit -q --no-verify -am Again
           git rev-parse HEAD > .git/shallow
           sha=$(git rev-parse HEAD)
           echo "{\\"outcome\\":\\"done\\",\\"artifacts\\":[{\\"kind\\":\\"commit\\",\\"fields\\":{\\"sha\\":\\"$sha\\"}}]}" \\
             > "$MEDRENGARD_OUT/output.json"`,
          "end",
        ),
      },
    }),
  );

  const state = await engine.advance("first");

  assert.equal(state.status, "escalated");
  assert.match(
    state.reason,
    /^Step build claimed a commit its verifier rejected: [0-9a-f]{40}'s history is incomplete in the workspace\.$/,
  );
});

test("a claimed commit that is not a SHA escalates", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({
      start: "build",
      steps: { build: stepRunning(`claimed=main; ${committing}`, "end") },
    }),
  );

  const state = await engine.advance("first");

  assert.equal(state.status, "escalated");
  assert.match(
    state.reason,
    /^Step build claimed a commit its verifier rejected: HEAD is [0-9a-f]{40}, not main\.$/,
  );
});

/** A claim of the verdict `verdict`, as outcome too, with `summary` and the findings at `body`. */
function verdictOf(verdict: string, summary: string, body: string) {
  return {
    outcome: verdict,
    artifacts: [{ kind: "verdict", fields: { verdict, summary }, body }],
  };
}

test("a claim of a verdict that routes it and of a new subject escalates, and records neither", async (t) => {
  const claim = {
    outcome: "pass",
    artifacts: [
      { kind: "document", fields: { title: "Plan" }, body: "plan.md" },
      { kind: "verdict", fields: { verdict: "pass" } },
    ],
  };

  const { engine } = await engineWith(t, () =>
    defineWorkflow({
      start: "build",
      steps: {
        build: {
          ...stepRunning(
            `echo plan > "$MEDRENGARD_OUT/plan.md"
             echo '${JSON.stringify(claim)}' > "$MEDRENGARD_OUT/output.json"`,
            "end",
          ),
          claims: ["document", "verdict"],
          on: { pass: "end", fail: "end" },
        },
      },
    }),
  );

  const request = subjectOf(engine);

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    subject: request,
    cause: "claim",
    reason:
      "Step build claimed a verdict, whose verdict routes its outcome, with a new subject: the verdict would be about the subject its claim replaces.",
  });
  assert.partialDeepStrictEqual(engine.record("first").entries, [{ entry: "attempt", attempt: 1 }]);
  assert.ok(engine.record("first").entries.every((entry) => !("artifacts" in entry)));
});

/**
 * Starts an engine whose `develop` step commits, then whose `check` step writes `findings` and
 * claims `claim`, leading on pass or fail to `read`, which copies its input into the directory
 * `received` and leads to the approval step `review`. `read` is given the subject and the evidence.
 */
async function engineJudging(t: TestContext, claim: Claim, findings = "") {
  const started = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "develop",
      steps: {
        develop: stepRunning(committing, "check"),
        check: {
          ...stepRunning(
            `printf '${findings}' > "$MEDRENGARD_OUT/findings.md"
             echo '${JSON.stringify(claim)}' > "$MEDRENGARD_OUT/output.json"`,
            "read",
          ),
          claims: ["verdict"],
          on: { pass: "read", fail: "read" },
        },
        read: {
          ...stepRunning(
            `cp -r "$MEDRENGARD_IN"/* "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            "review",
            [join(directory, "received")],
          ),
          inputs: { subject: "subject", evidence: { kind: "verdict", about: "subject" } },
        },
        review: { kind: "approval", on: { approve: "end" } },
      },
    }),
  );

  await mkdir(join(started.directory, "received"));

  return started;
}

test("a claimed verdict is about the subject, which it leaves unchanged", async (t) => {
  const { engine, directory } = await engineJudging(
    t,
    verdictOf("fail", "Two tests fail.", "findings.md"),
    "plan.txt is wrong.",
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "awaiting" });

  const subject = subjectOf(engine);
  const received = join(directory, "received");
  const input = JSON.parse(await readFile(join(received, "input.json"), "utf8"));

  assert.equal(engine.artifact(subject).kind, "commit");
  assert.equal(input.inputs.subject[0].hash, subject);
  assert.equal(input.inputs.evidence.length, 1);

  assert.deepEqual(engine.artifact(input.inputs.evidence[0].hash), {
    kind: "verdict",
    fields: { verdict: "fail", summary: "Two tests fail.", subject },
    body: "plan.txt is wrong.",
  });
});

test("a claimed pass verdict without findings is recorded without a body", async (t) => {
  const { engine, directory } = await engineJudging(t, {
    outcome: "pass",
    artifacts: [{ kind: "verdict", fields: { verdict: "pass" } }],
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "awaiting" });

  const input = JSON.parse(await readFile(join(directory, "received", "input.json"), "utf8"));

  assert.deepEqual(engine.artifact(input.inputs.evidence[0].hash), {
    kind: "verdict",
    fields: { verdict: "pass", subject: subjectOf(engine) },
  });
});

test("a claimed verdict that is not the outcome escalates", async (t) => {
  const { engine } = await engineJudging(t, {
    ...verdictOf("fail", "Two tests fail.", "findings.md"),
    outcome: "pass",
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "check" },
    cause: "claim",
    reason: "Step check claimed a verdict whose verdict is fail, not its outcome pass.",
  });
});

test("a claimed verdict that names its own subject escalates", async (t) => {
  const { engine } = await engineJudging(t, {
    outcome: "pass",
    artifacts: [{ kind: "verdict", fields: { verdict: "pass", subject: "0".repeat(64) } }],
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "check" },
    cause: "claim",
    reason: 'Step check claimed a verdict with fields its kind does not define: ["subject"].',
  });
});

test("a claimed verdict that is not pass or fail escalates", async (t) => {
  const { engine } = await engineJudging(t, {
    outcome: "pass",
    artifacts: [{ kind: "verdict", fields: { verdict: "maybe" } }],
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "claim",
    reason: "Step check claimed a verdict verdict that is not one of pass, fail.",
  });
});

test("a claimed verdict summary over its size limit escalates", async (t) => {
  const { engine } = await engineJudging(t, verdictOf("pass", "x".repeat(201), "findings.md"));

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "check" },
    cause: "claim",
    reason: "Step check claimed a verdict summary over its limit of 200 bytes.",
  });
});

test("after a fix, the verdict on the replaced commit is history, not evidence", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "develop",
      steps: {
        develop: stepRunning(committing, "check"),
        // Fails the first time it runs and passes after.
        check: {
          ...stepRunning(
            `if [ -e "$1" ]; then v=pass; else v=fail; touch "$1"; fi
             echo "{\\"outcome\\":\\"$v\\",\\"artifacts\\":[{\\"kind\\":\\"verdict\\",\\"fields\\":{\\"verdict\\":\\"$v\\"}}]}" \\
               > "$MEDRENGARD_OUT/output.json"`,
            "read",
            [join(directory, "failed")],
          ),
          claims: ["verdict"],
          on: { pass: "read", fail: "fix" },
          budget: 2,
        },
        fix: {
          ...stepRunning(
            `printf 'Do it well.\\n' > plan.txt
             git -c user.name=Test -c user.email=test@example.com -c commit.gpgsign=false \\
               commit -q --no-verify -am Fix
             echo "{\\"outcome\\":\\"done\\",\\"artifacts\\":[{\\"kind\\":\\"commit\\",\\"fields\\":{\\"sha\\":\\"$(git rev-parse HEAD)\\"}}]}" \\
               > "$MEDRENGARD_OUT/output.json"`,
            "check",
          ),
          workspace: "subject",
        },
        read: {
          ...stepRunning(
            `cp "$MEDRENGARD_IN/input.json" "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            "review",
            [directory],
          ),
          inputs: {
            evidence: { kind: "verdict", about: "subject" },
            history: { kind: "verdict", about: "earlier" },
          },
        },
        review: { kind: "approval", on: { approve: "end" } },
      },
    }),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "awaiting" });

  const subject = subjectOf(engine);
  const input = JSON.parse(await readFile(join(directory, "input.json"), "utf8"));
  const [evidence] = input.inputs.evidence;
  const [history] = input.inputs.history;

  assert.equal(input.inputs.evidence.length, 1);
  assert.equal(input.inputs.history.length, 1);

  assert.deepEqual(engine.artifact(evidence.hash).fields, { verdict: "pass", subject });

  const replaced = engine.artifact(history.hash);

  assert.ok(replaced.kind === "verdict");
  assert.equal(replaced.fields.verdict, "fail");
  assert.notEqual(replaced.fields.subject, subject);
  assert.equal(engine.artifact(replaced.fields.subject).kind, "commit");
});

test("a step whose workspace is a commit subject works in its checkout", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "build",
      steps: {
        build: stepRunning(committing, "check"),
        check: {
          ...stepRunning(
            `{ cat plan.txt; git rev-parse HEAD; git status --porcelain; } > "$1"
             echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            "review",
            [join(directory, "seen")],
          ),
          workspace: "subject",
        },
        review: { kind: "approval", on: { approve: "end" } },
      },
    }),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "awaiting" });

  const commit = engine.artifact(subjectOf(engine));

  assert.equal(commit.kind, "commit");
  assert.equal(await readFile(join(directory, "seen"), "utf8"), `Do it.\n${commit.fields.sha}\n`);
});

test("a step whose workspace is an input's commit works in its checkout, whatever the subject", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "build",
      steps: {
        build: stepRunning(committing, "plan"),
        // The plan replaces the commit as the subject.
        plan: stepRunning(
          `printf 'Then this.' > "$MEDRENGARD_OUT/plan.md"
           echo '${JSON.stringify(planAt("plan.md"))}' > "$MEDRENGARD_OUT/output.json"`,
          "check",
        ),
        check: {
          ...stepRunning(
            `{ cat plan.txt; git rev-parse HEAD; } > "$1"
             echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            "review",
            [join(directory, "seen")],
          ),
          inputs: { base: { from: ["build"], kind: "commit", take: "latest" } },
          workspace: { input: "base" },
        },
        review: { kind: "approval", on: { approve: "end" } },
      },
    }),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "awaiting" });
  assert.equal(engine.artifact(subjectOf(engine)).kind, "document");

  const [commit] = engine
    .record("first")
    .entries.flatMap((entry) => ("artifacts" in entry ? entry.artifacts : []))
    .filter(({ artifact }) => artifact.kind === "commit");

  assert.ok(commit?.artifact.kind === "commit");
  assert.equal(
    await readFile(join(directory, "seen"), "utf8"),
    `Do it.\n${commit.artifact.fields.sha}\n`,
  );
});

test("a step whose workspace input holds no artifact escalates without starting", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({
      start: "check",
      steps: {
        check: {
          ...stepRunning("true", "end"),
          inputs: { base: { kind: "commit", take: "latest" } },
          workspace: { input: "base" },
        },
      },
    }),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "inputs",
    reason: "Step check's workspace input base holds no artifact.",
  });
  assert.ok(engine.record("first").entries.every((entry) => entry.entry !== "attempt"));
});

test("a step whose workspace is a document subject finds its body there", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "read",
      steps: {
        read: {
          ...stepRunning(
            `cp document "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            "end",
            [join(directory, "seen")],
          ),
          workspace: "subject",
        },
      },
    }),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
  assert.equal(await readFile(join(directory, "seen"), "utf8"), "Say hello.");
});

test("a commission runs on the workflow definition it started with", async (t) => {
  const { options } = await engineRunning(
    t,
    `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  const { build } = options.workflows;

  const edited = createEngine({
    ...options,
    workflows: {
      build: defineWorkflow({
        start: "build",
        steps: {
          build: { ...build.steps.build, on: { done: "review" } },
          review: { kind: "approval", on: { approve: "end" } },
        },
      }),
    },
  });

  assert.partialDeepStrictEqual(await edited.advance("first"), { status: "finished", by: "end" });
});

// A command step that names only the limits in `limits` and claims done once it has run `script`.
function stepLimited(script: string, limits?: Partial<Limits>) {
  const { limits: _named, ...step } = stepRunning(
    `${script}
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    "end",
  );

  return limits === undefined ? step : { ...step, limits };
}

test("a step that names no limits has the factory's", async (t) => {
  const { engine } = await engineWith(
    t,
    () => defineWorkflow({ start: "build", steps: { build: stepLimited("seq 100") } }),
    undefined,
    { ...defaultLimits, transcript: 16 },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "limit",
    reason: "Step build wrote more than its transcript limit of 16 bytes.",
  });
});

test("a step that names some limits has the factory's for the rest", async (t) => {
  const { engine } = await engineWith(
    t,
    () =>
      defineWorkflow({
        start: "build",
        steps: { build: stepLimited("seq 100", { transcript: 65536 }) },
      }),
    undefined,
    { ...defaultLimits, transcript: 16, attempt: 0.2 },
  );

  // The step's own transcript limit holds; its attempt limit is the factory's.
  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "finished",
    by: "end",
  });

  const { engine: slow } = await engineWith(
    t,
    () =>
      defineWorkflow({
        start: "build",
        steps: { build: stepLimited("sleep 2", { transcript: 65536 }) },
      }),
    undefined,
    { ...defaultLimits, transcript: 16, attempt: 0.2 },
  );

  assert.partialDeepStrictEqual(await slow.advance("first"), {
    status: "escalated",
    cause: "limit",
    reason: "Step build reached its attempt limit of 0.2 s.",
  });
});

test("a commission runs on the factory's limits it started with", async (t) => {
  const { options } = await engineWith(
    t,
    () => defineWorkflow({ start: "build", steps: { build: stepLimited("seq 100") } }),
    undefined,
    { ...defaultLimits, transcript: 16 },
  );

  const changed = createEngine({ ...options, defaults: { limits: defaultLimits } });

  assert.partialDeepStrictEqual(await changed.advance("first"), {
    status: "escalated",
    cause: "limit",
    reason: "Step build wrote more than its transcript limit of 16 bytes.",
  });
});

test("a commission's definition is the one it was commissioned with, each step's limits whole", async (t) => {
  const limits = { ...defaultLimits, transcript: 16 };

  const { options } = await engineWith(
    t,
    () => defineWorkflow({ start: "build", steps: { build: stepLimited("true", { idle: 2 }) } }),
    undefined,
    limits,
  );

  // Expected from the options themselves, as JSON holds them: the factory changed since.
  const { start, steps } = options.workflows.build;

  const recorded = JSON.parse(
    JSON.stringify({
      workflow: { start, steps: { build: { ...steps.build, limits: { ...limits, idle: 2 } } } },
      kinds: options.kinds,
      skills: {},
    }),
  );

  const changed = createEngine({ ...options, defaults: { limits: defaultLimits } });

  assert.deepEqual(changed.definition("first"), recorded);
  assert.throws(() => changed.definition("second"), {
    message: "There is no commission named second.",
  });
});

test("a factory whose default limits leave one out cannot commission", async (t) => {
  const { disk: _left, ...limits } = defaultLimits;

  await assert.rejects(
    engineWith(
      t,
      () => defineWorkflow({ start: "build", steps: { build: stepLimited("true") } }),
      undefined,
      // SAFETY: the factory module is the owner's JavaScript, which the type cannot hold to.
      limits as Limits,
    ),
    {
      message:
        "The factory's default limits are invalid: they must be idle, attempt, transcript, input, memory, processes and disk.",
    },
  );
});

test("a step that names a limit there is not cannot be commissioned", async (t) => {
  await assert.rejects(
    engineWith(t, () =>
      defineWorkflow({
        start: "build",
        // SAFETY: the workflow module is the owner's JavaScript, which the type cannot hold to.
        steps: { build: stepLimited("true", { cpu: 1 } as Partial<Limits>) },
      }),
    ),
    {
      message:
        "Workflow build is invalid: step build's limits may be only idle, attempt, transcript, input, memory, processes, disk and usd.",
    },
  );
});

test("a workflow whose budget is not a positive integer cannot be commissioned", async (t) => {
  await assert.rejects(
    engineWith(t, () =>
      defineWorkflow({
        start: "build",
        steps: { build: { ...stepRunning("true", "end"), budget: 0 } },
      }),
    ),
    { message: "Workflow build is invalid: step build's budget must be a positive integer." },
  );
});

test("a workflow whose input queries a step it does not have cannot be commissioned", async (t) => {
  await assert.rejects(
    engineWith(t, () =>
      defineWorkflow<string>({
        start: "build",
        steps: { build: { ...stepRunning("true", "end"), inputs: { plan: { from: ["design"] } } } },
      }),
    ),
    {
      message:
        "Workflow build is invalid: step build's inputs must each be subject, request, a query whose from names its steps, kind a kind, about subject, earlier or any, and take latest or all, a session of one of its steps that runs a program, a children step's children, a kind and any take, or across origin, started or siblings, with any from naming steps, kind and take.",
    },
  );
});

test("a workflow whose input queries a kind there is not cannot be commissioned", async (t) => {
  await assert.rejects(
    engineWith(t, () =>
      defineWorkflow({
        start: "build",
        steps: { build: { ...stepRunning("true", "end"), inputs: { plans: { kind: "plan" } } } },
      }),
    ),
    {
      message:
        "Workflow build is invalid: step build's inputs must each be subject, request, a query whose from names its steps, kind a kind, about subject, earlier or any, and take latest or all, a session of one of its steps that runs a program, a children step's children, a kind and any take, or across origin, started or siblings, with any from naming steps, kind and take.",
    },
  );
});

for (const [what, query] of [
  ["a field a query does not define", { kind: "document", limit: 3 }],
  ["a take a query does not define", { kind: "document", take: "first" }],
  ["an about a query does not define", { kind: "verdict", about: "later" }],
] as const) {
  test(`a workflow whose input names ${what} cannot be commissioned`, async (t) => {
    await assert.rejects(
      engineWith(t, () =>
        defineWorkflow({
          start: "build",
          // Through JSON, as a factory's module reaches the parser, since its type refuses the query.
          steps: {
            build: {
              ...stepRunning("true", "end"),
              inputs: { plans: JSON.parse(JSON.stringify(query)) },
            },
          },
        }),
      ),
      {
        message:
          "Workflow build is invalid: step build's inputs must each be subject, request, a query whose from names its steps, kind a kind, about subject, earlier or any, and take latest or all, a session of one of its steps that runs a program, a children step's children, a kind and any take, or across origin, started or siblings, with any from naming steps, kind and take.",
      },
    );
  });
}

for (const [what, inputs] of [
  ["it does not declare", {}],
  ["that may hold more than one artifact", { base: { kind: "commit" } }],
] as const) {
  test(`a workflow whose workspace names an input ${what} cannot be commissioned`, async (t) => {
    await assert.rejects(
      engineWith(t, () =>
        defineWorkflow({
          start: "build",
          steps: { build: { ...stepRunning("true", "end"), inputs, workspace: { input: "base" } } },
        }),
      ),
      {
        message:
          "Workflow build is invalid: step build's workspace must be subject, empty, or one of its inputs that names at most one artifact of this commission's: subject, request or a query that takes the latest.",
      },
    );
  });
}

test("a workspace adds the artifacts of an input over the record as branches named by position", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "develop",
      steps: {
        develop: stepRunning(committing, "read"),
        read: {
          ...stepRunning(
            `git for-each-ref --format='%(refname)' > "$1/refs"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            "review",
            [directory],
          ),
          inputs: { base: "subject", commits: { kind: "commit" } },
          workspace: { input: "base", branches: "commits" },
        },
        review: { kind: "approval", on: { approve: "end" } },
      },
    }),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "awaiting" });
  assert.equal(await readFile(join(directory, "refs"), "utf8"), "refs/heads/commits-1\n");
});

test("a workflow whose workspace adds branches without a base cannot be commissioned", async (t) => {
  await assert.rejects(
    engineWith(t, () =>
      defineWorkflow({
        start: "build",
        steps: {
          build: {
            ...stepRunning("true", "end"),
            inputs: { built: { kind: "commit" } },
            workspace: JSON.parse('{"branches":"built"}'),
          },
        },
      }),
    ),
    {
      message:
        "Workflow build is invalid: step build's workspace must be subject, empty, or one of its inputs that names at most one artifact of this commission's: subject, request or a query that takes the latest.",
    },
  );
});

for (const [what, inputs] of [
  ["it does not declare", { base: "subject" }],
  ["that is a session", { base: "subject", built: { session: "build" } }],
] as const) {
  test(`a workflow whose workspace adds branches from an input ${what} cannot be commissioned`, async (t) => {
    await assert.rejects(
      engineWith(t, () =>
        defineWorkflow({
          start: "build",
          steps: {
            build: {
              ...stepRunning("true", "end"),
              inputs,
              workspace: { input: "base", branches: "built" },
            },
          },
        }),
      ),
      {
        message:
          "Workflow build is invalid: step build's workspace branches must name one of its inputs that names artifacts of this commission's or its children's.",
      },
    );
  });
}

test("a workflow whose workspace adds every commit of each child as branches cannot be commissioned", async (t) => {
  await assert.rejects(
    engineWith(t, () =>
      defineWorkflow({
        start: "fan",
        steps: {
          fan: {
            kind: "children",
            workflow: "build",
            count: 1,
            width: 1,
            concurrent: 1,
            wait: "all",
            on: { done: "build" },
            budget: 1,
            limits: { wait: 60 },
          },
          build: {
            ...stepRunning("true", "end"),
            inputs: { base: "subject", built: { children: "fan", kind: "commit", take: "all" } },
            workspace: { input: "base", branches: "built" },
          },
        },
      }),
    ),
    {
      message:
        "Workflow build is invalid: step build's workspace branches cannot take all of each child's artifacts, since a child's branch holds one.",
    },
  );
});

test("a workflow whose workspace may add branches of a kind whose materialiser cannot add them cannot be commissioned", async (t) => {
  await assert.rejects(
    engineWith(t, () =>
      defineWorkflow({
        start: "build",
        steps: {
          build: {
            ...stepRunning("true", "end"),
            inputs: { base: "subject", built: { kind: "document" } },
            workspace: { input: "base", branches: "built" },
          },
        },
      }),
    ),
    {
      message:
        "Workflow build is invalid: step build's workspace may add branches of a document, whose kind's materialiser cannot add them.",
    },
  );
});

test("a workflow with a step that has no outcomes cannot be commissioned", async (t) => {
  await assert.rejects(
    engineWith(t, () =>
      defineWorkflow({
        start: "build",
        steps: { build: stepRunning("true", "gate"), gate: { kind: "approval", on: {} } },
      }),
    ),
    { message: "Workflow build is invalid: step gate has no outcomes." },
  );

  await assert.rejects(
    engineWith(t, () =>
      defineWorkflow({
        start: "build",
        steps: { build: { ...stepRunning("true", "end"), on: {} } },
      }),
    ),
    { message: "Workflow build is invalid: step build has no outcomes." },
  );
});

test("a workflow whose step may claim an outcome it has no edge for cannot be commissioned", async (t) => {
  await assert.rejects(
    engineWith(t, () =>
      defineWorkflow({
        start: "build",
        steps: {
          build: { ...stepRunning("true", "end"), claims: ["verdict"], on: { pass: "end" } },
        },
      }),
    ),
    {
      message:
        "Workflow build is invalid: step build may claim a verdict whose verdict is fail, an outcome it has no edge for.",
    },
  );
});

for (const [what, workspace, inputs, kind] of [
  [
    "an input of a kind",
    { input: "base" },
    { base: { kind: "verdict", take: "latest" } },
    "verdict",
  ],
  [
    "an input from an approval",
    { input: "base" },
    { base: { from: ["gate"], take: "latest" } },
    "decision",
  ],
  ["the subject, which may be a kind", "subject", {}, "draft"],
] as const) {
  test(`a workflow whose workspace is built from ${what} without a materialiser cannot be commissioned`, async (t) => {
    await assert.rejects(
      engineWith(
        t,
        () =>
          defineWorkflow({
            start: "write",
            steps: {
              write: { ...stepRunning("true", "gate"), claims: ["draft"] },
              gate: { kind: "approval", on: { approve: "build" } },
              build: { ...stepRunning("true", "end"), inputs, workspace },
            },
          }),
        () => ({ ...builtIn, draft: { ...builtIn.document, materialiser: undefined } }),
      ),
      {
        message: `Workflow build is invalid: step build's workspace may be built from a ${kind}, whose kind has no materialiser.`,
      },
    );
  });
}

test("a workflow whose input name is not a plain file name cannot be commissioned", async (t) => {
  await assert.rejects(
    engineWith(t, () =>
      defineWorkflow({
        start: "build",
        steps: { build: { ...stepRunning("true", "end"), inputs: { "../plan": "request" } } },
      }),
    ),
    {
      message:
        "Workflow build is invalid: step build's input names must each be letters, digits, - or _, starting with a letter.",
    },
  );
});

test("a workflow whose step claims a kind a step may not claim cannot be commissioned", async (t) => {
  for (const kind of ["memo", "decision"]) {
    await assert.rejects(
      engineWith(t, () =>
        defineWorkflow({
          start: "build",
          steps: { build: { ...stepRunning("true", "end"), claims: [kind] } },
        }),
      ),
      {
        message:
          "Workflow build is invalid: step build's claims must each be a kind a step may claim: document, commit, verdict.",
      },
    );
  }
});

test("a workflow whose limit is not positive cannot be commissioned", async (t) => {
  await assert.rejects(
    engineWith(t, () =>
      defineWorkflow({
        start: "build",
        steps: {
          build: {
            ...stepRunning("true", "end"),
            limits: { idle: 0, attempt: 5, transcript: 65536, input: 65536 },
          },
        },
      }),
    ),
    {
      message:
        "Workflow build is invalid: step build's idle limit must be a positive number of seconds, at most 2147483.",
    },
  );
});

test("a commission whose command step leads to an approval step awaits the owner", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({
      start: "build",
      steps: {
        build: {
          kind: "command",
          claims,
          workspace: "empty",
          inputs: {},
          run: ["sh", "-c", `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`],
          on: { done: "review" },
          access,
          budget: 1,
          limits: { idle: 1, attempt: 5, transcript: 65536, input: 65536 },
        },
        review: { kind: "approval", on: { approve: "end" } },
      },
    }),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "awaiting",
    step: { name: "review" },
  });
});

test("a step that exits non-zero escalates its commission", async (t) => {
  const { engine } = await engineRunning(
    t,
    `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"; exit 3`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "exit",
    reason: "Step build exited with code 3.",
  });
});

test("a step that exits 0 without output.json escalates its commission", async (t) => {
  const { engine } = await engineRunning(t, "true");

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "claim",
    reason: "Step build exited 0 without a readable output.json.",
  });
});

test("a step that claims an undeclared outcome escalates its commission", async (t) => {
  const { engine } = await engineRunning(
    t,
    `echo '{"outcome":"shipped"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "claim",
    reason: 'Step build claimed an outcome it does not declare: "shipped".',
  });
});

test("an escalation reason over 4096 bytes is cut on a character boundary, saying so", async (t) => {
  // Each "é" is two bytes, so a cut at an odd byte would split one.
  const outcome = "é".repeat(5000);
  const full = `Step build claimed an outcome it does not declare: "${outcome}".`;
  const marker = ` … (cut to 4096 of ${Buffer.byteLength(full)} bytes)`;

  const { engine } = await engineRunning(
    t,
    `echo '{"outcome":"${outcome}"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  const state = await engine.advance("first");

  assert.ok(state.status === "escalated");
  assert.ok(state.reason.endsWith(marker), state.reason.slice(-80));
  assert.ok(full.startsWith(state.reason.slice(0, -marker.length)));
  assert.ok(Buffer.byteLength(state.reason) <= 4096 && Buffer.byteLength(state.reason) > 4092);
});

test("a step whose program cannot start escalates its commission", async (t) => {
  const { directory, options } = await engineRunning(t, "true");
  const { build } = options.workflows;
  const missing = { ...build.steps.build, run: [join(directory, "missing")] as const };

  const engine = createEngine({
    ...options,
    workflows: { build: { ...build, steps: { build: missing } } },
  });

  engine.commission("build", "second", { title: "Greet", body: "Say hello." });

  // bwrap starts, then cannot start the program, so the reason is in the transcript.
  assert.partialDeepStrictEqual(await engine.advance("second"), {
    status: "escalated",
    step: { name: "build" },
    cause: "exit",
    reason: "Step build exited with code 1.",
  });
  assert.match(engine.transcript("second", 1).toString(), /execvp .*missing: No such file/);
});

test("a step that has spent its budget escalates instead of starting again", async (t) => {
  const { engine, directory } = await engineRunning(t, claimingAgain);

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "budget",
    reason: "Step build has spent its budget of 2 attempts.",
  });
  assert.equal(await readFile(join(directory, "started"), "utf8"), "started\nstarted\n");
});

test("a step attempted again on the same subject and inputs escalates instead", async (t) => {
  const { engine, directory } = await engineRunning(
    t,
    `echo started >> "$1"; echo '{"outcome":"again"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "repeat",
    reason: "Step build was already attempted on this subject and these inputs.",
  });
  assert.equal(await readFile(join(directory, "started"), "utf8"), "started\n");
});

test("a completed attempt keeps its stdout and stderr as its transcript", async (t) => {
  const { engine } = await engineRunning(
    t,
    `echo hello; sleep 0.1; echo oops >&2
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  await engine.advance("first");

  assert.equal(engine.transcript("first", 1).toString(), "hello\noops\n");
});

test("an escalated attempt keeps its transcript", async (t) => {
  const { engine } = await engineRunning(t, "echo failing; exit 3");

  await engine.advance("first");

  assert.equal(engine.transcript("first", 1).toString(), "failing\n");
});

test("a step that writes past its transcript limit is stopped and escalates", async (t) => {
  const { engine } = await engineRunning(t, "head -c 2000 /dev/zero; sleep 5", {
    idle: 5,
    attempt: 10,
    transcript: 1000,
    input: 65536,
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "limit",
    reason: "Step build wrote more than its transcript limit of 1000 bytes.",
  });
  assert.equal(engine.transcript("first", 1).length, 1000);
});

test("a step whose inputs are over its input limit escalates without starting", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({
      start: "build",
      steps: {
        build: {
          ...stepRunning("true", "end"),
          inputs: { request: "request" },
          limits: { idle: 5, attempt: 10, transcript: 65536, input: 9 },
        },
      },
    }),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "limit",
    reason: "Step build's inputs are 10 bytes, over its input limit of 9.",
  });

  // An attempt that started would have a transcript, even an empty one.
  assert.throws(() => engine.transcript("first", 1));
});

test("a step that is idle for its idle limit is stopped and escalates", async (t) => {
  const { engine } = await engineRunning(t, "sleep 5");

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "limit",
    reason: "Step build was idle for 1 s.",
  });
});

test("a step that keeps writing output runs past its idle limit", async (t) => {
  const { engine } = await engineRunning(
    t,
    `for tick in 1 2 3 4; do echo "$tick"; sleep 0.5; done
    echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
});

test("a step that runs for its attempt limit is stopped and escalates", async (t) => {
  const { engine } = await engineRunning(t, "while true; do echo tick; sleep 0.2; done", {
    idle: 1,
    attempt: 1,
    transcript: 65536,
    input: 65536,
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    cause: "limit",
    reason: "Step build reached its attempt limit of 1 s.",
  });
});

test("a stopped step has its grace period between SIGTERM and SIGKILL", async (t) => {
  const { engine, directory } = await engineRunning(
    t,
    `trap 'sleep 0.5; echo stopped gracefully > "$1"; exit 0' TERM
     while true; do echo tick; sleep 0.1; done`,
    { idle: 5, attempt: 1, transcript: 65536, input: 65536 },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "escalated" });
  assert.equal(await readFile(join(directory, "started"), "utf8"), "stopped gracefully\n");
});

test("two engines advancing one ready commission at once run its step once", async (t) => {
  const { engine, directory, options } = await engineRunning(
    t,
    `echo started >> "$1"; sleep 0.5; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  // Each in a process of its own, both released at the same moment, so both may read the
  // commission ready; whichever loses, the log takes one attempt-started.
  const racing = join(directory, "racing.ts");
  const at = Date.now() + 1000;

  await writeFile(
    racing,
    `import { createEngine } from ${JSON.stringify(join(import.meta.dirname, "engine.ts"))};
    const engine = createEngine(${JSON.stringify(options)});
    while (Date.now() < ${at});
    await engine.advance("first").catch(() => {});`,
  );

  const racers = [1, 2].map(() => spawn(process.execPath, [racing], { stdio: "ignore" }));

  await Promise.all(racers.map((racer) => once(racer, "exit")));

  assert.equal(await readFile(join(directory, "started"), "utf8"), "started\n");
  assert.equal(
    engine.record("first").entries.filter((entry) => entry.entry === "attempt").length,
    1,
  );
});

test("an attempt held by a live engine is left attempting", async (t) => {
  const { engine, directory, options } = await engineRunning(
    t,
    `echo started >> "$1"; sleep 1; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    { idle: 5, attempt: 5, transcript: 65536, input: 65536 },
  );

  const running = engine.advance("first");

  await untilStarted(directory);

  assert.partialDeepStrictEqual(await createEngine(options).advance("first"), {
    status: "attempting",
  });
  assert.partialDeepStrictEqual(await running, { status: "finished" });
});

test("an attempt started in an earlier boot escalates as interrupted, even if its pid and start time match a live process", async (t) => {
  const { engine, options } = await engineRunning(t, "exit 0");

  // A live process stands in for an engine of the earlier boot that had the same pid and start.
  const stand = spawn("sleep", ["30"], { stdio: "ignore" });

  t.after(() => stand.kill("SIGKILL"));

  const stat = await readFile(`/proc/${stand.pid}/stat`, "utf8");
  const start = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]);
  const database = new DatabaseSync(options.log);

  database.prepare("INSERT INTO events VALUES (?, 1, ?)").run(
    "first",
    JSON.stringify({
      type: "attempt-started",
      step: "build",
      attempt: 1,
      subject: subjectOf(engine),
      inputs: [],
      process: { pid: stand.pid, start, boot: "00000000-0000-0000-0000-000000000000" },
    }),
  );
  database.close();

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "interrupted",
    reason: "Step build was interrupted.",
  });
});

test("an engine that cannot read its own process in /proc refuses to start", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const script = join(directory, "start.ts");

  await writeFile(
    script,
    `import { createEngine } from ${JSON.stringify(join(import.meta.dirname, "engine.ts"))};
     createEngine({ log: ${JSON.stringify(join(directory, "log.sqlite"))}, kinds: {}, workflows: {} });`,
  );

  // An empty /proc, as a hidden or missing one would be.
  const { status, stderr } = spawnSync(
    "bwrap",
    [
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      "--tmpfs",
      "/proc",
      "--bind",
      directory,
      directory,
    ].concat(["--unshare-pid", process.execPath, script]),
    { encoding: "utf8" },
  );

  assert.notEqual(status, 0);
  assert.match(stderr, /The engine cannot identify its own process: /);
});

test(
  "an attempt whose engine process died escalates as interrupted",
  { timeout: 10_000 },
  async (t) => {
    const { engine, directory, options } = await engineRunning(
      t,
      `echo started >> "$1"; exec sleep 30`,
      {
        idle: 60,
        attempt: 60,
        transcript: 65536,
        input: 65536,
      },
    );

    const crashing = join(directory, "crashing.ts");

    await writeFile(
      crashing,
      `import { createEngine } from ${JSON.stringify(join(import.meta.dirname, "engine.ts"))};
    await createEngine(${JSON.stringify(options)}).advance("first");`,
    );

    const child = spawn(process.execPath, [crashing], { stdio: "ignore" });
    await untilStarted(directory);
    child.kill("SIGKILL");
    await once(child, "exit");

    assert.partialDeepStrictEqual(await engine.advance("first"), {
      status: "escalated",
      step: { name: "build" },
      cause: "interrupted",
      reason: "Step build was interrupted.",
    });
  },
);

test(
  "an interrupted attempt keeps what its step wrote before its engine died, and leaves no directory",
  { timeout: 10_000 },
  async (t) => {
    const { engine, directory, record, options } = await engineRunning(
      t,
      `echo "before the crash"; echo "on stderr" >&2; pwd > "$1.workspace"
       echo started >> "$1"; exec sleep 30`,
      { idle: 60, attempt: 60, transcript: 65536, input: 65536 },
    );

    const crashing = join(directory, "crashing.ts");

    await writeFile(
      crashing,
      `import { createEngine } from ${JSON.stringify(join(import.meta.dirname, "engine.ts"))};
    await createEngine(${JSON.stringify(options)}).advance("first");`,
    );

    const child = spawn(process.execPath, [crashing], { stdio: "ignore" });

    // Killed only once the engine has spooled both lines: what the step wrote but the engine had
    // not yet read from its pipe dies with the engine, and no spool could keep it.
    await untilStarted(directory);
    await untilSpooled(join(record, "attempts"), "before the crash\non stderr\n");
    child.kill("SIGKILL");
    await once(child, "exit");

    assert.partialDeepStrictEqual(await engine.advance("first"), {
      status: "escalated",
      cause: "interrupted",
      reason: "Step build was interrupted.",
    });
    assert.equal(engine.transcript("first", 1).toString(), "before the crash\non stderr\n");
    assert.equal(engine.errors("first", 1).toString(), "on stderr\n");

    // The step saw its workspace at /workspace; the attempt's directory beside the log is gone.
    assert.equal(
      (await readFile(join(directory, "started.workspace"), "utf8")).trim(),
      "/workspace",
    );
    assert.deepEqual(await readdir(join(record, "attempts")), []);
  },
);

test(
  "an interrupted attempt whose step locked directories in its work area leaves no directory",
  { timeout: 10_000 },
  async (t) => {
    const { engine, directory, record, options } = await engineRunning(
      t,
      `mkdir -p locked/inner && chmod 000 locked/inner locked
       echo started >> "$1"; exec sleep 30`,
      { idle: 60, attempt: 60, transcript: 65536, input: 65536 },
    );

    const crashing = join(directory, "crashing.ts");

    await writeFile(
      crashing,
      `import { createEngine } from ${JSON.stringify(join(import.meta.dirname, "engine.ts"))};
    await createEngine(${JSON.stringify(options)}).advance("first");`,
    );

    const child = spawn(process.execPath, [crashing], { stdio: "ignore" });

    await untilStarted(directory);
    child.kill("SIGKILL");
    await once(child, "exit");

    assert.partialDeepStrictEqual(await engine.advance("first"), {
      status: "escalated",
      cause: "interrupted",
      reason: "Step build was interrupted.",
    });
    assert.deepEqual(await readdir(join(record, "attempts")), []);
  },
);

test("an attempt that ends leaves nothing spooled", async (t) => {
  const { engine, record } = await engineRunning(
    t,
    `echo hello; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
  assert.equal(engine.transcript("first", 1).toString(), "hello\n");
  assert.deepEqual(await readdir(join(record, "attempts")), []);
});

test("a step whose access covers the log's directory finds it empty and cannot write there", async (t) => {
  // The test's access writes the whole temp directory, the log's included.
  const { engine, record } = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "build",
      steps: {
        // Only the attempt's own directories, under attempts, are there to see.
        build: stepRunning(
          `ls -A "$1" | grep -v '^attempts$'; touch "$1/forged" 2> /dev/null && echo forged
           echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
          "end",
          [join(directory, "record")],
        ),
      },
    }),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
  assert.equal(engine.transcript("first", 1).toString(), "");
  assert.ok(!(await readdir(record)).includes("forged"));
});

// A step's part in a test that changes the log or store while it runs, which the step cannot
// reach: it says it is ready in \`$1.ready\`, then waits for \`$1.go\`.
const handshake = `echo ready > "$1.ready"; until [ -e "$1.go" ]; do sleep 0.02; done`;

/** Waits for the step's handshake, does `change`, then lets the step go on. */
async function meddle(directory: string, change: () => Promise<void>): Promise<void> {
  await untilWritten(directory, "started.ready");
  await change();
  await writeFile(join(directory, "started.go"), "");
}

test("an engine error during an attempt escalates the commission, naming the error", async (t) => {
  // The store is made read-only while the step runs, so the engine fails to keep its transcript.
  const { engine, directory, record } = await engineRunning(
    t,
    `echo "a transcript of its own: $$"
     ${handshake}
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  const store = join(record, "store");
  const advancing = engine.advance("first");

  await meddle(directory, () => chmod(store, 0o555));

  const state = await advancing.finally(() => chmod(store, 0o755));

  assert.partialDeepStrictEqual(state, { status: "escalated", step: { name: "build" } });
  assert.ok(state.status === "escalated");
  assert.match(
    state.reason,
    /^Step build failed in the engine: EACCES: permission denied.*; its transcript could not be kept: EACCES: permission denied/,
  );
});

test("an engine error after a step ran keeps its transcript on the escalation", async (t) => {
  // The store cannot keep the claimed body, whose partial file is already a directory, but it
  // can keep the transcript.
  const body = "A plan the store cannot keep.";

  const { engine, record } = await engineRunning(
    t,
    `echo "a transcript of its own"; echo "and errors" >&2
     printf '${body}' > "$MEDRENGARD_OUT/plan.md"
     echo '${JSON.stringify(planAt("plan.md"))}' > "$MEDRENGARD_OUT/output.json"`,
  );

  const hash = createHash("sha256").update(body).digest("hex");

  await mkdir(join(record, "store", `${hash}.${process.pid}.partial`));

  const state = await engine.advance("first");

  assert.partialDeepStrictEqual(state, { status: "escalated", step: { name: "build" } });
  assert.ok(state.status === "escalated");
  assert.match(state.reason, /^Step build failed in the engine: EISDIR/);
  assert.equal(engine.transcript("first", 1).toString(), "a transcript of its own\nand errors\n");
  assert.equal(engine.errors("first", 1).toString(), "and errors\n");
  assert.deepEqual(await readdir(join(record, "attempts")), []);
});

test("an engine error while a step runs stops the step and escalates, naming the error", async (t) => {
  // The log's directory is made read-only while the step runs, so its note cannot be written;
  // stopped, the step waits until the directory is writable again, so the escalation can be.
  const { engine, directory, record } = await engineRunning(
    t,
    `trap 'echo stopped > "$1.stopped"; until [ -e "$1.restored" ]; do sleep 0.02; done; exit 0' TERM
     ${handshake}
     echo a note >&3
     sleep 5 & wait`,
    { idle: 5, attempt: 10, transcript: 65536, input: 65536 },
  );

  const advancing = engine.advance("first");

  await meddle(directory, () => chmod(record, 0o555));
  await untilWritten(directory, "started.stopped");
  await chmod(record, 0o755);
  await writeFile(join(directory, "started.restored"), "");

  const state = await advancing.finally(() => chmod(record, 0o755));

  assert.partialDeepStrictEqual(state, { status: "escalated", step: { name: "build" } });
  assert.ok(state.status === "escalated");
  assert.match(state.reason, /^Step build failed in the engine: /);
  assert.partialDeepStrictEqual(engine.record("first").entries, [{ entry: "attempt", notes: [] }]);
});

/** The store file of the request's body, which a test may make unreadable or change. */
async function requestBodyIn(record: string, engine: ReturnType<typeof createEngine>) {
  const store = join(record, "store");
  const { body } = JSON.parse(await readFile(join(store, subjectOf(engine)), "utf8"));

  return join(store, body);
}

test("an engine error while preparing a step escalates without starting an attempt", async (t) => {
  const { engine, record } = await engineReceiving(t, { request: "request" }, "exit 0");
  const body = await requestBodyIn(record, engine);

  await chmod(body, 0);

  const state = await engine.advance("first").finally(() => chmod(body, 0o644));

  assert.partialDeepStrictEqual(state, { status: "escalated", step: { name: "build" } });
  assert.ok(state.status === "escalated");
  assert.match(state.reason, /^The engine could not prepare step build: EACCES: permission denied/);
  assert.equal(
    engine.record("first").entries.filter((entry) => entry.entry === "attempt").length,
    0,
  );
});

test("a store file whose bytes no longer match its hash is refused, and the step is not given it", async (t) => {
  const { engine, record } = await engineReceiving(t, { request: "request" }, "exit 0");
  const body = await requestBodyIn(record, engine);
  const hash = body.slice(body.lastIndexOf("/") + 1);

  await writeFile(body, "Say goodbye.");

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "engine",
    reason: `The engine could not prepare step build: The store's file ${hash} does not match its hash.`,
  });
});

test("an attempt this engine stopped running without recording its end escalates at the next advance", async (t) => {
  // The log's directory is made read-only while the step runs, so neither the attempt's end nor
  // an escalation can be written.
  const { engine, directory, record } = await engineRunning(
    t,
    `${handshake}
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  const advancing = engine.advance("first");

  await meddle(directory, () => chmod(record, 0o555));
  await assert.rejects(advancing.finally(() => chmod(record, 0o755)));

  // The attempt is held by this process, which is alive but no longer running it.
  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "interrupted",
    reason: "Step build was interrupted.",
  });
});

test("an attempt cancelled from another engine is stopped and escalates", async (t) => {
  const { engine, directory, options } = await engineRunning(t, `echo started >> "$1"; sleep 30`, {
    idle: 60,
    attempt: 60,
    transcript: 65536,
    input: 65536,
  });

  const running = engine.advance("first");

  await untilStarted(directory);
  createEngine(options).cancel("first");

  assert.partialDeepStrictEqual(await running, {
    status: "escalated",
    step: { name: "build" },
    cause: "cancelled",
    reason: "Step build was cancelled by the owner.",
  });
});

test("a cancel made just before the step exits still escalates", async (t) => {
  // The step exits well within the second the engine takes to look for a cancel.
  const { engine, directory, options } = await engineRunning(
    t,
    `echo started >> "$1"; sleep 0.3; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    { idle: 5, attempt: 5, transcript: 65536, input: 65536 },
  );

  const running = engine.advance("first");

  await untilStarted(directory);
  createEngine(options).cancel("first");

  assert.partialDeepStrictEqual(await running, {
    status: "escalated",
    cause: "cancelled",
    reason: "Step build was cancelled by the owner.",
  });
});

/** Waits until the one attempt spooled under `attempts` has spooled `transcript`. */
async function untilSpooled(attempts: string, transcript: string): Promise<void> {
  for (;;) {
    const [attempt] = await readdir(attempts);

    const spooled =
      attempt === undefined
        ? ""
        : await readFile(join(attempts, attempt, "transcript"), "utf8").catch(() => "");

    if (spooled === transcript) {
      return;
    }

    await sleep(20);
  }
}

/** Waits until the file `name` in `directory` holds a line. */
async function untilWritten(directory: string, name: string): Promise<void> {
  while (!(await readFile(join(directory, name), "utf8").catch(() => "")).endsWith("\n")) {
    await sleep(20);
  }
}

// A kind's program that says it started, then would run for half a minute and say it finished.
const lingering = (file: string) =>
  `echo started >> "$1/${file}"; sleep 30; echo finished >> "$1/${file}"`;

test(
  "a cancel while a kind's verifier runs stops it and escalates",
  { timeout: 10_000 },
  async (t) => {
    const { engine, directory, options } = await engineVerifying(
      t,
      `${lingering("verifier")}; echo '{"accepted":true,"keep":[]}' > "$MEDRENGARD_OUT/output.json"`,
      { limit: 60 },
    );

    const running = engine.advance("first");

    await untilWritten(directory, "verifier");
    createEngine(options).cancel("first");

    assert.partialDeepStrictEqual(await running, {
      status: "escalated",
      cause: "cancelled",
      reason: "Step build was cancelled by the owner.",
    });
    assert.equal(await readFile(join(directory, "verifier"), "utf8"), "started\n");
  },
);

test(
  "a cancel while a kind's materialiser runs stops it, and the step never starts",
  { timeout: 10_000 },
  async (t) => {
    // The request is a document; this one's materialiser builds the step's workspace from it.
    const { engine, directory, options } = await engineWith(
      t,
      (directory) =>
        defineWorkflow({
          start: "build",
          steps: {
            build: {
              ...stepRunning('echo started >> "$1"', "end", [join(directory, "started")]),
              workspace: "subject",
            },
          },
        }),
      (directory) => ({
        ...builtIn,
        document: {
          ...builtIn.document,
          materialiser: {
            run: ["sh", "-c", lingering("materialiser"), "sh", directory],
            access,
            limit: 60,
            ...bounded,
          },
        },
      }),
    );

    const running = engine.advance("first");

    await untilWritten(directory, "materialiser");
    createEngine(options).cancel("first");

    assert.partialDeepStrictEqual(await running, {
      status: "escalated",
      cause: "cancelled",
      reason: "Step build was cancelled by the owner.",
    });
    assert.equal(await readFile(join(directory, "materialiser"), "utf8"), "started\n");
    await assert.rejects(readFile(join(directory, "started")), { code: "ENOENT" });
  },
);

/**
 * Starts an engine whose step `build` builds its workspace from the subject, the request, with a
 * document materialiser that runs `script` for at most `limit` seconds, its `$1` the test's
 * directory. The step writes `started` in that directory if it ever runs.
 */
function engineMaterialising(t: TestContext, script: string, limit = 5) {
  return engineWith(
    t,
    (directory) =>
      defineWorkflow({
        start: "build",
        steps: {
          build: {
            ...stepRunning('echo started >> "$1"', "end", [join(directory, "started")]),
            workspace: "subject",
          },
        },
      }),
    (directory) => ({
      ...builtIn,
      document: {
        ...builtIn.document,
        materialiser: { run: ["sh", "-c", script, "sh", directory], access, limit, ...bounded },
      },
    }),
  );
}

test("a kind's materialiser that fails escalates with its stderr, and the step never starts", async (t) => {
  const { engine, directory } = await engineMaterialising(t, "echo 'No room.' >&2; exit 1");

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "kind",
    reason:
      'The document materialiser failed for step build: it exited with code 1. Its stderr: "No room.\\n".',
  });
  await assert.rejects(readFile(join(directory, "started")), { code: "ENOENT" });
});

test("an attempt whose workspace could not be built records no transcript, since its step never ran", async (t) => {
  const { engine } = await engineMaterialising(t, "exit 1");

  await engine.advance("first");

  assert.throws(() => engine.transcript("first", 1), {
    message: "Commission first has no transcript for attempt 1.",
  });
  assert.partialDeepStrictEqual(engine.record("first").entries, [
    { entry: "attempt", attempt: 1, errors: false },
  ]);
});

test("a kind's materialiser past its limit is stopped and escalates", async (t) => {
  const { engine } = await engineMaterialising(t, "sleep 5", 1);

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "kind",
    reason: "The document materialiser failed for step build: it reached its limit of 1 s.",
  });
});

test("a kind's materialiser ended by a signal escalates, naming the signal", async (t) => {
  const { engine, directory } = await engineMaterialising(
    t,
    `echo started > "$1/materialising"; sleep 5`,
  );

  const advancing = engine.advance("first");

  await untilWritten(directory, "materialising");
  // From outside, as the owner or the system would: every process naming the test's directory.
  await once(spawn("pkill", ["-KILL", "-f", directory]), "close");

  assert.partialDeepStrictEqual(await advancing, {
    status: "escalated",
    cause: "kind",
    reason: "The document materialiser failed for step build: it was ended by SIGKILL.",
  });
});

test(
  "cancelling an attempt no engine is running escalates it at once",
  { timeout: 10_000 },
  async (t) => {
    const { engine, directory, record, options } = await engineRunning(
      t,
      `echo "before the crash"; echo started >> "$1"; exec sleep 30`,
      {
        idle: 60,
        attempt: 60,
        transcript: 65536,
        input: 65536,
      },
    );

    const crashing = join(directory, "crashing.ts");

    await writeFile(
      crashing,
      `import { createEngine } from ${JSON.stringify(join(import.meta.dirname, "engine.ts"))};
    await createEngine(${JSON.stringify(options)}).advance("first");`,
    );

    const child = spawn(process.execPath, [crashing], { stdio: "ignore" });

    // Killed only once the engine has spooled the line, which it could not keep unread.
    await untilStarted(directory);
    await untilSpooled(join(record, "attempts"), "before the crash\n");
    child.kill("SIGKILL");
    await once(child, "exit");

    engine.cancel("first");

    assert.partialDeepStrictEqual(engine.state("first"), {
      status: "escalated",
      cause: "cancelled",
      reason: "Step build was cancelled by the owner.",
    });
    assert.equal(engine.transcript("first", 1).toString(), "before the crash\n");
  },
);

/** Appends to `commission`'s log an event replay refuses, as a log damaged or from another engine. */
function damage(log: string, commission: string) {
  const database = new DatabaseSync(log);

  database
    .prepare("INSERT INTO events VALUES (?, 1, ?)")
    .run(commission, JSON.stringify({ type: "decided", step: "build", outcome: "done" }));
  database.close();
}

test("a commission that cannot be read is listed with its error, and the others with their states", async (t) => {
  const { engine, options } = await engineRunning(t, "exit 0");

  engine.commission("build", "broken", { title: "Greet", body: "Say hello." });
  damage(options.log, "broken");

  assert.deepEqual(
    engine.commissions().map((entry) => ("error" in entry ? entry : entry.commission)),
    [
      "first",
      {
        commission: "broken",
        error: "A decision cannot arrive while the commission is ready.",
      },
    ],
  );
});

test("a commission that was never started is refused by name", async (t) => {
  const { engine } = await engineRunning(t, "true");
  const refused = { message: "There is no commission named missing." };

  assert.throws(() => engine.state("missing"), refused);
  await assert.rejects(engine.advance("missing"), refused);
  assert.throws(
    () => engine.decide("missing", { subject: "a", since: 0, outcome: "retry" }),
    refused,
  );
  assert.throws(() => engine.cancel("missing"), refused);
  assert.throws(() => engine.transcript("missing", 1), refused);
});

test("a commission without an attempt in flight cannot be cancelled", async (t) => {
  const { engine } = await engineRunning(t, "true");

  assert.throws(() => engine.cancel("first"), {
    message: "Commission first is ready, so no attempt can be cancelled.",
  });
});

test("an approval decision leaves the commission ready at the next step", async (t) => {
  const { engine } = await engineAwaiting(t);

  assert.partialDeepStrictEqual(
    engine.decide("first", {
      subject: subjectOf(engine),
      since: sinceOf(engine),
      outcome: "approve",
    }),
    { status: "ready", step: { name: "build" } },
  );
});

test("a decision about a stale subject is refused and records nothing", async (t) => {
  const { engine } = await engineAwaiting(t);

  assert.throws(
    () => engine.decide("first", { subject: "stale", since: sinceOf(engine), outcome: "approve" }),
    {
      message: `Commission first is about ${subjectOf(engine)}, not stale.`,
    },
  );
  assert.partialDeepStrictEqual(engine.state("first"), { status: "awaiting" });
});

test("a decision made while the commission waited at one gate is refused at a later gate on the same subject", async (t) => {
  // As the change workflow's deviation and owner gates: both declare changes, and the check
  // between them claims no subject.
  const { engine } = await engineWith(t, () =>
    defineWorkflow({
      start: "deviation",
      steps: {
        deviation: { kind: "approval", on: { proceed: "end", changes: "check" } },
        check: {
          kind: "command",
          claims,
          workspace: "empty",
          inputs: {},
          run: ["sh", "-c", `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`],
          on: { done: "owner" },
          access,
          budget: 1,
          limits: { idle: 1, attempt: 5, transcript: 65536, input: 65536 },
        },
        owner: { kind: "approval", on: { accept: "end", changes: "check" } },
      },
    }),
  );

  // Commissioned at event 0, awaiting at deviation since then.
  const decision = { subject: subjectOf(engine), since: 0, outcome: "changes" };

  engine.decide("first", decision);

  // Decided (1), attempt started (2), attempt completed (3): awaiting at owner since event 3.
  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "awaiting",
    step: { name: "owner" },
    subject: decision.subject,
    since: 3,
  });
  assert.throws(() => engine.decide("first", decision), {
    message: "Commission first has waited since event 3, not 0.",
  });
  assert.partialDeepStrictEqual(engine.state("first"), { status: "awaiting", since: 3 });
});

test("a retry made at one escalation is refused at a later escalation of the same step", async (t) => {
  const { engine } = await engineRunning(t, "exit 1");

  // Commissioned (0), attempt started (1), escalated (2).
  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "escalated", since: 2 });

  const retry = { subject: subjectOf(engine), since: 2, outcome: "retry" };

  engine.decide("first", retry);

  // Decided (3), attempt started (4), escalated (5).
  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "escalated", since: 5 });
  assert.throws(() => engine.decide("first", retry), {
    message: "Commission first has waited since event 5, not 2.",
  });
});

test("a decision with an undeclared outcome is refused and records nothing", async (t) => {
  const { engine } = await engineAwaiting(t);

  assert.throws(
    () =>
      engine.decide("first", {
        subject: subjectOf(engine),
        since: sinceOf(engine),
        outcome: "ship",
      }),
    {
      message: 'Step review does not declare outcome "ship".',
    },
  );
  assert.partialDeepStrictEqual(engine.state("first"), { status: "awaiting" });
});

test("a decision whose feedback is over 1 MiB is refused and records nothing", async (t) => {
  const { engine } = await engineAwaiting(t);

  assert.throws(
    () =>
      engine.decide("first", {
        subject: subjectOf(engine),
        since: sinceOf(engine),
        outcome: "approve",
        feedback: "a".repeat(1024 * 1024 + 1),
      }),
    { message: "The feedback is 1048577 bytes, over its limit of 1048576." },
  );
  assert.partialDeepStrictEqual(engine.state("first"), { status: "awaiting" });
});

test("a retry renews the budget of the escalated step", async (t) => {
  const { engine, directory } = await engineRunning(t, claimingAgain);

  await engine.advance("first");
  engine.decide("first", { subject: subjectOf(engine), since: sinceOf(engine), outcome: "retry" });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "budget",
    reason: "Step build has spent its budget of 2 attempts.",
  });
  assert.equal(await readFile(join(directory, "started"), "utf8"), "started\n".repeat(4));
});

test("an abandon decision finishes the escalated commission as abandoned", async (t) => {
  const { engine } = await engineRunning(t, "exit 1");

  await engine.advance("first");

  assert.partialDeepStrictEqual(
    engine.decide("first", {
      subject: subjectOf(engine),
      since: sinceOf(engine),
      outcome: "abandon",
    }),
    { status: "finished", by: "abandoned" },
  );
});

test("an abandon decision at an approval step finishes the commission as abandoned", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({
      start: "gate",
      steps: {
        gate: { kind: "approval", on: { approve: "build" } },
        build: stepRunning("true", "end"),
      },
    }),
  );

  assert.partialDeepStrictEqual(
    engine.decide("first", {
      subject: subjectOf(engine),
      since: sinceOf(engine),
      outcome: "abandon",
    }),
    { status: "finished", by: "abandoned" },
  );
});

test("an approval step whose edge leads to the end finishes the commission by the end", async (t) => {
  const { engine } = await engineWith(t, () =>
    defineWorkflow({ start: "gate", steps: { gate: { kind: "approval", on: { reject: "end" } } } }),
  );

  assert.partialDeepStrictEqual(
    engine.decide("first", {
      subject: subjectOf(engine),
      since: sinceOf(engine),
      outcome: "reject",
    }),
    { status: "finished", by: "end" },
  );
});

test("a workflow whose approval step declares abandon cannot be commissioned", async (t) => {
  await assert.rejects(
    engineWith(t, () =>
      defineWorkflow({
        start: "gate",
        steps: { gate: { kind: "approval", on: { abandon: "end" } } },
      }),
    ),
    {
      message:
        "Workflow build is invalid: step gate cannot declare abandon, which the owner may decide at every wait.",
    },
  );
});

test("an advance whose signal aborts finishes the running attempt and starts no other", async (t) => {
  const { engine, directory } = await engineRunning(t, `${claimingAgain}; sleep 0.3`);
  const stop = new AbortController();
  const advancing = engine.advance("first", { signal: stop.signal });

  while ((await readFile(join(directory, "started"), "utf8").catch(() => "")) === "") {
    await sleep(20);
  }

  stop.abort();

  assert.partialDeepStrictEqual(await advancing, { status: "ready", step: { name: "build" } });
  assert.equal(await readFile(join(directory, "started"), "utf8"), "started\n");
});

test("an artifact the log does not name is refused by its hash", async (t) => {
  const { engine, options } = await engineRunning(t, "true");

  // The definition is in the store, but it is not an artifact.
  const first = new DatabaseSync(options.log)
    .prepare("SELECT event FROM events WHERE position = 0")
    .get()!;

  const { definition } = JSON.parse(String(first.event));

  for (const hash of ["missing", "../log.sqlite", definition]) {
    assert.throws(() => engine.artifact(hash), { message: `There is no artifact ${hash}.` });
  }
});

// The memory and processes a test's kind program may use: as many as the built-ins'.
const bounded = { memory: 4 * 1024 * 1024 * 1024, processes: 1024 };

/** A judgement kind of the factory's own: a required note of at most 20 bytes and an optional body. */
const memo: Kind = {
  role: "judgement",
  description: "A memo.",
  fields: { note: { limit: 20, required: true } },
  body: { required: false, limit: 100 },
};

/** What a step writes to claim a memo. */
type MemoClaim = { kind: "memo"; fields: { note: string }; body?: string };

/** A claim of `done` with a memo whose note is `note`, and whose body, if any, is memo.md. */
function memoClaim(note: string, body?: string) {
  const claimed: MemoClaim = { kind: "memo", fields: { note } };

  if (body !== undefined) {
    claimed.body = body;
  }

  return `echo '${JSON.stringify({ outcome: "done", artifacts: [claimed] })}' > "$MEDRENGARD_OUT/output.json"`;
}

/**
 * Starts an engine with the kinds `kinds`, whose step `build` claims memos by running `script`
 * and leads to `read`, which copies its input.json, with every memo, into the returned directory.
 */
function engineWithMemos(t: TestContext, kinds: Kinds, script: string) {
  return engineWith(
    t,
    (directory) =>
      defineWorkflow({
        start: "build",
        steps: {
          build: { ...stepRunning(script, "read"), claims: ["memo"] },
          read: {
            ...stepRunning(
              `cp "$MEDRENGARD_IN/input.json" "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
              "review",
              [directory],
            ),
            inputs: { memos: { kind: "memo" } },
          },
          review: { kind: "approval", on: { approve: "end" } },
        },
      }),
    () => kinds,
  );
}

test("a kind the factory defines can be claimed, and a query of it receives the claim", async (t) => {
  const { engine, directory } = await engineWithMemos(
    t,
    { ...builtIn, memo },
    memoClaim("Looks fine."),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "awaiting" });

  const input = JSON.parse(await readFile(join(directory, "input.json"), "utf8"));

  assert.deepEqual(
    input.inputs.memos.map(({ kind, fields }: { kind: string; fields: object }) => ({
      kind,
      fields,
    })),
    [{ kind: "memo", fields: { note: "Looks fine.", subject: subjectOf(engine) } }],
  );
});

test("a commission runs on the kinds it started with after the factory edits one", async (t) => {
  const { options } = await engineWithMemos(t, { ...builtIn, memo }, memoClaim("Looks fine."));

  // The same factory, its memo's note now at most 1 byte, so the claim would be over it.
  const edited = createEngine({
    ...options,
    kinds: { ...builtIn, memo: { ...memo, fields: { note: { limit: 1, required: true } } } },
  });

  assert.partialDeepStrictEqual(await edited.advance("first"), { status: "awaiting" });
});

test("a request the factory's document kind refuses is not commissioned", async (t) => {
  // "Greet" and "Say hello." fit, so the helper's own commission passes.
  const { engine } = await engineWith(
    t,
    () => defineWorkflow({ start: "build", steps: { build: stepRunning("true", "end") } }),
    () => ({
      ...builtIn,
      document: {
        ...builtIn.document,
        fields: { title: { limit: 5, required: true, values: ["Greet", "Plan", "Planning"] } },
        body: { required: true, limit: 10 },
      },
    }),
  );

  const refused: [{ title: string; body: string }, string][] = [
    [{ title: "Planning", body: "Hi." }, "The request's title is over its limit of 5 bytes."],
    [{ title: "Hello", body: "Hi." }, "The request's title is not one of Greet, Plan, Planning."],
    [
      { title: "Plan", body: "Say hello now." },
      "The request's body is over its limit of 10 bytes.",
    ],
  ];

  for (const [request, message] of refused) {
    assert.throws(() => engine.commission("build", "second", request), { message });
    assert.throws(() => engine.state("second"), {
      message: "There is no commission named second.",
    });
  }
});

test("kinds the engine cannot rely on cannot be commissioned", async (t) => {
  const { document } = builtIn;

  const refused: [object, string][] = [
    [
      { memo },
      "The kinds are invalid: they must include document, the kind of the owner's request.",
    ],
    [
      { document, decision: memo },
      "The kinds are invalid: decision is the owner's, so no kind can be named decision.",
    ],
    [
      { document, "a memo": memo },
      'The kinds are invalid: "a memo" is not letters, digits or -, starting with a letter.',
    ],
    [
      { document, memo: { ...memo, role: "note" } },
      "Kind memo is invalid: its role must be subject or judgement.",
    ],
    [
      { document, memo: { ...memo, colour: "red" } },
      "Kind memo is invalid: it does not have exactly the fields a kind defines.",
    ],
    [
      { document, memo: { ...memo, description: 1 } },
      "Kind memo is invalid: its description must be text.",
    ],
    [
      { document, memo: { ...memo, fields: { note: { limit: 0 } } } },
      "Kind memo is invalid: field note's limit must be a positive integer.",
    ],
    [
      { document, memo: { ...memo, fields: { note: { limit: 9, values: "a" } } } },
      "Kind memo is invalid: field note's values must be a list of text.",
    ],
    [
      { document, memo: { ...memo, fields: { note: { limit: 9, required: false } } } },
      "Kind memo is invalid: field note may only be required: true.",
    ],
    [
      { document, memo: { ...memo, fields: { subject: { limit: 64 } } } },
      "Kind memo is invalid: the engine names a judgement's subject, so it cannot define a subject field.",
    ],
    [
      { document, memo: { ...memo, body: { required: true } } },
      "Kind memo is invalid: its body must be whether it is required, and its limit, a positive integer.",
    ],
    [
      { document, memo: { ...memo, outcome: "note" } },
      "Kind memo is invalid: its outcome must name a required field with values.",
    ],
    [
      {
        document,
        memo: { ...memo, verifier: { run: ["true"], access, limit: 0, ...bounded, kept: 1024 } },
      },
      "Kind memo is invalid: its verifier's limit must be a positive number of seconds, at most 2147483.",
    ],
    [
      {
        document,
        memo: {
          ...memo,
          verifier: { run: ["true"], access, limit: 1, ...bounded, memory: 0, kept: 1 },
        },
      },
      "Kind memo is invalid: its verifier's memory must be a positive integer.",
    ],
    [
      {
        document,
        memo: { ...memo, verifier: { run: ["true"], access, limit: 1, ...bounded, kept: -1 } },
      },
      "Kind memo is invalid: its verifier's kept must be an integer, 0 or more.",
    ],
    [
      {
        document,
        memo: { ...memo, verifier: { run: ["true"], access, limit: 1, memory: 1024, kept: 1 } },
      },
      "Kind memo is invalid: its verifier must be a program, its access, and its limit, memory, processes and kept.",
    ],
    [
      {
        document,
        memo: { ...memo, materialiser: { run: ["true"], access, limit: 1, ...bounded, kept: 1 } },
      },
      "Kind memo is invalid: its materialiser must be a program, its access, and its limit, memory and processes.",
    ],
    [
      {
        document,
        memo: {
          ...memo,
          materialiser: { run: ["true"], access, limit: 1, ...bounded, branches: false },
        },
      },
      "Kind memo is invalid: its materialiser may only state branches: true.",
    ],
    [
      {
        document,
        memo: { ...memo, verifier: { run: [], access, limit: 1, ...bounded, kept: 1024 } },
      },
      "Kind memo is invalid: its verifier's program must be a command and its arguments.",
    ],
    [
      {
        document,
        memo: {
          ...memo,
          materialiser: {
            run: ["true"],
            access: { ...access, network: "yes" },
            limit: 1,
            ...bounded,
          },
        },
      },
      "Kind memo is invalid: its materialiser's network access must be true or false.",
    ],
    [
      { document: { ...document, role: "judgement" } },
      "Kind document is invalid: the owner's request is a document, so it must be a subject.",
    ],
    [
      { document: { ...document, fields: { name: { limit: 9, required: true } } } },
      "Kind document is invalid: the owner's request is a document, so it must define a title.",
    ],
    [
      {
        document: {
          ...document,
          fields: { ...document.fields, priority: { limit: 9, required: true } },
        },
      },
      "Kind document is invalid: the owner's request is a document, so only its title can be required.",
    ],
    [
      {
        document: {
          ...document,
          verifier: { run: ["true"], access, limit: 1, ...bounded, kept: 1024 },
        },
      },
      "Kind document is invalid: the owner's request is a document, and no attempt claims it, so it cannot have a verifier.",
    ],
  ];

  for (const [kinds, message] of refused) {
    // SAFETY: each is a kinds value the type would refuse, which the engine must refuse too.
    await assert.rejects(
      engineWith(
        t,
        () => defineWorkflow({ start: "build", steps: { build: stepRunning("true", "end") } }),
        () => kinds as Kinds,
      ),
      { message },
    );
  }
});

/**
 * Starts an engine whose step `build` claims a memo with the body "Why.", and whose memo kind has
 * a verifier that runs `script`, its `$1` the test's directory, under the test's access for at
 * most 5 s with 4 GiB and 1024 processes, keeping at most 1 MiB, unless `given` changes them.
 */
function engineVerifying(
  t: TestContext,
  script: string,
  given: Partial<Omit<NonNullable<Kind["verifier"]>, "run">> = {},
) {
  return engineWith(
    t,
    () =>
      defineWorkflow({
        start: "build",
        steps: {
          build: {
            ...stepRunning(
              `printf 'Why.' > "$MEDRENGARD_OUT/memo.md"; ${memoClaim("Looks fine.", "memo.md")}`,
              "end",
            ),
            claims: ["memo"],
          },
        },
      }),
    (directory) => ({
      ...builtIn,
      memo: {
        ...memo,
        verifier: {
          run: ["sh", "-c", script, "sh", directory],
          access,
          limit: 5,
          ...bounded,
          kept: 1024 * 1024,
          ...given,
        },
      },
    }),
  );
}

test("the record names the verifier that accepted each artifact, or that its kind has none", async (t) => {
  // A memo's verifier accepts and keeps nothing, so only the record tells it from a note, which
  // has no verifier.
  const verifier = [
    "sh",
    "-c",
    `echo '{"accepted":true,"keep":[]}' > "$MEDRENGARD_OUT/output.json"`,
  ] as const;

  const claimed = [
    { kind: "memo", fields: { note: "Checked." } },
    { kind: "note", fields: { note: "Claimed." } },
  ];

  const { engine } = await engineWith(
    t,
    () =>
      defineWorkflow({
        start: "build",
        steps: {
          build: {
            ...stepRunning(
              `echo '${JSON.stringify({ outcome: "done", artifacts: claimed })}' > "$MEDRENGARD_OUT/output.json"`,
              "end",
            ),
            claims: ["memo", "note"],
          },
        },
      }),
    () => ({
      ...builtIn,
      memo: { ...memo, verifier: { run: verifier, access, limit: 5, ...bounded, kept: 1024 } },
      note: memo,
    }),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
  assert.partialDeepStrictEqual(engine.record("first").entries, [
    {
      outcome: "done",
      artifacts: [
        { artifact: { kind: "memo" }, verifier },
        { artifact: { kind: "note" }, verifier: null },
      ],
    },
  ]);
});

test("a kind's verifier sees the claim's fields and body, and its rejection escalates", async (t) => {
  const { engine, directory } = await engineVerifying(
    t,
    `cp -r "$MEDRENGARD_IN"/. "$1"; echo '{"accepted":false,"reason":"No."}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "claim",
    reason: "Step build claimed a memo its verifier rejected: No.",
  });

  const claim = JSON.parse(await readFile(join(directory, "claim.json"), "utf8"));

  assert.partialDeepStrictEqual(claim, { fields: { note: "Looks fine." }, body: "body" });
  assert.equal(await readFile(join(directory, claim.body), "utf8"), "Why.");
});

test("a kind's verifier whose access makes the workspace read-only cannot write to it", async (t) => {
  const { engine } = await engineVerifying(
    t,
    `touch written && echo '{"accepted":true,"keep":[]}' > "$MEDRENGARD_OUT/output.json"`,
    { access: { ...access, workspace: "read" } },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "kind",
    reason:
      "The memo verifier failed on step build's claim: it exited with code 1. Its stderr: \"touch: cannot touch 'written': Read-only file system\\n\".",
  });
});

test("a kind's verifier past its limit is stopped and escalates", async (t) => {
  const { engine } = await engineVerifying(t, "sleep 5", { limit: 1 });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "kind",
    reason: "The memo verifier failed on step build's claim: it reached its limit of 1 s.",
  });
});

test("a kind's verifier keeps files up to its kind's kept limit, however large one is", async (t) => {
  // Past the 64 MiB the engine once kept of any one file.
  const { engine } = await engineVerifying(
    t,
    `head -c $((65 * 1024 * 1024)) /dev/zero > "$MEDRENGARD_OUT/big"
     echo '{"accepted":true,"keep":["big"]}' > "$MEDRENGARD_OUT/output.json"`,
    { kept: 66 * 1024 * 1024 },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
});

test("a kind's verifier that keeps nothing may have a kept limit of 0", async (t) => {
  const { engine } = await engineVerifying(
    t,
    `echo '{"accepted":true,"keep":[]}' > "$MEDRENGARD_OUT/output.json"`,
    { kept: 0 },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
});

test("a kind's verifier whose kept files total more than its kept limit fails", async (t) => {
  const { engine } = await engineVerifying(
    t,
    `printf 123456 > "$MEDRENGARD_OUT/one"; printf 123456 > "$MEDRENGARD_OUT/two"
     echo '{"accepted":true,"keep":["one","two"]}' > "$MEDRENGARD_OUT/output.json"`,
    { kept: 10 },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "kind",
    reason:
      "The memo verifier failed on step build's claim: the files it kept total more than its limit of 10 bytes.",
  });
});

test("a kind's verifier over its memory limit is stopped and escalates, naming the limit", async (t) => {
  // tail holds its whole input, which has no newline, in memory.
  const { engine } = await engineVerifying(t, "head -c 200000000 /dev/zero | tail > /dev/null", {
    memory: 32 * 1024 * 1024,
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "kind",
    reason:
      "The memo verifier failed on step build's claim: it reached its memory limit of 33554432 bytes.",
  });
});

test("a kind's verifier cannot run more processes than its limit", async (t) => {
  // Forks until refused, each child waiting, and rejects the claim with how many it started.
  const { engine } = await engineVerifying(
    t,
    `started=$(python3 -c '
import os, time
started = 0
try:
    for _ in range(100):
        if os.fork() == 0:
            time.sleep(2)
            os._exit(0)
        started += 1
except OSError:
    pass
print(started)')
     echo "{\\"accepted\\":false,\\"reason\\":\\"$started\\"}" > "$MEDRENGARD_OUT/output.json"`,
    { processes: 16 },
  );

  const state = await engine.advance("first");

  assert.equal(state.status, "escalated");

  const started = Number(
    state.reason.replace("Step build claimed a memo its verifier rejected: ", ""),
  );

  assert.ok(started > 0 && started < 16, `started ${started}`);
});

test("a kind's verifier ended by a signal escalates, naming the signal", async (t) => {
  const { engine, directory } = await engineVerifying(t, `echo started > "$1/verifying"; sleep 5`);
  const advancing = engine.advance("first");

  await untilWritten(directory, "verifying");

  // From outside, as the owner or the system would: every process naming the test's directory,
  // the verifier's sandbox included.
  await once(spawn("pkill", ["-KILL", "-f", directory]), "close");

  assert.partialDeepStrictEqual(await advancing, {
    status: "escalated",
    cause: "kind",
    reason: "The memo verifier failed on step build's claim: it was ended by SIGKILL.",
  });
});

test("an engine waits for another process's write to the log instead of failing", async (t) => {
  const { engine, options } = await engineAwaiting(t);

  // Another process holds the log's write lock for half a second.
  const holder = spawn(process.execPath, [
    "-e",
    `const { DatabaseSync } = require("node:sqlite");
     const log = new DatabaseSync(${JSON.stringify(options.log)});
     log.exec("BEGIN IMMEDIATE");
     console.log("locked");
     Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
     log.exec("COMMIT");`,
  ]);

  await once(holder.stdout, "data");

  assert.partialDeepStrictEqual(
    engine.decide("first", {
      subject: subjectOf(engine),
      since: sinceOf(engine),
      outcome: "approve",
    }),
    { status: "ready" },
  );

  await once(holder, "exit");
});

test("a step's stderr is kept apart from its transcript as its errors", async (t) => {
  const { engine } = await engineRunning(
    t,
    `echo hello; sleep 0.1; echo oops >&2
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  await engine.advance("first");

  assert.equal(engine.transcript("first", 1).toString(), "hello\noops\n");
  assert.equal(engine.errors("first", 1).toString(), "oops\n");
});

test("a step that writes nothing to stderr has no errors", async (t) => {
  const { engine } = await engineRunning(
    t,
    `echo hello; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  await engine.advance("first");

  assert.equal(engine.errors("first", 1).length, 0);
  assert.partialDeepStrictEqual(engine.record("first").entries, [{ errors: false }]);
});

test("a failing verifier's stderr ends the reason its commission escalates", async (t) => {
  const { engine } = await engineVerifying(t, `echo "fatal: no repository" >&2; exit 3`);

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "kind",
    reason:
      'The memo verifier failed on step build\'s claim: it exited with code 3. Its stderr: "fatal: no repository\\n".',
  });
});

test("a failing verifier's stderr over 1 KiB is given as its last 1024 bytes", async (t) => {
  const { engine } = await engineVerifying(
    t,
    `head -c 2000 /dev/zero | tr '\\0' a >&2; echo end >&2; exit 3`,
  );

  const state = await engine.advance("first");

  assert.equal(state.status, "escalated");
  assert.equal(
    state.reason,
    `The memo verifier failed on step build's claim: it exited with code 3. The last 1024 bytes of its stderr: "${"a".repeat(1020)}end\\n".`,
  );
});

test("a commission's record lists its attempts, claims, escalations and decisions in order", async (t) => {
  const { engine } = await engineRunning(t, `${claimingAgain}; echo careful >&2`);

  await engine.advance("first");

  const subject = subjectOf(engine);

  engine.decide("first", {
    subject,
    since: sinceOf(engine),
    outcome: "abandon",
    feedback: "Enough.",
  });

  const record = engine.record("first");

  assert.partialDeepStrictEqual(record, {
    state: { status: "finished", by: "abandoned" },
    request: { artifact: { kind: "document", fields: { title: "Greet" }, body: "Say hello." } },
  });
  assert.partialDeepStrictEqual(record.entries, [
    {
      entry: "attempt",
      attempt: 1,
      step: "build",
      outcome: "again",
      artifacts: [{ artifact: { kind: "document", fields: { title: "Plan" }, body: "1\n" } }],
      errors: true,
    },
    { entry: "attempt", attempt: 2, step: "build", outcome: "again", errors: true },
    {
      entry: "escalation",
      step: "build",
      cause: "budget",
      reason: "Step build has spent its budget of 2 attempts.",
    },
    { entry: "decision", step: "build", outcome: "abandon", subject, feedback: "Enough." },
  ]);
});

test("a commission's record names the step each escalation is at, after the commission moved on", async (t) => {
  const { engine } = await engineAwaiting(t);

  engine.decide("first", {
    subject: subjectOf(engine),
    since: sinceOf(engine),
    outcome: "approve",
  });
  // build writes no output.json, so its attempt escalates.
  await engine.advance("first");
  engine.decide("first", { subject: subjectOf(engine), since: sinceOf(engine), outcome: "retry" });
  await engine.advance("first");

  assert.partialDeepStrictEqual(engine.record("first").entries, [
    { entry: "decision", step: "review", outcome: "approve" },
    {
      entry: "attempt",
      attempt: 1,
      step: "build",
      cause: "claim",
      escalated: "Step build exited 0 without a readable output.json.",
    },
    { entry: "decision", step: "build", outcome: "retry" },
    { entry: "attempt", attempt: 2, step: "build" },
  ]);
});

test("an artifact can be named by a unique prefix of its hash of at least 8 characters", async (t) => {
  const { engine } = await engineRunning(t, "true");
  const subject = subjectOf(engine);

  assert.deepEqual(engine.artifact(subject.slice(0, 8)), engine.artifact(subject));
  assert.throws(() => engine.artifact(subject.slice(0, 7)), {
    message: `There is no artifact ${subject.slice(0, 7)}.`,
  });
});

test("a step's notes on fd 3 are recorded as they arrive, in order", async (t) => {
  const { engine } = await engineRunning(
    t,
    `echo first >&3; sleep 0.5; printf 'second\\nthird' >&3
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  const advancing = engine.advance("first");

  // Before the step ends, its first note is in the record already.
  for (;;) {
    const [entry] = engine.record("first").entries;

    if (entry?.entry === "attempt" && entry.notes.length > 0) {
      assert.partialDeepStrictEqual(entry, {
        entry: "attempt",
        running: true,
        notes: [{ note: "first", from: "step" }],
      });
      break;
    }

    await sleep(20);
  }

  await advancing;

  assert.partialDeepStrictEqual(engine.record("first").entries, [
    {
      entry: "attempt",
      outcome: "done",
      notes: [
        { note: "first", from: "step" },
        { note: "second", from: "step" },
        { note: "third", from: "step" },
      ],
    },
  ]);
});

test("a step that writes many notes is not slowed by the log they make", async (t) => {
  // Each note re-reading the log made 20,000 take minutes; appended, they take seconds, or up to
  // half a minute where each event's write waits on a disk rather than a tmpfs.
  const { engine } = await engineRunning(
    t,
    `i=0; while [ $i -lt 20000 ]; do echo "note $i" >&3; i=$((i + 1)); done
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    { idle: 120, attempt: 120, transcript: 1024 * 1024, input: 65536 },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });

  const [entry] = engine.record("first").entries;

  assert.ok(entry?.entry === "attempt");
  assert.equal(entry.notes.length, 20000);
  assert.deepEqual(entry.notes.at(-1), { note: "note 19999", from: "step" });
});

test("a note over its limit stops the step, which escalates", async (t) => {
  const { engine } = await engineRunning(t, `head -c 5000 /dev/zero | tr '\\0' a >&3; sleep 5`);

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "limit",
    reason: "Step build wrote a note over its limit of 4096 bytes.",
  });
});

test("a step's notes count toward its transcript limit", async (t) => {
  const { engine } = await engineRunning(
    t,
    `for n in 1 2 3 4 5 6 7 8 9 10; do echo "note $n" >&3; done; sleep 5`,
    { idle: 5, attempt: 10, transcript: 40, input: 65536 },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "limit",
    reason: "Step build wrote more than its transcript limit of 40 bytes.",
  });
});

test("every event carries the time the engine wrote it, and the record each attempt's start and end", async (t) => {
  const before = Date.now();

  const { engine, options } = await engineWith(t, () =>
    defineWorkflow({
      start: "build",
      steps: {
        build: stepRunning(
          `sleep 0.2; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
          "review",
        ),
        review: { kind: "approval", on: { approve: "end" } },
      },
    }),
  );

  await engine.advance("first");
  engine.decide("first", {
    subject: subjectOf(engine),
    since: sinceOf(engine),
    outcome: "approve",
  });

  const after = Date.now();
  const log = new DatabaseSync(options.log);

  t.after(() => log.close());

  const times = log
    .prepare("SELECT event FROM events WHERE commission = 'first' ORDER BY position")
    .all()
    .map(({ event }) => JSON.parse(String(event)).at);

  assert.equal(times.length, 4);
  assert.ok(times.every((at) => Number.isInteger(at) && at >= before && at <= after));

  const [attempt, decision] = engine.record("first").entries;

  assert.ok(attempt.entry === "attempt" && "outcome" in attempt);
  assert.ok(attempt.ended! - attempt.started! >= 200);
  assert.equal(attempt.started, times[1]);
  assert.equal(attempt.ended, times[2]);
  assert.ok(decision.entry === "decision");
  assert.equal(decision.at, times[3]);
});

test("a log written before events carried times still reads, without them", async (t) => {
  const { engine, options } = await engineRunning(
    t,
    `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  await engine.advance("first");

  const log = new DatabaseSync(options.log);

  t.after(() => log.close());
  log.exec("UPDATE events SET event = json_remove(event, '$.at')");

  const [attempt] = engine.record("first").entries;

  assert.partialDeepStrictEqual(attempt, { entry: "attempt", outcome: "done" });
  assert.ok(attempt.entry === "attempt" && "ended" in attempt);
  assert.equal(attempt.started, undefined);
  assert.equal(attempt.ended, undefined);
});

/**
 * Parses the JSON `text` with each string and number replaced by its JSON type, so a test pins
 * the fields and their types, to every depth; a field named in `kept` keeps its value.
 */
function typesIn(text: string, kept: readonly string[]) {
  return JSON.parse(text, (key, value) => {
    if (kept.includes(key) || isRecord(value) || Array.isArray(value)) {
      return value;
    }

    if (isText(value)) {
      return "string";
    }

    return Number.isFinite(value) ? "number" : value;
  });
}

// Constraint 7: the log's vocabulary is pinned, so a new event type or field fails here until it
// is added on purpose. Each value is replaced by its type, so the shape is pinned to every depth.
test("the log's events are exactly the seven types, each with its pinned fields", async (t) => {
  // Every type the log may hold, and where its fields are pinned: a type added to the vocabulary
  // fails to compile here until it is pinned somewhere.
  const pinned = {
    commissioned: "here",
    "attempt-started": "here",
    noted: "here",
    "attempt-completed": "here",
    decided: "here",
    escalated: "here",
    withdrawn: "children.test.ts",
  } satisfies Record<CommissionEvent["type"], "here" | "children.test.ts">;

  const { engine, options } = await engineWith(t, () =>
    defineWorkflow({
      start: "build",
      steps: {
        build: stepRunning(
          `echo note >&3; echo warning >&2; printf 'Do it.' > "$MEDRENGARD_OUT/plan.md"
           echo '{"usd":0.5,"tokens":{"input":1,"output":2,"cacheRead":3,"cacheWrite":4}}' >&4
           printf 'a conversation' > "$MEDRENGARD_OUT/session"
           echo '${JSON.stringify(planAt("plan.md"))}' > "$MEDRENGARD_OUT/output.json"`,
          "review",
        ),
        review: { kind: "approval", on: { approve: "fail" } },
        fail: {
          ...stepRunning(
            `echo '{"usd":0.25}' >&4; printf 'another' > "$MEDRENGARD_OUT/session"; echo broken >&2; exit 3`,
            "end",
          ),
          inputs: { plan: "subject" },
        },
      },
    }),
  );

  await engine.advance("first");
  engine.decide("first", {
    subject: subjectOf(engine),
    since: sinceOf(engine),
    outcome: "approve",
  });
  await engine.advance("first");

  const log = new DatabaseSync(options.log);

  t.after(() => log.close());

  const vocabulary = log
    .prepare("SELECT event FROM events WHERE commission = 'first' ORDER BY position")
    .all()
    .map(({ event }) => typesIn(String(event), ["type"]));

  const started = (inputs: readonly { name: string; hashes: readonly string[] }[]) => ({
    type: "attempt-started",
    step: "string",
    attempt: "number",
    subject: "string",
    inputs,
    process: { pid: "number", start: "number", boot: "string" },
    engine: "string",
    at: "number",
  });

  assert.deepEqual(vocabulary, [
    {
      type: "commissioned",
      workflow: "string",
      definition: "string",
      request: "string",
      engine: "string",
      at: "number",
    },
    started([]),
    { type: "noted", attempt: "number", note: "string", at: "number" },
    {
      type: "attempt-completed",
      step: "string",
      attempt: "number",
      outcome: "string",
      artifacts: [{ hash: "string", kind: "string", kept: {} }],
      transcript: "string",
      errors: "string",
      usage: {
        usd: "number",
        tokens: { input: "number", output: "number", cacheRead: "number", cacheWrite: "number" },
      },
      session: "string",
      next: "string",
      at: "number",
    },
    {
      type: "decided",
      step: "string",
      decision: "string",
      outcome: "string",
      subject: "string",
      next: "string",
      at: "number",
    },
    started([{ name: "string", hashes: ["string"] }]),
    {
      type: "escalated",
      cause: "string",
      reason: "string",
      attempt: "number",
      transcript: "string",
      errors: "string",
      usage: { usd: "number" },
      session: "string",
      at: "number",
    },
  ]);
  assert.deepEqual(
    new Set(vocabulary.map(({ type }) => type)),
    new Set(
      Object.entries(pinned)
        .filter(([, where]) => where === "here")
        .map(([type]) => type),
    ),
  );
});

// Constraint 7: the step contract is pinned, so a new variable, descriptor or input.json field
// fails here until it is added on purpose. output.json's fields are pinned where they are parsed:
// a claim with a field output.json does not define escalates.
test("an agent step is started with exactly the pinned environment, descriptors and input.json", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "plan",
      steps: {
        plan: {
          kind: "agent",
          claims: [...claims, "verdict"],
          workspace: "empty",
          agent: {
            harness: {
              run: [
                "sh",
                "-c",
                `tr '\\0' '\\n' < /proc/$$/environ | cut -d= -f1 | sort > "$1/environment"
                 ls /proc/$$/fd > "$1/descriptors"; ls -A "$MEDRENGARD_IN" > "$1/listing"
                 cp "$MEDRENGARD_IN/input.json" "$1"
                 echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
                "sh",
                directory,
              ],
            },
            model: "a-model",
            prompt: "Plan the change.",
            skills: [skillAt(directory, "tdd", { "SKILL.md": "Test first.\n" })],
          },
          inputs: { request: "request" },
          on: { done: "end", pass: "end", fail: "end" },
          access,
          budget: 1,
          limits: { idle: 5, attempt: 10, transcript: 65536, input: 65536 },
        },
      },
    }),
  );

  await engine.advance("first");

  const read = (name: string) => readFile(join(directory, name), "utf8");

  // The step's access names no variables; PWD is bwrap's --chdir.
  assert.equal(await read("environment"), "MEDRENGARD_IN\nMEDRENGARD_OUT\nPWD\n");
  assert.equal(await read("descriptors"), "0\n1\n2\n3\n4\n");
  assert.equal(await read("listing"), ".skills\ninput.json\nrequest\n");

  // A kind's rules are its schema, defined by the kind, so only the keys of each are pinned here.
  const { claims: rules, ...input } = typesIn(await read("input.json"), []);

  assert.deepEqual(input, {
    commission: "string",
    step: "string",
    attempt: "number",
    outcomes: ["string", "string", "string"],
    inputs: {
      request: [{ hash: "string", kind: "string", fields: { title: "string" }, body: "string" }],
    },
    attended: false,
    agent: {
      model: "string",
      prompt: "string",
      skills: [{ name: "string", path: "string" }],
    },
  });
  assert.deepEqual(
    Object.entries(rules).map(([kind, rule]) => [kind, isRecord(rule) ? Object.keys(rule) : rule]),
    [
      ["document", ["description", "fields", "body"]],
      ["commit", ["description", "fields", "body"]],
      ["verdict", ["description", "fields", "body", "outcome"]],
    ],
  );
});

// Constraint 7: a kind's programs have a contract of their own, pinned like the step's: their
// environment, descriptors, input files and those files' fields.
test("a kind's verifier and materialiser are started with exactly the pinned environment, descriptors and files", async (t) => {
  // Records what the program was started with under `$1/<name>-…`.
  const recording = (name: string, file: string) =>
    `tr '\\0' '\\n' < /proc/$$/environ | cut -d= -f1 | sort > "$1/${name}-environment"
     ls /proc/$$/fd > "$1/${name}-descriptors"; ls -A "$MEDRENGARD_IN" > "$1/${name}-listing"
     cp "$MEDRENGARD_IN/${file}" "$1/${name}.json"`;

  const { engine, directory } = await engineWith(
    t,
    () =>
      defineWorkflow({
        start: "build",
        steps: {
          build: {
            ...stepRunning(
              `printf 'Why.' > "$MEDRENGARD_OUT/draft.md"
               echo '{"outcome":"done","artifacts":[{"kind":"draft","fields":{"note":"Drafted."},"body":"draft.md"}]}' > "$MEDRENGARD_OUT/output.json"`,
              "use",
            ),
            claims: ["draft"],
          },
          use: {
            ...stepRunning(`echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`, "end"),
            workspace: "subject",
          },
        },
      }),
    (directory) => ({
      ...builtIn,
      draft: {
        ...memo,
        role: "subject",
        verifier: {
          run: [
            "sh",
            "-c",
            `${recording("verifier", "claim.json")}
             echo kept > "$MEDRENGARD_OUT/kept.txt"
             echo '{"accepted":true,"keep":["kept.txt"]}' > "$MEDRENGARD_OUT/output.json"`,
            "sh",
            directory,
          ],
          access,
          limit: 5,
          ...bounded,
          kept: 1024,
        },
        materialiser: {
          run: ["sh", "-c", recording("materialiser", "artifact.json"), "sh", directory],
          access,
          limit: 5,
          ...bounded,
        },
      },
    }),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });

  const read = (name: string) => readFile(join(directory, name), "utf8");

  for (const program of ["verifier", "materialiser"]) {
    // No variables but the contract's, PWD being bwrap's --chdir, and no fd 3 for notes.
    assert.equal(await read(`${program}-environment`), "MEDRENGARD_IN\nMEDRENGARD_OUT\nPWD\n");
    assert.equal(await read(`${program}-descriptors`), "0\n1\n2\n");
  }

  assert.equal(await read("verifier-listing"), "body\nclaim.json\n");
  assert.deepEqual(typesIn(await read("verifier.json"), []), {
    fields: { note: "string" },
    body: "string",
    subject: { hash: "string", kind: "string", fields: { title: "string" } },
  });

  assert.equal(await read("materialiser-listing"), "artifact.json\nbody\nkept\n");
  assert.deepEqual(typesIn(await read("materialiser.json"), []), {
    hash: "string",
    kind: "string",
    fields: { note: "string" },
    body: "string",
    kept: { "kept.txt": "string" },
  });
});

for (const [what, written] of [
  ["an acceptance", '{"accepted":true,"keep":[],"note":"Fine."}'],
  ["a rejection", '{"accepted":false,"reason":"No.","note":"Sorry."}'],
] as const) {
  test(`a kind's verifier that writes ${what} with a field output.json does not define fails`, async (t) => {
    const { engine } = await engineVerifying(
      t,
      `echo '${written}' > "$MEDRENGARD_OUT/output.json"`,
    );

    assert.partialDeepStrictEqual(await engine.advance("first"), {
      status: "escalated",
      cause: "kind",
      reason: "The memo verifier failed on step build's claim: it wrote no valid output.json.",
    });
  });
}

test("a command step's input.json has no agent", async (t) => {
  const { engine, directory } = await engineReceiving(
    t,
    {},
    `cp "$MEDRENGARD_IN/input.json" "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  await engine.advance("first");

  const input = JSON.parse(await readFile(join(directory, "received", "input.json"), "utf8"));

  assert.deepEqual(Object.keys(input), [
    "commission",
    "step",
    "attempt",
    "outcomes",
    "inputs",
    "claims",
  ]);
});

// A usage report, as a step writes it to fd 4.
const usageOf = (usd: number, input: number) =>
  JSON.stringify({ usd, tokens: { input, output: 2, cacheRead: 3, cacheWrite: 4 } });

test("a step's latest usage report on fd 4 is recorded with its attempt", async (t) => {
  const { engine } = await engineRunning(
    t,
    `echo '${usageOf(0.1, 10)}' >&4; echo '${usageOf(0.25, 30)}' >&4
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  await engine.advance("first");

  assert.partialDeepStrictEqual(engine.record("first").entries, [
    { entry: "attempt", outcome: "done", usage: JSON.parse(usageOf(0.25, 30)) },
  ]);
});

test("a failed step's usage is recorded with its escalation, and a step that reports none has none", async (t) => {
  const reporting = await engineRunning(t, `echo '{"usd":0.5}' >&4; exit 3`);

  await reporting.engine.advance("first");

  assert.partialDeepStrictEqual(reporting.engine.record("first").entries, [
    { entry: "attempt", escalated: "Step build exited with code 3.", usage: { usd: 0.5 } },
  ]);

  const silent = await engineRunning(t, `exit 3`);

  await silent.engine.advance("first");

  const [entry] = silent.engine.record("first").entries;

  assert.ok(entry !== undefined && !("usage" in entry));
});

// Neither money below zero, nor a field a report does not define, nor tokens without each count.
const notReports = ["not json", '{"usd":-1}', '{"usd":1,"euros":1}', '{"tokens":{"input":1}}'];

for (const [report, reason] of [
  ...notReports.map((report) => [
    report,
    `Step build wrote a usage report that is not one: ${report}.`,
  ]),
  [
    `{"usd":1,"pad":"${"x".repeat(5000)}"}`,
    "Step build wrote a usage report over its limit of 4096 bytes.",
  ],
]) {
  test(`a usage report ${report!.slice(0, 30)} escalates`, async (t) => {
    const { engine } = await engineRunning(
      t,
      `echo '${report}' >&4; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    );

    assert.partialDeepStrictEqual(await engine.advance("first"), {
      status: "escalated",
      reason,
    });
  });
}

test(
  "an interrupted attempt keeps the usage its step reported before its engine died",
  { timeout: 10_000 },
  async (t) => {
    const { engine, directory, record, options } = await engineRunning(
      t,
      `echo '${usageOf(0.75, 50)}' >&4; echo started >> "$1"; exec sleep 30`,
      { idle: 60, attempt: 60, transcript: 65536, input: 65536 },
    );

    const crashing = join(directory, "crashing.ts");

    await writeFile(
      crashing,
      `import { createEngine } from ${JSON.stringify(join(import.meta.dirname, "engine.ts"))};
    await createEngine(${JSON.stringify(options)}).advance("first");`,
    );

    const child = spawn(process.execPath, [crashing], { stdio: "ignore" });

    // Killed only once the engine has spooled the report, as with the transcript.
    await untilStarted(directory);

    for (;;) {
      const [attempt] = await readdir(join(record, "attempts"));

      if (attempt !== undefined && existsSync(join(record, "attempts", attempt, "usage"))) {
        break;
      }

      await sleep(20);
    }

    child.kill("SIGKILL");
    await once(child, "exit");

    assert.partialDeepStrictEqual(await engine.advance("first"), {
      status: "escalated",
      cause: "interrupted",
      reason: "Step build was interrupted.",
    });
    assert.partialDeepStrictEqual(engine.record("first").entries, [
      { entry: "attempt", usage: JSON.parse(usageOf(0.75, 50)) },
    ]);
  },
);

/**
 * Starts an engine whose one command step, `build`, runs `script` with `$1` its `started` file,
 * repeats on `again` with a budget of 5, and has the money limit `step`, in a workflow with the
 * money limit `commission`; either may be left out.
 */
function engineSpending(
  t: TestContext,
  script: string,
  { step, commission }: { step?: number; commission?: number },
) {
  return engineWith(t, (directory) => {
    const limits: Partial<Limits> & Money = {
      idle: 5,
      attempt: 10,
      transcript: 65536,
      input: 65536,
    };

    if (step !== undefined) {
      limits.usd = step;
    }

    const workflow: Workflow<"build"> = {
      start: "build",
      steps: {
        build: {
          kind: "command",
          claims,
          workspace: "empty",
          inputs: {},
          run: ["sh", "-c", script, "sh", join(directory, "started")],
          on: { done: "end", again: "build" },
          access,
          budget: 5,
          limits,
        },
      },
    };

    if (commission !== undefined) {
      workflow.usd = commission;
    }

    return workflow;
  });
}

test("an attempt whose reported cost goes over its step's money limit is stopped as it reports it", async (t) => {
  const { engine } = await engineSpending(
    t,
    `echo '{"usd":0.5}' >&4; echo '{"usd":1.5}' >&4; exec sleep 30`,
    { step: 1 },
  );

  const started = Date.now();

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "money",
    reason: "Step build reached its money limit of $1.",
  });
  assert.ok(Date.now() - started < 5000);
  assert.partialDeepStrictEqual(engine.record("first").entries, [{ usage: { usd: 1.5 } }]);
});

test("an attempt within its step's money limit completes", async (t) => {
  const { engine } = await engineSpending(
    t,
    `echo '{"usd":0.5}' >&4; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    { step: 1 },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
});

test("an attempt with a money limit that reports no cost escalates, its claim unrecorded", async (t) => {
  const { engine } = await engineSpending(
    t,
    `echo '{"tokens":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0}}' >&4
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    { step: 1 },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "money",
    reason: "Step build reported no cost, so it counts as over its money limit of $1.",
  });
});

test("a commission is stopped once its attempts' cost since the owner's last decision goes over its money limit, and a retry renews it", async (t) => {
  const { engine } = await engineSpending(t, `echo '{"usd":0.6}' >&4; ${claimingAgain}`, {
    commission: 1,
  });

  // 0.6, then 1.2 during the second attempt.
  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "money",
    reason: "The commission reached its money limit of $1.",
  });
  assert.equal(engine.record("first").entries.length, 2);

  engine.decide("first", { subject: subjectOf(engine), since: sinceOf(engine), outcome: "retry" });

  // Renewed: the next attempt runs, and the one after goes over again.
  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "money",
    reason: "The commission reached its money limit of $1.",
  });
  assert.equal(
    engine.record("first").entries.filter((entry) => entry.entry === "attempt").length,
    4,
  );
});

test("a commission that has spent its whole money limit escalates before another attempt starts", async (t) => {
  const { engine } = await engineSpending(t, `echo '{"usd":1}' >&4; ${claimingAgain}`, {
    commission: 1,
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "money",
    reason: "The commission has spent $1.00 of its money limit of $1.",
  });
  assert.partialDeepStrictEqual(engine.record("first").entries, [
    { entry: "attempt", outcome: "again" },
    { entry: "escalation" },
  ]);
});

test("a commission with a money limit whose attempt reported no cost escalates before the next starts", async (t) => {
  const { engine } = await engineSpending(t, claimingAgain, { commission: 1 });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "money",
    reason:
      "The commission's spend is unknown: attempt 1 reported no cost, so it counts as over its money limit of $1.",
  });
});

test("a commission without a money limit spends what it reports, unbounded", async (t) => {
  const { engine } = await engineSpending(
    t,
    `echo '{"usd":100}' >&4; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    {},
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
});

// An agent step of the workflow `build`, which commissioning would accept as it is.
const planning = {
  kind: "agent",
  agent: { harness: { run: ["true"] }, model: "a-model", prompt: "Plan." },
  claims: [],
  workspace: "empty",
  inputs: {},
  on: { done: "end" },
  access,
  budget: 1,
} as const;

for (const [what, workflow, problem] of [
  [
    "a money limit at an attended step",
    { start: "build", steps: { build: { ...planning, attended: true, limits: { usd: 1 } } } },
    "step build's money limit cannot be kept at an attended step, which reports no cost",
  ],
  [
    "a step money limit of zero",
    { start: "build", steps: { build: { ...planning, limits: { usd: 0 } } } },
    "step build's money limit must be a positive number of dollars",
  ],
  [
    "a money limit at a step whose agent's harness reports no cost",
    {
      start: "build",
      steps: {
        build: {
          ...planning,
          agent: { ...planning.agent, harness: { run: ["true"], costs: false } },
          limits: { usd: 1 },
        },
      },
    },
    "step build's money limit cannot be kept: its agent's harness reports no cost",
  ],
  [
    "a commission money limit over a step whose agent's harness reports no cost",
    {
      start: "build",
      usd: 5,
      steps: {
        build: {
          ...planning,
          agent: { ...planning.agent, harness: { run: ["true"], costs: false } },
        },
      },
    },
    "its money limit cannot be kept: step build's agent's harness reports no cost",
  ],
  [
    "a harness that says it costs, which every harness is unless it says not",
    {
      start: "build",
      steps: {
        // As a factory written in JavaScript could give it.
        build: {
          ...planning,
          agent: { ...planning.agent, harness: JSON.parse('{"run":["true"],"costs":true}') },
        },
      },
    },
    "step build's harness may say only costs: false, when it reports no cost",
  ],
  [
    "a commission money limit that is no number",
    // As a factory written in JavaScript could give it.
    { start: "build", usd: JSON.parse('"lots"'), steps: { build: planning } },
    "its money limit must be a positive number of dollars",
  ],
] satisfies [string, Workflow<"build">, string][]) {
  test(`commissioning refuses ${what}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

    t.after(() => rm(directory, { recursive: true, force: true }));

    const engine = createEngine({
      log: join(directory, "log.sqlite"),
      kinds: builtIn,
      defaults: { limits: defaultLimits },
      workflows: { build: workflow },
    });

    assert.throws(() => engine.commission("build", "first", { title: "T", body: "B" }), {
      message: `Workflow build is invalid: ${problem}.`,
    });
  });
}

/**
 * Starts an engine whose step `build` runs `script` with `$1` the test's directory, and declares
 * its own latest session as the input `earlier`; done leads to the end. Its transcript limit is
 * `transcript`.
 */
function engineResuming(t: TestContext, script: string, transcript = 65536) {
  return engineWith(t, (directory) =>
    defineWorkflow({
      start: "build",
      steps: {
        build: {
          kind: "command",
          claims,
          workspace: "empty",
          inputs: { earlier: { session: "build" } },
          run: ["sh", "-c", script, "sh", directory],
          on: { done: "end" },
          access,
          budget: 2,
          limits: { idle: 10, attempt: 20, transcript, input: 65536 },
        },
      },
    }),
  );
}

// The step's script: its first attempt leaves a session and fails; its retry keeps what it was
// given, its input.json and the session's body.
const resuming = `if [ ! -e "$1/failed" ]; then
    touch "$1/failed"
    cp "$MEDRENGARD_IN/input.json" "$1/first.json"
    printf 'the first conversation' > "$MEDRENGARD_OUT/session"
    exit 3
  fi
  cp "$MEDRENGARD_IN/input.json" "$1/second.json"
  cp "$MEDRENGARD_IN"/earlier/* "$1/session"
  echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`;

test("a session a failed attempt left is given to a later attempt that declares it", async (t) => {
  const { engine, directory } = await engineResuming(t, resuming);

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "exit",
    reason: "Step build exited with code 3.",
  });

  // Its first attempt had no session to continue: an empty list, not an error.
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, "first.json"), "utf8")).inputs.earlier,
    [],
  );

  engine.decide("first", { subject: subjectOf(engine), since: sinceOf(engine), outcome: "retry" });

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });

  const [given] = JSON.parse(await readFile(join(directory, "second.json"), "utf8")).inputs.earlier;
  const hash = createHash("sha256").update("the first conversation").digest("hex");

  assert.deepEqual(given, { hash, body: `earlier/${hash}` });
  assert.equal(await readFile(join(directory, "session"), "utf8"), "the first conversation");

  const escalated = engine.events(0).find(({ event }) => event.type === "escalated")?.event;

  assert.partialDeepStrictEqual(escalated, { type: "escalated", attempt: 1, session: hash });
});

test("a session over the step's transcript limit escalates, and is not kept", async (t) => {
  const { engine } = await engineResuming(
    t,
    `head -c 200 /dev/zero > "$MEDRENGARD_OUT/session"
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    100,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "limit",
    reason: "Step build left a session of 200 bytes, over its transcript limit of 100.",
  });

  const escalated = engine.events(0).find(({ event }) => event.type === "escalated")?.event;

  assert.ok(escalated !== undefined && !("session" in escalated));
});

test(
  "an interrupted attempt keeps the session its step left before its engine died",
  { timeout: 10_000 },
  async (t) => {
    const { engine, directory, options } = await engineResuming(
      t,
      `printf 'cut short' > "$MEDRENGARD_OUT/session"; echo started >> "$1/started"; exec sleep 30`,
    );

    const crashing = join(directory, "crashing.ts");

    await writeFile(
      crashing,
      `import { createEngine } from ${JSON.stringify(join(import.meta.dirname, "engine.ts"))};
    await createEngine(${JSON.stringify(options)}).advance("first");`,
    );

    const child = spawn(process.execPath, [crashing], { stdio: "ignore" });

    await untilStarted(directory);
    child.kill("SIGKILL");
    await once(child, "exit");

    assert.partialDeepStrictEqual(await engine.advance("first"), {
      status: "escalated",
      cause: "interrupted",
      reason: "Step build was interrupted.",
    });

    const escalated = engine.events(0).find(({ event }) => event.type === "escalated")?.event;

    assert.partialDeepStrictEqual(escalated, {
      session: createHash("sha256").update("cut short").digest("hex"),
    });
  },
);

for (const [what, session, problem] of [
  ["a step it lacks", "nowhere", "a query whose from names its steps"],
  ["an approval step", "review", "a session of one of its steps that runs a program"],
] as const) {
  test(`a session input naming ${what} cannot be commissioned`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

    t.after(() => rm(directory, { recursive: true, force: true }));

    const engine = createEngine({
      log: join(directory, "log.sqlite"),
      kinds: builtIn,
      defaults: { limits: defaultLimits },
      workflows: {
        build: {
          start: "build",
          steps: {
            build: {
              ...stepRunning("true", "review"),
              // As a factory written in JavaScript could name any step.
              inputs: { earlier: { session: JSON.parse(JSON.stringify(session)) } },
            },
            review: { kind: "approval", on: { approve: "end" } },
          },
        },
      },
    });

    assert.throws(() => engine.commission("build", "first", { title: "T", body: "B" }), {
      message: new RegExp(RegExp.escape(problem)),
    });
  });
}

/**
 * Rewrites the log at `log` as an older engine would have left the commission `first`: its
 * commissioned event recording the engine `engine`, or none when it is undefined.
 */
function commissionedBy(log: string, engine: string | undefined): void {
  const database = new DatabaseSync(log);

  database
    .prepare(
      engine === undefined
        ? "UPDATE events SET event = json_remove(event, '$.engine') WHERE commission = 'first' AND position = 0"
        : "UPDATE events SET event = json_set(event, '$.engine', ?) WHERE commission = 'first' AND position = 0",
    )
    .run(...(engine === undefined ? [] : [engine]));
  database.close();
}

/** The engine this process runs, as it records it when commissioning. */
function engineOf(engine: ReturnType<typeof createEngine>): string {
  const [commissioned] = engine.events(0);

  assert.ok(commissioned?.event.type === "commissioned" && commissioned.event.engine !== undefined);

  return commissioned.event.engine;
}

test("a commission that last ran on another engine escalates once, and the owner's retry carries it on with this one", async (t) => {
  const { engine, options } = await engineRunning(
    t,
    `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  const current = engineOf(engine);

  commissionedBy(options.log, "0123456789abcdef");

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "upgrade",
    reason: `Commission first last ran on engine 01234567; this engine is ${current.slice(0, 8)}.`,
  });
  assert.deepEqual(engine.record("first").entries.length, 1);

  engine.decide("first", { subject: subjectOf(engine), since: sinceOf(engine), outcome: "retry" });

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });

  const started = engine.events(0).find(({ event }) => event.type === "attempt-started")?.event;

  assert.partialDeepStrictEqual(started, { type: "attempt-started", engine: current });
});

test("a decision at an approval step does not carry a commission on with another engine", async (t) => {
  const { engine, options } = await engineAwaiting(t);

  const current = engineOf(engine);

  commissionedBy(options.log, "0123456789abcdef");
  engine.decide("first", {
    subject: subjectOf(engine),
    since: sinceOf(engine),
    outcome: "approve",
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "upgrade",
    reason: `Commission first last ran on engine 01234567; this engine is ${current.slice(0, 8)}.`,
  });
});

test("a commission written before engines recorded their version escalates once", async (t) => {
  const { engine, options } = await engineRunning(
    t,
    `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  const current = engineOf(engine);

  commissionedBy(options.log, undefined);

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "upgrade",
    reason: `Commission first last ran on an engine that recorded no version; this engine is ${current.slice(0, 8)}.`,
  });
});

test("a commission run on by the engine it last ran on does not escalate", async (t) => {
  const { engine } = await engineRunning(
    t,
    `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
});

/** A server on loopback, outside any sandbox, answering every request with `answer`; its port. */
async function serving(t: TestContext, answer: string): Promise<number> {
  const server = createServer((_, response) => response.end(answer));

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  // SAFETY: a TCP server listening on a port has an address of that kind.
  return (server.address() as AddressInfo).port;
}

test("a step whose access lists hosts reaches them through the engine's proxy, and nothing else", async (t) => {
  const allowed = await serving(t, "reached");
  const other = await serving(t, "should not be reached");

  const { engine, directory } = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "build",
      steps: {
        build: {
          ...stepRunning(
            `printenv HTTPS_PROXY > "$1/proxy"
             curl -sS -p "http://127.0.0.1:${allowed}/" > "$1/allowed"
             curl -sS -p "http://127.0.0.1:${other}/" > "$1/refused" 2>&1
             curl -sS --noproxy '*' "http://127.0.0.1:${allowed}/" > "$1/direct" 2>&1
             echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            "end",
            [directory],
          ),
          access: { ...access, network: { hosts: [`127.0.0.1:${allowed}`] } },
        },
      },
    }),
  );

  const ended = await engine.advance("first");

  assert.partialDeepStrictEqual(
    ended,
    { status: "finished" },
    engine.errors("first", 1).toString(),
  );

  const read = (name: string) => readFile(join(directory, name), "utf8");

  assert.match(await read("proxy"), /^http:\/\/127\.0\.0\.1:\d+\n$/);
  assert.equal(await read("allowed"), "reached");
  assert.doesNotMatch(await read("refused"), /should not be reached/);
  assert.doesNotMatch(await read("direct"), /reached/);
  assert.partialDeepStrictEqual(engine.record("first").entries, [
    {
      notes: [
        { note: `Step build was refused network access to 127.0.0.1:${other}.`, from: "engine" },
      ],
    },
  ]);
});

/**
 * A broker for a test: a program that listens on MEDRENGARD_SOCKET and answers every request with
 * `answer` and the Authorization it was given, and records its process id in `pid` and its
 * environment's MEDRENGARD_SOCKET in `socket`, in `directory`. Its argv.
 */
async function brokerIn(directory: string, answer: string): Promise<[string, ...string[]]> {
  const program = join(directory, "broker.mjs");

  await writeFile(
    program,
    `import { createServer } from "node:http";
     import { writeFileSync } from "node:fs";
     writeFileSync(${JSON.stringify(join(directory, "pid"))}, String(process.pid));
     writeFileSync(${JSON.stringify(join(directory, "socket"))}, process.env.MEDRENGARD_SOCKET);
     createServer((request, response) =>
       response.end(${JSON.stringify(answer)} + " " + (request.headers.authorization ?? "none")),
     ).listen(process.env.MEDRENGARD_SOCKET);`,
  );

  return [process.execPath, program];
}

/** Whether the process `pid` still runs. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

test("a step whose access names a broker reaches it on loopback, and the broker stops with the attempt", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "build",
      steps: {
        build: {
          ...stepRunning(
            `printenv MEDRENGARD_BROKER_MODEL > "$1/url"
             curl -sS --noproxy '*' -H 'Authorization: Bearer placeholder' "$MEDRENGARD_BROKER_MODEL/v1" > "$1/brokered"
             echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            "end",
            [directory],
          ),
          access: {
            ...access,
            network: {
              hosts: [],
              brokers: { model: [process.execPath, join(directory, "broker.mjs")] },
            },
          },
        },
      },
    }),
  );

  await brokerIn(directory, "brokered");

  const ended = await engine.advance("first");

  assert.partialDeepStrictEqual(
    ended,
    { status: "finished" },
    engine.errors("first", 1).toString(),
  );

  const read = (name: string) => readFile(join(directory, name), "utf8");

  assert.match(await read("url"), /^http:\/\/127\.0\.0\.1:\d+\n$/);
  assert.equal(await read("brokered"), "brokered Bearer placeholder");
  // Outside the sandbox, on a socket of the engine's, not the step's.
  assert.doesNotMatch(await read("socket"), /^\/network\//);
  assert.equal(running(Number(await read("pid"))), false);
});

test("a broker that ends before it listens escalates its attempt, which never starts its program", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) =>
    defineWorkflow({
      start: "build",
      steps: {
        build: {
          ...stepRunning(`touch "$1/ran"`, "end", [directory]),
          access: {
            ...access,
            network: {
              hosts: [],
              brokers: { model: ["sh", "-c", "echo 'no credential' >&2; exit 1"] },
            },
          },
        },
      },
    }),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "broker",
    reason: "Step build's broker model ended before it listened: no credential",
  });
  assert.equal(existsSync(join(directory, "ran")), false);
});

for (const [what, network, problem] of [
  [
    "no hosts",
    { hosts: [] },
    "network access must be true, false, or hosts it may reach and any brokers, each a name of lowercase letters and digits and a program",
  ],
  [
    "a broker with no program",
    { hosts: [], brokers: { model: [] } },
    "network access must be true, false, or hosts it may reach and any brokers, each a name of lowercase letters and digits and a program",
  ],
  [
    "a broker whose name is not lowercase letters and digits",
    { hosts: [], brokers: { "Model-API": ["broker"] } },
    "network access must be true, false, or hosts it may reach and any brokers, each a name of lowercase letters and digits and a program",
  ],
  [
    "a host that is no host",
    { hosts: ["not a host"] },
    "network access must be true, false, or hosts it may reach and any brokers, each a name of lowercase letters and digits and a program",
  ],
] as const) {
  test(`access whose network lists ${what} cannot be commissioned`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

    t.after(() => rm(directory, { recursive: true, force: true }));

    const engine = createEngine({
      log: join(directory, "log.sqlite"),
      kinds: builtIn,
      defaults: { limits: defaultLimits },
      workflows: {
        build: {
          start: "build",
          steps: {
            build: {
              ...stepRunning("true", "end"),
              // As a factory written in JavaScript could give it.
              access: { ...access, network: JSON.parse(JSON.stringify(network)) },
            },
          },
        },
      },
    });

    assert.throws(() => engine.commission("build", "first", { title: "T", body: "B" }), {
      message: `Workflow build is invalid: step build's ${problem}.`,
    });
  });
}

test("access whose paths name /network, where the step's proxy goes, cannot be commissioned", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const engine = createEngine({
    log: join(directory, "log.sqlite"),
    kinds: builtIn,
    defaults: { limits: defaultLimits },
    workflows: {
      build: {
        start: "build",
        steps: {
          build: {
            ...stepRunning("true", "end"),
            access: { ...access, paths: [...access.paths, { path: "/network", mode: "read" }] },
          },
        },
      },
    },
  });

  assert.throws(() => engine.commission("build", "first", { title: "T", body: "B" }), {
    message: /paths cannot name \/workspace, \/input, \/output or \/network/,
  });
});
