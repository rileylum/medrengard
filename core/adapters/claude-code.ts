/**
 * The Claude Code harness adapter: runs the step's agent through `claude -p` and exits as it does;
 * at an attended step, as an interactive session in the owner's terminal, which ends when they
 * exit it. The agent writes the claim itself, so the engine judges it like any step's.
 *
 * Usage: claude-code.ts [--permission-mode acceptEdits|bypassPermissions] [--tools <names>]
 *                       [--effort low|medium|high|xhigh|max] [--max-budget-usd <dollars>]
 *                       [--token <file>]
 *
 * --max-budget-usd bounds only an unattended agent, so an attended one with it is refused.
 *
 * acceptEdits, the default, lets the agent edit files but not run commands. bypassPermissions
 * lets it do anything its step's access allows, so the sandbox is its only boundary. --tools is a
 * comma-separated list of Claude Code's tools, Bash,Read,Edit,Write unless given; an agent with
 * skills also gets Skill. Nothing else of Claude Code's own loads: no bundled skills or built-in
 * plugins, no settings files, no MCP servers, no memory, no CLAUDE.md, and no attribution in
 * commits. A claude that did not apply these settings or load a declared skill is stopped before
 * its first turn, and the attempt fails; one that loaded more is recorded and runs on.
 *
 * --token is the file holding the subscription token, ~/.config/medrengard/claude-token unless
 * given. claude runs in a nested sandbox of its own, with the token on a descriptor: nothing the
 * agent runs can see this adapter or the outer sandbox, whose environments and files are where the
 * token would otherwise be found.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Writable } from "node:stream";
import { parseArgs } from "node:util";

// The part of a kind the adapter explains to the agent.
type Kind = {
  description: string;
  fields: Record<string, { limit: number; required?: true; values?: string[] }>;
  body: { required: boolean; limit: number };
  outcome?: string;
};

// What the adapter reads from input.json; the engine writes the rest for the agent to read.
type Given = {
  outcomes: string[];
  attended: boolean;
  claims: Record<string, Kind>;
  agent: { model: string; prompt: string; skills: { name: string; path: string }[] };
};

const input = process.env.MEDRENGARD_IN!;
const output = process.env.MEDRENGARD_OUT!;

const usage = `Usage: claude-code.ts [--permission-mode acceptEdits|bypassPermissions] [--tools <names>]
                      [--effort low|medium|high|xhigh|max] [--max-budget-usd <dollars>]
                      [--token <file>]`;

// Exits as a usage error, which the engine records as the attempt's errors.
function refuse(problem: string): never {
  console.error(`${problem}\n${usage}`);
  process.exit(2);
}

let options;

try {
  ({ values: options } = parseArgs({
    options: {
      "permission-mode": { type: "string", default: "acceptEdits" },
      tools: { type: "string", default: "Bash,Read,Edit,Write" },
      effort: { type: "string" },
      "max-budget-usd": { type: "string" },
      token: { type: "string", default: join(homedir(), ".config", "medrengard", "claude-token") },
    },
  }));
} catch (error) {
  refuse(error instanceof Error ? error.message : String(error));
}

const modes = ["acceptEdits", "bypassPermissions"];
const efforts = ["low", "medium", "high", "xhigh", "max"];

const mode = options["permission-mode"];
const { effort } = options;
const budget = options["max-budget-usd"];
const tools = options.tools.split(",");

if (!modes.includes(mode)) {
  refuse(`The permission mode must be one of ${modes.join(", ")}, not ${mode}.`);
}

if (!tools.every((tool) => /^[A-Za-z]+$/.test(tool))) {
  refuse(`The tools must be tool names separated by commas, not ${JSON.stringify(options.tools)}.`);
}

if (effort !== undefined && !efforts.includes(effort)) {
  refuse(`The effort must be one of ${efforts.join(", ")}, not ${effort}.`);
}

if (budget !== undefined && !(Number(budget) > 0)) {
  refuse(`The budget must be a positive number of dollars, not ${budget}.`);
}

const tokenFile = resolve(options.token);

let token;

try {
  token = readFileSync(tokenFile, "utf8").trim();
} catch (error) {
  refuse(`Cannot read the token file: ${error instanceof Error ? error.message : String(error)}.`);
}

if (token === "") {
  refuse(`The token file ${tokenFile} is empty.`);
}

// SAFETY: the engine encodes input.json for an agent step with these fields.
const given = JSON.parse(readFileSync(join(input, "input.json"), "utf8")) as Given;

const { attended } = given;

if (attended && budget !== undefined) {
  refuse("A budget bounds only an unattended agent: claude keeps --max-budget-usd only with -p.");
}

// One line per field, saying what the claim's fields must hold.
const fieldsOf = (kind: Kind) =>
  Object.entries(kind.fields).map(
    ([field, { limit, required, values }]) =>
      `  - "${field}": ${required ? "required" : "optional"}, ${values ? `one of ${JSON.stringify(values)}` : `text of at most ${limit} bytes`}.`,
  );

const bodyOf = (kind: Kind) =>
  `  - "body": ${kind.body.required ? "required" : "optional"}, the path of a UTF-8 file you wrote in ${output}, relative to it, of at most ${kind.body.limit} bytes.`;

// Only the kinds the step may claim, so the agent is not told how to claim what it must not.
const kinds = Object.entries(given.claims).map(([name, kind]) =>
  [
    `- ${JSON.stringify(name)}: ${kind.description}`,
    ...fieldsOf(kind),
    bodyOf(kind),
    ...(kind.outcome === undefined ? [] : [`  Its "${kind.outcome}" must equal your outcome.`]),
  ].join("\n"),
);

const claiming =
  kinds.length === 0
    ? "Claim no artifacts."
    : `Each artifact is {"kind": ..., "fields": {...}, "body": ...}, of one of these kinds:\n${kinds.join("\n")}`;

// How an attended agent works with the owner, and when its claim is made.
const together = `

The owner is with you in this session. Work on the step with them, and write output.json once
they agree it is done. If they then want changes, make them and write it again; tell them each
time you write it. They end the session with /exit, and the last output.json you wrote is your
claim.`;

// lazy: the step contract as prompt text, here only. Share it between adapters once a second one
// needs it.
const contract = `You are a step in a workflow. Your inputs are in ${input}: input.json lists each
input's artifacts, and each body is the file its "body" names, relative to ${input}.

When you are done, write ${join(output, "output.json")} as JSON:
{"outcome": one of ${JSON.stringify(given.outcomes)}, "artifacts": [...]}.
Leave out "artifacts" to claim none. ${claiming}${attended ? together : ""}`;

const prompt = `${given.agent.prompt}\n\n${contract}`;

// Where claude's InstructionsLoaded hook writes each CLAUDE.md or rules file it loads, one JSON
// line each; the stream does not carry that hook's events.
const instructions = join(mkdtempSync(join(tmpdir(), "medrengard-hooks-")), "instructions.jsonl");

// Everything Claude Code loads of its own that these settings turn off, as 2.1.318 names it; design
// and doctor are bundled skills that disableBundledSkills leaves. claude ignores settings with an
// invalid value whole, silently, so the SessionStart hook is a canary: it runs only if they applied.
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
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "true" }] }],
    InstructionsLoaded: [
      { hooks: [{ type: "command", command: `{ cat; echo; } >> '${instructions}'` }] },
    ],
  },
};

// The agent's skills as one plugin, built outside the read-only input; its skills are named
// medrengard:<skill>.
function pluginOf(skills: Given["agent"]["skills"]): string {
  const plugin = mkdtempSync(join(tmpdir(), "medrengard-plugin-"));

  mkdirSync(join(plugin, ".claude-plugin"));
  writeFileSync(
    join(plugin, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "medrengard" }),
  );

  for (const { name, path } of skills) {
    cpSync(join(input, path), join(plugin, "skills", name), { recursive: true });
  }

  return plugin;
}

const { skills } = given.agent;

// The tools the agent declares: its harness's, and Skill when it has skills.
const declared = [...tools, ...(skills.length === 0 ? [] : ["Skill"])];

// Claude Code's managed settings, which --setting-sources cannot turn off: hooks and environment
// that its init would not list. Hidden, so only what the agent declares loads.
const managed = "/etc/claude-code";

// claude's own sandbox: a PID namespace and /proc of its own, so what the agent runs sees only
// claude and itself, and the token file and managed settings hidden; and no namespaces of the
// agent's own, which the step's access grants only for this one. Every other mount stays as the
// step's access made it.
const nested = [
  "--die-with-parent",
  "--unshare-user",
  "--disable-userns",
  "--unshare-pid",
  "--dev-bind",
  "/",
  "/",
  "--proc",
  "/proc",
  "--ro-bind",
  "/dev/null",
  tokenFile,
  // An empty directory needs a place to mount: only one that exists can be hidden, and one that
  // does not cannot load.
  ...(existsSync(managed) ? ["--size", "4096", "--tmpfs", managed, "--remount-ro", managed] : []),
  "--",
];

// The token goes only on fd 3, which claude reads once. In claude's environment the agent's
// commands could read it through /proc, so one the step was given is dropped.
const { CLAUDE_CODE_OAUTH_TOKEN: _, ...environment } = process.env;

// CLAUDE.md loads as Claude Code's own, not through a plugin, so only this variable keeps it out.
// No telemetry, error reports or feature flags: flags fetched from Anthropic could change how
// claude behaves between attempts of one commission, so it runs on its own defaults.
const claudeEnvironment: NodeJS.ProcessEnv = {
  ...environment,
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "3",
};

// An interactive claude would try to update itself, which its sandbox refuses, and say so on the
// owner's screen.
if (attended) {
  claudeEnvironment.DISABLE_AUTOUPDATER = "1";
}

// What claude loads and how it runs, the same for a session as for its dry run.
const configuration = [
  "--permission-mode",
  mode,
  // No MCP servers: none from the workspace's .mcp.json, nor any other configuration.
  "--strict-mcp-config",
  "--settings",
  JSON.stringify(hermetic),
  // Only these settings: none from the user's or the repository's settings files.
  "--setting-sources",
  "",
  ...(effort === undefined ? [] : ["--effort", effort]),
  ...(budget === undefined ? [] : ["--max-budget-usd", budget]),
  ...(skills.length === 0 ? [] : ["--plugin-dir", pluginOf(skills)]),
  // --add-dir and --tools each take a list, which the next flag ends.
  "--add-dir",
  input,
  output,
  "--tools",
  declared.join(","),
  "--model",
  given.agent.model,
];

// Streamed, so the engine sees output while the agent works, with the hooks that ran; plain -p
// prints only at the end, which the idle limit would stop.
const headless = ["-p", "--output-format", "stream-json", "--verbose", "--include-hook-events"];

// The attempt's session, chosen here so the record names it even when claude never says: an
// attended session does not. Random, as a commission's name is unique only within its log.
const sessionId = randomUUID();

// Starts claude in its sandbox, with `session` before its configuration and `secret` on fd 3.
// stdin, when piped, is given `prompt`: Linux refuses one argument over 128 KiB.
function start(
  session: string[],
  secret: string,
  stdio: ("inherit" | "pipe" | "ignore")[],
  prompt?: string,
): ChildProcess {
  const claude = spawn("bwrap", [...nested, "claude", ...session, ...configuration], {
    env: claudeEnvironment,
    stdio: [...stdio, "pipe"],
  });

  // A claude that ends before reading what it is given says why in its exit; the write has
  // nothing to add.
  const ignoreEnded = (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE" && error.code !== "ECONNRESET") {
      throw error;
    }
  };

  if (prompt !== undefined) {
    // SAFETY: stdin is a "pipe" when a prompt is given.
    const promptPipe = claude.stdin as Writable;

    promptPipe.on("error", ignoreEnded);
    promptPipe.end(prompt);
  }

  // SAFETY: stdio[3] is the "pipe" given above, which Node opens for the parent to write.
  const tokenPipe = claude.stdio[3] as Writable;

  tokenPipe.on("error", ignoreEnded);
  tokenPipe.end(secret);

  return claude;
}

// The longest note the adapter writes; a longer message is cut, and says so with "…".
const noteLength = 200;

// Writes one note for the owner to fd 3, the step contract's notes.
function note(text: string): void {
  const line = text.replace(/\s+/g, " ").trim();

  if (line !== "") {
    writeSync(3, `${line.length > noteLength ? `${line.slice(0, noteLength - 1)}…` : line}\n`);
  }
}

// Records a problem on stderr, as the attempt's errors, and in a note for the owner.
function report(problem: string): void {
  console.error(problem);
  note(problem);
}

// The parts of a tool's input that say what it did, as Claude Code's tools name them.
type ToolInput = {
  command?: string;
  file_path?: string;
  pattern?: string;
  path?: string;
  description?: string;
};

// A tool call as a note: the tool, and its command, file or pattern.
function toolNote(name: string, input: ToolInput): string {
  const said = input.command ?? input.file_path ?? input.pattern ?? input.path ?? input.description;

  return `${name}: ${said ?? JSON.stringify(input)}`;
}

// One stream-json event: what claude loaded, the hooks it ran, what the agent said, each tool it
// called, and how the run finished.
// lazy: only the event fields the notes need; the transcript keeps the rest.
type StreamEvent = {
  type?: string;
  subtype?: string;
  // A hook that ran, in its hook_response event.
  hook_event?: string;
  // Whether claude sends telemetry, in its init event.
  analytics_disabled?: boolean;
  // Which claude ran, and in what session, in its init event.
  claude_code_version?: string;
  session_id?: string;
  // What claude loaded, in its init event.
  tools?: string[];
  skills?: string[];
  plugins?: { name: string }[];
  plugin_errors?: { message?: string }[];
  mcp_servers?: { name: string }[];
  agents?: string[];
  message?: {
    content?: { type: string; text?: string; name?: string; input?: ToolInput }[];
  };
  is_error?: boolean;
  // The tools claude refused the agent, in its result event.
  permission_denials?: { tool_name: string; tool_input?: ToolInput }[];
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
};

// Records on stderr and in a note what claude loaded that the agent did not declare, and lets it
// run: a leak is for the owner to see and fix, not a reason to stop.
function leaksOf(init: StreamEvent): void {
  const extra = (loaded: string[], allowed: string[]) =>
    loaded.filter((name) => !allowed.includes(name));

  const leaks = Object.entries({
    tools: extra(init.tools ?? [], declared),
    skills: extra(
      init.skills ?? [],
      skills.map(({ name }) => `medrengard:${name}`),
    ),
    plugins: extra(
      (init.plugins ?? []).map(({ name }) => name),
      skills.length === 0 ? [] : ["medrengard"],
    ),
    "MCP servers": (init.mcp_servers ?? []).map(({ name }) => name),
    // Listed subagents can only start through Task.
    subagents: (init.tools ?? []).includes("Task") ? (init.agents ?? []) : [],
  }).flatMap(([what, names]) => (names.length === 0 ? [] : [`${what} ${JSON.stringify(names)}`]));

  if (leaks.length > 0) {
    report(`Claude Code loaded what the agent did not declare: ${leaks.join(", ")}.`);
  }

  // Its start has sent what it sends by the time init says so; stopping would save nothing.
  if (init.analytics_disabled === false) {
    report("Claude Code did not turn off its nonessential traffic: telemetry and error reports.");
  }
}

// Why claude, by its init, is not running the agent as declared: its settings not applied, or a
// declared skill or plugin not loaded. An agent without them is not the one the step names.
function unfitOf(init: StreamEvent, applied: boolean): string[] {
  const missing = (loaded: string[], wanted: string[]) =>
    wanted.filter((name) => !loaded.includes(name));

  const absent = Object.entries({
    skills: missing(
      init.skills ?? [],
      skills.map(({ name }) => `medrengard:${name}`),
    ),
    plugins: missing(
      (init.plugins ?? []).map(({ name }) => name),
      skills.length === 0 ? [] : ["medrengard"],
    ),
  }).flatMap(([what, names]) => (names.length === 0 ? [] : [`${what} ${JSON.stringify(names)}`]));

  return [
    ...(applied ? [] : ["Claude Code did not apply the adapter's settings."]),
    ...(absent.length === 0
      ? []
      : [`Claude Code did not load what the agent declared: ${absent.join(", ")}.`]),
    ...(init.plugin_errors ?? []).map(
      ({ message }) => `Claude Code could not load a plugin: ${message ?? "unnamed"}`,
    ),
  ];
}

// What claude said of its start: whether its settings applied, whether it said what it loaded and
// which version it is, and whether that stopped it.
type Startup = { applied: boolean; initialised: boolean; stopped: boolean; version?: string };

// Which claude ran the attempt, and in what session: the one it was given unless it says otherwise.
function identityOf(version?: string, ran?: string): string {
  const which = version === undefined ? "Claude Code, version unknown" : `Claude Code ${version}`;

  const session =
    ran === undefined || ran === sessionId
      ? sessionId
      : `${ran}, not ${sessionId}, which it was given`;

  return `${which}, session ${session}.`;
}

// Follows claude's start in its stream: at init, notes which claude it is, records its leaks and, if
// it is unfit, stops it before its first turn. `then` stops it anyway, as a dry run does, whose
// session is not the attempt's and goes unnoted.
function startupOf(
  claude: ChildProcess,
  event: StreamEvent,
  startup: Startup,
  then?: "stop",
): void {
  if (event.type === "system" && event.subtype === "hook_response") {
    startup.applied ||= event.hook_event === "SessionStart";
  }

  if (event.type === "system" && event.subtype === "init") {
    startup.initialised = true;
    startup.version = event.claude_code_version;

    if (then === undefined) {
      note(identityOf(event.claude_code_version, event.session_id));
    }

    leaksOf(event);

    const unfit = unfitOf(event, startup.applied);

    unfit.forEach(report);
    startup.stopped = unfit.length > 0;

    // bwrap's --die-with-parent ends claude with it.
    if (startup.stopped || then === "stop") {
      claude.kill("SIGTERM");
    }
  }
}

// Calls `each` with each stream-json event claude prints; `echo` passes its stdout on unchanged,
// as the transcript.
function follow(claude: ChildProcess, echo: boolean, each: (event: StreamEvent) => void): void {
  let partial = "";

  claude.stdout?.on("data", (chunk: Buffer) => {
    if (echo) {
      process.stdout.write(chunk);
    }

    const lines = (partial + chunk.toString()).split("\n");

    partial = lines.pop()!;

    for (const line of lines) {
      let event;

      try {
        event = JSON.parse(line);
      } catch {
        // Not stream-json, such as a warning: the transcript has it, and it is no note.
        continue;
      }

      each(event);
    }
  });
}

// Records that claude never said what it loaded; without that, nothing of its start was checked,
// and its version is unknown.
function unsaid(startup: Startup): void {
  if (!startup.initialised) {
    note(identityOf());
    report("Claude Code did not say what it loaded.");
  }
}

// Records each instruction file claude's hook said it loaded, once each: CLAUDE.md files can load
// at any point in a session, and a dry run's load again in it. What the agent runs could write
// there too, but only to add a leak, never to hide one.
function instructionsOf(): void {
  if (!existsSync(instructions)) {
    return;
  }

  const loaded = new Set(
    readFileSync(instructions, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .flatMap((line) => {
        try {
          // SAFETY: the InstructionsLoaded hook's input, as Claude Code documents it.
          const { file_path, load_reason } = JSON.parse(line) as {
            file_path?: string;
            load_reason?: string;
          };

          return [`${file_path} at ${load_reason}`];
        } catch {
          return [`an unreadable report: ${line}`];
        }
      }),
  );

  if (loaded.size > 0) {
    report(`Claude Code loaded instructions the agent did not declare: ${[...loaded].join(", ")}.`);
  }
}

// An attended agent's prompt is its system prompt, from a file: compacting a long session keeps
// it, and Linux refuses one argument over 128 KiB. The agent begins at once, as unattended.
// Claude Code's first-run questions, in a home that has never run it, are answered, so the
// session opens on the work.
function attendedSession(): string[] {
  const file = join(mkdtempSync(join(tmpdir(), "medrengard-prompt-")), "prompt.md");

  writeFileSync(file, prompt);

  const settings = join(homedir(), ".claude.json");

  if (!existsSync(settings)) {
    writeFileSync(
      settings,
      JSON.stringify({
        hasCompletedOnboarding: true,
        projects: { [process.cwd()]: { hasTrustDialogAccepted: true } },
      }),
    );
  }

  return ["--append-system-prompt-file", file];
}

// An interactive session draws on the terminal and says nothing of what it loaded. So first the
// same claude runs headless with a token that cannot authenticate: it says what it loaded before
// its first request, which it would fail, and is stopped there. A start unfit to run opens no
// session. The assumption, which nothing here checks: claude loads the same either way.
async function dryRun(session: string[]): Promise<Startup> {
  const dryStartup: Startup = { applied: false, initialised: false, stopped: false };

  const dry = start(
    // It keeps no session, which would take the attempt's id from the session after it.
    [...headless, "--no-session-persistence", ...session],
    "medrengard-dry-run",
    ["pipe", "pipe", "ignore"],
    "Begin your step.",
  );

  follow(dry, false, (event) => startupOf(dry, event, dryStartup, "stop"));
  await once(dry, "close").catch(() => undefined);
  unsaid(dryStartup);

  return dryStartup;
}

// The last result claude reported, which says whether its run succeeded; none if it never said.
let result: StreamEvent | undefined;

// What the agent says, each tool it calls, and how its run finished.
function notesOf(event: StreamEvent): void {
  if (event.type === "assistant") {
    for (const block of event.message?.content ?? []) {
      if (block.type === "text" && block.text !== undefined) {
        note(block.text);
      } else if (block.type === "tool_use" && block.name !== undefined) {
        note(toolNote(block.name, block.input ?? {}));
      }
    }
  }

  if (event.type === "result") {
    result = event;

    // Why an agent could not do what it tried, such as run the tests under acceptEdits: the
    // permission mode at work, so a note, not an error.
    for (const { tool_name, tool_input } of event.permission_denials ?? []) {
      note(`Claude Code denied ${toolNote(tool_name, tool_input ?? {})}`);
    }

    const how = event.is_error ? "Failed" : "Finished";

    note(
      `${how} in ${(event.duration_ms ?? 0) / 1000} s, ${event.num_turns} turns, $${event.total_cost_usd}.`,
    );
  }
}

const startup: Startup = { applied: false, initialised: false, stopped: false };

let claude: ChildProcess;

if (attended) {
  const session = attendedSession();

  const dry = await dryRun(session);

  if (dry.stopped) {
    process.exit(1);
  }

  if (dry.initialised) {
    note(identityOf(dry.version));
  }

  // The terminal is claude's.
  claude = start(["Begin your step.", ...session, "--session-id", sessionId], token, [
    "inherit",
    "inherit",
    "inherit",
  ]);
} else {
  // stdout is read, to note what the agent does, and passed on unchanged as the transcript.
  claude = start(
    [...headless, "--session-id", sessionId],
    token,
    ["pipe", "pipe", "inherit"],
    prompt,
  );

  follow(claude, true, (event) => {
    startupOf(claude, event, startup);
    notesOf(event);
  });
}

const closed = await once(claude, "close").catch((error: NodeJS.ErrnoException) => error);

instructionsOf();

if (!attended) {
  unsaid(startup);
}

if (closed instanceof Error) {
  console.error(`bwrap could not start claude: ${closed.code}.`);
  process.exitCode = 127;
} else if (startup.stopped) {
  // Why is already recorded.
  process.exitCode = 1;
} else {
  const [code] = closed;

  // claude can exit 0 from a run it reports as failed, or say nothing of how it ended: either way
  // a claim it left is not one to trust, so the attempt fails and the owner decides. An attended
  // session reports nothing; the owner was there to see how it ended.
  const failure =
    code !== 0 || attended
      ? undefined
      : result === undefined
        ? "claude ended without a result."
        : result.is_error === true
          ? `claude finished with an error: ${result.subtype ?? "unnamed"}.`
          : undefined;

  if (failure !== undefined) {
    console.error(failure);
  }

  // A claude ended by a signal has no exit code; the attempt failed all the same.
  process.exitCode = failure === undefined ? (code ?? 1) : 1;
}
