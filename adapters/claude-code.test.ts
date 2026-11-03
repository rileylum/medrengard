import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createEngine } from "../src/engine.ts";
import { builtIn } from "../defaults/kinds.ts";
import { limits } from "../defaults/limits.ts";
import { defineWorkflow } from "../src/replay.ts";

const adapter = join(import.meta.dirname, "claude-code.ts");

/**
 * Starts an engine whose one agent step, `plan`, runs the Claude Code adapter with a fake `claude`
 * on its PATH, and commissions `first`. The fake runs `script`; its arguments are in the returned
 * directory's `arguments` file, its input and output directories in `directories`, each ended by a
 * NUL, the variable that keeps CLAUDE.md out in `claude-mds`, and what it read on stdin, its
 * prompt, in `prompt`. The adapter reads the token from the directory's `token` file. The agent's
 * prompt is `prompt`, and it declares a skill for each of `skills`, its SKILL.md by name.
 */
async function engineWithClaude(
  t: TestContext,
  script: string,
  args: readonly string[] = [],
  skills: Readonly<Record<string, string>> = {},
  prompt = "Plan the change.",
) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const claude = join(directory, "claude");

  await writeFile(join(directory, "token"), "sk-ant-oat01-test-token");

  await writeFile(
    claude,
    `#!/bin/sh
printf '%s\\0' "$@" > "${join(directory, "arguments")}"
printf '%s\\0' "$MEDRENGARD_IN" "$MEDRENGARD_OUT" > "${join(directory, "directories")}"
printf '%s' "$CLAUDE_CODE_DISABLE_CLAUDE_MDS" > "${join(directory, "claude-mds")}"
cat > "${join(directory, "prompt")}"
${script}
`,
  );
  await chmod(claude, 0o755);

  const paths = [];

  for (const [name, text] of Object.entries(skills)) {
    await mkdir(join(directory, "skills", name), { recursive: true });
    await writeFile(join(directory, "skills", name, "SKILL.md"), text);
    paths.push(join(directory, "skills", name));
  }

  const engine = createEngine({
    kinds: builtIn,
    defaults: { limits },
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
                  "--token",
                  join(directory, "token"),
                  ...args,
                ],
              },
              model: "a-model",
              prompt,
              skills: paths,
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
                { path: "/tmp", mode: "empty", size: 16 * 1024 * 1024 },
                { path: dirname(dirname(process.execPath)), mode: "read" },
                { path: join(import.meta.dirname, ".."), mode: "read" },
                { path: directory, mode: "write" },
              ],
              network: false,
              environment: [],
              workspace: "write",
              sandboxes: true,
            },
            limits: { idle: 5, attempt: 10, transcript: 65536, input: 1024 * 1024 },
          },
        },
      }),
    },
  });

  engine.commission("build", "first", { title: "Greet", body: "Say hello." });

  return { engine, directory };
}

// What every agent runs without: Claude Code's bundled skills, its built-in plugins, memory and
// attribution, as Claude Code 2.1.316 names them. design and doctor survive disableBundledSkills.
const hermetic = {
  disableBundledSkills: true,
  skillOverrides: { design: "off", doctor: "off" },
  autoMemoryEnabled: false,
  attribution: false,
  enabledPlugins: {
    "cc-plugin-agents-md@builtin": false,
    "cc-plugin-telemetry@builtin": false,
    "cc-plugin-plugin-authoring@builtin": false,
  },
};

/** The fake claude's arguments, as the adapter gave them. */
async function argumentsOf(directory: string): Promise<string[]> {
  return (await readFile(join(directory, "arguments"), "utf8")).split("\0").slice(0, -1);
}

/** The value the adapter gave `flag`, or undefined if it did not give it. */
function valueOf(argv: readonly string[], flag: string): string | undefined {
  return argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined;
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
  const prompt = await readFile(join(directory, "prompt"), "utf8");

  assert.equal(print, "-p");

  // Edits only, in the workspace and the step's input and output: shell commands stay refused.
  // Only the default tools, and nothing of Claude Code's own loads. The prompt is on stdin.
  assert.deepEqual(rest, [
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
    "--settings",
    JSON.stringify(hermetic),
    "--setting-sources",
    "",
    "--add-dir",
    input,
    output,
    "--tools",
    "Bash,Read,Edit,Write",
    "--model",
    "a-model",
  ]);
  assert.equal(await readFile(join(directory, "claude-mds"), "utf8"), "1");
  assert.ok(prompt.startsWith("Plan the change.\n"));
  assert.ok(prompt.includes('["done"]'));
  assert.ok(!prompt.includes("CLAUDE.md"));
});

test("the Claude Code adapter gives claude the token only on a descriptor, out of reach of what the agent runs", async (t) => {
  // As anything the agent runs could: the token in any process's environment or command line, or
  // in the token file. The token to look for is the one claude was given.
  const { engine, directory } = await engineWithClaude(
    t,
    `eval "cat <&$CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR" > "${"$"}{0%/claude}/received"
     for file in /proc/[0-9]*/environ /proc/[0-9]*/cmdline "${"$"}{0%/claude}/token"; do
       grep -qaF -f "${"$"}{0%/claude}/received" "$file" 2>/dev/null && echo "$file"
     done > "${"$"}{0%/claude}/exposed"
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
  assert.equal(await readFile(join(directory, "received"), "utf8"), "sk-ant-oat01-test-token");
  assert.equal(await readFile(join(directory, "exposed"), "utf8"), "");
});

test("what the agent runs under the Claude Code adapter cannot make namespaces of its own", async (t) => {
  const { engine, directory } = await engineWithClaude(
    t,
    `unshare -Ur true 2> /dev/null && echo made > "${"$"}{0%/claude}/nested" || echo refused > "${"$"}{0%/claude}/nested"
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
  assert.equal(await readFile(join(directory, "nested"), "utf8"), "refused\n");
});

test("the Claude Code adapter gives claude a prompt longer than one argument may be", async (t) => {
  // Linux refuses a single argument over 128 KiB.
  const long = "x".repeat(200 * 1024);

  const { engine, directory } = await engineWithClaude(
    t,
    `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    [],
    {},
    long,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
  assert.ok((await readFile(join(directory, "prompt"), "utf8")).startsWith(`${long}\n\n`));
});

test("the Claude Code adapter tells the agent how to claim only the kinds its step may claim", async (t) => {
  const { engine, directory } = await engineWithClaude(
    t,
    `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  await engine.advance("first");

  const prompt = await readFile(join(directory, "prompt"), "utf8");

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

test("the Claude Code adapter gives claude the tools, effort and budget its harness names", async (t) => {
  const { engine, directory } = await engineWithClaude(
    t,
    `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    ["--tools", "Bash,Read,Write", "--effort", "high", "--max-budget-usd", "2.5"],
  );

  await engine.advance("first");

  const argv = await argumentsOf(directory);

  assert.equal(valueOf(argv, "--tools"), "Bash,Read,Write");
  assert.equal(valueOf(argv, "--effort"), "high");
  assert.equal(valueOf(argv, "--max-budget-usd"), "2.5");
});

test("the Claude Code adapter turns the agent's skills into a plugin, and gives it the Skill tool", async (t) => {
  const { engine, directory } = await engineWithClaude(
    t,
    `while [ $# -gt 0 ]; do [ "$1" = --plugin-dir ] && cp -r "$2" "${"$"}{0%/claude}/plugin"; shift; done
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    ["--tools", "Bash,Read"],
    { tdd: "Test first.\n" },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });

  const plugin = join(directory, "plugin");

  assert.equal(valueOf(await argumentsOf(directory), "--tools"), "Bash,Read,Skill");
  assert.deepEqual(
    JSON.parse(await readFile(join(plugin, ".claude-plugin", "plugin.json"), "utf8")),
    { name: "medrengard" },
  );
  assert.equal(await readFile(join(plugin, "skills", "tdd", "SKILL.md"), "utf8"), "Test first.\n");
});

test("the Claude Code adapter without skills loads no plugin", async (t) => {
  const { engine, directory } = await engineWithClaude(
    t,
    `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  await engine.advance("first");

  assert.ok(!(await argumentsOf(directory)).includes("--plugin-dir"));
});

for (const args of [
  ["--permission-mode", "plan"],
  ["--effort", "extreme"],
  ["--max-budget-usd", "0"],
  ["--max-budget-usd", "lots"],
  ["--tools", ""],
  ["--tools", "Bash,,Read"],
  ["--colour", "red"],
  ["--effort"],
  ["--token", "/nonexistent/token"],
]) {
  test(`the Claude Code adapter refuses ${JSON.stringify(args)}`, async (t) => {
    const { engine } = await engineWithClaude(t, "true", args);

    assert.partialDeepStrictEqual(await engine.advance("first"), {
      status: "escalated",
      reason: "Step plan exited with code 2.",
    });
  });
}

test("a Claude Code run that fails escalates its commission", async (t) => {
  const { engine } = await engineWithClaude(t, `echo '{"type":"result","is_error":true}'; exit 3`);

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "plan" },
    reason: "Step plan exited with code 3.",
  });
});

test("the Claude Code adapter records what claude loaded that the agent did not declare", async (t) => {
  const init = {
    type: "system",
    subtype: "init",
    tools: ["Bash", "Read", "Skill", "Task", "WebFetch"],
    skills: ["medrengard:tdd", "design"],
    plugins: [{ name: "medrengard" }, { name: "cc-plugin-telemetry" }],
    mcp_servers: [{ name: "github", status: "connected" }],
    agents: ["general-purpose"],
  };

  const { engine } = await engineWithClaude(
    t,
    `echo '${JSON.stringify(init)}'
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    ["--tools", "Bash,Read,Task"],
    { tdd: "Test first.\n" },
  );

  const leak =
    'Claude Code loaded what the agent did not declare: tools ["WebFetch"], skills ["design"], plugins ["cc-plugin-telemetry"], MCP servers ["github"], subagents ["general-purpose"].';

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
  assert.partialDeepStrictEqual(engine.record("first").entries, [
    { outcome: "done", notes: [leak], errors: true },
  ]);
  assert.equal(engine.errors("first", 1).toString(), `${leak}\n`);
});

test("the Claude Code adapter records that claude did not say what it loaded", async (t) => {
  const { engine } = await engineWithClaude(
    t,
    `echo '{"type":"result","is_error":false}'
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  const unsaid = "Claude Code did not say what it loaded.";

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
  assert.partialDeepStrictEqual(engine.record("first").entries, [
    { outcome: "done", notes: [unsaid], errors: true },
  ]);
  assert.equal(engine.errors("first", 1).toString(), `${unsaid}\n`);
});

test("the Claude Code adapter records nothing when claude loaded only what the agent declared", async (t) => {
  const init = {
    type: "system",
    subtype: "init",
    tools: ["Bash", "Read", "Edit", "Write", "Skill"],
    skills: ["medrengard:tdd"],
    plugins: [{ name: "medrengard" }],
    mcp_servers: [],
    agents: ["general-purpose"],
  };

  const { engine } = await engineWithClaude(
    t,
    `echo '${JSON.stringify(init)}'
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    [],
    { tdd: "Test first.\n" },
  );

  await engine.advance("first");

  assert.partialDeepStrictEqual(engine.record("first").entries, [
    { outcome: "done", notes: [], errors: false },
  ]);
});
