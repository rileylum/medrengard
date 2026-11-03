import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { builtIn } from "../defaults/kinds.ts";
import { createEngine } from "./engine.ts";
import { isRecord, isText } from "./json.ts";
import type { Kind, Kinds } from "./kinds.ts";
import { defineWorkflow, type Access, type Query, type Workflow } from "./replay.ts";

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
};

// Every kind a step may claim, so a test step is refused only by the claim it tests.
const claims = ["document", "commit", "verdict"];

/**
 * Starts an engine whose one workflow, `build`, is made by `workflow` from the test's directory,
 * with the kinds `kinds` makes from it, the built-ins unless given, and commissions `first` under
 * it. Returns the options too, so a test can start a second engine
 * on the same log.
 */
async function engineWith<N extends string>(
  t: TestContext,
  workflow: (directory: string) => Workflow<N>,
  kinds: (directory: string) => Kinds = () => builtIn,
) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const options = {
    log: join(directory, "log.sqlite"),
    kinds: kinds(directory),
    workflows: { build: workflow(directory) },
  };

  const engine = createEngine(options);

  engine.commission("build", "first", { title: "Greet", body: "Say hello." });

  return { engine, directory, options };
}

/**
 * Starts an engine with a single command step that runs `script`, ends on `done`, repeats on
 * `again`, has a budget of 2 and the given limits. The script's `$1` is a file it may append to,
 * named `started` in the returned directory.
 */
function engineRunning(
  t: TestContext,
  script: string,
  limits = { idle: 1, attempt: 5, transcript: 65536, input: 65536 },
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
function engineConfined(t: TestContext, confined: (directory: string) => Access, script: string) {
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
          limits: { idle: 5, attempt: 10, transcript: 65536, input: 65536 },
        },
      },
    }),
  );
}

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

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
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
    reason: "Step build claimed a document without its title.",
  });
});

test("a claimed body the step did not write escalates", async (t) => {
  const { engine } = await engineClaiming(t, "true", planAt("plan.md"));

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
    reason: 'Step build claimed a body it did not write: "plan.md".',
  });
});

test("a claimed body outside the step's output escalates", async (t) => {
  const { engine } = await engineClaiming(
    t,
    `ln -s "$MEDRENGARD_IN/input.json" "$MEDRENGARD_OUT/plan.md"`,
    planAt("plan.md"),
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
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
function agentWithSkills(directory: string, skills: readonly string[], input = 65536) {
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
          prompt: "Plan the change.",
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
    reason: "Step plan's inputs and skills are 100 bytes, over its input limit of 64.",
  });
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
    reason: "Step check claimed a verdict verdict that is not one of pass, fail.",
  });
});

test("a claimed verdict summary over its size limit escalates", async (t) => {
  const { engine } = await engineJudging(t, verdictOf("pass", "x".repeat(201), "findings.md"));

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "check" },
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
        "Workflow build is invalid: step build's inputs must each be subject, request, or a query of its steps, a kind, a subject and latest or all.",
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
        "Workflow build is invalid: step build's inputs must each be subject, request, or a query of its steps, a kind, a subject and latest or all.",
    },
  );
});

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
    reason: "Step build exited with code 3.",
  });
});

test("a step that exits 0 without output.json escalates its commission", async (t) => {
  const { engine } = await engineRunning(t, "true");

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
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
    reason: 'Step build claimed an outcome it does not declare: "shipped".',
  });
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
    reason: "Step build exited with code 1.",
  });
  assert.match(engine.transcript("second", 1).toString(), /execvp .*missing: No such file/);
});

test("a step that has spent its budget escalates instead of starting again", async (t) => {
  const { engine, directory } = await engineRunning(t, claimingAgain);

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "build" },
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
      reason: "Step build was interrupted.",
    });
  },
);

test("an engine error during an attempt escalates the commission, naming the error", async (t) => {
  // The step makes the store read-only, so the engine fails to keep its transcript.
  const { engine, directory } = await engineRunning(
    t,
    `echo "a transcript of its own: $$"
     chmod a-w "$(dirname "$1")/store"
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  const state = await engine.advance("first").finally(() => chmod(join(directory, "store"), 0o755));

  assert.partialDeepStrictEqual(state, { status: "escalated", step: { name: "build" } });
  assert.ok(state.status === "escalated");
  assert.match(state.reason, /^Step build failed in the engine: EACCES: permission denied/);
});

test("an attempt this engine stopped running without recording its end escalates at the next advance", async (t) => {
  // The step makes the log's directory read-only, so neither the attempt's end nor an escalation
  // can be written.
  const { engine, directory } = await engineRunning(
    t,
    `chmod a-w "$(dirname "$1")"
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  await assert.rejects(engine.advance("first").finally(() => chmod(directory, 0o755)));

  // The attempt is held by this process, which is alive but no longer running it.
  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
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
    reason: "Step build was cancelled by the owner.",
  });
});

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
      access,
      60,
    );

    const running = engine.advance("first");

    await untilWritten(directory, "verifier");
    createEngine(options).cancel("first");

    assert.partialDeepStrictEqual(await running, {
      status: "escalated",
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
          },
        },
      }),
    );

    const running = engine.advance("first");

    await untilWritten(directory, "materialiser");
    createEngine(options).cancel("first");

    assert.partialDeepStrictEqual(await running, {
      status: "escalated",
      reason: "Step build was cancelled by the owner.",
    });
    assert.equal(await readFile(join(directory, "materialiser"), "utf8"), "started\n");
    await assert.rejects(readFile(join(directory, "started")), { code: "ENOENT" });
  },
);

test(
  "cancelling an attempt no engine is running escalates it at once",
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

    engine.cancel("first");

    assert.partialDeepStrictEqual(engine.state("first"), {
      status: "escalated",
      reason: "Step build was cancelled by the owner.",
    });
  },
);

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

test("a retry renews the budget of the escalated step", async (t) => {
  const { engine, directory } = await engineRunning(t, claimingAgain);

  await engine.advance("first");
  engine.decide("first", { subject: subjectOf(engine), since: sinceOf(engine), outcome: "retry" });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
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
      { document, memo: { ...memo, verifier: { run: ["true"], access, limit: 0 } } },
      "Kind memo is invalid: its verifier's limit must be a positive number of seconds, at most 2147483.",
    ],
    [
      { document, memo: { ...memo, verifier: { run: [], access, limit: 1 } } },
      "Kind memo is invalid: its verifier's program must be a command and its arguments.",
    ],
    [
      {
        document,
        memo: {
          ...memo,
          materialiser: { run: ["true"], access: { ...access, network: "yes" }, limit: 1 },
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
      { document: { ...document, verifier: { run: ["true"], access, limit: 1 } } },
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
 * a verifier that runs `script` under `verifying` for at most `limit` seconds, its `$1` the test's
 * directory.
 */
function engineVerifying(t: TestContext, script: string, verifying = access, limit = 5) {
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
        verifier: { run: ["sh", "-c", script, "sh", directory], access: verifying, limit },
      },
    }),
  );
}

test("a kind's verifier sees the claim's fields and body, and its rejection escalates", async (t) => {
  const { engine, directory } = await engineVerifying(
    t,
    `cp -r "$MEDRENGARD_IN"/. "$1"; echo '{"accepted":false,"reason":"No."}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
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
    { ...access, workspace: "read" },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    reason:
      "The memo verifier failed on step build's claim: it exited with code 1. Its stderr: \"touch: cannot touch 'written': Read-only file system\\n\".",
  });
});

test("a kind's verifier past its limit is stopped and escalates", async (t) => {
  const { engine } = await engineVerifying(t, "sleep 5", access, 1);

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    reason: "The memo verifier failed on step build's claim: it reached its limit of 1 s.",
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
      reason: "Step build has spent its budget of 2 attempts.",
    },
    { entry: "decision", step: "build", outcome: "abandon", subject, feedback: "Enough." },
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
      assert.partialDeepStrictEqual(entry, { entry: "attempt", running: true, notes: ["first"] });
      break;
    }

    await sleep(20);
  }

  await advancing;

  assert.partialDeepStrictEqual(engine.record("first").entries, [
    { entry: "attempt", outcome: "done", notes: ["first", "second", "third"] },
  ]);
});

test("a note over its limit stops the step, which escalates", async (t) => {
  const { engine } = await engineRunning(t, `head -c 5000 /dev/zero | tr '\\0' a >&3; sleep 5`);

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
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
test("the log's events are exactly the six types, each with its pinned fields", async (t) => {
  const { engine, options } = await engineWith(t, () =>
    defineWorkflow({
      start: "build",
      steps: {
        build: stepRunning(
          `echo note >&3; echo warning >&2; printf 'Do it.' > "$MEDRENGARD_OUT/plan.md"
           echo '${JSON.stringify(planAt("plan.md"))}' > "$MEDRENGARD_OUT/output.json"`,
          "review",
        ),
        review: { kind: "approval", on: { approve: "fail" } },
        fail: { ...stepRunning("echo broken >&2; exit 3", "end"), inputs: { plan: "subject" } },
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
    process: { pid: "number", start: "number" },
    at: "number",
  });

  assert.deepEqual(vocabulary, [
    {
      type: "commissioned",
      workflow: "string",
      definition: "string",
      request: "string",
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
      reason: "string",
      attempt: "number",
      transcript: "string",
      errors: "string",
      at: "number",
    },
  ]);
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
          claims,
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
          on: { done: "end" },
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
  assert.equal(await read("descriptors"), "0\n1\n2\n3\n");
  assert.equal(await read("listing"), ".skills\ninput.json\nrequest\n");

  // A kind's rules are its schema, defined by the kind, so only the keys of each are pinned here.
  const { claims: rules, ...input } = typesIn(await read("input.json"), []);

  assert.deepEqual(input, {
    commission: "string",
    step: "string",
    attempt: "number",
    outcomes: ["string"],
    inputs: {
      request: [{ hash: "string", kind: "string", fields: { title: "string" }, body: "string" }],
    },
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
