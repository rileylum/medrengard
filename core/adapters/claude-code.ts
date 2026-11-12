/**
 * The Claude Code harness adapter: runs the step's agent through `claude -p` and exits as it does;
 * at an attended step, as an interactive session in the owner's terminal, which ends when they
 * exit it. The agent writes the claim itself, so the engine judges it like any step's.
 *
 * Usage: claude-code.ts [--permission-mode acceptEdits|bypassPermissions] [--tools <names>]
 *                       [--effort low|medium|high|xhigh|max] [--max-budget-usd <dollars>]
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
 * claude reaches the model only through the step's broker `anthropic`, claude-code-broker.ts,
 * which holds the subscription token outside the step's sandbox: claude has a placeholder in its
 * place, so the token is nowhere the agent could read it. claude runs in the step's sandbox, so
 * what the agent runs may make namespaces of its own only if the step's access grants sandboxes.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";
import { parseArgs } from "node:util";
import { placeholder } from "./broker.ts";
import {
  continuedOf,
  input,
  keptOf,
  note,
  output,
  promptOf,
  readGiven,
  report,
  reportUsage,
  type Counted,
  type Given,
  type Kept,
  type Usage,
} from "./contract.ts";

const usage = `Usage: claude-code.ts [--permission-mode acceptEdits|bypassPermissions] [--tools <names>]
                      [--effort low|medium|high|xhigh|max] [--max-budget-usd <dollars>]`;

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

// Where the step reaches its broker, which the forwarder in its sandbox names.
const broker = process.env.MEDRENGARD_BROKER_ANTHROPIC;

if (broker === undefined) {
  refuse(
    "claude reaches the model only through the broker anthropic, which this step's access does not name: give it claudeCode's network.",
  );
}

const given = readGiven();

const { attended } = given;

if (attended && budget !== undefined) {
  refuse("A budget bounds only an unattended agent: claude keeps --max-budget-usd only with -p.");
}

// How an attended agent works with the owner, and when its claim is made.
const together = `

The owner is with you in this session. Work on the step with them, and write output.json once
they agree it is done. If they then want changes, make them and write it again; tell them each
time you write it. They end the session with /exit, and the last output.json you wrote is your
claim.`;

const continued = continuedOf(given);
const prompt = promptOf(given, attended ? together : "");

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
// that its init would not list. Absent, and under a read-only /etc, none can load or be written.
// lazy: refused rather than hidden, the step's access having no read-only empty path; add one once
// a machine with managed settings runs agents.
const managed = "/etc/claude-code";

if (existsSync(managed)) {
  refuse(
    `${managed}, where Claude Code reads managed settings no flag turns off, exists in the step's sandbox, so claude would not load only what the agent declares.`,
  );
}

// CLAUDE.md loads as Claude Code's own, not through a plugin, so only this variable keeps it out.
// No telemetry, error reports or feature flags: flags fetched from Anthropic could change how
// claude behaves between attempts of one commission, so it runs on its own defaults.
// claude speaks plain HTTP to its broker on loopback, not through the step's proxy.
const claudeEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  ANTHROPIC_BASE_URL: broker,
  NO_PROXY: "127.0.0.1",
  no_proxy: "127.0.0.1",
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

// Starts claude, with `session` before its configuration and `credential` as its token: the
// placeholder its broker replaces, or another, which the broker refuses. stdin, when piped, is
// given `prompt`: Linux refuses one argument over 128 KiB. Headless, it leads a process group of
// its own, so stopping it stops what it started; in the terminal it must stay in the foreground.
function start(
  session: string[],
  credential: string,
  stdio: ("inherit" | "pipe" | "ignore")[],
  prompt?: string,
): ChildProcess {
  const claude = spawn("claude", [...session, ...configuration], {
    env: { ...claudeEnvironment, CLAUDE_CODE_OAUTH_TOKEN: credential },
    stdio,
    detached: stdio[1] === "pipe",
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

  return claude;
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
    id?: string;
    content?: { type: string; text?: string; name?: string; input?: ToolInput }[];
    // The tokens this message used, the same on each event claude splits it into.
    usage?: Tokens;
  };
  // Every message's tokens together, in its result event.
  usage?: Tokens;
  // The account's usage limit, in a rate_limit_event; on an API error, in its parameters.
  rate_limit_info?: RateLimit;
  api_error_params?: { rate_limit_info?: RateLimit };
  is_error?: boolean;
  // The tools claude refused the agent, in its result event.
  permission_denials?: { tool_name: string; tool_input?: ToolInput }[];
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
};

// The account's usage limit as claude reports it: whether requests are refused, the window that
// refuses them and when it resets, in epoch seconds.
type RateLimit = { status?: string; rateLimitType?: string; resetsAt?: number };

// What the owner calls each window claude names.
const windows = new Map([
  ["five_hour", "five-hour"],
  ["seven_day", "weekly"],
  ["seven_day_opus", "weekly Opus"],
  ["seven_day_sonnet", "weekly Sonnet"],
  ["seven_day_overage_included", "weekly extra usage"],
  ["overage", "extra usage"],
]);

// claude keeps a conversation under its home's projects, in a directory named for the working
// directory with every character but letters and digits as -.
const conversations = join(homedir(), ".claude", "projects");
const project = join(conversations, process.cwd().replace(/[^A-Za-z0-9]/g, "-"));

// Restores the session the step continues where claude finds it, and returns the flags that
// continue it as a fork: the stored session never changes. A session claude cannot continue, such
// as another harness's, fails the attempt rather than start afresh.
function restored(): string[] {
  if (continued === undefined) {
    return [];
  }

  const kept = keptOf(continued, "claude-code", "Claude Code");

  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, `${kept.id}.jsonl`), kept.conversation);

  // The step's own contract, not the one the conversation began with.
  return ["--resume", kept.id, "--fork-session", "--system-prompt-snapshot", "off"];
}

// Keeps the conversation claude had in this attempt, if it wrote one, in the output, where the
// engine records it as the attempt's session however the attempt ends.
function keep(version: string | undefined): void {
  if (!existsSync(conversations)) {
    return;
  }

  const file = readdirSync(conversations, { withFileTypes: true, recursive: true }).find(
    (entry) => entry.isFile() && entry.name === `${sessionId}.jsonl`,
  );

  if (file === undefined) {
    return;
  }

  const kept: Kept = {
    harness: "claude-code",
    id: sessionId,
    conversation: readFileSync(join(file.parentPath, file.name), "utf8"),
  };

  if (version !== undefined) {
    kept.version = version;
  }

  writeFileSync(join(output, "session"), JSON.stringify(kept));
}

// The latest refusal by the account's usage limit, if claude reported one.
let refused: RateLimit | undefined;

// Tokens as the Anthropic API counts them.
type Tokens = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

// Tokens as the step contract's usage report counts them.
const counted = (tokens: Tokens): Counted => ({
  input: tokens.input_tokens ?? 0,
  output: tokens.output_tokens ?? 0,
  cacheRead: tokens.cache_read_input_tokens ?? 0,
  cacheWrite: tokens.cache_creation_input_tokens ?? 0,
});

// Each message's tokens, by its id, so a message claude splits over several events counts once.
const used = new Map<string, Tokens>();

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

    // A resumed session must be the fork it was given, or claude did not continue it.
    const forked =
      then === undefined && continued !== undefined && event.session_id !== sessionId
        ? [`Claude Code did not continue the session as a fork: it ran ${event.session_id}.`]
        : [];

    const unfit = [...unfitOf(event, startup.applied), ...forked];

    unfit.forEach(report);
    startup.stopped = unfit.length > 0;

    // Only a headless claude is followed, so it leads its group.
    if (startup.stopped || then === "stop") {
      process.kill(-claude.pid!, "SIGTERM");
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
// same claude runs headless with a token the broker refuses: it says what it loaded before its
// first request, which it would fail, and is stopped there. A start unfit to run opens no
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
  const limit = event.rate_limit_info ?? event.api_error_params?.rate_limit_info;

  if (limit?.status === "rejected") {
    refused = limit;
  }

  // The tokens so far after each message, so the engine knows them while the agent works; the
  // result's totals and cost replace them at the end.
  const { id, usage } = event.message ?? {};

  if (event.type === "assistant" && id !== undefined && usage !== undefined) {
    used.set(id, usage);

    const sum = [...used.values()].map(counted).reduce((total, each) => ({
      input: total.input + each.input,
      output: total.output + each.output,
      cacheRead: total.cacheRead + each.cacheRead,
      cacheWrite: total.cacheWrite + each.cacheWrite,
    }));

    reportUsage({ tokens: sum });
  }

  if (event.type === "result" && event.usage !== undefined) {
    const final: Usage = {
      tokens: counted(event.usage),
    };

    if (event.total_cost_usd !== undefined) {
      final.usd = event.total_cost_usd;
    }

    reportUsage(final);
  }

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

// The dry run continues it too, so restoring is checked before the owner's session opens.
configuration.push(...restored());

// The version claude said it is, kept with its session.
let version: string | undefined;

let claude: ChildProcess;

// How long a headless claude may take to exit once it has given its result, before it is stopped.
const resultGrace = 1000;
let afterResult: NodeJS.Timeout | undefined;
let stoppedAfterResult = false;

if (attended) {
  const session = attendedSession();

  const dry = await dryRun(session);

  if (dry.stopped) {
    process.exit(1);
  }

  if (dry.initialised) {
    note(identityOf(dry.version));
  }

  version = dry.version;

  // The terminal is claude's.
  claude = start(["Begin your step.", ...session, "--session-id", sessionId], placeholder, [
    "inherit",
    "inherit",
    "inherit",
  ]);
} else {
  // stdout is read, to note what the agent does, and passed on unchanged as the transcript.
  claude = start(
    [...headless, "--session-id", sessionId],
    placeholder,
    ["pipe", "pipe", "inherit"],
    prompt,
  );

  follow(claude, true, (event) => {
    startupOf(claude, event, startup);
    notesOf(event);

    // The agent has finished: claude may stay alive for a command it moved to the background,
    // until that ends or its own limit stops it. Given a moment to exit as it would, claude is
    // then stopped with all it started, and judged by its result.
    if (event.type === "result" && afterResult === undefined) {
      afterResult = setTimeout(() => {
        // A claude that exited itself keeps its own exit; only what it left holds its output.
        stoppedAfterResult = claude.exitCode === null && claude.signalCode === null;

        try {
          process.kill(-claude.pid!, "SIGTERM");
        } catch {
          // The group ended on its own meanwhile.
        }
      }, resultGrace);
    }
  });
}

const closed = await once(claude, "close").catch((error: NodeJS.ErrnoException) => error);

clearTimeout(afterResult);

instructionsOf();

// However it ended: a failed attempt's conversation may be continued too.
keep(version ?? startup.version);

if (!attended) {
  unsaid(startup);
}

if (closed instanceof Error) {
  console.error(`claude could not start: ${closed.code}.`);
  process.exitCode = 127;
} else if (startup.stopped) {
  // Why is already recorded.
  process.exitCode = 1;
} else {
  // A claude stopped after its result ended as its result says.
  const code = stoppedAfterResult ? 0 : closed[0];

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

  // A run the account's usage limit refused failed for no fault of the agent's: say which window,
  // and when it resets, so the owner retries then.
  if ((code !== 0 || failure !== undefined) && refused !== undefined) {
    const type = refused.rateLimitType;
    const window = type === undefined ? "usage limit" : `${windows.get(type) ?? type} usage window`;

    const when =
      refused.resetsAt === undefined
        ? ""
        : `; it resets at ${new Date(refused.resetsAt * 1000).toISOString()}`;

    report(`Claude Code's ${window} is used up${when}.`);
  }

  // A claude ended by a signal has no exit code; the attempt failed all the same.
  process.exitCode = failure === undefined ? (code ?? 1) : 1;
}
