import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createEngine } from "../src/engine.ts";
import { claudeCode } from "../defaults/access.ts";
import { builtIn } from "../defaults/kinds.ts";
import { limits } from "../defaults/limits.ts";
import { defineWorkflow, type Workflow } from "../src/definition.ts";

const adapter = join(import.meta.dirname, "claude-code.ts");
const broker = join(import.meta.dirname, "claude-code-broker.ts");

/**
 * A model API for a test, on loopback: it answers every request with 401, as the real one answers
 * an invalid token, and appends the Authorization each carried to `received`. Its URL.
 */
async function upstreamRecording(t: TestContext, received: string): Promise<string> {
  const server = createServer((request, response) => {
    appendFileSync(received, `${request.headers.authorization ?? "none"}\n`);
    request.resume();
    response.writeHead(401, { "content-type": "application/json" });
    response.end('{"type":"error","error":{"type":"authentication_error","message":"invalid"}}');
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  // SAFETY: a TCP server listening on a port has an address of that kind.
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/**
 * Starts an engine whose one agent step, `plan`, runs the Claude Code adapter with a fake `claude`
 * on its PATH, and commissions `first`. The fake runs `script`; its arguments are in the returned
 * directory's `arguments` file, its input and output directories in `directories`, each ended by a
 * NUL, the variable that keeps CLAUDE.md out in `claude-mds`, and what it read on stdin, its
 * prompt, in `prompt`. Its broker reads the token from a file outside the sandbox, and forwards to a
 * model API that records the Authorization of each request in the directory's `upstream`. The agent's
 * prompt is `prompt`, and it declares a skill for each of `skills`, its SKILL.md by name. Its home
 * is `/tmp`, fresh for each attempt.
 *
 * Without `brokered`, its access names no broker.
 *
 * With `continuing`, a step `first` runs before `plan`, which declares first's session as its input
 * `earlier`: the same agent, or a command step running a script.
 */
async function engineWithClaude(
  t: TestContext,
  script: string,
  args: readonly string[] = [],
  skills: Readonly<Record<string, string>> = {},
  prompt = "Plan the change.",
  continuing?: { agent: true } | { command: string },
  brokered = true,
  { sandboxes = false, managed = false } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const claude = join(directory, "claude");

  // Apart from the test's directory, which the step sees.
  const secrets = await mkdtemp(join(tmpdir(), "medrengard-test-"));

  t.after(() => rm(secrets, { recursive: true, force: true }));
  await writeFile(join(secrets, "token"), "sk-ant-oat01-test-token");

  const upstream = await upstreamRecording(t, join(directory, "upstream"));

  await writeFile(
    claude,
    `#!/bin/sh
printf '%s\\0' "$@" > "${join(directory, "arguments")}"
printf '%s\\0' "$MEDRENGARD_IN" "$MEDRENGARD_OUT" > "${join(directory, "directories")}"
printf '%s' "$CLAUDE_CODE_DISABLE_CLAUDE_MDS" > "${join(directory, "claude-mds")}"
printf '%s' "$CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC" > "${join(directory, "traffic")}"
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

  const agent = {
    kind: "agent",
    claims: ["document"],
    workspace: "empty",
    agent: {
      harness: {
        run: [
          "env",
          `PATH=${directory}:${process.env.PATH}`,
          "HOME=/tmp",
          process.execPath,
          adapter,
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
        ...["/usr", "/bin", "/lib", "/lib64"].map((path) => ({
          path,
          mode: "read" as const,
        })),
        // An empty /etc where a directory under it must be made, which a read-only one refuses.
        managed
          ? ({ path: "/etc", mode: "empty", size: 65536 } as const)
          : ({ path: "/etc", mode: "read" } as const),
        { path: "/tmp", mode: "empty", size: 16 * 1024 * 1024 },
        { path: dirname(dirname(process.execPath)), mode: "read" },
        { path: join(import.meta.dirname, ".."), mode: "read" },
        { path: directory, mode: "write" },
        // Where Claude Code's managed settings would be, as on a machine an admin manages.
        ...(managed ? [{ path: "/etc/claude-code", mode: "empty", size: 4096 } as const] : []),
      ],
      network: brokered && {
        hosts: [],
        brokers: {
          anthropic: [
            process.execPath,
            broker,
            "--token",
            join(secrets, "token"),
            "--upstream",
            upstream,
          ] as const,
        },
      },
      environment: [],
      workspace: "write",
      sandboxes,
    },
    limits: { idle: 5, attempt: 10, transcript: 65536, input: 1024 * 1024 },
  } as const;

  const steps: Workflow["steps"] =
    continuing === undefined
      ? { plan: agent }
      : {
          first:
            "agent" in continuing
              ? { ...agent, on: { done: "plan" } }
              : {
                  kind: "command",
                  claims: [],
                  workspace: "empty",
                  inputs: {},
                  run: ["sh", "-c", continuing.command],
                  on: { done: "plan" },
                  budget: 1,
                  access: agent.access,
                  limits: agent.limits,
                },
          plan: { ...agent, inputs: { earlier: { session: "first" } } },
        };

  const engine = createEngine({
    kinds: builtIn,
    defaults: { limits },
    log: join(directory, "record", "log.sqlite"),
    workflows: { build: { start: continuing === undefined ? "plan" : "first", steps } },
  });

  engine.commission("build", { title: "Greet", body: "Say hello." }, { name: "first" });

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
  analytics_disabled?: boolean;
  claude_code_version?: string;
  session_id?: string;
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
    "--session-id",
    valueOf(rest, "--session-id")!,
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

  // No telemetry, error reports or feature flags: an attempt runs on Claude Code's own defaults.
  assert.equal(await readFile(join(directory, "traffic"), "utf8"), "1");
  assert.ok(prompt.startsWith("Plan the change.\n"));
  assert.ok(prompt.includes('["done"]'));
  assert.ok(!prompt.includes("CLAUDE.md"));
});

test("the Claude Code adapter gives claude only a placeholder, which its broker swaps for the token outside the sandbox", async (t) => {
  // As claude would, a request to the model API; then, as anything the agent runs could, the token
  // looked for in every process's environment and command line, given on stdin so the search
  // itself does not carry it.
  const { engine, directory } = await engineWithClaude(
    t,
    `${succeeded}
     printf '%s' "$CLAUDE_CODE_OAUTH_TOKEN" > "${"$"}{0%/claude}/given"
     printf '%s' "$ANTHROPIC_BASE_URL" > "${"$"}{0%/claude}/base"
     curl -sS -H "Authorization: Bearer $CLAUDE_CODE_OAUTH_TOKEN" "$ANTHROPIC_BASE_URL/v1/messages" > /dev/null
     for file in /proc/[0-9]*/environ /proc/[0-9]*/cmdline; do
       printf '%s\\n' "sk-ant-oat01-test""-token" | grep -qaF -f - "$file" 2>/dev/null && echo "$file"
     done > "${"$"}{0%/claude}/exposed"
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
  assert.equal(await readFile(join(directory, "given"), "utf8"), "medrengard-broker");
  assert.match(await readFile(join(directory, "base"), "utf8"), /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(
    await readFile(join(directory, "upstream"), "utf8"),
    "Bearer sk-ant-oat01-test-token\n",
  );
  assert.equal(await readFile(join(directory, "exposed"), "utf8"), "");
});

test("the Claude Code adapter refuses a step whose access names no broker for it", async (t) => {
  const { engine } = await engineWithClaude(
    t,
    "true",
    ["--effort", "low"],
    {},
    "Plan the change.",
    undefined,
    false,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "exit",
    reason: "Step plan exited with code 2.",
  });
  assert.match(engine.errors("first", 1).toString(), /through the broker anthropic/);
});

for (const [sandboxes, expected] of [
  [false, "refused\n"],
  [true, "made\n"],
] as const) {
  test(`what the agent runs under the Claude Code adapter makes namespaces of its own only if its step's access grants sandboxes: ${sandboxes}`, async (t) => {
    const { engine, directory } = await engineWithClaude(
      t,
      `${succeeded}
       unshare -Ur true 2> /dev/null && echo made > "${"$"}{0%/claude}/nested" || echo refused > "${"$"}{0%/claude}/nested"
       echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
      [],
      {},
      "Plan the change.",
      undefined,
      true,
      { sandboxes },
    );

    assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
    assert.equal(await readFile(join(directory, "nested"), "utf8"), expected);
  });
}

test("the Claude Code adapter refuses to start claude where its managed settings could load", async (t) => {
  const { engine, directory } = await engineWithClaude(
    t,
    `echo started > "${"$"}{0%/claude}/started"`,
    [],
    {},
    "Plan the change.",
    undefined,
    true,
    { managed: true },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "exit",
    reason: "Step plan exited with code 2.",
  });
  assert.match(
    engine.errors("first", 1).toString(),
    /\/etc\/claude-code, where Claude Code reads managed settings no flag turns off, exists/,
  );
  await assert.rejects(readFile(join(directory, "started")));
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
  ["--token", "/a/token"],
]) {
  test(`the Claude Code adapter refuses ${JSON.stringify(args)}`, async (t) => {
    const { engine } = await engineWithClaude(t, "true", args);

    assert.partialDeepStrictEqual(await engine.advance("first"), {
      status: "escalated",
      cause: "exit",
      reason: "Step plan exited with code 2.",
    });
  });
}

test("a Claude Code run that fails escalates its commission", async (t) => {
  const { engine } = await engineWithClaude(t, `echo '{"type":"result","is_error":true}'; exit 3`);

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    step: { name: "plan" },
    cause: "exit",
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
    cause: "exit",
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
    cause: "exit",
    reason: "Step plan exited with code 1.",
  });
  assert.match(engine.errors("first", 1).toString(), /^claude ended without a result\.$/m);
});

test("a Claude Code attempt ends once claude gives its result, and stops what the agent left running", async (t) => {
  // As claude does when it moved a command to the background: the agent claims and finishes, and
  // claude stays alive while the command runs, which here adds a line to `alive` five times a second.
  const { engine, directory } = await engineWithClaude(
    t,
    `(while :; do echo . >> "${"$"}{0%/claude}/alive"; sleep 0.2; done) &
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"
     ${succeeded}
     wait`,
  );

  const started = Date.now();

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished", by: "end" });
  assert.ok(Date.now() - started < 4000, `the attempt took ${Date.now() - started} ms`);

  const alive = async () => (await readFile(join(directory, "alive"), "utf8")).length;
  const before = await alive();

  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(await alive(), before);
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
      cause: "exit",
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
    cause: "exit",
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

// A version 4 UUID, as --session-id takes.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("the Claude Code adapter notes the version claude says it is and the session it gave it", async (t) => {
  const { engine, directory } = await engineWithClaude(
    t,
    `${initOf({ tools: ["Bash", "Read", "Edit", "Write"], claude_code_version: "2.1.319" })}
     ${succeeded}
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });

  const session = valueOf(await argumentsOf(directory), "--session-id")!;

  assert.match(session, uuid);
  assert.partialDeepStrictEqual(engine.record("first").entries, [
    { notes: [{ note: `Claude Code 2.1.319, session ${session}.`, from: "step" }] },
  ]);
});

test("the Claude Code adapter gives each attempt a session of its own", async (t) => {
  const sessions = [];

  for (const _ of [1, 2]) {
    const { engine, directory } = await engineWithClaude(
      t,
      `${succeeded}
       echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
    );

    await engine.advance("first");
    sessions.push(valueOf(await argumentsOf(directory), "--session-id"));
  }

  assert.notEqual(sessions[0], sessions[1]);
});

test("the Claude Code adapter notes a session claude ran other than the one it gave it", async (t) => {
  const { engine, directory } = await engineWithClaude(
    t,
    `${initOf({ claude_code_version: "2.1.319", session_id: "chosen-by-claude" })}
     ${succeeded}
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });

  const session = valueOf(await argumentsOf(directory), "--session-id")!;

  assert.partialDeepStrictEqual(engine.record("first").entries, [
    {
      notes: [
        {
          note: `Claude Code 2.1.319, session chosen-by-claude, not ${session}, which it was given.`,
          from: "step",
        },
      ],
    },
  ]);
});

test("the Claude Code adapter records that claude did not turn off its nonessential traffic", async (t) => {
  const { engine } = await engineWithClaude(
    t,
    `${initOf({ tools: ["Bash", "Read", "Edit", "Write"], analytics_disabled: false })}
     ${succeeded}
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  const leak =
    "Claude Code did not turn off its nonessential traffic: telemetry and error reports.";

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
  assert.partialDeepStrictEqual(engine.record("first").entries, [
    { outcome: "done", notes: [{ note: leak, from: "step" }], errors: true },
  ]);
  assert.equal(engine.errors("first", 1).toString(), `${leak}\n`);
});

test("the Claude Code adapter notes each tool claude denied the agent", async (t) => {
  const result = {
    type: "result",
    is_error: false,
    num_turns: 2,
    duration_ms: 1000,
    total_cost_usd: 0.01,
    permission_denials: [
      { tool_name: "Bash", tool_use_id: "a", tool_input: { command: "npm test" } },
      { tool_name: "Write", tool_use_id: "b", tool_input: { file_path: "/etc/hosts" } },
    ],
  };

  const { engine } = await engineWithClaude(
    t,
    `echo '${JSON.stringify(result)}'
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });

  assert.partialDeepStrictEqual(engine.record("first").entries, [
    {
      notes: [
        "Claude Code denied Bash: npm test",
        "Claude Code denied Write: /etc/hosts",
        "Finished in 1 s, 2 turns, $0.01.",
      ].map((note) => ({ note, from: "step" })),
    },
  ]);
});

test("the Claude Code adapter reports the cost and tokens claude's result gives", async (t) => {
  const result = {
    type: "result",
    is_error: false,
    total_cost_usd: 0.42,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 40,
    },
  };

  const { engine } = await engineWithClaude(
    t,
    `echo '${JSON.stringify(result)}'
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
  assert.partialDeepStrictEqual(engine.record("first").entries, [
    {
      usage: { usd: 0.42, tokens: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 } },
    },
  ]);
});

test("the Claude Code adapter reports the tokens so far after each message, counting each once", async (t) => {
  const message = (id: string, input: number) => ({
    type: "assistant",
    message: {
      id,
      content: [],
      usage: {
        input_tokens: input,
        output_tokens: 1,
        cache_read_input_tokens: 2,
        cache_creation_input_tokens: 3,
      },
    },
  });

  // claude splits a message with several blocks into events that each carry its usage.
  const events = [message("a", 10), message("a", 10), message("b", 5)];

  const { engine } = await engineWithClaude(
    t,
    events.map((event) => `echo '${JSON.stringify(event)}'`).join("\n"),
  );

  // It never reported a result, so the attempt fails, with the tokens it used recorded.
  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "escalated" });
  assert.partialDeepStrictEqual(engine.record("first").entries, [
    { usage: { tokens: { input: 15, output: 2, cacheRead: 4, cacheWrite: 6 } } },
  ]);
});

// 2026-11-09T14:00:00Z, as epoch seconds.
const reset = Date.UTC(2026, 10, 9, 14) / 1000;

/** A rate limit event as claude prints it, its window `type` in the state `status`. */
const rateLimit = (status: string, type: string) =>
  `echo '${JSON.stringify({
    type: "rate_limit_event",
    rate_limit_info: { status, rateLimitType: type, resetsAt: reset, utilization: 1 },
  })}'`;

for (const [type, window] of [
  ["five_hour", "five-hour"],
  ["seven_day", "weekly"],
  ["seven_day_opus", "weekly Opus"],
] as const) {
  test(`a Claude Code run refused by its ${window} usage window says when the window resets`, async (t) => {
    const { engine } = await engineWithClaude(
      t,
      `${rateLimit("rejected", type)}
       echo '{"type":"result","subtype":"error_during_execution","is_error":true}'`,
    );

    const said = `Claude Code's ${window} usage window is used up; it resets at 2026-11-09T14:00:00.000Z.`;

    assert.partialDeepStrictEqual(await engine.advance("first"), { status: "escalated" });
    assert.match(engine.errors("first", 1).toString(), new RegExp(`^${RegExp.escape(said)}$`, "m"));
    assert.partialDeepStrictEqual(engine.record("first").entries, [
      { notes: [{ note: said, from: "step" }] },
    ]);
  });
}

test("a Claude Code run warned of its usage window that succeeds says nothing of it", async (t) => {
  const { engine } = await engineWithClaude(
    t,
    `${rateLimit("allowed_warning", "five_hour")}
     ${succeeded}
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
  assert.doesNotMatch(engine.errors("first", 1).toString(), /usage window/);
});

// A fake claude that keeps a conversation, as the real one does, under its home's projects by
// session id; on --resume, it keeps the conversation it was given in `restored`, and every session
// id it was given in `ids`.
const conversing = `id=; resumed=
  for arg in "$@"; do
    [ "$previous" = --session-id ] && id=$arg
    [ "$previous" = --resume ] && resumed=$arg
    previous=$arg
  done
  echo "$id" >> "\${0%/claude}/ids"
  [ -n "$resumed" ] && cat "$HOME"/.claude/projects/*/"$resumed".jsonl > "\${0%/claude}/restored"
  mkdir -p "$HOME/.claude/projects/-workspace"
  echo "conversation of $id" > "$HOME/.claude/projects/-workspace/$id.jsonl"
  ${succeeded}
  echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`;

test("the Claude Code adapter keeps claude's session, and a later step continues it as a fork", async (t) => {
  const { engine, directory } = await engineWithClaude(t, conversing, [], {}, "Plan the change.", {
    agent: true,
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });

  const [first, second] = (await readFile(join(directory, "ids"), "utf8")).trim().split("\n");

  // The conversation is the one the first attempt had, in a home that is fresh for each attempt.
  assert.equal(await readFile(join(directory, "restored"), "utf8"), `conversation of ${first}\n`);
  assert.notEqual(first, second);

  const argv = await argumentsOf(directory);

  assert.equal(valueOf(argv, "--resume"), first);
  assert.equal(valueOf(argv, "--session-id"), second);
  assert.ok(argv.includes("--fork-session"));
  assert.equal(valueOf(argv, "--system-prompt-snapshot"), "off");
  assert.match(
    await readFile(join(directory, "prompt"), "utf8"),
    /You are continuing your earlier conversation[^]*rebuilt from\s+the latest commit/,
  );
});

test("the Claude Code adapter starts fresh when the step it continues left no session yet", async (t) => {
  const { engine, directory } = await engineWithClaude(t, conversing, [], {}, "Plan.", {
    command: `echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });
  assert.ok(!(await argumentsOf(directory)).includes("--resume"));
});

test("the Claude Code adapter refuses to continue another harness's session", async (t) => {
  const { engine } = await engineWithClaude(t, conversing, [], {}, "Plan.", {
    command: `echo '{"harness":"codex","id":"x","conversation":""}' > "$MEDRENGARD_OUT/session"
      echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  });

  assert.partialDeepStrictEqual(await engine.advance("first"), {
    status: "escalated",
    cause: "exit",
    reason: "Step plan exited with code 1.",
  });
  assert.match(
    engine.errors("first", 2).toString(),
    /^The session to continue is codex's, not Claude Code's\.$/m,
  );
});

test("the Claude Code adapter stops claude that did not continue the session as a fork", async (t) => {
  // The second attempt says it runs a session other than the one it was given.
  const { engine } = await engineWithClaude(
    t,
    `if [ -e "\${0%/claude}/once" ]; then
       ${initOf({ tools: ["Bash", "Read", "Edit", "Write"], session_id: "not-the-fork" })}
       sleep 5
     fi
     touch "\${0%/claude}/once"
     ${conversing}`,
    [],
    {},
    "Plan.",
    { agent: true },
  );

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "escalated" });
  assert.match(
    engine.errors("first", 2).toString(),
    /^Claude Code did not continue the session as a fork: it ran not-the-fork\.$/m,
  );
});

test("the Claude Code adapter records that claude did not say what it loaded", async (t) => {
  const { engine, directory } = await engineWithClaude(
    t,
    `echo '{"type":"result","is_error":false}'
     echo '{"outcome":"done"}' > "$MEDRENGARD_OUT/output.json"`,
  );

  const unsaid = "Claude Code did not say what it loaded.";

  assert.partialDeepStrictEqual(await engine.advance("first"), { status: "finished" });

  const session = valueOf(await argumentsOf(directory), "--session-id")!;

  assert.partialDeepStrictEqual(engine.record("first").entries, [
    {
      outcome: "done",
      notes: [
        { note: `Claude Code, version unknown, session ${session}.`, from: "step" },
        { note: unsaid, from: "step" },
      ],
      errors: true,
    },
  ]);
  assert.equal(engine.errors("first", 1).toString(), `${unsaid}\n`);
});

// The installed claude itself, through the adapter and the default access, refused at its first
// request by an invalid token, so it costs nothing: it says what it loaded before it asks. A new
// Claude Code that loads something more, such as a built-in plugin, fails this test, not a paid run.
const installed = join(homedir(), ".local", "bin", "claude");

/** claudeCode's access, its broker reading the token from `token`. */
function withToken(token: string) {
  const { anthropic } = claudeCode.network.brokers;

  return {
    ...claudeCode,
    network: { hosts: [], brokers: { anthropic: [...anthropic, "--token", token] } },
  } as const;
}

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
                  run: ["node", adapter, "--permission-mode", "bypassPermissions"],
                },
                model: "sonnet",
                prompt: "Plan the change.",
              },
              inputs: {},
              on: { done: "end" },
              budget: 1,
              access: withToken(join(directory, "token")),
              limits: { idle: 30, attempt: 60, transcript: 1024 * 1024, input: 1024 * 1024 },
            },
          },
        }),
      },
    });

    engine.commission("build", { title: "Greet", body: "Say hello." }, { name: "first" });

    // The refused token fails the run; what matters is what claude said it loaded first.
    assert.equal((await engine.advance("first")).status, "escalated");

    const errors = engine.errors("first", 1).toString();

    // claudeCode reaches the model API only through its broker: the API refused the token the
    // broker added, so the request reached it, and nothing was refused on the way.
    assert.match(engine.transcript("first", 1).toString(), /"error_status":401/);
    assert.deepEqual(
      engine
        .record("first")
        .entries.flatMap((entry) =>
          entry.entry === "attempt" ? entry.notes.filter(({ from }) => from === "engine") : [],
        ),
      [],
    );
    assert.doesNotMatch(errors, /did not say what it loaded/);
    assert.doesNotMatch(errors, /loaded what the agent did not declare: .*/);
    assert.doesNotMatch(errors, /did not apply|could not load|did not load|nonessential/);
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

    const adapted = spawn(process.execPath, [adapter, "--permission-mode", "bypassPermissions"], {
      cwd: workspace,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        TMPDIR: directory,
        MEDRENGARD_IN: input,
        MEDRENGARD_OUT: output,
        // In its broker's place, a model API that refuses every request.
        MEDRENGARD_BROKER_ANTHROPIC: await upstreamRecording(t, join(directory, "upstream")),
        CLAUDE_CODE_MAX_RETRIES: "0",
      },
      // fd 4 is the step's usage reports, as the engine gives it.
      stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
    });

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

    // The installed claude says it sends no telemetry, as the adapter's environment asks.
    assert.doesNotMatch(said, /nonessential/);

    // Which claude ran, as it says itself, in the session the adapter gave it.
    const version = execFileSync(installed, ["--version"], { encoding: "utf8" }).split(" ")[0];

    assert.match(
      said,
      new RegExp(`^Claude Code ${version.replaceAll(".", "\\.")}, session [0-9a-f-]{36}\\.$`, "m"),
    );
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

test(
  "the installed Claude Code continues, as a fork, the session a refused attempt left",
  { skip: !existsSync(installed) && "Claude Code is not installed", timeout: 120_000 },
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
                  run: ["env", "CLAUDE_CODE_MAX_RETRIES=0", "node", adapter],
                },
                model: "sonnet",
                prompt: "Plan the change.",
              },
              // Its own latest session: none at first, then the one its refused attempt left.
              inputs: { earlier: { session: "plan" } },
              on: { done: "end" },
              budget: 2,
              access: withToken(join(directory, "token")),
              limits: { idle: 30, attempt: 60, transcript: 1024 * 1024, input: 1024 * 1024 },
            },
          },
        }),
      },
    });

    engine.commission("build", { title: "Greet", body: "Say hello." }, { name: "first" });

    // Refused at its first request, it still leaves the session claude wrote.
    assert.equal((await engine.advance("first")).status, "escalated");

    const state = engine.state("first");

    assert.ok(state.status === "escalated");
    engine.decide("first", { subject: state.subject, since: state.since, outcome: "retry" });

    assert.equal((await engine.advance("first")).status, "escalated");

    // The retry was given the session the refused attempt left: it did not start afresh.
    const events = engine.events(0).map(({ event }) => event);
    const left = events.find((event) => event.type === "escalated" && event.attempt === 1);
    const retried = events.findLast((event) => event.type === "attempt-started");

    assert.ok(left?.type === "escalated" && left.session !== undefined);
    assert.ok(retried?.type === "attempt-started");
    assert.deepEqual(retried.inputs, [{ name: "earlier", hashes: [left.session] }]);

    const errors = engine.errors("first", 2).toString();

    assert.doesNotMatch(errors, /did not continue the session|session to continue/);
    assert.doesNotMatch(errors, /did not say what it loaded|did not apply|did not load/);
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
  printf '%s' "$CLAUDE_CODE_OAUTH_TOKEN" > "${join(directory, "dry-token")}"
  ${dry}
  exit 1
fi
printf '%s\\0' "$@" > "${join(directory, "arguments")}"
printf '%s' "$CLAUDE_CODE_OAUTH_TOKEN" > "${join(directory, "token")}"
[ -t 0 ] && echo yes > "${join(directory, "terminal")}"
printf '%s' "$DISABLE_AUTOUPDATER" > "${join(directory, "updater")}"
printf '%s' "$CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC" > "${join(directory, "traffic")}"
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
    // As the forwarder names it; the fake claude never reaches it.
    "MEDRENGARD_BROKER_ANTHROPIC=http://127.0.0.1:9",
    process.execPath,
    adapter,
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
    token: await recorded("token"),
    terminal: await recorded("terminal"),
    system: await recorded("system"),
    claudeJson: await recorded("claude.json"),
    updater: await recorded("updater"),
    traffic: await recorded("traffic"),
  };
}

test("the Claude Code adapter runs an attended agent's claude in the owner's terminal, its prompt the system's", async (t) => {
  const run = await attendedAdapter(t);

  assert.equal(run.code, 0);
  assert.equal(run.terminal, "yes\n");

  // It cannot update itself in its sandbox, and would say so on the owner's screen.
  assert.equal(run.updater, "1");
  assert.equal(run.traffic, "1");

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
  assert.equal(
    run.notes,
    `Claude Code, version unknown, session ${valueOf(run.arguments, "--session-id")}.\n`,
  );
});

test("the Claude Code adapter notes an attended agent's version from its dry run, and the session it gave it", async (t) => {
  const run = await attendedAdapter(
    t,
    [],
    undefined,
    `${initOf({ tools: ["Bash", "Read", "Edit", "Write"], claude_code_version: "2.1.319" })}
     sleep 30`,
  );

  const session = valueOf(run.arguments, "--session-id")!;

  assert.equal(run.code, 0);
  assert.match(session, uuid);

  // The dry run keeps no session, so the session's id is free for the session.
  assert.ok(run.dryArguments.includes("--no-session-persistence"));
  assert.ok(!run.dryArguments.includes("--session-id"));
  assert.equal(run.notes, `Claude Code 2.1.319, session ${session}.\n`);
});

test("the Claude Code adapter first runs an attended agent's claude headless, to check what it loads", async (t) => {
  const run = await attendedAdapter(t);

  assert.equal(run.code, 0);

  // The session's own flags, headless and streamed, with a token its broker refuses, so the dry
  // run stops at its first request and costs nothing; the session has the placeholder.
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
  assert.notEqual(run.dryToken, "medrengard-broker");
  assert.equal(run.token, "medrengard-broker");
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
    `Claude Code loaded what the agent did not declare: tools ["WebFetch"].
Claude Code, version unknown, session ${valueOf(run.arguments, "--session-id")}.
`,
  );
});

test("the Claude Code adapter records the instructions an attended agent's claude loaded", async (t) => {
  const run = await attendedAdapter(t, [], undefined, loadedOnly, instructionsLoaded);

  assert.equal(run.code, 0);
  assert.equal(
    run.notes,
    `Claude Code, version unknown, session ${valueOf(run.arguments, "--session-id")}.
Claude Code loaded instructions the agent did not declare: /workspace/CLAUDE.md at session_start.
`,
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
