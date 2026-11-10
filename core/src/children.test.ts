import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { builtIn } from "../defaults/kinds.ts";
import { limits } from "../defaults/limits.ts";
import { createEngine } from "./engine.ts";
import type { Access, Wait, Workflow } from "./definition.ts";
import type { CommissionState } from "./replay.ts";

// A factory's workflows, by name.
type Workflows = Parameters<typeof createEngine>[0]["workflows"];

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

/** A command step that runs `script`, with `$1` the test's directory, and claims what it writes. */
function command(
  script: string,
  on: Record<string, string>,
  directory: string,
  claims = ["document"],
) {
  return {
    kind: "command",
    claims,
    workspace: "empty",
    inputs: {},
    run: ["sh", "-c", script, "sh", directory],
    on,
    access,
    budget: 1,
    limits: { idle: 30, attempt: 60, transcript: 65536, input: 65536 },
  } as const;
}

// A claim of the outcome done with one document titled `title`, whose body is the file `body`.
const documentClaim = (title: string, body: string) =>
  `printf '{"outcome":"done","artifacts":[{"kind":"document","fields":{"title":"%s"},"body":"%s"}]}' "${title}" "${body}" > "$MEDRENGARD_OUT/output.json"`;

/**
 * Starts an engine on the factory `workflows` makes from the test's directory, and commissions
 * `first` under the workflow `build`.
 */
async function engineWith(t: TestContext, workflows: (directory: string) => Workflows) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "record"));

  const factory = workflows(directory);

  const engine = createEngine({
    log: join(directory, "record", "log.sqlite"),
    kinds: builtIn,
    defaults: { limits },
    workflows: factory,
  });

  engine.commission("build", "first", { title: "Plan", body: "Plan three tasks." });

  return { engine, directory, factory };
}

type Engine = Awaited<ReturnType<typeof engineWith>>["engine"];

/**
 * Advances every commission at once, as `run` does, until `first` is no longer attempting or
 * ready, and returns its state: each commission is looked at again as soon as it settles, or every
 * 50 ms, which carries a parent's wait on while its children run.
 */
async function settle(engine: Engine, limit = 30_000): Promise<CommissionState> {
  const advancing = new Map<string, Promise<unknown>>();
  const deadline = Date.now() + limit;

  while (Date.now() < deadline) {
    const state = engine.state("first");

    if (state.status !== "attempting" && state.status !== "ready") {
      await Promise.all(advancing.values());

      return engine.state("first");
    }

    for (const entry of engine.commissions()) {
      if ("error" in entry || advancing.has(entry.commission)) {
        continue;
      }

      if (entry.state.status === "ready" || entry.state.status === "attempting") {
        const done = engine
          .advance(entry.commission)
          .finally(() => advancing.delete(entry.commission));

        advancing.set(entry.commission, done);
      }
    }

    // A parent's look does no I/O, so a round always yields to it too: the children's programs
    // end through it.
    await Promise.race([...advancing.values(), sleep(50)]);
    await sleep(5);
  }

  const states = engine
    .commissions()
    .map(
      (entry) =>
        `${entry.commission}: ${JSON.stringify("state" in entry ? entry.state : entry.error)}`,
    );

  throw new Error(`first did not settle within ${limit} ms:\n${states.join("\n")}`);
}

// A child workflow of one step that claims a document titled after its request's title.
const task = (directory: string): Workflow => ({
  start: "work",
  steps: {
    work: {
      ...command(
        `title=$(sed -n 's/.*"title":"\\([^"]*\\)".*/\\1/p' "$MEDRENGARD_IN/input.json" | head -n 1)
         echo "did $title" > "$MEDRENGARD_OUT/result.md"
         ${documentClaim("did $title", "result.md")}`,
        { done: "end" },
        directory,
      ),
      inputs: { request: "request" },
    },
  },
});

// A plan step that claims three task documents, then the children step over them, then a step
// that writes what the children query gives it to `gathered` in the test's directory.
const mapping = (directory: string, concurrent = 3, width = 3): Workflows => ({
  build: {
    start: "plan",
    steps: {
      plan: command(
        `for n in 1 2 3; do echo "task $n" > "$MEDRENGARD_OUT/$n.md"; done
         printf '{"outcome":"done","artifacts":[%s,%s,%s]}' \
           '{"kind":"document","fields":{"title":"one"},"body":"1.md"}' \
           '{"kind":"document","fields":{"title":"two"},"body":"2.md"}' \
           '{"kind":"document","fields":{"title":"three"},"body":"3.md"}' > "$MEDRENGARD_OUT/output.json"`,
        { done: "fanOut" },
        directory,
      ),
      fanOut: {
        kind: "children",
        workflow: "task",
        each: { from: ["plan"], kind: "document" },
        width,
        concurrent,
        wait: "all",
        on: { done: "gather" },
        budget: 1,
        limits: { wait: 60 },
      },
      gather: {
        ...command(
          `cp "$MEDRENGARD_IN/input.json" "$1/gathered"; printf '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
          { done: "end" },
          directory,
        ),
        inputs: { results: { children: "fanOut", kind: "document" } },
      },
    },
  },
  task: task(directory),
});

test("a children step maps a workflow over the documents a step claimed, and a later step reads what each child claimed", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) => mapping(directory));

  assert.partialDeepStrictEqual(await settle(engine), { status: "finished", by: "end" });

  const gathered = JSON.parse(await readFile(join(directory, "gathered"), "utf8"));
  const results = gathered.inputs.results;

  // One per child, in the order commissioned, each its latest document, naming the child.
  assert.deepEqual(
    results.map(({ fields, commission }: { fields: { title: string }; commission: string }) => [
      fields.title,
      commission,
    ]),
    [
      ["did one", "first.fanOut.2.1"],
      ["did two", "first.fanOut.2.2"],
      ["did three", "first.fanOut.2.3"],
    ],
  );

  // Each child is a commission of its own, finished at its end, about its own request.
  assert.partialDeepStrictEqual(engine.state("first.fanOut.2.2"), {
    status: "finished",
    by: "end",
  });
  assert.equal(engine.record("first.fanOut.2.2").request.artifact.fields.title, "two");
});

test("a children step has at most concurrent children unfinished at once", async (t) => {
  const { engine } = await engineWith(t, (directory) => mapping(directory, 2));

  // plan runs, then the children step starts and commissions what it may.
  await engine.advance("first");

  const children = engine
    .commissions()
    .filter(({ commission }) => commission.startsWith("first.fanOut."));

  assert.deepEqual(
    children.map(({ commission }) => commission),
    ["first.fanOut.2.1", "first.fanOut.2.2"],
  );
  assert.partialDeepStrictEqual(await settle(engine), { status: "finished", by: "end" });
  assert.equal(
    engine.commissions().filter(({ commission }) => commission.startsWith("first.fanOut.")).length,
    3,
  );
});

test("a child starts with the artifacts given it, the latest subject among them its subject", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) => ({
    build: {
      start: "write",
      steps: {
        write: command(
          `echo draft > "$MEDRENGARD_OUT/draft.md"; ${documentClaim("Draft", "draft.md")}`,
          { done: "review" },
          directory,
        ),
        review: {
          kind: "children",
          workflow: "look",
          count: 2,
          given: { draft: "subject" },
          width: 2,
          concurrent: 2,
          wait: "all",
          on: { done: "end" },
          budget: 1,
          limits: { wait: 60 },
        },
      },
    },
    look: {
      start: "read",
      steps: {
        read: {
          ...command(
            `cat "$MEDRENGARD_IN/subject/"* > "$1/seen-$(basename "$MEDRENGARD_IN")"; printf '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
            { done: "end" },
            directory,
          ),
          inputs: { subject: "subject" },
        },
      },
    },
  }));

  assert.partialDeepStrictEqual(await settle(engine), { status: "finished", by: "end" });

  const record = engine.record("first");
  const draft = record.entries.find((entry) => entry.entry === "attempt" && "artifacts" in entry);

  assert.ok(draft?.entry === "attempt" && "artifacts" in draft);

  // The child's request is the parent's; its subject, the draft it was given.
  assert.equal(engine.record("first.review.2.1").request.artifact.fields.title, "Plan");
  assert.match(await readFile(join(directory, "seen-input"), "utf8"), /^draft\n$/);
});

// A review that passes, unless it is the first child, which fails.
const review = (directory: string): Workflow => ({
  start: "judge",
  steps: {
    judge: command(
      `case "$(sed -n 's/.*"commission":"\\([^"]*\\)".*/\\1/p' "$MEDRENGARD_IN/input.json")" in
         *.1) verdict=fail ;;
         *) verdict=pass ;;
       esac
       printf '{"outcome":"%s","artifacts":[{"kind":"verdict","fields":{"verdict":"%s"}}]}' $verdict $verdict > "$MEDRENGARD_OUT/output.json"`,
      { pass: "end", fail: "end" },
      directory,
      ["verdict"],
    ),
  },
});

// A panel of three reviews of the request, waiting as `wait` says, then `merge` or `fix`, each of
// which writes its name to `routed` and what the children query gives it to `verdicts`.
const panel = (directory: string, wait: Wait): Workflows => ({
  build: {
    start: "panel",
    steps: {
      panel: {
        kind: "children",
        workflow: "review",
        count: 3,
        width: 3,
        concurrent: 3,
        wait,
        on: { met: "merge", unmet: "fix" },
        budget: 1,
        limits: { wait: 60 },
      },
      merge: {
        ...command(
          `echo merge > "$1/routed"; cp "$MEDRENGARD_IN/input.json" "$1/verdicts"; printf '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
          { done: "end" },
          directory,
        ),
        inputs: { verdicts: { children: "panel", kind: "verdict" } },
      },
      fix: {
        ...command(
          `echo fix > "$1/routed"; cp "$MEDRENGARD_IN/input.json" "$1/verdicts"; printf '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
          { done: "end" },
          directory,
        ),
        inputs: { verdicts: { children: "panel", kind: "verdict" } },
      },
    },
  },
  review: review(directory),
});

for (const [what, wait, routed] of [
  ["at least two of three pass", { atLeast: 2, outcome: "pass" }, "merge"],
  ["all must pass and one fails", { all: "pass" }, "fix"],
] as const) {
  test(`a children step waiting on its children's outcome routes met or unmet: ${what}`, async (t) => {
    const { engine, directory } = await engineWith(t, (directory) => panel(directory, wait));

    assert.partialDeepStrictEqual(await settle(engine), { status: "finished", by: "end" });
    assert.equal(await readFile(join(directory, "routed"), "utf8"), `${routed}\n`);

    // Every child that reached its end is read, failing verdicts too, for the step that fixes. A
    // child still running once the wait was decided was withdrawn, so it may be missing.
    const verdicts: string[] = JSON.parse(
      await readFile(join(directory, "verdicts"), "utf8"),
    ).inputs.verdicts.map(({ fields }: { fields: { verdict: string } }) => fields.verdict);

    assert.ok(
      routed === "merge"
        ? verdicts.filter((verdict) => verdict === "pass").length >= 2
        : verdicts.includes("fail"),
      JSON.stringify(verdicts),
    );
  });
}

test("a children step waiting on the first child withdraws the rest, stopping one in flight", async (t) => {
  const { engine } = await engineWith(t, (directory) => ({
    build: {
      start: "race",
      steps: {
        race: {
          kind: "children",
          workflow: "runner",
          count: 2,
          width: 2,
          concurrent: 2,
          wait: "first",
          on: { done: "end" },
          budget: 1,
          limits: { wait: 60 },
        },
      },
    },
    runner: {
      start: "run",
      steps: {
        run: command(
          `case "$(sed -n 's/.*"commission":"\\([^"]*\\)".*/\\1/p' "$MEDRENGARD_IN/input.json")" in
             *.2) sleep 20 ;;
           esac
           printf '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
          { done: "end" },
          directory,
        ),
      },
    },
  }));

  assert.partialDeepStrictEqual(await settle(engine), { status: "finished", by: "end" });

  // The slow child was stopped, its attempt kept, and finished as withdrawn.
  assert.partialDeepStrictEqual(engine.state("first.race.1.2"), {
    status: "finished",
    by: "withdrawn",
  });
  assert.partialDeepStrictEqual(engine.record("first.race.1.2").entries, [
    { entry: "attempt", escalated: "Commission first's step race no longer waits for it." },
    { entry: "withdrawal", reason: "Commission first's step race no longer waits for it." },
  ]);

  // Constraint 7: a child's own events are pinned here, with every field each holds: the one that
  // commissioned it, naming its parent and what it was given, and the one that withdrew it.
  const fields = Object.fromEntries(
    engine
      .events(0)
      .filter(({ commission }) => commission === "first.race.1.2")
      .map(({ event }) => [event.type, Object.keys(event).toSorted()]),
  );

  assert.deepEqual(fields.commissioned, [
    "at",
    "definition",
    "engine",
    "given",
    "parent",
    "request",
    "type",
    "workflow",
  ]);
  assert.deepEqual(fields.withdrawn, ["at", "reason", "type"]);
});

test("a children step escalates at its wait limit, withdrawing the children still running", async (t) => {
  const { engine } = await engineWith(t, (directory) => ({
    build: {
      start: "slow",
      steps: {
        slow: {
          kind: "children",
          workflow: "runner",
          count: 1,
          width: 1,
          concurrent: 1,
          wait: "all",
          on: { done: "end" },
          budget: 1,
          limits: { wait: 1 },
        },
      },
    },
    runner: {
      start: "run",
      steps: {
        run: command(
          `sleep 20; printf '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
          { done: "end" },
          directory,
        ),
      },
    },
  }));

  assert.partialDeepStrictEqual(await settle(engine), {
    status: "escalated",
    cause: "limit",
    reason: "Step slow waited 1 s for its children, its wait limit.",
  });
  assert.partialDeepStrictEqual(engine.state("first.slow.1.1"), {
    status: "finished",
    by: "withdrawn",
  });
});

test("cancelling a children step withdraws its children and escalates", async (t) => {
  const { engine } = await engineWith(t, (directory) => ({
    build: {
      start: "slow",
      steps: {
        slow: {
          kind: "children",
          workflow: "runner",
          count: 1,
          width: 1,
          concurrent: 1,
          wait: "all",
          on: { done: "end" },
          budget: 1,
          limits: { wait: 60 },
        },
      },
    },
    runner: {
      start: "run",
      steps: {
        run: command(
          `sleep 20; printf '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
          { done: "end" },
          directory,
        ),
      },
    },
  }));

  await engine.advance("first");
  engine.cancel("first");

  assert.partialDeepStrictEqual(await settle(engine), {
    status: "escalated",
    cause: "cancelled",
    reason: "Step slow was cancelled by the owner.",
  });
  assert.partialDeepStrictEqual(engine.state("first.slow.1.1"), {
    status: "finished",
    by: "withdrawn",
  });
});

test("a children step with more children to start than its width escalates, spending no budget", async (t) => {
  const { engine } = await engineWith(t, (directory) => mapping(directory, 2, 2));

  assert.partialDeepStrictEqual(await settle(engine), {
    status: "escalated",
    cause: "limit",
    reason: "Step fanOut has 3 children to start, over its width of 2.",
  });
  assert.equal(
    engine.record("first").entries.filter((entry) => entry.entry === "attempt").length,
    1,
  );
});

test("a step adopts a child's artifact it was given, which becomes the parent's subject", async (t) => {
  const { engine } = await engineWith(t, (directory) => ({
    build: {
      start: "tries",
      steps: {
        tries: {
          kind: "children",
          workflow: "task",
          count: 2,
          width: 2,
          concurrent: 2,
          wait: "all",
          on: { done: "pick" },
          budget: 1,
          limits: { wait: 60 },
        },
        pick: {
          ...command(
            `hash=$(sed -n 's/.*"hash":"\\([0-9a-f]*\\)".*"commission":"first.tries.1.2".*/\\1/p' "$MEDRENGARD_IN/input.json")
             printf '{"outcome":"done","artifacts":[{"adopt":"%s"}]}' "$hash" > "$MEDRENGARD_OUT/output.json"`,
            { done: "end" },
            directory,
          ),
          inputs: { tries: { children: "tries", kind: "document" } },
        },
      },
    },
    task: task(directory),
  }));

  assert.partialDeepStrictEqual(await settle(engine), { status: "finished", by: "end" });

  const second = engine
    .record("first.tries.1.2")
    .entries.find((entry) => entry.entry === "attempt" && "artifacts" in entry);

  const pick = engine.record("first").entries.at(-1);

  assert.ok(second?.entry === "attempt" && "artifacts" in second);
  assert.ok(pick?.entry === "attempt" && "artifacts" in pick);
  assert.equal(pick.artifacts[0]?.hash, second.artifacts[0]?.hash);
});

test("a step cannot adopt an artifact it was not given", async (t) => {
  const { engine } = await engineWith(t, (directory) => ({
    build: {
      start: "pick",
      steps: {
        pick: command(
          `printf '{"outcome":"done","artifacts":[{"adopt":"%064d"}]}' 0 > "$MEDRENGARD_OUT/output.json"`,
          { done: "end" },
          directory,
        ),
      },
    },
  }));

  assert.partialDeepStrictEqual(await settle(engine), {
    status: "escalated",
    cause: "claim",
    reason: `Step pick adopted an artifact it was not given: "${"0".repeat(64)}".`,
  });
});

// Git with an identity, and no signing or hooks a developer's configuration could add.
const git = "git -c user.name=Test -c user.email=test@example.com -c commit.gpgsign=false";

// A claim of the outcome done with the workspace's HEAD as a commit.
const claimHead = `printf '{"outcome":"done","artifacts":[{"kind":"commit","fields":{"sha":"%s"}}]}' "$(git rev-parse HEAD)" > "$MEDRENGARD_OUT/output.json"`;

// A setup step that commits base.txt, writing its SHA to `base`; two children that each commit
// child-<n>.txt on it; and an integrate step whose workspace is built from `base`, one of its
// inputs, with the children's commits as branches. It writes what it sees, merges them and claims
// the merge.
const integrating = (directory: string, base: "request" | "commit"): Workflows => ({
  build: {
    start: "setup",
    steps: {
      setup: command(
        `git init -q; echo base > base.txt; git add base.txt; ${git} commit -q --no-verify -m base
         git rev-parse HEAD > "$1/base"; ${claimHead}`,
        { done: "fanOut" },
        directory,
        ["commit"],
      ),
      fanOut: {
        kind: "children",
        workflow: "change",
        count: 2,
        given: { base: "subject" },
        width: 2,
        concurrent: 2,
        wait: "all",
        on: { done: "integrate" },
        budget: 1,
        limits: { wait: 60 },
      },
      integrate: {
        ...command(
          `git rev-parse HEAD > "$1/head"
           git for-each-ref --format='%(refname)' refs/heads/built-* > "$1/refs"
           git remote > "$1/remotes"
           cp "$MEDRENGARD_IN/input.json" "$1/integrated"
           ${git} merge -q --no-edit built-1 built-2
           ls > "$1/merged"; ${claimHead}`,
          { done: "end" },
          directory,
          ["commit"],
        ),
        inputs: {
          base:
            base === "request" ? "request" : { from: ["setup"], kind: "commit", take: "latest" },
          built: { children: "fanOut", kind: "commit" },
        },
        workspace: { input: "base", branches: "built" },
      },
    },
  },
  change: {
    start: "edit",
    steps: {
      edit: {
        ...command(
          `n=$(sed -n 's/.*"commission":"[^"]*\\.\\([0-9]*\\)".*/\\1/p' "$MEDRENGARD_IN/input.json")
           echo "child $n" > "child-$n.txt"; git add .; ${git} commit -q --no-verify -m "child $n"
           ${claimHead}`,
          { done: "end" },
          directory,
          ["commit"],
        ),
        workspace: "subject",
      },
    },
  },
});

test("a step's workspace holds its base checked out and each child's commit as a branch, which it can merge", async (t) => {
  const { engine, directory } = await engineWith(t, (directory) =>
    integrating(directory, "commit"),
  );

  assert.partialDeepStrictEqual(await settle(engine), { status: "finished", by: "end" });

  const seen = (file: string) => readFile(join(directory, file), "utf8");

  assert.equal(await seen("head"), await seen("base"));
  assert.equal(await seen("refs"), "refs/heads/built-1\nrefs/heads/built-2\n");
  assert.equal(await seen("remotes"), "");
  assert.equal(await seen("merged"), "base.txt\nchild-1.txt\nchild-2.txt\n");

  // The step is told which branch holds which child's commit.
  const { built } = JSON.parse(await seen("integrated")).inputs;

  assert.deepEqual(
    built.map(({ branch, commission }: { branch: string; commission: string }) => [
      branch,
      commission,
    ]),
    [
      ["built-1", "first.fanOut.2.1"],
      ["built-2", "first.fanOut.2.2"],
    ],
  );
});

test("a workspace cannot add branches of a kind other than its base's", async (t) => {
  const { engine } = await engineWith(t, (directory) => integrating(directory, "request"));

  assert.partialDeepStrictEqual(await settle(engine), {
    status: "escalated",
    cause: "inputs",
    reason: "Step integrate's workspace cannot add the commit built-1 as a branch of a document.",
  });
});

test("a child runs on the workflow as its parent was commissioned, not as the factory says later", async (t) => {
  const { engine, factory, directory } = await engineWith(t, (directory) => mapping(directory));

  // Edited after first was commissioned: its children are not.
  factory.task = {
    start: "other",
    steps: { other: command(`exit 1`, { done: "end" }, directory) },
  };

  assert.partialDeepStrictEqual(await settle(engine), { status: "finished", by: "end" });
  assert.equal(engine.definition("first.fanOut.2.1").workflow.start, "work");
});

for (const [what, workflows, problem] of [
  [
    "children that lead back to their own workflow",
    {
      build: {
        start: "again",
        steps: {
          again: {
            kind: "children",
            workflow: "build",
            count: 1,
            width: 1,
            concurrent: 1,
            wait: "all",
            on: { done: "end" },
            budget: 1,
            limits: { wait: 60 },
          },
        },
      },
    },
    "Workflow build is invalid: step again's children lead back to workflow build, which they are within.",
  ],
  [
    "children of a workflow the factory lacks",
    {
      build: {
        start: "fan",
        steps: {
          fan: {
            kind: "children",
            workflow: "missing",
            count: 1,
            width: 1,
            concurrent: 1,
            wait: "all",
            on: { done: "end" },
            budget: 1,
            limits: { wait: 60 },
          },
        },
      },
    },
    "Workflow build is invalid: step fan's workflow missing is not one of the factory's workflows.",
  ],
  [
    "a wait on an outcome its children's workflow never ends on",
    {
      build: {
        start: "fan",
        steps: {
          fan: {
            kind: "children",
            workflow: "review",
            count: 1,
            width: 1,
            concurrent: 1,
            wait: { all: "approved" },
            on: { met: "end", unmet: "end" },
            budget: 1,
            limits: { wait: 60 },
          },
        },
      },
      review: review(tmpdir()),
    },
    "Workflow build is invalid: step fan's wait counts children ending on approved, which workflow review never ends on.",
  ],
  [
    "a wait on an outcome without met and unmet edges",
    {
      build: {
        start: "fan",
        steps: {
          fan: {
            kind: "children",
            workflow: "review",
            count: 1,
            width: 1,
            concurrent: 1,
            wait: { all: "pass" },
            on: { done: "end" },
            budget: 1,
            limits: { wait: 60 },
          },
        },
      },
      review: review(tmpdir()),
    },
    "Workflow build is invalid: step fan's edges must be met and unmet, the outcomes of its wait.",
  ],
  [
    "a count over its width",
    {
      build: {
        start: "fan",
        steps: {
          fan: {
            kind: "children",
            workflow: "review",
            count: 3,
            width: 2,
            concurrent: 2,
            wait: "all",
            on: { done: "end" },
            budget: 1,
            limits: { wait: 60 },
          },
        },
      },
      review: review(tmpdir()),
    },
    "Workflow build is invalid: step fan's count of 3 is over its width of 2.",
  ],
] as const) {
  test(`commissioning refuses ${what}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

    t.after(() => rm(directory, { recursive: true, force: true }));

    const engine = createEngine({
      log: join(directory, "log.sqlite"),
      kinds: builtIn,
      defaults: { limits },
      // As a factory written in JavaScript could give it.
      workflows: JSON.parse(JSON.stringify(workflows)),
    });

    assert.throws(() => engine.commission("build", "first", { title: "T", body: "B" }), {
      message: problem,
    });
  });
}
