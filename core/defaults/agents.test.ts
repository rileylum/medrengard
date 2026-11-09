import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../src/engine.ts";
import { defineWorkflow } from "../src/replay.ts";
import { contract } from "./access.ts";
import { agent } from "./agents.ts";
import { builtIn } from "./kinds.ts";
import { limits } from "./limits.ts";

// A harness that copies its input.json to the directory it is given, and claims done.
const copying = (out: string) => ({
  run: [
    "sh",
    "-c",
    `set -e; cp "$MEDRENGARD_IN/input.json" "$1"; echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    "sh",
    out,
  ] as const,
});

const harnesses = { fake: { run: ["true"] as const }, other: { run: ["false"] as const } };

/** Writes `text` as an agent file in a directory of the test's own, and returns its path. */
async function agentFile(t: TestContext, text: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "agent.md"), text);

  return join(directory, "agent.md");
}

test("an agent file's frontmatter names its harness, model and skills, and its body is its prompt", async (t) => {
  const path = await agentFile(
    t,
    "---\nharness: other\nmodel: 1.10\nskills:\n  - ../review\n  - tests\n---\nReview it.\n\nCarefully.\n",
  );

  const directory = join(path, "..");

  assert.deepEqual(agent(path, harnesses), {
    harness: harnesses.other,
    model: "1.10",
    prompt: "Review it.\n\nCarefully.\n",
    skills: [join(directory, "..", "review"), join(directory, "tests")],
  });
});

test("an agent file without skills has none", async (t) => {
  const path = await agentFile(t, "---\nmodel: m\nharness: fake\n---\nGo.");

  assert.deepEqual(agent(path, harnesses), {
    harness: harnesses.fake,
    model: "m",
    prompt: "Go.",
  });
});

for (const [what, text, problem] of [
  [
    "does not start with frontmatter",
    "harness: fake\n",
    "it must start with --- and its frontmatter",
  ],
  ["has no closing ---", "---\nharness: fake\nmodel: m\n", "its frontmatter must end with ---"],
  ["has a line that is no key and value", "---\nharness fake\n", "line 2 must be key: value"],
  ["has a blank line", "---\nharness: fake\n\nmodel: m\n---\n", "line 3 must be key: value"],
  ["has a comment", "---\n# the reviewer\nharness: fake\n", "line 2 must be key: value"],
  [
    "quotes a value",
    '---\nmodel: "m"\n',
    "line 2's value must be plain text, without quotes or brackets",
  ],
  [
    "writes a flow list",
    "---\nskills: [a, b]\n",
    "line 2's value must be plain text, without quotes or brackets",
  ],
  ["nests a value", "---\nharness: fake\n  model: m\n", "line 3 must be key: value"],
  ["lists under a key other than skills", "---\nmodel:\n  - m\n", "line 2: only skills is a list"],
  ["states a key twice", "---\nmodel: m\nmodel: n\n", "line 3 states model again"],
  [
    "states an unknown key",
    "---\ncolour: red\n",
    "line 2 states colour, which an agent file does not define",
  ],
  ["leaves out its model", "---\nharness: fake\n---\nGo.", "its frontmatter must state model"],
  [
    "names a harness the factory lacks",
    "---\nharness: gone\nmodel: m\n---\nGo.",
    "its harness gone is not one of fake, other",
  ],
] as const) {
  test(`an agent file that ${what} is refused`, async (t) => {
    const path = await agentFile(t, text);

    assert.throws(() => agent(path, harnesses), {
      message: `Agent file ${path} is invalid: ${problem}.`,
    });
  });
}

test("a step runs an agent from a file with its prompt as the file said when commissioned", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "out"));
  await mkdir(join(directory, "record"));
  await mkdir(join(directory, "review"));
  await writeFile(join(directory, "review", "SKILL.md"), "Look closely.");
  await writeFile(
    join(directory, "reviewer.md"),
    "---\nharness: fake\nmodel: m\nskills:\n  - review\n---\nReview it.\n",
  );

  const engine = createEngine({
    kinds: builtIn,
    defaults: { limits },
    // Apart from the directory the step may write, since every step is kept out of the log's.
    log: join(directory, "record", "log.sqlite"),
    workflows: {
      build: defineWorkflow({
        start: "review",
        steps: {
          review: {
            kind: "agent",
            agent: agent(join(directory, "reviewer.md"), { fake: copying(join(directory, "out")) }),
            workspace: "empty",
            inputs: {},
            claims: [],
            on: { done: "end" },
            budget: 1,
            access: { ...contract, paths: [...contract.paths, { path: directory, mode: "write" }] },
          },
        },
      }),
    },
  });

  engine.commission("build", "first", { title: "T", body: "B" });

  // Edited after commissioning: the commission runs on the prompt it started with.
  await writeFile(join(directory, "reviewer.md"), "---\nharness: fake\nmodel: m\n---\nChanged.\n");

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });

  const input = JSON.parse(await readFile(join(directory, "out", "input.json"), "utf8"));

  assert.deepEqual(input.agent, {
    model: "m",
    prompt: "Review it.\n",
    skills: [{ name: "review", path: ".skills/review" }],
  });
});
