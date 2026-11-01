import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createEngine } from "../src/engine.ts";
import { builtIn } from "../defaults/kinds.ts";
import { defineWorkflow } from "../src/replay.ts";

const adapter = join(import.meta.dirname, "claude-code.ts");

/**
 * Starts an engine whose one agent step, `plan`, runs the Claude Code adapter with a fake `claude`
 * on its PATH, and commissions `first`. The fake runs `script`; its arguments are in the returned
 * directory's `arguments` file, and its input and output directories in `directories`, each ended
 * by a NUL.
 */
async function engineWithClaude(t: TestContext, script: string, args: readonly string[] = []) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const claude = join(directory, "claude");

  await writeFile(
    claude,
    `#!/bin/sh
printf '%s\\0' "$@" > "${join(directory, "arguments")}"
printf '%s\\0' "$MEDRENGARD_IN" "$MEDRENGARD_OUT" > "${join(directory, "directories")}"
${script}
`,
  );
  await chmod(claude, 0o755);

  const engine = createEngine({
    kinds: builtIn,
    log: join(directory, "log.sqlite"),
    workflows: {
      build: defineWorkflow({
        start: "plan",
        steps: {
          plan: {
            kind: "agent",
            claims: ["document"],
            workspace: "empty",
            agent: {
              harness: {
                run: [
                  "env",
                  `PATH=${directory}:${process.env.PATH}`,
                  process.execPath,
                  adapter,
                  ...args,
                ],
              },
              model: "a-model",
              prompt: "Plan the change.",
            },
            inputs: {},
            on: { done: "end" },
            budget: 1,
            // The system, Node and this repository to run the adapter, and the test's directory
            // for the fake claude and what it records.
            access: {
              paths: [
                ...["/usr", "/etc", "/bin", "/lib", "/lib64"].map((path) => ({
                  path,
                  mode: "read" as const,
                })),
                { path: dirname(dirname(process.execPath)), mode: "read" },
                { path: join(import.meta.dirname, ".."), mode: "read" },
                { path: directory, mode: "write" },
              ],
              network: false,
              environment: [],
              workspace: "write",
            },
            limits: { idle: 5, attempt: 10, transcript: 65536, input: 65536 },
          },
        },
      }),
    },
  });

  engine.commission("build", "first", { title: "Greet", body: "Say hello." });

  return { engine, directory };
}

test("the Claude Code adapter runs claude headless with the agent, whose claim completes the attempt", async (t) => {
  const { engine, directory } = await engineWithClaude(
    t,
    `echo '{"type":"result","is_error":false}'
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });

  const fields = async (file: string) =>
    (await readFile(join(directory, file), "utf8")).split("\0").slice(0, -1);

  const [input, output] = await fields("directories");
  const [print, ...rest] = await fields("arguments");
  const prompt = rest.at(-1)!;

  assert.equal(print, "-p");

  // Edits only, in the workspace and the step's input and output: shell commands stay refused.
  assert.deepEqual(rest.slice(0, -1), [
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
    "--add-dir",
    input,
    output,
    "--model",
    "a-model",
  ]);
  assert.ok(prompt.startsWith("Plan the change.\n"));
  assert.ok(prompt.includes('["done"]'));
});

test("the Claude Code adapter tells the agent how to claim only the kinds its step may claim", async (t) => {
  const { engine, directory } = await engineWithClaude(
    t,
    `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  await engine.advance("first");

  const prompt = (await readFile(join(directory, "arguments"), "utf8")).split("\0").at(-2)!;

  assert.ok(prompt.includes(builtIn.document.description));
  assert.ok(prompt.includes('"title"'));
  assert.ok(!prompt.includes(builtIn.commit.description));
  assert.ok(!prompt.includes(builtIn.verdict.description));
});

test("the Claude Code adapter notes what the agent says, each tool it uses and how it finished", async (t) => {
  const events = [
    { type: "system", subtype: "init" },
    {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Reading the codec first.\nThen planning." },
          { type: "tool_use", name: "Bash", input: { command: "git clone --no-local /repo ." } },
          { type: "tool_use", name: "Read", input: { file_path: "shared/src/net/codec.ts" } },
        ],
      },
    },
    { type: "result", is_error: false, num_turns: 3, duration_ms: 1500, total_cost_usd: 0.0123 },
  ];

  const { engine } = await engineWithClaude(
    t,
    `${events.map((event) => `echo '${JSON.stringify(event)}'`).join("\n")}
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  await engine.advance("first");

  assert.partialDeepStrictEqual(engine.record("first").entries, [
    {
      outcome: "done",
      notes: [
        "Reading the codec first. Then planning.",
        "Bash: git clone --no-local /repo .",
        "Read: shared/src/net/codec.ts",
        "Finished in 1.5 s, 3 turns, $0.0123.",
      ],
    },
  ]);
  assert.match(engine.transcript("first", 1).toString(), /"type":"result"/);
});

test("the Claude Code adapter runs claude in the permission mode its harness names", async (t) => {
  const { engine, directory } = await engineWithClaude(
    t,
    `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    ["--permission-mode", "bypassPermissions"],
  );

  await engine.advance("first");

  const argv = (await readFile(join(directory, "arguments"), "utf8")).split("\0");

  assert.equal(argv[argv.indexOf("--permission-mode") + 1], "bypassPermissions");
});

test("the Claude Code adapter refuses arguments it does not define", async (t) => {
  const { engine } = await engineWithClaude(t, "true", ["--permission-mode", "plan"]);

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    reason: "Step plan exited with code 2.",
  });
});

test("a Claude Code run that fails escalates its commission", async (t) => {
  const { engine } = await engineWithClaude(t, `echo '{"type":"result","is_error":true}'; exit 3`);

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "plan" },
    reason: "Step plan exited with code 3.",
  });
});
