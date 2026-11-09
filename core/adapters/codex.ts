/**
 * The Codex harness adapter: runs the step's agent through `codex exec` and exits as it does. The
 * agent writes the claim itself, so the engine judges it like any step's. Unattended only.
 *
 * Usage: codex.ts [--effort low|medium|high|xhigh]
 *
 * Codex runs in a Codex home of its own, made for the attempt, which loads only what the agent
 * declares: no AGENTS.md, rules, bundled skills, plugins, MCP servers or other agents. What it
 * loaded is checked before its first request reaches the model: a Codex that did not load a
 * declared skill is stopped and the attempt fails; one that loaded more is recorded and runs on.
 * It runs with no sandbox or approvals of its own: the step's sandbox is its boundary.
 *
 * Codex reaches the model only through the step's broker `openai`, codex-broker.ts, which holds
 * Medrengard's Codex login outside the step's sandbox: Codex runs on a fake login, so the
 * credential is nowhere the agent could read it. Codex reports tokens, never their cost, so its
 * agents' harness says `costs: false`.
 */
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { placeholder } from "./broker.ts";
import { fakeLogin, pinnedVersion } from "./codex-login.ts";
import {
  continuedOf,
  failed,
  input,
  keptOf,
  note,
  output,
  promptOf,
  readGiven,
  report,
  reportUsage,
  type Counted,
  type Kept,
} from "./contract.ts";

const usage = "Usage: codex.ts [--effort low|medium|high|xhigh]";

// Exits as a usage error, which the engine records as the attempt's errors.
function refuse(problem: string): never {
  console.error(`${problem}\n${usage}`);
  process.exit(2);
}

let options;

try {
  ({ values: options } = parseArgs({ options: { effort: { type: "string" } } }));
} catch (error) {
  refuse(error instanceof Error ? error.message : String(error));
}

const efforts = ["low", "medium", "high", "xhigh"];
const { effort } = options;

if (effort !== undefined && !efforts.includes(effort)) {
  refuse(`The effort must be one of ${efforts.join(", ")}, not ${effort}.`);
}

// Where the step reaches its broker, which the forwarder in its sandbox names.
const broker = process.env.MEDRENGARD_BROKER_OPENAI;

if (broker === undefined) {
  refuse(
    "Codex reaches the model only through the broker openai, which this step's access does not name: give it codex's network.",
  );
}

const given = readGiven();

if (given.attended) {
  refuse("Codex steps are unattended only.");
}

// The Codex this adapter is written for: its login, routing and session files are Codex's own,
// and change between releases.
let version: string;

try {
  version = execFileSync("codex", ["--version"], { encoding: "utf8" }).trim().split(" ").at(-1)!;
} catch (error) {
  failed(`Cannot run codex: ${error instanceof Error ? error.message : String(error)}.`);
}

if (version !== pinnedVersion) {
  failed(`Codex ${version} is not ${pinnedVersion}, the version this adapter is written for.`);
}

const continued = continuedOf(given);
const prompt = promptOf(given);

// The attempt's Codex home: the fake login, and configuration that loads only what is declared.
// Under the step's home, which codex's access makes empty: Codex declines to set up its helpers
// under /tmp, and says so on every run. Removed once the session is kept.
const codexHome = mkdtempSync(join(homedir(), ".medrengard-codex-"));

writeFileSync(join(codexHome, "auth.json"), fakeLogin(), { mode: 0o600 });

const configuration = [
  `model = ${JSON.stringify(given.agent.model)}`,
  `openai_base_url = ${JSON.stringify(`${broker}/v1`)}`,
  `chatgpt_base_url = ${JSON.stringify(`${broker}/backend-api/`)}`,
  // No AGENTS.md: Codex has no switch to turn it off, but reads none of no bytes.
  "project_doc_max_bytes = 0",
  'approval_policy = "never"',
  'sandbox_mode = "danger-full-access"',
  'cli_auth_credentials_store = "file"',
  ...(effort === undefined ? [] : [`model_reasoning_effort = ${JSON.stringify(effort)}`]),
  // No plugins, other agents or ChatGPT's apps, whose client asks the backend for its tools.
  "[features]",
  "plugins = false",
  "multi_agent = false",
  "apps = false",
  "[skills.bundled]",
  "enabled = false",
  // No analytics or metrics to OpenAI: the step reaches nothing but the model.
  "[analytics]",
  "enabled = false",
  "[otel]",
  'metrics_exporter = "none"',
];

writeFileSync(join(codexHome, "config.toml"), `${configuration.join("\n")}\n`);

// The declared skills, where Codex finds a user's: under the home, which is the attempt's own.
const declared = given.agent.skills.map(({ name }) => name);

for (const { name, path } of given.agent.skills) {
  cpSync(join(input, path), join(homedir(), ".agents", "skills", name), { recursive: true });
}

const sessions = join(codexHome, "sessions");

// The session the step continues, restored where Codex finds it, and the flags that continue it
// as a fork: the stored session never changes, and a session Codex cannot find fails.
function restored(): string[] {
  if (continued === undefined) {
    return [];
  }

  const kept = keptOf(continued, "codex", "Codex");
  const day = join(sessions, "2000", "01", "01");

  mkdirSync(day, { recursive: true });
  writeFileSync(join(day, `rollout-2000-01-01T00-00-00-${kept.id}.jsonl`), kept.conversation);

  return ["fork", kept.id];
}

const forking = restored();

// The session file of the thread `id`, once Codex has written it.
function sessionFile(id: string): string | undefined {
  if (!existsSync(sessions)) {
    return undefined;
  }

  const found = readdirSync(sessions, { withFileTypes: true, recursive: true }).find(
    (entry) => entry.isFile() && entry.name.endsWith(`-${id}.jsonl`),
  );

  return found === undefined ? undefined : join(found.parentPath, found.name);
}

// What Codex says it loaded, in the state it records before its first request to the model.
type Loaded = {
  agents_md?: object;
  host_skills?: { body?: string };
  plugins_instructions?: boolean;
};

// The loaded state of the session file at `file`, if it holds one yet.
function loadedIn(file: string): Loaded | undefined {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    try {
      const entry = JSON.parse(line);

      if (entry?.type === "world_state") {
        return entry.payload?.state ?? {};
      }
    } catch {
      // A line still being written.
    }
  }

  return undefined;
}

// The skills a loaded state lists, by name.
const skillsOf = (loaded: Loaded) =>
  [...(loaded.host_skills?.body ?? "").matchAll(/^- ([^:\n]+): /gm)].map(([, name]) => name!);

// Why a Codex that loaded `loaded` must not run, if it must not; what it loaded that the agent did
// not declare is recorded, and it runs on.
function unfitOf(loaded: Loaded): string | undefined {
  const skills = skillsOf(loaded);
  const missing = declared.filter((name) => !skills.includes(name));
  const extra = skills.filter((name) => !declared.includes(name));

  if (extra.length > 0) {
    report(`Codex loaded skills the agent did not declare: ${extra.join(", ")}.`);
  }

  if (Object.keys(loaded.agents_md ?? {}).length > 0) {
    return "Codex loaded AGENTS.md, which the adapter keeps out.";
  }

  if (loaded.plugins_instructions === true) {
    return "Codex loaded plugins, which the adapter keeps out.";
  }

  return missing.length > 0 ? `Codex did not load the skills ${missing.join(", ")}.` : undefined;
}

// How long Codex has to say what it loaded, in milliseconds, and how often it is looked for.
const loadWait = 30_000;
const loadLook = 50;

const codex = spawn(
  "codex",
  [
    "exec",
    "--json",
    "--strict-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    ...forking,
    "-",
  ],
  {
    env: { ...process.env, CODEX_HOME: codexHome, NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1" },
    stdio: ["pipe", "pipe", "inherit"],
  },
);

codex.stdin.on("error", () => {});

codex.stdin.end(prompt);

let thread: string | undefined;
let checked = false;
let stopped: string | undefined;

// Checks what Codex loaded once it says, then lets its first request reach the model, or stops it.
async function startOnceLoaded(id: string): Promise<void> {
  const deadline = Date.now() + loadWait;

  while (Date.now() < deadline && codex.exitCode === null) {
    const file = sessionFile(id);
    const loaded = file === undefined ? undefined : loadedIn(file);

    if (loaded !== undefined) {
      const unfit = unfitOf(loaded);

      if (unfit !== undefined) {
        stopped = unfit;
        codex.kill();

        return;
      }

      checked = true;
      await fetch(`${broker}/medrengard/start`, {
        method: "POST",
        headers: { authorization: `Bearer ${placeholder}` },
      });

      return;
    }

    await new Promise((resolve) => setTimeout(resolve, loadLook));
  }

  if (codex.exitCode === null) {
    stopped = "Codex did not say what it loaded.";
    codex.kill();
  }
}

// The tokens of each turn that completed, summed, as the usage so far.
const total: Counted = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

type Item = {
  type?: string;
  text?: string;
  message?: string;
  command?: string;
  exit_code?: number | null;
  status?: string;
  changes?: { path: string; kind: string }[];
};

type Event = {
  type?: string;
  thread_id?: string;
  item?: Item;
  message?: string;
  error?: { message?: string };
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    cache_write_input_tokens?: number;
    output_tokens?: number;
  };
};

let finished = false;
let failure: string | undefined;

// What the agent says, each command it runs and each file it changes, and how its turn ended.
function notesOf(event: Event): void {
  if (event.type === "thread.started" && event.thread_id !== undefined) {
    thread = event.thread_id;
    note(`Codex ${version}, session ${thread}.`);
    void startOnceLoaded(thread);
  }

  const { item } = event;

  if (event.type === "item.completed" && item !== undefined) {
    if (item.type === "agent_message" && item.text !== undefined) {
      note(item.text);
    } else if (item.type === "command_execution" && item.command !== undefined) {
      const ended =
        item.exit_code === 0 || item.exit_code == null ? "" : ` (exit ${item.exit_code})`;

      note(`Codex ran: ${item.command}${ended}`);
    } else if (item.type === "file_change" && item.changes !== undefined) {
      note(`Codex changed ${item.changes.map(({ path, kind }) => `${path} (${kind})`).join(", ")}`);
    } else if (item.type === "error" && item.message !== undefined) {
      note(item.message);
    }
  }

  if (event.type === "turn.completed" && event.usage !== undefined) {
    const { usage: tokens } = event;
    const cached = tokens.cached_input_tokens ?? 0;

    total.input += (tokens.input_tokens ?? 0) - cached;
    total.output += tokens.output_tokens ?? 0;
    total.cacheRead += cached;
    total.cacheWrite += tokens.cache_write_input_tokens ?? 0;
    reportUsage({ tokens: { ...total } });
    finished = true;
  }

  if (event.type === "turn.failed") {
    failure = `Codex's turn failed: ${event.error?.message ?? "no reason given"}.`;
  }
}

// stdout is read, to note what the agent does, and passed on unchanged as the transcript.
createInterface({ input: codex.stdout }).on("line", (line) => {
  process.stdout.write(`${line}\n`);

  try {
    notesOf(JSON.parse(line));
  } catch {
    // Not an event, such as a warning: in the transcript only.
  }
});

const closed = await once(codex, "close").catch((error: NodeJS.ErrnoException) => error);

// However it ended: a failed attempt's conversation may be continued too.
const file = thread === undefined ? undefined : sessionFile(thread);

if (file !== undefined && thread !== undefined) {
  const kept: Kept = {
    harness: "codex",
    version,
    id: thread,
    conversation: readFileSync(file, "utf8"),
  };

  writeFileSync(join(output, "session"), JSON.stringify(kept));
}

rmSync(codexHome, { recursive: true, force: true });

if (closed instanceof Error) {
  console.error(`codex could not start: ${closed.code}.`);
  process.exitCode = 127;
} else if (stopped !== undefined) {
  failed(stopped);
} else {
  const [code] = closed;

  const why =
    failure ??
    (code === 0 && !finished ? "Codex ended without finishing its turn." : undefined) ??
    (code === 0 && !checked ? "Codex did not say what it loaded." : undefined);

  if (why !== undefined) {
    report(why);
  }

  process.exitCode = why === undefined ? (code ?? 1) : 1;
}
