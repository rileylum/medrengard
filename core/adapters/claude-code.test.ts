import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createEngine } from "../src/engine.ts";
import { claudeCode } from "../defaults/access.ts";
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

  // The log's directory is hidden from every step, so it is not the one the fake claude is in.
  await mkdir(join(directory, "record"));

  const engine = createEngine({
    kinds: builtIn,
    defaults: { limits },
    log: join(directory, "record", "log.sqlite"),
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

// What a fake claude prints to say its run succeeded, as the real one ends its stream.
const succeeded = `echo '{"type":"result","is_error":false}'`;

// What every agent runs without: Claude Code's bundled skills, its built-in plugins, memory and
// attribution, as Claude Code 2.1.318 names them. design and doctor survive disableBundledSkills.
const hermetic = {
  disableBundledSkills: true,
  skillOverrides: { design: "off", doctor: "off" },
  autoMemoryEnabled: false,
  attribution: false,
  enabledPlugins: {
    "cc-plugin-agents-md@builtin": false,
    "cc-plugin-telemetry@builtin": false,
    "cc-plugin-plugin-authoring@builtin": false,
    "cc-plugin-privacy@builtin": false,
  },
};

// What claude prints when the canary hook in the adapter's settings ran, before its init: the sign
// that it applied them.
const canary = `echo '{"type":"system","subtype":"hook_response","hook_event":"SessionStart","outcome":"success"}'`;

// The parts of claude's init these tests vary.
type Loaded = {
  tools?: string[];
  skills?: string[];
  plugins?: { name: string }[];
  plugin_errors?: { plugin: string; message: string }[];
};

/** What a fake claude prints to say it loaded `loaded`, its settings applied first. */
function initOf(loaded: Loaded = {}): string {
  return `${canary}
     echo '${JSON.stringify({ type: "system", subtype: "init", ...loaded })}'`;
}

// Runs, in a fake claude, the InstructionsLoaded hook the adapter gave it, as claude would on
// loading the workspace's CLAUDE.md.
const instructionsLoaded = `"${process.execPath}" -e '
const argv = require("node:fs").readFileSync(process.argv[1] + "/arguments", "utf8").split("\\0");
const settings = JSON.parse(argv[argv.indexOf("--settings") + 1]);
require("node:child_process").execSync(settings.hooks.InstructionsLoaded[0].hooks[0].command, {
  input: JSON.stringify({ hook_event_name: "InstructionsLoaded", file_path: "/workspace/CLAUDE.md", load_reason: "session_start" }),
});' "${"$"}{0%/claude}"`;

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

  const settings = rest[rest.indexOf("--settings") + 1]!;
  const { hooks, ...applied } = JSON.parse(settings);

  // Edits only, in the workspace and the step's input and output: shell commands stay refused.
  // Only the default tools, and nothing of Claude Code's own loads, MCP servers included. The
  // prompt is on stdin.
  assert.deepEqual(rest, [
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-hook-events",
    "--permission-mode",
    "acceptEdits",
    "--strict-mcp-config",
    "--settings",
    settings,
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
  assert.deepEqual(applied, hermetic);

  // A canary that says the settings were applied, and a hook that says what instructions loaded.
  assert.deepEqual(hooks.SessionStart, [{ hooks: [{ type: "command", command: "true" }] }]);
  assert.partialDeepStrictEqual(hooks.InstructionsLoaded, [{ hooks: [{ type: "command" }] }]);
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
    `${succeeded}
     eval "cat <&$CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR" > "${"$"}{0%/claude}/received"
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
    `${succeeded}
     unshare -Ur true 2> /dev/null && echo made > "${"$"}{0%/claude}/nested" || echo refused > "${"$"}{0%/claude}/nested"
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
    `${succeeded}
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
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
    { type: "system", subtype: "hook_response", hook_event: "SessionStart" },
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
      ].map((note) => ({ note, from: "step" })),
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
    `${succeeded}
     while [ $# -gt 0 ]; do [ "$1" = --plugin-dir ] && cp -r "$2" "${"$"}{0%/claude}/plugin"; shift; done
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

test("a Claude Code run that finishes with an error escalates, though the agent claimed", async (t) => {
  const { engine } = await engineWithClaude(
    t,
    `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"
     echo '{"type":"result","subtype":"error_max_turns","is_error":true}'`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    reason: "Step plan exited with code 1.",
  });
  assert.match(
    engine.errors("first", 1).toString(),
    /^claude finished with an error: error_max_turns\.$/m,
  );
});

test("a Claude Code run that ends without a result escalates, though the agent claimed", async (t) => {
  const { engine } = await engineWithClaude(
    t,
    `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    reason: "Step plan exited with code 1.",
  });
  assert.match(engine.errors("first", 1).toString(), /^claude ended without a result\.$/m);
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
    `${succeeded}
     ${canary}
     echo '${JSON.stringify(init)}'
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    ["--tools", "Bash,Read,Task"],
    { tdd: "Test first.\n" },
  );

  const leak =
    'Claude Code loaded what the agent did not declare: tools ["WebFetch"], skills ["design"], plugins ["cc-plugin-telemetry"], MCP servers ["github"], subagents ["general-purpose"].';

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
  assert.partialDeepStrictEqual(engine.record("first").entries, [
    { outcome: "done", notes: [{ note: leak, from: "step" }], errors: true },
  ]);
  assert.equal(engine.errors("first", 1).toString(), `${leak}\n`);
});

// A claude stopped before its first turn never writes this claim, and the engine would not record
// it from an attempt that failed if it did.
const claimLate = `sleep 5
     ${succeeded}
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`;

for (const { what, loaded, stopped } of [
  {
    what: "a declared skill",
    loaded: { skills: [], plugins: [{ name: "medrengard" }] },
    stopped: 'Claude Code did not load what the agent declared: skills ["medrengard:tdd"].',
  },
  {
    what: "the agent's plugin",
    loaded: { skills: [], plugins: [] },
    stopped:
      'Claude Code did not load what the agent declared: skills ["medrengard:tdd"], plugins ["medrengard"].',
  },
  {
    what: "a plugin, with an error",
    loaded: {
      skills: ["medrengard:tdd"],
      plugins: [{ name: "medrengard" }],
      plugin_errors: [{ plugin: "inline[0]", message: "Failed to load plugin: corrupt manifest" }],
    },
    stopped: "Claude Code could not load a plugin: Failed to load plugin: corrupt manifest",
  },
]) {
  test(`the Claude Code adapter stops claude before its first turn when it did not load ${what}`, async (t) => {
    const { engine } = await engineWithClaude(
      t,
      `${initOf({ tools: ["Bash", "Read", "Edit", "Write", "Skill"], ...loaded })}
       ${claimLate}`,
      [],
      { tdd: "Test first.\n" },
    );

    assert.partialDeepStrictEqual(await engine.advance("first"), {
      status: "escalated",
      reason: "Step plan exited with code 1.",
    });
    assert.partialDeepStrictEqual(engine.record("first").entries, [
      { notes: [{ note: stopped, from: "step" }], errors: true },
    ]);
    assert.equal(engine.errors("first", 1).toString(), `${stopped}\n`);
  });
}

test("the Claude Code adapter stops claude before its first turn when it did not apply the settings", async (t) => {
  const { engine } = await engineWithClaude(
    t,
    `echo '{"type":"system","subtype":"init","tools":["Bash","Read","Edit","Write"]}'
     ${claimLate}`,
  );

  const stopped = "Claude Code did not apply the adapter's settings.";

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    reason: "Step plan exited with code 1.",
  });
  assert.partialDeepStrictEqual(engine.record("first").entries, [
    { notes: [{ note: stopped, from: "step" }], errors: true },
  ]);
  assert.equal(engine.errors("first", 1).toString(), `${stopped}\n`);
});

test("the Claude Code adapter records the instructions claude loaded, and lets it run", async (t) => {
  const { engine } = await engineWithClaude(
    t,
    `${initOf({ tools: ["Bash", "Read", "Edit", "Write"] })}
     ${instructionsLoaded}
     ${instructionsLoaded}
     ${succeeded}
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  const leak =
    "Claude Code loaded instructions the agent did not declare: /workspace/CLAUDE.md at session_start.";

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
  assert.partialDeepStrictEqual(engine.record("first").entries, [
    { outcome: "done", notes: [{ note: leak, from: "step" }], errors: true },
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
    { outcome: "done", notes: [{ note: unsaid, from: "step" }], errors: true },
  ]);
  assert.equal(engine.errors("first", 1).toString(), `${unsaid}\n`);
});

// The installed claude itself, through the adapter and the default access, refused at its first
// request by an invalid token, so it costs nothing: it says what it loaded before it asks. A new
// Claude Code that loads something more, such as a built-in plugin, fails this test, not a paid run.
const installed = join(homedir(), ".local", "bin", "claude");

test(
  "the installed Claude Code loads nothing the agent did not declare",
  { skip: !existsSync(installed) && "Claude Code is not installed", timeout: 60_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

    t.after(() => rm(directory, { recursive: true, force: true }));

    await writeFile(join(directory, "token"), "sk-ant-oat01-invalid-for-a-test");
    await mkdir(join(directory, "record"));

    const engine = createEngine({
      kinds: builtIn,
      defaults: { limits },
      log: join(directory, "record", "log.sqlite"),
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
                    "node",
                    adapter,
                    "--token",
                    join(directory, "token"),
                    "--permission-mode",
                    "bypassPermissions",
                  ],
                },
                model: "sonnet",
                prompt: "Plan the change.",
              },
              inputs: {},
              on: { done: "end" },
              budget: 1,
              access: {
                ...claudeCode,
                paths: [...claudeCode.paths, { path: directory, mode: "read" }],
              },
              limits: { idle: 30, attempt: 60, transcript: 1024 * 1024, input: 1024 * 1024 },
            },
          },
        }),
      },
    });

    engine.commission("build", "first", { title: "Greet", body: "Say hello." });

    // The refused token fails the run; what matters is what claude said it loaded first.
    assert.equal((await engine.advance("first")).status, "escalated");

    const errors = engine.errors("first", 1).toString();

    assert.doesNotMatch(errors, /did not say what it loaded/);
    assert.doesNotMatch(errors, /loaded what the agent did not declare: .*/);
    assert.doesNotMatch(errors, /did not apply|could not load|did not load/);
  },
);

/**
 * A workspace holding everything a repository could configure Claude Code with: an MCP server and
 * a hook that each touch a marker in `directory` if they run, a skill, a subagent, and CLAUDE.md
 * and AGENTS.md, at its root and below it.
 */
async function plantedWorkspace(directory: string): Promise<string> {
  const workspace = join(directory, "workspace");

  await mkdir(join(workspace, ".claude", "skills", "planted"), { recursive: true });
  await mkdir(join(workspace, ".claude", "agents"), { recursive: true });
  await mkdir(join(workspace, "below"));
  await writeFile(
    join(workspace, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        planted: { command: "sh", args: ["-c", `touch '${join(directory, "mcp-ran")}'; sleep 5`] },
      },
    }),
  );
  await writeFile(
    join(workspace, ".claude", "settings.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: `touch '${join(directory, "hook-ran")}'` }] },
        ],
      },
    }),
  );
  await writeFile(
    join(workspace, ".claude", "skills", "planted", "SKILL.md"),
    "---\nname: planted\ndescription: Planted by the repository.\n---\nPlanted.\n",
  );
  await writeFile(
    join(workspace, ".claude", "agents", "planted.md"),
    "---\nname: planted\ndescription: Planted by the repository.\n---\nPlanted.\n",
  );

  for (const file of ["CLAUDE.md", "AGENTS.md", join("below", "CLAUDE.md")]) {
    await writeFile(join(workspace, file), "Planted by the repository.\n");
  }

  return workspace;
}

/** Runs the installed claude headless in `workspace`, refused at its first request, and returns its stream. */
async function installedClaude(workspace: string, home: string, args: readonly string[]) {
  const claude = spawn(installed, ["-p", "--output-format", "stream-json", "--verbose", ...args], {
    cwd: workspace,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-invalid-for-a-test",
      CLAUDE_CODE_MAX_RETRIES: "0",
    },
    stdio: ["pipe", "pipe", "ignore"],
  });

  claude.stdin.end("Say hello.");

  let stream = "";

  claude.stdout.on("data", (chunk: Buffer) => {
    stream += chunk.toString();
  });

  await once(claude, "close");

  return stream
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
}

test(
  "the installed Claude Code loads nothing from a workspace its repository configures",
  { skip: !existsSync(installed) && "Claude Code is not installed", timeout: 120_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

    t.after(() => rm(directory, { recursive: true, force: true }));

    const workspace = await plantedWorkspace(directory);

    const [input, output, home, controlHome] = ["input", "output", "home", "control-home"].map(
      (name) => join(directory, name),
    );

    for (const made of [input, output, home, controlHome]) {
      await mkdir(made);
    }

    // The control: the same claude, allowed the repository's configuration, loads all of it, so
    // the adapter's run below proves something.
    const loaded = join(directory, "loaded.jsonl");

    const control = await installedClaude(workspace, controlHome, [
      "--setting-sources",
      "project",
      "--settings",
      JSON.stringify({
        hooks: {
          InstructionsLoaded: [
            { hooks: [{ type: "command", command: `{ cat; echo; } >> '${loaded}'` }] },
          ],
        },
      }),
    ]);

    const init = control.find((event) => event.subtype === "init");

    assert.ok(existsSync(join(directory, "mcp-ran")));
    assert.ok(existsSync(join(directory, "hook-ran")));
    assert.ok(init.skills.includes("planted"));
    assert.ok(init.agents.includes("planted"));
    assert.match(await readFile(loaded, "utf8"), /"file_path":"[^"]*\/workspace\/CLAUDE\.md"/);

    await rm(join(directory, "mcp-ran"));
    await rm(join(directory, "hook-ran"));

    await writeFile(join(directory, "token"), "sk-ant-oat01-invalid-for-a-test");
    await writeFile(
      join(input, "input.json"),
      JSON.stringify({
        commission: "first",
        step: "plan",
        attempt: 1,
        outcomes: ["done"],
        inputs: {},
        claims: {},
        attended: false,
        agent: { model: "sonnet", prompt: "Say hello.", skills: [] },
      }),
    );

    const adapted = spawn(
      process.execPath,
      [adapter, "--token", join(directory, "token"), "--permission-mode", "bypassPermissions"],
      {
        cwd: workspace,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          TMPDIR: directory,
          MEDRENGARD_IN: input,
          MEDRENGARD_OUT: output,
          CLAUDE_CODE_MAX_RETRIES: "0",
        },
        stdio: ["ignore", "ignore", "pipe", "pipe"],
      },
    );

    let said = "";

    adapted.stderr!.on("data", (chunk: Buffer) => {
      said += chunk.toString();
    });
    adapted.stdio[3]!.on("data", (chunk: Buffer) => {
      said += chunk.toString();
    });

    await once(adapted, "close");

    // The refused token fails the run; what matters is what claude loaded before it.
    assert.ok(!existsSync(join(directory, "mcp-ran")));
    assert.ok(!existsSync(join(directory, "hook-ran")));
    assert.doesNotMatch(said, /did not say what it loaded/);
    assert.doesNotMatch(said, /did not apply/);
    assert.doesNotMatch(said, /did not declare/);
    assert.doesNotMatch(said, /could not load/);
  },
);

test(
  "the installed Claude Code ignores settings with an invalid value whole, canary and all",
  { skip: !existsSync(installed) && "Claude Code is not installed", timeout: 60_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

    t.after(() => rm(directory, { recursive: true, force: true }));

    const canaryHook = { SessionStart: [{ hooks: [{ type: "command", command: "true" }] }] };

    const ran = async (settings: Readonly<Record<string, string | boolean>>) => {
      const home = await mkdtemp(join(directory, "home-"));

      const stream = await installedClaude(directory, home, [
        "--include-hook-events",
        "--setting-sources",
        "",
        "--settings",
        JSON.stringify({ ...settings, hooks: canaryHook }),
      ]);

      return stream.some(
        (event) => event.subtype === "hook_response" && event.hook_event === "SessionStart",
      );
    };

    // Which is why the canary proves the adapter's settings applied: not any one of them.
    assert.equal(await ran({ attribution: false }), true);
    assert.equal(await ran({ attribution: "nonsense" }), false);
    assert.equal(await ran({ noSuchSetting: true }), true);
  },
);

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
    `${succeeded}
     ${canary}
     echo '${JSON.stringify(init)}'
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    [],
    { tdd: "Test first.\n" },
  );

  await engine.advance("first");

  assert.partialDeepStrictEqual(engine.record("first").entries, [
    { outcome: "done", notes: [], errors: false },
  ]);
});

// What a dry run's claude prints by default: its settings applied and only the default tools
// loaded; then it would wait on its refused token, until the adapter stops it.
const loadedOnly = `${initOf({ tools: ["Bash", "Read", "Edit", "Write"], skills: [], plugins: [] })}
sleep 30`;

/**
 * Runs the adapter as an attended step's harness, in a terminal script makes, with `args`, an
 * input.json saying so and a fake `claude` on its PATH. Run headless, as the dry run before the
 * session, the fake records its arguments and the token it read and runs `dry`. Run as the
 * session, it records its arguments, whether its stdin is a terminal, the system prompt file it
 * was given and the `.claude.json` in its home, and runs `session`. Returns the adapter's exit
 * code, its notes and what the fake recorded.
 */
async function attendedAdapter(
  t: TestContext,
  args: readonly string[] = [],
  claudeJson?: string,
  dry = loadedOnly,
  session = "",
) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const [input, output, home, workspace] = ["input", "output", "home", "workspace"].map((name) =>
    join(directory, name),
  );

  for (const made of [input, output, home, workspace]) {
    await mkdir(made);
  }

  if (claudeJson !== undefined) {
    await writeFile(join(home, ".claude.json"), claudeJson);
  }

  await writeFile(join(directory, "token"), "sk-ant-oat01-test-token");
  await writeFile(
    join(input, "input.json"),
    JSON.stringify({
      commission: "first",
      step: "plan",
      attempt: 1,
      outcomes: ["done"],
      inputs: {},
      claims: {},
      attended: true,
      agent: { model: "a-model", prompt: "Plan the change with the owner.", skills: [] },
    }),
  );

  const claude = join(directory, "claude");

  await writeFile(
    claude,
    `#!/bin/sh
if [ "$1" = -p ]; then
  printf '%s\\0' "$@" > "${join(directory, "dry-arguments")}"
  eval "cat <&$CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR" > "${join(directory, "dry-token")}"
  ${dry}
  exit 1
fi
printf '%s\\0' "$@" > "${join(directory, "arguments")}"
[ -t 0 ] && echo yes > "${join(directory, "terminal")}"
printf '%s' "$DISABLE_AUTOUPDATER" > "${join(directory, "updater")}"
while [ $# -gt 0 ]; do
  [ "$1" = --append-system-prompt-file ] && cp "$2" "${join(directory, "system")}"
  shift
done
cp "$HOME/.claude.json" "${join(directory, "claude.json")}"
${session}
`,
  );
  await chmod(claude, 0o755);

  const command = [
    "env",
    `PATH=${directory}:${process.env.PATH}`,
    `HOME=${home}`,
    // Outside the engine's sandbox, what the adapter makes in its temporary directory stays.
    `TMPDIR=${directory}`,
    `MEDRENGARD_IN=${input}`,
    `MEDRENGARD_OUT=${output}`,
    process.execPath,
    adapter,
    "--token",
    join(directory, "token"),
    ...args,
  ].map((arg) => `'${arg}'`);

  // fd 3 is the step's notes, as the engine gives it; script passes it on.
  const terminal = spawn("script", ["-q", "-e", "-c", command.join(" "), "/dev/null"], {
    cwd: workspace,
    stdio: ["pipe", "pipe", "pipe", "pipe"],
  });

  let notes = "";

  terminal.stdio[3]!.on("data", (chunk: Buffer) => {
    notes += chunk.toString();
  });

  const [code] = await once(terminal, "close");

  const recorded = async (name: string) => readFile(join(directory, name), "utf8").catch(() => "");

  return {
    code,
    notes,
    workspace,
    arguments: (await recorded("arguments")).split("\0").slice(0, -1),
    dryArguments: (await recorded("dry-arguments")).split("\0").slice(0, -1),
    dryToken: await recorded("dry-token"),
    terminal: await recorded("terminal"),
    system: await recorded("system"),
    claudeJson: await recorded("claude.json"),
    updater: await recorded("updater"),
  };
}

test("the Claude Code adapter runs an attended agent's claude in the owner's terminal, its prompt the system's", async (t) => {
  const run = await attendedAdapter(t);

  assert.equal(run.code, 0);
  assert.equal(run.terminal, "yes\n");

  // It cannot update itself in its sandbox, and would say so on the owner's screen.
  assert.equal(run.updater, "1");

  // An interactive session, which the agent begins: no -p and no stream on stdout.
  assert.equal(run.arguments[0], "Begin your step.");
  assert.ok(!run.arguments.includes("-p"));
  assert.ok(!run.arguments.includes("--output-format"));
  assert.ok(run.arguments.includes("--append-system-prompt-file"));
  assert.match(run.system, /^Plan the change with the owner\.\n\n/);
  assert.match(run.system, /The owner is with you in this session/);
  assert.match(run.system, /write .*output\.json/);

  // Claude Code's first-run questions are answered, so the session opens on the work.
  assert.partialDeepStrictEqual(JSON.parse(run.claudeJson), {
    hasCompletedOnboarding: true,
    projects: { [run.workspace]: { hasTrustDialogAccepted: true } },
  });
  assert.equal(run.notes, "");
});

test("the Claude Code adapter first runs an attended agent's claude headless, to check what it loads", async (t) => {
  const run = await attendedAdapter(t);

  assert.equal(run.code, 0);

  // The session's own flags, headless and streamed, with a token that cannot authenticate, so the
  // dry run stops at its first request and costs nothing.
  const flags = (argv: string[]) => argv.slice(argv.indexOf("--permission-mode"));

  assert.deepEqual(run.dryArguments.slice(0, 5), [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-hook-events",
  ]);
  assert.ok(run.dryArguments.includes("--append-system-prompt-file"));
  assert.ok(run.arguments.includes("--strict-mcp-config"));
  assert.deepEqual(flags(run.dryArguments), flags(run.arguments));
  assert.notEqual(run.dryToken, "");
  assert.notEqual(run.dryToken, "sk-ant-oat01-test-token");
});

for (const { what, dry, stopped } of [
  {
    what: "did not apply the settings",
    dry: `echo '{"type":"system","subtype":"init","tools":["Bash","Read","Edit","Write"]}'`,
    stopped: "Claude Code did not apply the adapter's settings.",
  },
  {
    what: "could not load a plugin",
    dry: initOf({ plugin_errors: [{ plugin: "inline[0]", message: "corrupt manifest" }] }),
    stopped: "Claude Code could not load a plugin: corrupt manifest",
  },
]) {
  test(`the Claude Code adapter opens no attended session when its dry run ${what}`, async (t) => {
    const run = await attendedAdapter(t, [], undefined, dry);

    assert.equal(run.code, 1);
    assert.deepEqual(run.arguments, []);
    assert.equal(run.notes, `${stopped}\n`);
  });
}

test("the Claude Code adapter records what an attended agent's dry run loaded beyond its declaration", async (t) => {
  const run = await attendedAdapter(
    t,
    [],
    undefined,
    `${initOf({ tools: ["Bash", "Read", "Edit", "Write", "WebFetch"] })}
     sleep 30`,
  );

  assert.equal(run.code, 0);
  assert.equal(
    run.notes,
    'Claude Code loaded what the agent did not declare: tools ["WebFetch"].\n',
  );
});

test("the Claude Code adapter records the instructions an attended agent's claude loaded", async (t) => {
  const run = await attendedAdapter(t, [], undefined, loadedOnly, instructionsLoaded);

  assert.equal(run.code, 0);
  assert.equal(
    run.notes,
    "Claude Code loaded instructions the agent did not declare: /workspace/CLAUDE.md at session_start.\n",
  );
});

test("the Claude Code adapter leaves a .claude.json already in an attended agent's home", async (t) => {
  const run = await attendedAdapter(t, [], '{"theme":"light"}');

  assert.equal(run.code, 0);
  assert.equal(run.claudeJson, '{"theme":"light"}');
});

test("the Claude Code adapter refuses a budget for an attended agent, which claude cannot keep", async (t) => {
  const run = await attendedAdapter(t, ["--max-budget-usd", "2"]);

  assert.equal(run.code, 2);
  assert.deepEqual(run.arguments, []);
});
